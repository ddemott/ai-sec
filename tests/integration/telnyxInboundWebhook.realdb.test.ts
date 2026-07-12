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
import { generateKeyPairSync, sign as edSign, type KeyObject } from 'crypto';
import { API_DB_URL, getRootClient, createTenant, skipIfDbDown } from '../utils';
import { createWithTenantClient } from '../../src/database';
import { registerCommunicationRoutes } from '../../src/routes/communications';
import { jsonContentTypeParser } from '../../src/jsonContentTypeParser';

// A REAL Ed25519 keypair. The tests sign with the private half and the app
// verifies with the public half — genuinely asymmetric, exactly as Telnyx does it.
//
// This matters more than it looks. The previous suite signed with the same
// HMAC-SHA256 scheme the verifier checked, so it was self-consistent and PASSED
// while the implementation was verifying an algorithm Telnyx does not use. A test
// that mirrors the implementation's mistake proves nothing. Here the signature is
// produced by Node's Ed25519 primitive, so if the verifier's algorithm, header
// names, or signed-string format are wrong, these tests FAIL.
const { publicKey: ED_PUBLIC, privateKey: ED_PRIVATE } = generateKeyPairSync('ed25519');
// Telnyx's portal hands you bare base64 of the raw 32-byte key (no PEM armor).
const PUBLIC_KEY_B64 = ED_PUBLIC.export({ format: 'der', type: 'spki' })
  .subarray(12)
  .toString('base64');
const OTHER_KEY = generateKeyPairSync('ed25519').privateKey;
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
  opts: {
    sign?: boolean;
    badSignature?: boolean;
    key?: KeyObject;
    timestamp?: number;
  } = {}
) {
  const raw = JSON.stringify(payload);
  const headers: Record<string, string> = { 'content-type': 'application/json' };

  if (opts.sign) {
    const ts = String(opts.timestamp ?? Math.floor(Date.now() / 1000));
    // The exact string Telnyx signs: `${timestamp}|${rawBody}`.
    const sig = edSign(null, Buffer.from(`${ts}|${raw}`, 'utf8'), opts.key ?? ED_PRIVATE);
    headers['telnyx-timestamp'] = ts;
    headers['telnyx-signature-ed25519'] = opts.badSignature
      ? Buffer.alloc(64, 1).toString('base64') // well-formed length, wrong bytes
      : sig.toString('base64');
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
  delete process.env.TELNYX_PUBLIC_KEY;
});

