/**
 * Real-DB companion for the cancel / reschedule agent tools.
 *
 * Motivation (docs/TEST_DB_AUDIT.md): the mocked agentToolsCancel /
 * reschedule suites prove the handler shape, not the SQL. But these two
 * handlers lean entirely on multi-condition SQL that only real Postgres
 * enforces — a JOIN to customers for phone-ownership, `status='scheduled'`,
 * `start_time > NOW()`, the `is_deleted` filter, and (reschedule) the GiST
 * exclusion constraint surfacing as 23P01. A mock returns whatever rows you
 * tell it to; it can't catch a phone-ownership hole or a missing is_deleted
 * clause. This suite drives the REAL route → REAL Postgres and asserts the
 * stored row.
 *
 * Strategy mirrors agentToolsBookingIntegration.test.ts: real pg.Pool on
 * API_DB_URL (api_user, RLS-scoped) + registerAgentToolRoutes on a throwaway
 * Fastify app, driven via x-agent-secret. Fixtures per-suite, cleaned in
 * afterAll (test-isolation rule). Skips when the DB is down; hard-fails under
 * REQUIRE_DB_TESTS=1 (CI).
 *
 * 5W for sad-path failures:
 *   WHO  — the voice agent acting for a live caller who wants to change a booking
 *   WHAT — POST /agent-tools/{cancel,reschedule}-appointment
 *   WHEN — mid-call, caller gives their phone + the appointment
 *   WHERE — agentTools.ts UPDATE … FROM customers … WHERE c.phone = $ (ownership)
 *   WHY  — a phone-ownership hole lets one caller cancel/move ANOTHER caller's
 *          appointment; a missing is_deleted/past-time guard mutates rows that
 *          should be untouchable
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { type Client, Pool } from 'pg';
import {
  API_DB_URL,
  getRootClient,
  createTenant,
  createResource,
  createCustomerFull,
  createAppointment,
  skipIfDbDown,
} from '../utils';
import { createWithTenantClient } from '../../src/database';
import { registerAgentToolRoutes } from '../../src/routes/agentTools';

const AGENT_SECRET = 'test-cancel-reschedule-secret';
// Capture any pre-existing value so afterAll restores it instead of blindly
// deleting — avoids clobbering an AGENT_SECRET set by the environment or a
// sibling suite that runs later in the same process.
let prevAgentSecret: string | undefined;
const stubEmbedding = (): Promise<number[]> => Promise.resolve(new Array(1536).fill(0));
const stubNormalizer = async (text: string): Promise<string> => text;

// The endpoint normalizes the caller-supplied phone (normalizePhone) before
// matching customers.phone, and real customers are ALWAYS stored normalized
// (the booking path normalizes before insert). So fixtures are seeded in
// E.164 while the tool is called with the raw spoken form — mirroring prod.
const OWNER_PHONE_RAW = '5557770001';
const OWNER_PHONE_E164 = '+15557770001';
const OTHER_PHONE_RAW = '5557770002';
const OTHER_PHONE_E164 = '+15557770002';

let setup: Client;
let pool: Pool;
let app: FastifyInstance;
let dbAvailable = false;
let tenantId: string;
let resourceId: string;
let ownerCustomerId: string;
const tenantsToClean: string[] = [];

function post(path: string, payload: unknown) {
  return app.inject({
    method: 'POST',
    url: path,
    headers: { 'x-agent-secret': AGENT_SECRET },
    payload,
  });
}

/** ISO instant N hours from now, snapped to a 15-min boundary (the
 *  appointments_end_time_15min check constraint rejects arbitrary times). */
function hoursFromNow(h: number): string {
  const QUARTER = 900_000;
  const t = Math.round((Date.now() + h * 3_600_000) / QUARTER) * QUARTER;
  return new Date(t).toISOString();
}

async function apptRow(
  appointmentId: string
): Promise<{ status: string; start_time: Date } | undefined> {
  const res = await setup.query(
    `SELECT status, start_time FROM appointments WHERE appointment_id = $1`,
    [appointmentId]
  );
  return res.rows[0];
}

/** Create a scheduled appointment for the owner customer at [from,to]. */
async function ownerAppt(fromIso: string, toIso: string): Promise<string> {
  return createAppointment(
    setup,
    tenantId,
    resourceId,
    ownerCustomerId,
    fromIso,
    toIso,
    'owner appt'
  );
}

beforeAll(async () => {
  try {
    setup = await getRootClient();
    await setup.query('SELECT 1');
    pool = new Pool({ connectionString: API_DB_URL, max: 5 });
    prevAgentSecret = process.env.AGENT_SECRET;
    process.env.AGENT_SECRET = AGENT_SECRET;

    app = Fastify({ logger: false });
    const withTenantClient = createWithTenantClient(pool);
    registerAgentToolRoutes(app, pool, withTenantClient, stubEmbedding, stubNormalizer);
    await app.ready();

    tenantId = await createTenant(setup, 'Cancel/Reschedule Salon', 'salon');
    tenantsToClean.push(tenantId);
    resourceId = await createResource(setup, tenantId, 'Chair 1');
    ownerCustomerId = await createCustomerFull(setup, tenantId, OWNER_PHONE_E164, 'Owner Olive');
    // A second caller exists so the phone-ownership tests use a REAL other
    // customer (not just an unknown number).
    await createCustomerFull(setup, tenantId, OTHER_PHONE_E164, 'Other Otto');

    dbAvailable = true;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[agentToolsCancelReschedule.realdb.test] DB not available, skipping', err);
  }
});

