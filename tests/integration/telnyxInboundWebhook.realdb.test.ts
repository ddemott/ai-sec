/**
 * Real-DB coverage for POST /communications/telnyx/inbound — the inbound-SMS
 * webhook (phase 1 of docs/superpowers/specs/2026-07-11-sms-appointment-confirmation-design.md).
 *
 * TWO things are being pinned here, and the second is the important one.
 *
 * 1. FUNCTION: a customer who texts STOP is actually recorded in opt_out_records.
 *    Until this route existed, NOTHING in the app received an inbound text — the
 *    opt-out machinery (ConsentService.processOptOutCommand) was fully written but
 *    unreachable, so a STOP reply to any of our messages was silently dropped.
 *    That is a live compliance gap, and it is what phase 1 closes.
 *
 * 2. SECURITY: a FORGED request changes nothing. This is the assertion that
 *    justifies the whole signature guard, so it is tested from the attacker's
 *    side, not the happy path's.
 *
 *    The threat is not SMS spoofing. This is a PUBLIC HTTPS endpoint (Telnyx
 *    can't present a JWT), so anyone can POST JSON at it — no handset, no SIM,
 *    no carrier. In a forged request the `from` phone number is simply a string
 *    the attacker typed. Unguarded, the route is therefore an unauthenticated
 *    public API meaning "mutate state on behalf of any phone number you name",
 *    and both inputs are guessable: the `to` number is the business's public
 *    phone number, and `from` numbers are just customer numbers. Later phases
 *    make this route CANCEL APPOINTMENTS, so the guard must be right before
 *    anything is wired to it.
 *
 *    The signature is what turns "the from-number is attacker-supplied" into
 *    "the from-number came from Telnyx, who got it from the carrier".
 *
 * Signatures here are computed with the REAL algorithm (HMAC-SHA256 over
 * `timestamp|rawBody`) against the exact bytes posted — not stubbed — so these
 * tests would catch a verifier that, say, hashed a re-serialized body.
 *
 * WHO: a customer replying to one of our texts | WHERE: src/routes/communications.ts
 * WHY: an unguarded mutating webhook is an open API; an unreachable opt-out is a
 *      compliance failure. Both are silent until they aren't.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { Pool, type Client } from 'pg';
import { createHmac } from 'crypto';
import { API_DB_URL, getRootClient, createTenant, skipIfDbDown } from '../utils';
import { createWithTenantClient } from '../../src/database';
import { registerCommunicationRoutes } from '../../src/routes/communications';
import { jsonContentTypeParser } from '../../src/jsonContentTypeParser';

const SECRET = 'test-telnyx-webhook-secret';
const CUSTOMER = '+16305550142';

// tenants.inbound_phone is UNIQUE (a number belongs to exactly one tenant), so
// each test's throwaway tenant needs its own number or the fixture collides.
let seq = 0;
let OUR_NUMBER = '';

let setup: Client;
let pool: Pool;
let app: FastifyInstance;
let dbAvailable = false;
let tenantId: string;
const tenantsToClean: string[] = [];

/** A Telnyx v2 `message.received` payload. */
function inboundPayload(text: string, from = CUSTOMER, to?: string) {
  to = to ?? OUR_NUMBER;
  return {
    data: {
      event_type: 'message.received',
      payload: {
        from: { phone_number: from },
        to: [{ phone_number: to }],
        text,
      },
    },
  };
}

/**
 * POST to the webhook. `sign: true` produces a REAL signature over the exact
 * bytes sent; `sign: false` is the forged request an attacker can trivially
 * make with curl — no phone or carrier involved.
 */
function postInbound(
  payload: unknown,
  opts: { sign?: boolean; badSignature?: boolean; secret?: string } = {}
) {
  const raw = JSON.stringify(payload);
  const headers: Record<string, string> = { 'content-type': 'application/json' };

  if (opts.sign) {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const sig = createHmac('sha256', opts.secret ?? SECRET)
      .update(`${timestamp}|${raw}`)
      .digest('hex');
    headers['telnyx-signature'] =
      `t=${timestamp},v1=${opts.badSignature ? 'deadbeef'.repeat(8) : sig}`;
  }

  return app.inject({
    method: 'POST',
    url: '/communications/telnyx/inbound',
    headers,
    payload: raw,
  });
}

