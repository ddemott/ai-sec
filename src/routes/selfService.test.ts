/**
 * WHO:   GET /self/cancel
 * WHAT:  token-gated appointment cancellation — no session auth required
 * WHEN:  customer taps the cancel link in an appointment-confirmation SMS
 * WHERE: src/routes/selfService.ts
 * WHY:   token IS the auth; route must gate on signature + scope to tenant;
 *        must be idempotent (already-canceled → 200, not 400)
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { registerSelfServiceRoutes } from './selfService.js';
import { generateSelfServiceToken } from '../services/selfServiceToken.js';
import { buildRouteTestApp, type RouteTestAppHandle } from '../test-utils-mock.js';

const APPT_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const TENANT_ID = 'ffffffff-eeee-4ddd-8ccc-bbbbbbbbbbbb';

beforeAll(() => {
  process.env.JWT_SECRET = 'test-secret-self-service-route';
});

let handle: RouteTestAppHandle;
let app: FastifyInstance;

beforeAll(async () => {
  handle = buildRouteTestApp((a, pool) => {
    registerSelfServiceRoutes(a, pool);
  });
  app = handle.app;
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  handle.queries.length = 0;
  handle.queryResponses.length = 0;
});

describe('GET /self/cancel', () => {
  describe('Happy Paths', () => {
    it('cancels appointment and returns 200 with success message', async () => {
      // WHO: customer with a valid 24-hour cancel token
      // WHAT: appointment status set to canceled
      // WHY:  token-only auth gates the update; no session JWT needed
      handle.queryResponses.push({ rows: [{ appointment_id: APPT_ID }], rowCount: 1 });

      const token = generateSelfServiceToken(APPT_ID, TENANT_ID, 'cancel')!;
      const res = await app.inject({ method: 'GET', url: `/self/cancel?token=${token}` });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body) as { success: boolean; message: string };
      expect(body.success).toBe(true);
      expect(body.message).toMatch(/canceled/i);
    });

    it('returns 200 for already-canceled appointment (idempotent)', async () => {
      // WHO: customer tapping cancel link a second time
      // WHAT: second call is a no-op — returns success without DB error
      // WHY:  SMS links can be tapped accidentally more than once; idempotency prevents
      //       confusing error responses for a legitimate action
      handle.queryResponses.push({ rows: [], rowCount: 0 });
      // Second query: existence check
      handle.queryResponses.push({ rows: [{ status: 'canceled' }], rowCount: 1 });

      const token = generateSelfServiceToken(APPT_ID, TENANT_ID, 'cancel')!;
      const res = await app.inject({ method: 'GET', url: `/self/cancel?token=${token}` });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body) as { success: boolean; message: string };
      expect(body.success).toBe(true);
      expect(body.message).toMatch(/already been canceled/i);
    });
  });

  describe('Sad Paths', () => {
    it('returns 400 when token is missing', async () => {
      const res = await app.inject({ method: 'GET', url: '/self/cancel' });
      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body) as { success: boolean };
      expect(body.success).toBe(false);
    });

    it('returns 400 for invalid/tampered token', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/self/cancel?token=not.a.valid.jwt',
      });
      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body) as { success: boolean; error: string };
      expect(body.success).toBe(false);
      expect(body.error).toMatch(/expired or is invalid/i);
    });

    it('returns 404 when appointment not found for this tenant', async () => {
      // WHO: customer with a valid token but appointment was deleted
      // WHAT: no rows from UPDATE, no rows from existence check
      handle.queryResponses.push({ rows: [], rowCount: 0 });
      handle.queryResponses.push({ rows: [], rowCount: 0 });

      const token = generateSelfServiceToken(APPT_ID, TENANT_ID, 'cancel')!;
      const res = await app.inject({ method: 'GET', url: `/self/cancel?token=${token}` });

      expect(res.statusCode).toBe(404);
      const body = JSON.parse(res.body) as { success: boolean };
      expect(body.success).toBe(false);
    });
  });
});