afterAll(async () => {
  if (app) await app.close();
  if (pool) await pool.end();
  if (setup) {
    for (const id of tenantsToClean) {
      await setup.query('DELETE FROM tenants WHERE tenant_id = $1', [id]).catch(() => {});
    }
    await setup.end();
  }
  if (prevAgentSecret === undefined) delete process.env.AGENT_SECRET;
  else process.env.AGENT_SECRET = prevAgentSecret;
});

beforeEach((ctx) => {
  skipIfDbDown(ctx, () => dbAvailable);
});

describe('cancel-appointment → real DB', () => {
  it('HAPPY: owner cancels their own future scheduled appointment → status=canceled', async () => {
    const id = await ownerAppt(hoursFromNow(48), hoursFromNow(49));
    const res = await post('/agent-tools/cancel-appointment', {
      tenant_id: tenantId,
      phone: OWNER_PHONE_RAW,
      appointment_id: id,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().success).toBe(true);
    expect((await apptRow(id))!.status).toBe('canceled');
  });

  it('SECURITY: a different caller CANNOT cancel — appointment stays scheduled', async () => {
    // WHY: the JOIN customers … c.phone = $ clause is the only thing stopping
    // one caller from canceling another's appointment. If it regressed, this
    // would flip to canceled — a real cross-caller tampering hole.
    const id = await ownerAppt(hoursFromNow(50), hoursFromNow(51));
    const res = await post('/agent-tools/cancel-appointment', {
      tenant_id: tenantId,
      phone: OTHER_PHONE_RAW,
      appointment_id: id,
    });
    expect(res.json().success).toBe(false);
    expect((await apptRow(id))!.status).toBe('scheduled');
  });

  it('SAD: a past appointment is not cancelable (start_time > NOW guard)', async () => {
    const id = await ownerAppt(hoursFromNow(-49), hoursFromNow(-48));
    const res = await post('/agent-tools/cancel-appointment', {
      tenant_id: tenantId,
      phone: OWNER_PHONE_RAW,
      appointment_id: id,
    });
    expect(res.json().success).toBe(false);
    // Untouched — still whatever it was (scheduled), not flipped.
    expect((await apptRow(id))!.status).toBe('scheduled');
  });

  it('SAD: a soft-deleted appointment is invisible to cancel (is_deleted filter)', async () => {
    const id = await ownerAppt(hoursFromNow(52), hoursFromNow(53));
    await setup.query(`UPDATE appointments SET is_deleted = true WHERE appointment_id = $1`, [id]);
    const res = await post('/agent-tools/cancel-appointment', {
      tenant_id: tenantId,
      phone: OWNER_PHONE_RAW,
      appointment_id: id,
    });
    expect(res.json().success).toBe(false);
  });
});

describe('reschedule-appointment → real DB', () => {
  it('HAPPY: owner moves their appointment to a new future time → row shows new start', async () => {
    const id = await ownerAppt(hoursFromNow(60), hoursFromNow(61));
    const newFrom = hoursFromNow(72);
    const newTo = hoursFromNow(73);
    const res = await post('/agent-tools/reschedule-appointment', {
      tenant_id: tenantId,
      phone: OWNER_PHONE_RAW,
      appointment_id: id,
      new_start_time: newFrom,
      new_end_time: newTo,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().success).toBe(true);
    expect((await apptRow(id))!.start_time.toISOString()).toBe(newFrom);
  });

  it('SECURITY: a different caller CANNOT reschedule — original time unchanged', async () => {
    const originalFrom = hoursFromNow(80);
    const id = await ownerAppt(originalFrom, hoursFromNow(81));
    const res = await post('/agent-tools/reschedule-appointment', {
      tenant_id: tenantId,
      phone: OTHER_PHONE_RAW,
      appointment_id: id,
      new_start_time: hoursFromNow(90),
      new_end_time: hoursFromNow(91),
    });
    expect(res.json().success).toBe(false);
    expect((await apptRow(id))!.start_time.toISOString()).toBe(originalFrom);
  });

  it('SAD: rescheduling to a past time is rejected, original unchanged', async () => {
    const originalFrom = hoursFromNow(96);
    const id = await ownerAppt(originalFrom, hoursFromNow(97));
    const res = await post('/agent-tools/reschedule-appointment', {
      tenant_id: tenantId,
      phone: OWNER_PHONE_RAW,
      appointment_id: id,
      new_start_time: hoursFromNow(-2),
      new_end_time: hoursFromNow(-1),
    });
    expect(res.json().success).toBe(false);
    expect((await apptRow(id))!.start_time.toISOString()).toBe(originalFrom);
  });

  it('SAD: rescheduling onto an occupied slot (same resource) → GiST 23P01 → friendly error, original unchanged', async () => {
    // WHERE: appointments_no_resource_overlap. Two scheduled appts on the
    // same chair; moving A onto B's window must be refused by the DB and
    // surfaced as a clean "already booked" message, NOT a 500 or a silent
    // overlap. A's time must stay put.
    const aFrom = hoursFromNow(100);
    const a = await ownerAppt(aFrom, hoursFromNow(101));
    const bFrom = hoursFromNow(104);
    const bTo = hoursFromNow(105);
    await ownerAppt(bFrom, bTo); // B occupies the target slot
    const res = await post('/agent-tools/reschedule-appointment', {
      tenant_id: tenantId,
      phone: OWNER_PHONE_RAW,
      appointment_id: a,
      new_start_time: bFrom,
      new_end_time: bTo,
    });
    expect(res.json().success).toBe(false);
    expect(String(res.json().error).toLowerCase()).toContain('booked');
    expect((await apptRow(a))!.start_time.toISOString()).toBe(aFrom);
  });
});
