/**
 * SECURITY REGRESSION — a self-service SMS link must never be a login.
 *
 * WHAT WENT WRONG (found 2026-07-13, never exploited — see below):
 *   Self-service cancel/reschedule tokens are signed with the SAME `JWT_SECRET`
 *   as login sessions. `verifyToken()` was a bare `jwt.verify(token, SECRET)`,
 *   so it could not tell the two apart. Worse, the auth hook then did:
 *
 *       request.auth = { ...decoded, role: decoded.role ?? 'owner' };
 *
 *   A self-service token carries no `role` — so the fallback promoted its bearer
 *   to OWNER of the tenant named in the token. Every appointment confirmation
 *   and reminder SMS contains such a token in a link. Anyone holding that text
 *   could send it as `Authorization: Bearer …` and read the tenant's entire
 *   customer list, appointments, call transcripts and consent records via
 *   `GET /export/tenant-data` — for 24 hours, with no password and no login.
 *
 * WHY IT WAS NEVER EXPLOITED: production had never sent a single SMS
 * (`communications_history` had zero rows, all time), so no such token had ever
 * been minted. Fixed before the first one ever went out.
 *
 * THE FIX: every token this system signs now declares what it IS (`typ`), and
 * each verifier accepts only its own kind. A shared secret proves the token came
 * from us; it says nothing about what the token is FOR. That distinction is the
 * whole bug.
 *
 * These tests exist so a future refactor cannot quietly re-merge the two.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { Pool } from 'pg';
import jwt from 'jsonwebtoken';
import { registerJwtAuthHook, generateToken } from '../../src/middleware';
import {
  generateSelfServiceToken,
  verifySelfServiceToken,
} from '../../src/services/selfServiceToken';
import { skipIfDbDown } from '../utils';

// Mirror middleware.ts's own resolution — outside production it falls back to a
// dev secret, and these tests hand-sign tokens that must be signed with exactly
// the key the auth hook will verify against.
const JWT_SECRET = process.env.JWT_SECRET || 'dev-jwt-secret-change-in-production';
const TENANT_ID = 'f234e471-0e60-4163-86c9-93cfd9338e3a';
const APPT_ID = 'a1111111-1111-4111-8111-111111111111';

describe('SECURITY: session tokens and self-service tokens are not interchangeable', () => {
  let app: FastifyInstance;
  let pool: Pool;
  let dbAvailable = false;
  beforeEach((ctx) => skipIfDbDown(ctx, () => dbAvailable));

  beforeAll(async () => {
    try {
      pool = new Pool({
        connectionString:
          process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5433/test_db',
      });
      await pool.query('SELECT 1');
      dbAvailable = true;
    } catch {
      return;
    }
    app = Fastify({ logger: false });
    registerJwtAuthHook(app, pool);
    // A stand-in for any authenticated route. If the hook lets a caller through,
    // this echoes back the identity it granted them — including the role, which
    // is what the old `?? 'owner'` fallback silently inflated.
    app.get('/whoami', (req, reply) =>
      reply.send({ success: true, auth: (req as unknown as { auth?: unknown }).auth ?? null })
    );
    await app.ready();
  });

  afterAll(async () => {
    if (app) await app.close();
    if (pool) await pool.end();
  });

  it('SAD: a self-service cancel token is REJECTED as a session (the 2026-07-13 vulnerability)', async () => {
    // WHO: anyone holding an appointment-confirmation SMS — the customer, or a
    //      person who picked up their unlocked phone.
    // WHAT: present the token from the cancel link as a session Bearer token.
    // WHEN: within its 24h validity.
    // WHERE: registerJwtAuthHook → verifyToken (src/middleware.ts).
    // WHY: it is signed with JWT_SECRET, so the signature is genuine. Only the
    //      `typ` claim distinguishes it from a login. Without that check this
    //      request returned 200 with role='owner'.
    const smsToken = generateSelfServiceToken(APPT_ID, TENANT_ID, 'cancel');
    expect(smsToken).toBeTruthy();

    const res = await app.inject({
      method: 'GET',
      url: '/whoami',
      headers: { Authorization: `Bearer ${smsToken as string}` },
    });

    expect(res.statusCode).toBe(401);
    // And emphatically NOT an owner.
    expect(res.json().auth ?? null).toBeNull();
  });

  it('SAD: a token with a valid signature but no `typ` is rejected — no implicit session', async () => {
    // WHY: `typ` is the whole defense. A legacy/hand-rolled token signed with
    //      the right secret must still fail closed rather than be assumed a
    //      session. (This also covers the OAuth `state` JWT, which is signed
    //      with the same secret and carries neither typ nor role.)
    const untyped = jwt.sign(
      { tenant_id: TENANT_ID, user_id: 'u1', email: 'x@y.com', role: 'owner' },
      JWT_SECRET,
      { expiresIn: '1h' }
    );

    const res = await app.inject({
      method: 'GET',
      url: '/whoami',
      headers: { Authorization: `Bearer ${untyped}` },
    });

    expect(res.statusCode).toBe(401);
  });

  it('SAD: a session token carrying no role is rejected rather than defaulted to owner', async () => {
    // WHY: this is the privilege-escalation half of the bug, isolated. The old
    //      hook wrote `role: decoded.role ?? 'owner'`, so a roleless token became
    //      the most privileged principal we have. A token that will not say what
    //      it is does not get to be an owner.
    const roleless = jwt.sign(
      { typ: 'session', tenant_id: TENANT_ID, user_id: 'u1', email: 'x@y.com' },
      JWT_SECRET,
      { expiresIn: '1h' }
    );

    const res = await app.inject({
      method: 'GET',
      url: '/whoami',
      headers: { Authorization: `Bearer ${roleless}` },
    });

    expect(res.statusCode).toBe(401);
  });

  it('SAD: a real session token is REJECTED by the self-service verifier (confusion fails closed both ways)', () => {
    // WHY: fixing only one direction would just move the confusion. A logged-in
    //      user's token must not open a cancel link's route either — that route
    //      trusts `appointment_id` from the payload, which a session does not
    //      have.
    const session = generateToken({
      tenant_id: TENANT_ID,
      user_id: 'u1',
      email: 'owner@shop.com',
      role: 'owner',
    });

    expect(verifySelfServiceToken(session, 'cancel')).toBeNull();
  });

  it('HAPPY: a real session token still authenticates, with its true role', async () => {
    // WHY: the guard must not have broken login. front_desk stays front_desk —
    //      proving the role now comes from the token rather than a default.
    const session = generateToken({
      tenant_id: TENANT_ID,
      user_id: '11111111-1111-1111-1111-111111111111',
      email: 'desk@shop.com',
      role: 'front_desk',
    });

    const res = await app.inject({
      method: 'GET',
      url: '/whoami',
      headers: { Authorization: `Bearer ${session}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().auth.role).toBe('front_desk');
    expect(res.json().auth.typ).toBe('session');
  });

  it('FACT: jsonwebtoken REJECTS an empty key — it does not treat it as a valid HMAC secret', () => {
    // WHY THIS TEST EXISTS: a comment in selfServiceToken.ts asserted the
    // opposite as fact — "an empty string is a valid HMAC key so jwt.verify would
    // accept ANY token" — and that false claim resurfaced as a review objection on
    // PR #243, costing a cycle. It is wrong, and now it is wrong in a way CI will
    // catch rather than a way a human has to re-derive.
    //
    // The library fails closed. We ALSO guard explicitly (middleware.assertSecret),
    // because leaning on a third-party's internal falsy check to hold the most
    // important boundary in the system is too thin a thread — if a future
    // jsonwebtoken ever accepted '', every token in the system becomes forgeable
    // and this test is what tells us.
    expect(() => jwt.sign({ a: 1 }, '')).toThrow(/secretOrPrivateKey must have a value/);

    const real = jwt.sign({ a: 1 }, 'a-real-secret');
    expect(() => jwt.verify(real, '')).toThrow(/secret or public key must be provided/);
  });

  it('HAPPY: a self-service token still opens its own door', () => {
    // WHY: the cancel link in the SMS must keep working — the fix scopes the
    //      token, it does not revoke it.
    const t = generateSelfServiceToken(APPT_ID, TENANT_ID, 'cancel');
    const payload = verifySelfServiceToken(t as string, 'cancel');

    expect(payload).not.toBeNull();
    expect(payload?.appointment_id).toBe(APPT_ID);
    expect(payload?.tenant_id).toBe(TENANT_ID);
    // ...and still cannot be used for the OTHER action.
    expect(verifySelfServiceToken(t as string, 'reschedule')).toBeNull();
  });
});