beforeEach(async (ctx) => {
  skipIfDbDown(ctx, () => dbAvailable);
  if (!dbAvailable) return;
  process.env.TELNYX_PUBLIC_KEY = PUBLIC_KEY_B64;
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

  it('SECURITY: a signature from the WRONG KEY is rejected 403', async () => {
    // A REAL, correctly-formed Ed25519 signature — from a different keypair. The
    // guard must check WHO signed, not merely that a signature parses.
    const res = await postInbound(inboundPayload('STOP'), {
      sign: true,
      key: OTHER_KEY,
    });
    expect(res.statusCode).toBe(403);
    expect(await optOutRows(tenantId)).toHaveLength(0);
  });

  it('SECURITY: a tampered body fails even with a REAL signature valid for the ORIGINAL body', async () => {
    // Proves the signature covers the PAYLOAD, not just the timestamp — an
    // attacker who captures a legitimately-signed webhook can't replay it with
    // the victim's number swapped in.
    const rawOriginal = JSON.stringify(inboundPayload('hello', '+16305559999'));
    const timestamp = String(Math.floor(Date.now() / 1000));
    // A genuine Ed25519 signature — over the ORIGINAL body.
    const sigForOriginal = edSign(
      null,
      Buffer.from(`${timestamp}|${rawOriginal}`, 'utf8'),
      ED_PRIVATE
    ).toString('base64');

    // Same (genuinely valid) signature, different body: now a STOP from the victim.
    const tampered = JSON.stringify(inboundPayload('STOP', CUSTOMER));
    const res = await app.inject({
      method: 'POST',
      url: '/communications/telnyx/inbound',
      headers: {
        'content-type': 'application/json',
        'telnyx-timestamp': timestamp,
        'telnyx-signature-ed25519': sigForOriginal,
      },
      payload: tampered,
    });

    expect(res.statusCode).toBe(403);
    expect(await optOutRows(tenantId)).toHaveLength(0);
  });

  it('SECURITY: a STALE timestamp is rejected (bounds replay of a captured webhook)', async () => {
    // The signature is genuine and the body is untouched — but it was signed an
    // hour ago. Without a freshness bound, anyone who captured one valid webhook
    // could replay it forever. The signature covers the timestamp, so an attacker
    // cannot simply rewrite it to something current.
    const res = await postInbound(inboundPayload('STOP'), {
      sign: true,
      timestamp: Math.floor(Date.now() / 1000) - 3600,
    });

    expect(res.statusCode).toBe(403);
    expect(await optOutRows(tenantId)).toHaveLength(0);
  });

  it('SECURITY: a malformed TELNYX_PUBLIC_KEY rejects rather than silently never matching', async () => {
    // An operator pasting the wrong value (an API key, a truncated key) must get a
    // hard failure, not a webhook that quietly 403s everything forever and looks
    // like "Telnyx is broken".
    process.env.TELNYX_PUBLIC_KEY = 'not-a-real-key';

    const res = await postInbound(inboundPayload('STOP'), { sign: true });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toMatch(/signature/i);
  });

  it('SECURITY: fails CLOSED when TELNYX_PUBLIC_KEY is unset (503, never unguarded)', async () => {
    // An unset secret must not silently degrade a MUTATING endpoint into an open
    // one. Contrast /telnyx/status, a read-only receipt sink, which accepts
    // unsigned callbacks in dev — the asymmetry is deliberate.
    delete process.env.TELNYX_PUBLIC_KEY;

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

  it('SAD: a DELIVERY RECEIPT for our own reminder does NOT opt the customer out', async () => {
    // WHO: Telnyx, reporting that the reminder text WE sent was delivered.
    // WHAT: a messaging profile has ONE webhook URL and Telnyx sends every event
    //        to it — message.received AND message.sent/message.finalized. So this
    //        route receives delivery receipts for our own outbound messages.
    // WHERE: the event_type guard at the top of /communications/telnyx/inbound.
    // WHY: THE TRAP. On a DLR, payload.text is OUR OWN message body — and every
    //       message we send ends with the compliance line "Reply STOP to opt out."
    //       Without the event_type check, classifySmsKeyword() reads our own
    //       reminder as the customer saying STOP, and we opt them out of the very
    //       reminders they asked for. The route survived only because a DLR's `to`
    //       is the customer's number (matching no tenant), so the tenant lookup
    //       bailed first — safe by luck, not by design. This pins the intent.
    const dlr = {
      data: {
        event_type: 'message.finalized',
        payload: {
          // On a DLR the direction is INVERTED: from = us, to = the customer.
          from: { phone_number: OUR_NUMBER },
          to: [{ phone_number: CUSTOMER, status: 'delivered' }],
          // Our real reminder copy — note the trailing compliance line.
          text: '🔔 Reminder: Haircut with Maria in 30 minutes. Reply STOP to opt out.',
        },
      },
    };

    const res = await postInbound(dlr, { sign: true });

    expect(res.statusCode).toBe(200); // 200: a DLR is legitimate, and Telnyx retries non-2xx
    expect(res.json().result).toMatchObject({
      handled: false,
      reason: 'not_an_inbound_message',
    });
    // The whole point: nobody got opted out by their own appointment reminder.
    expect(await optOutRows(tenantId)).toHaveLength(0);
  });

  it('SAD: a message.sent event is likewise ignored', async () => {
    // The other outbound event type Telnyx delivers to the same URL.
    const sent = {
      data: {
        event_type: 'message.sent',
        payload: {
          from: { phone_number: OUR_NUMBER },
          to: [{ phone_number: CUSTOMER, status: 'sent' }],
          text: 'Confirmed: Haircut on Friday. Reply STOP to opt out.',
        },
      },
    };

    const res = await postInbound(sent, { sign: true });

    expect(res.statusCode).toBe(200);
    expect(res.json().result).toMatchObject({ reason: 'not_an_inbound_message' });
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

  it('HAPPY: START RESTORES consent — it must never record an opt-out', async () => {
    // REGRESSION (caught by review on PR #238). Both keywords used to be routed
    // through ConsentService.processOptOutCommand(), which calls recordOptOut()
    // UNCONDITIONALLY regardless of the command handed to it. So a customer who
    // texted START to resume messages was opted OUT of everything instead — the
    // exact inverse of what they asked for. The original tests only covered STOP,
    // which is precisely why this got through.
    const res = await postInbound(inboundPayload('START'), { sign: true });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      success: true,
      result: { handled: true, keyword: 'opt_in' },
    });

    // The decisive assertion: NO opt-out row. Under the bug there would be one.
    expect(await optOutRows(tenantId)).toHaveLength(0);

    // And a positive consent record exists, since checkConsent() reads the LATEST
    // consent row — writing one is what actually re-enables messaging after a
    // prior STOP revoked it. Recording nothing would leave them silently blocked.
    const { rows } = await setup.query(
      `SELECT consent_given, consent_type FROM consent_records
        WHERE tenant_id = $1 AND customer_phone = $2
        ORDER BY consent_date DESC LIMIT 1`,
      [tenantId, CUSTOMER]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].consent_given).toBe(true);
    expect(rows[0].consent_type).toBe('sms');
  });

  it('HAPPY: STOP then START leaves the customer re-enabled (the full round trip)', async () => {
    // The sequence that actually matters in the wild.
    await postInbound(inboundPayload('STOP'), { sign: true });
    expect(await optOutRows(tenantId)).toHaveLength(1);

    await postInbound(inboundPayload('START'), { sign: true });

    // START adds consent; it does not add a second opt-out.
    expect(await optOutRows(tenantId)).toHaveLength(1);
    const { rows } = await setup.query(
      `SELECT consent_given FROM consent_records
        WHERE tenant_id = $1 AND customer_phone = $2
        ORDER BY consent_date DESC LIMIT 1`,
      [tenantId, CUSTOMER]
    );
    expect(rows[0]?.consent_given).toBe(true);
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