const optOutRows = (t: string) =>
  setup
    .query('SELECT customer_phone, opt_out_type FROM opt_out_records WHERE tenant_id = $1', [t])
    .then((r) => r.rows);

beforeAll(async () => {
  try {
    setup = await getRootClient();
    await setup.query('SELECT 1');
    dbAvailable = true;
  } catch {
    return;
  }
  pool = new Pool({ connectionString: API_DB_URL, max: 5 });
  app = Fastify({ logger: false });
  // The webhook verifies against req.rawBody — the exact received bytes. Register
  // the SAME content-type parser production uses; without it rawBody is undefined
  // and verification can't proceed (which is itself asserted below).
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, jsonContentTypeParser);
  registerCommunicationRoutes(app, pool, createWithTenantClient(pool));
  await app.ready();
});

afterAll(async () => {
  if (!dbAvailable) return;
  for (const t of tenantsToClean) {
    await setup.query('DELETE FROM tenants WHERE tenant_id = $1', [t]).catch(() => undefined);
  }
  await app?.close();
  await pool?.end();
  await setup?.end();
  delete process.env.TELNYX_WEBHOOK_SECRET;
});

beforeEach(async (ctx) => {
  skipIfDbDown(ctx, () => dbAvailable);
  if (!dbAvailable) return;
  process.env.TELNYX_WEBHOOK_SECRET = SECRET;
  seq += 1;
  OUR_NUMBER = `+1630822${String(9000 + seq).padStart(4, '0')}`;
  tenantId = await createTenant(setup, 'Inbound SMS Tenant', 'salon', 'Etc/UTC');
  tenantsToClean.push(tenantId);
  await setup.query('UPDATE tenants SET inbound_phone = $1 WHERE tenant_id = $2', [
    OUR_NUMBER,
    tenantId,
  ]);
});

describe('POST /communications/telnyx/inbound — signature guard', () => {
  it('SECURITY: a forged (unsigned) STOP is rejected 403 and opts NOBODY out', async () => {
    // THE test. This is the exact curl an attacker runs — no text is ever sent:
    //   curl -X POST .../communications/telnyx/inbound \
    //        -d '{"data":{"payload":{"from":{"phone_number":"<victim>"},...,"text":"STOP"}}}'
    // The `from` number is attacker-supplied. Without the guard this endpoint
    // would happily act on it.
    const res = await postInbound(inboundPayload('STOP'), { sign: false });

    expect(res.statusCode).toBe(403);
    // The decisive assertion: no state changed. Not "it logged a warning" —
    // nothing happened.
    expect(await optOutRows(tenantId)).toHaveLength(0);
  });

  it('SECURITY: a WRONG signature is rejected 403 and changes nothing', async () => {
    // An attacker who knows the header format but not the secret.
    const res = await postInbound(inboundPayload('STOP'), { sign: true, badSignature: true });
    expect(res.statusCode).toBe(403);
    expect(await optOutRows(tenantId)).toHaveLength(0);
  });

  it('SECURITY: a signature from the WRONG secret is rejected 403', async () => {
    // Correctly-formed HMAC, wrong key — i.e. the guard actually checks the key
    // rather than merely checking that a v1= field parses.
    const res = await postInbound(inboundPayload('STOP'), {
      sign: true,
      secret: 'not-the-real-secret',
    });
    expect(res.statusCode).toBe(403);
    expect(await optOutRows(tenantId)).toHaveLength(0);
  });

  it('SECURITY: a tampered body fails even with a signature valid for the ORIGINAL body', async () => {
    // Proves the signature covers the PAYLOAD, not just the timestamp — i.e. an
    // attacker can't replay a legitimately-signed message with the victim's
    // number swapped in.
    const original = inboundPayload('hello', '+16305559999');
    const rawOriginal = JSON.stringify(original);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const sigForOriginal = createHmac('sha256', SECRET)
      .update(`${timestamp}|${rawOriginal}`)
      .digest('hex');

    // Same (valid) signature, different body: now a STOP from the victim.
    const tampered = JSON.stringify(inboundPayload('STOP', CUSTOMER));
    const res = await app.inject({
      method: 'POST',
      url: '/communications/telnyx/inbound',
      headers: {
        'content-type': 'application/json',
        'telnyx-signature': `t=${timestamp},v1=${sigForOriginal}`,
      },
      payload: tampered,
    });

    expect(res.statusCode).toBe(403);
    expect(await optOutRows(tenantId)).toHaveLength(0);
  });

  it('SECURITY: fails CLOSED when TELNYX_WEBHOOK_SECRET is unset (503, never unguarded)', async () => {
    // An unset secret must not silently degrade a MUTATING endpoint into an open
    // one. Contrast /telnyx/status, a read-only receipt sink, which accepts
    // unsigned callbacks in dev — the asymmetry is deliberate.
    delete process.env.TELNYX_WEBHOOK_SECRET;

    const res = await postInbound(inboundPayload('STOP'), { sign: false });
    expect(res.statusCode).toBe(503);
    expect(await optOutRows(tenantId)).toHaveLength(0);
  });
});

