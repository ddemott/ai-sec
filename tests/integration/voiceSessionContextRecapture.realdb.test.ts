/**
 * end_voice_session must re-capture customer_context AT CALL END, so the
 * stored appointment_history reflects what the call PRODUCED — not the
 * caller's history from before they dialed.
 *
 * THE BUG (Dale, 2026-07-21): a call whose outcome was "Booked" displayed
 * "Appointment History · Total: 0" and "0 appointments", because the context
 * snapshot is written by start_voice_session() at the instant the call
 * connects. On a first booking that is always 0 — "Booked / 0 appointments"
 * reads as broken, and the number is useless for reviewing what the call did.
 *
 * These tests own their tenant; afterAll deletes only it (cascade). Never
 * truncates — the DB is shared.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type Client } from 'pg';
import {
  getRootClient,
  createTenant,
  createCustomer,
  createResource,
  createAppointment,
  deleteTenantWithDeadlockRetry,
  skipIfDbDown,
} from '../utils';

let db: Client;
let dbAvailable = false;
let tenantId: string;
let resourceId: string;
const tenantsToClean: string[] = [];

const historyOf = (ctx: unknown): { total: number; completed: number; cancelled: number } =>
  (ctx as { appointment_history: { total: number; completed: number; cancelled: number } })
    .appointment_history;

beforeAll(async () => {
  try {
    db = await getRootClient();
    await db.query('SELECT 1');
    dbAvailable = true;
  } catch {
    dbAvailable = false;
    return;
  }
  tenantId = await createTenant(db, 'Recapture Co', 'automotive', 'America/Chicago');
  tenantsToClean.push(tenantId);
  resourceId = await createResource(db, tenantId, 'Main Line');
});

afterAll(async () => {
  if (!dbAvailable) return;
  for (const t of tenantsToClean) await deleteTenantWithDeadlockRetry(db, t);
  await db.end();
});

describe('end_voice_session re-captures customer_context after the call', () => {
  it('a first-time booking call ends showing Total: 1, not the 0 it started with', async (ctx) => {
    skipIfDbDown(ctx, () => dbAvailable);

    // A brand-new caller — zero prior appointments.
    const phone = '+12624970001';
    const customerId = await createCustomer(db, tenantId, 'Neil New', phone);
    const callId = 'recapture-call-1';

    // Call STARTS → snapshot captured here must be 0 (history before the call).
    const startCtx = await db.query<{ context: unknown }>(
      'SELECT start_voice_session($1, $2, $3) AS context',
      [tenantId, callId, phone]
    );
    expect(historyOf(startCtx.rows[0].context).total).toBe(0); // the "before" number

    // DURING the call the caller books an appointment.
    const apptId = await createAppointment(
      db,
      tenantId,
      resourceId,
      customerId,
      '2026-08-01T15:00:00Z',
      '2026-08-01T15:30:00Z',
      'Booking via SecretaryHQ'
    );

    // Call ENDS with a booked outcome + the appointment id.
    await db.query('SELECT end_voice_session($1, $2, $3, $4, $5, $6, $7)', [
      tenantId,
      callId,
      120,
      'booked',
      'Caller: book me. Agent: booked.',
      'Booked an appointment.',
      apptId,
    ]);

    // The STORED context on the row must now reflect the booking: Total = 1.
    const stored = await db.query<{ ctx: unknown; outcome: string }>(
      'SELECT customer_context AS ctx, outcome FROM voice_sessions WHERE tenant_id=$1 AND call_id=$2',
      [tenantId, callId]
    );
    expect(stored.rows[0].outcome).toBe('booked');
    expect(historyOf(stored.rows[0].ctx).total).toBe(1); // the "after" number — the fix
  });

  it('two bookings on one call end showing Total: 2 (the 0→2 double-booking case)', async (ctx) => {
    skipIfDbDown(ctx, () => dbAvailable);

    const phone = '+12624970002';
    const customerId = await createCustomer(db, tenantId, 'Neil Double', phone);
    const callId = 'recapture-call-2';

    await db.query('SELECT start_voice_session($1, $2, $3)', [tenantId, callId, phone]);

    // The exact real scenario: one call created TWO back-to-back appointments.
    const a1 = await createAppointment(db, tenantId, resourceId, customerId, '2026-08-02T20:00:00Z', '2026-08-02T20:30:00Z', 'first');
    await createAppointment(db, tenantId, resourceId, customerId, '2026-08-02T20:30:00Z', '2026-08-02T21:00:00Z', 'second');

    await db.query('SELECT end_voice_session($1, $2, $3, $4, $5, $6, $7)', [
      tenantId, callId, 200, 'booked', 't', 's', a1,
    ]);

    const stored = await db.query<{ ctx: unknown }>(
      'SELECT customer_context AS ctx FROM voice_sessions WHERE tenant_id=$1 AND call_id=$2',
      [tenantId, callId]
    );
    expect(historyOf(stored.rows[0].ctx).total).toBe(2);
  });

  it('a message-only call (no booking) still ends showing the true current count', async (ctx) => {
    skipIfDbDown(ctx, () => dbAvailable);

    // Caller who ALREADY had one appointment, calls to leave a message.
    const phone = '+12624970003';
    const customerId = await createCustomer(db, tenantId, 'Prior Pat', phone);
    await createAppointment(db, tenantId, resourceId, customerId, '2026-08-03T15:00:00Z', '2026-08-03T15:30:00Z', 'pre-existing');
    const callId = 'recapture-call-3';

    // Start snapshot already sees the 1 pre-existing appointment.
    const startCtx = await db.query<{ context: unknown }>(
      'SELECT start_voice_session($1, $2, $3) AS context',
      [tenantId, callId, phone]
    );
    expect(historyOf(startCtx.rows[0].context).total).toBe(1);

    await db.query('SELECT end_voice_session($1, $2, $3, $4, $5, $6, $7)', [
      tenantId, callId, 60, 'message', 't', 's', null,
    ]);

    // No booking happened → still 1 after, not inflated.
    const stored = await db.query<{ ctx: unknown }>(
      'SELECT customer_context AS ctx FROM voice_sessions WHERE tenant_id=$1 AND call_id=$2',
      [tenantId, callId]
    );
    expect(historyOf(stored.rows[0].ctx).total).toBe(1);
  });

  it('a cancellation during the call is reflected: booked then canceled ends at cancelled=1, total counts it', async (ctx) => {
    skipIfDbDown(ctx, () => dbAvailable);

    const phone = '+12624970004';
    const customerId = await createCustomer(db, tenantId, 'Cancy Cal', phone);
    const callId = 'recapture-call-4';
    await db.query('SELECT start_voice_session($1, $2, $3)', [tenantId, callId, phone]);

    // Book then cancel within the call.
    const apptId = await createAppointment(db, tenantId, resourceId, customerId, '2026-08-04T15:00:00Z', '2026-08-04T15:30:00Z', 'to be canceled', 'canceled');

    await db.query('SELECT end_voice_session($1, $2, $3, $4, $5, $6, $7)', [
      tenantId, callId, 90, 'message', 't', 's', apptId,
    ]);

    const stored = await db.query<{ ctx: unknown }>(
      'SELECT customer_context AS ctx FROM voice_sessions WHERE tenant_id=$1 AND call_id=$2',
      [tenantId, callId]
    );
    const h = historyOf(stored.rows[0].ctx);
    expect(h.total).toBe(1); // total counts all statuses
    expect(h.cancelled).toBe(1); // and the cancel is visible
  });
});
