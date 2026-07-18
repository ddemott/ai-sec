// ─────────────────────────────────────────────────────────────────────────
// WHO  : /agent-tools/available-slots — the SUGGEST layer of booking.
// WHAT : a scheduled appointment must SUBTRACT its slot from open_times, in
//        the TENANT's timezone — regardless of the DB session's timezone.
// WHEN : regression guard for the 2026-07-17 evening call: available-slots
//        offered 1:00 PM Monday while a scheduled appointment sat exactly
//        there. The un-annotated `start_time::text` cast rendered the
//        timestamptz in the SESSION timezone (UTC on the prod pooler), so the
//        1:00 PM CDT booking became "18:00", fell outside the 13:00–17:00
//        shift coverage, and subtracted NOTHING. The caller picked the taken
//        slot and bounced off TIMESLOT_OCCUPIED — the suggest layer lied, the
//        enforce layer knew.
// WHERE: src/routes/agentTools/scheduling.ts day_appointments CTE +
//        timeToMinutes mapping.
// WHY  : the unit tests mock the query, so the rendering bug is invisible to
//        them (review catch on #281). Only real Postgres exercises the cast —
//        and this suite's connection, like CI's and the prod pooler's, runs
//        with a UTC session timezone, which is exactly the condition that
//        exposed the bug. Under the pre-fix code this test FAILS (1:00 PM is
//        offered); under the fix it passes.
// ─────────────────────────────────────────────────────────────────────────
// Pin the NODE process to UTC before anything constructs a Date. The pre-fix
// bug was a CANCELLING PAIR — SQL rendered UTC, JS re-read it in the server's
// local zone — so on a dev machine whose OS timezone equals the tenant's
// (Chicago) the two errors cancelled and the old code looked correct. Railway
// and CI both run Node in UTC, where the pair does NOT cancel. Pinning TZ
// makes this test reproduce the production condition on every machine.
process.env.TZ = 'UTC';

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { type Client, Pool } from 'pg';
import {
  API_DB_URL,
  getRootClient,
  createTenant,
  createResource,
  createEmployee,
  createScheduleEntry,
  createService,
  createCustomerFull,
  skipIfDbDown,
} from '../utils';
import { createWithTenantClient } from '../../src/database';
import { registerAgentToolRoutes } from '../../src/routes/agentTools';

const AGENT_SECRET = 'test-available-slots-tz-secret';
let prevAgentSecret: string | undefined;
// All-zero embedding: forces the service resolver past the semantic branch to
// the tenant default without a real OpenAI call.
const stubEmbedding = (): Promise<number[]> => Promise.resolve(new Array(1536).fill(0));
const stubNormalizer = async (text: string): Promise<string> => text;

let setup: Client;
let pool: Pool;
let app: FastifyInstance;
let dbAvailable = false;
let tenantId: string;
const tenantsToClean: string[] = [];

// A fixed FUTURE date so the route's "filter past times when today" branch
// never interferes. Wall-clock times are Chicago-local; the appointment's UTC
// instant is computed BY POSTGRES from the tenant timezone, so the test is
// immune to DST and to whatever timezone the test runner happens to be in.
const DATE = '2027-03-08'; // a Monday
const TZ = 'America/Chicago';

function post(path: string, payload: unknown) {
  return app.inject({
    method: 'POST',
    url: path,
    headers: { 'x-agent-secret': AGENT_SECRET },
    payload,
  });
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

    tenantId = await createTenant(setup, 'TZ Slots Co', 'ai-platform', TZ);
    tenantsToClean.push(tenantId);
    // No buffer: keeps the exclusion arithmetic in the assertions exact.
    await setup.query('UPDATE tenants SET default_buffer_minutes = 0 WHERE tenant_id = $1', [
      tenantId,
    ]);
    const serviceId = await createService(setup, tenantId, 'Programming Consultation', 30, 0);
    await setup.query('UPDATE tenants SET default_service_id = $1 WHERE tenant_id = $2', [
      serviceId,
      tenantId,
    ]);
    const employeeId = await createEmployee(setup, tenantId, 'Dale Test');
    await createScheduleEntry(setup, tenantId, employeeId, DATE, '13:00', '17:00');
    const resourceId = await createResource(setup, tenantId, 'Office Line');
    const customerId = await createCustomerFull(setup, tenantId, '+15559990101', 'Jack Taken');

    // THE APPOINTMENT AT 1:00 PM LOCAL. Postgres converts the tenant-local
    // wall-clock to the UTC instant — under a UTC session this row's
    // start_time::text reads "…19:00:00+00" (CST), which is precisely the
    // value the pre-fix cast mis-rendered into the exclusion math.
    await setup.query(
      `INSERT INTO appointments (tenant_id, resource_id, customer_id, employee_id, start_time, end_time, description, status)
       VALUES ($1, $2, $3, $4,
               ($5 || ' 13:00:00')::timestamp AT TIME ZONE $6,
               ($5 || ' 13:30:00')::timestamp AT TIME ZONE $6,
               'the taken slot', 'scheduled')`,
      [tenantId, resourceId, customerId, employeeId, DATE, TZ]
    );

    dbAvailable = true;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[availableSlotsTz.realdb.test] DB not available, skipping', err);
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

describe('available-slots → real DB, non-UTC tenant, UTC session', () => {
  it('SAD→FIXED: a scheduled 1:00 PM local appointment is NOT offered as open', async () => {
    const res = await post('/agent-tools/available-slots', {
      tenant_id: tenantId,
      date: DATE,
      service_type: 'a meeting',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    const openTimes: string[] = body.result.open_times;

    // The booked 30 minutes are gone: a 30-minute service starting at 1:00 or
    // 1:15 would overlap [1:00, 1:30).
    expect(openTimes).not.toContain('1:00 PM');
    expect(openTimes).not.toContain('1:15 PM');
    // The rest of the shift is genuinely open — proves we subtracted the
    // appointment, not the whole day (an over-subtraction would also hide the
    // 1:00 PM absence).
    expect(openTimes).toContain('1:30 PM');
    expect(openTimes).toContain('3:00 PM');
    // And the spoken text never offers the taken time.
    expect(String(body.result.spoken ?? '')).not.toMatch(/\b1:00 PM\b/);
  });

  it('HAPPY: with no appointments on the day, the full shift grid is offered', async () => {
    const res = await post('/agent-tools/available-slots', {
      tenant_id: tenantId,
      date: '2027-03-09', // Tuesday — no shift seeded, then seed and re-ask below
      service_type: 'a meeting',
    });
    // No shift that day → open_times must be empty (and never invent times).
    expect(res.json().result.open_times).toEqual([]);
  });
});