describe('POST /communications/telnyx/inbound — STOP handling (the compliance gap)', () => {
  it('HAPPY: a properly-signed STOP records the opt-out', async () => {
    // Before this route existed, nothing in the app RECEIVED an inbound text, so
    // this reply went nowhere and the customer kept getting messages.
    const res = await postInbound(inboundPayload('STOP'), { sign: true });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      success: true,
      result: { handled: true, keyword: 'opt_out' },
    });

    const rows = await optOutRows(tenantId);
    expect(rows).toHaveLength(1);
    expect(rows[0].customer_phone).toBe(CUSTOMER);
  });

  it('HAPPY: keyword matching is case/punctuation tolerant ("Stop." still opts out)', async () => {
    const res = await postInbound(inboundPayload('Stop.'), { sign: true });
    expect(res.statusCode).toBe(200);
    expect(await optOutRows(tenantId)).toHaveLength(1);
  });

  it('SAD: a message that merely CONTAINS "stop" is NOT an opt-out', async () => {
    // "Please don't stop texting me" must not opt someone out. We match only when
    // the message IS the keyword — guessing at intent here silently destroys a
    // customer's ability to receive their own appointment reminders.
    const res = await postInbound(inboundPayload("please don't stop texting me"), { sign: true });

    expect(res.statusCode).toBe(200);
    expect(res.json().result).toMatchObject({ handled: false, reason: 'no_keyword' });
    expect(await optOutRows(tenantId)).toHaveLength(0);
  });

  it('SAD: an unknown destination number is ACKed (200) and ignored, not retried', async () => {
    // 200 on purpose: Telnyx retries non-2xx, and a text to a number we don't own
    // is not fixable by retrying. It must also never resolve to some other tenant.
    const res = await postInbound(inboundPayload('STOP', CUSTOMER, '+15005550000'), { sign: true });

    expect(res.statusCode).toBe(200);
    expect(res.json().result).toMatchObject({ handled: false, reason: 'unknown_tenant' });
    expect(await optOutRows(tenantId)).toHaveLength(0);
  });

  it('SAD: a signed but malformed payload (no from/to) is a 400, not a crash', async () => {
    const res = await postInbound({ data: { payload: { text: 'STOP' } } }, { sign: true });
    expect(res.statusCode).toBe(400);
    expect(await optOutRows(tenantId)).toHaveLength(0);
  });

  it('HAPPY: phase 1 takes NO action on a non-keyword message (Y/N lands in phases 2-3)', async () => {
    const res = await postInbound(inboundPayload('Y'), { sign: true });
    expect(res.statusCode).toBe(200);
    // 'Y' is not yet meaningful — and must not be mistaken for anything.
    expect(res.json().result).toMatchObject({ handled: false, reason: 'no_keyword' });
    expect(await optOutRows(tenantId)).toHaveLength(0);
  });

  it('GUARD: "YES" is NOT a carrier keyword — it is reserved for appointment confirmation', async () => {
    // Regression guard on a bug caught in review: 'yes' had been lumped into the
    // opt-in keyword set. YES is not a standard opt-in word (START/UNSTOP are),
    // and the design reserves Y/YES/YEAH/CONFIRM for confirming a booking. Had it
    // stayed, phase 3 would have swallowed a customer's "YES" as a carrier opt-in
    // and their appointment would never have been confirmed — a silent failure.
    const res = await postInbound(inboundPayload('YES'), { sign: true });
    expect(res.statusCode).toBe(200);
    expect(res.json().result).toMatchObject({ handled: false, reason: 'no_keyword' });
  });
});
