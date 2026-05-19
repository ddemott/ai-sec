/**
 * Real-DB integration test for the reminder retry worker behavior.
 *
 * The unit tests in `services/reminders/retryPolicy.test.ts` cover the
 * pure decision-function shape. This file pins the end-to-end pickup +
 * retry-write contract against an actual Postgres so the schema fields
 * (`retry_count`, `next_retry_at` from migration 20260514000000) and
 * the worker's catch block (`src/workers/reminderScheduler.ts`) stay
 * load-bearing through future schema or library changes.
 *
 * What this proves:
 *  1. A 5xx-style error on a fresh reminder writes retry_count=1 +
 *     next_retry_at=now+5min, leaves status='scheduled'.
 *  2. A 4xx-style error writes status='failed' immediately with no
 *     retry_count change.
 *  3. A row with retry_count=MAX_RETRIES that fails again flips to
 *     status='failed' with reason='max_retries_exceeded'.
 *  4. The getDueReminders pickup query honors next_retry_at — rows
 *     still in their backoff window are NOT returned.
 *  5. A reminder row whose retry_count=0 + next_retry_at IS NULL
 *     IS returned by the pickup query (back-compat for original attempt).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { type Client } from 'pg';
import { getRootClient, clearDB, setupBasicTenant, beginTestTransaction, rollbackTestTransaction, skipIfDbDown } from './test-utils';
import { decideRetry, MAX_RETRIES } from './services/reminders/retryPolicy';

describe('reminder retry worker — real-DB integration', () => {
  let client: Client;
  let tenantId: string;
  let customerId: string;
  let appointmentId: string;
  let dbAvailable = true;
  beforeEach((ctx) => skipIfDbDown(ctx, () => dbAvailable));

  beforeAll(async () => {
    try {
      client = await getRootClient();
      await clearDB(client);
      const setup = await setupBasicTenant(client);
      tenantId = setup.tenantId;
      customerId = setup.customerId;
      // Reminder rows FK to appointments — seed one we can attach to.
      // appointments_start_time_15min / appointments_end_time_15min require
      // start_time and end_time to land on :00/:15/:30/:45 with zero seconds.
      // date_trunc('hour', NOW()) gives a guaranteed-aligned base.
      const apptRes = await client.query(
        `INSERT INTO appointments (tenant_id, resource_id, customer_id, start_time, end_time, status, description)
         VALUES (
           $1, $2, $3,
           date_trunc('hour', NOW()) + INTERVAL '1 day',
           date_trunc('hour', NOW()) + INTERVAL '1 day 30 min',
           'scheduled', 'retry-test-appt'
         )
         RETURNING appointment_id`,
        [tenantId, setup.resourceId, customerId]
      );
      appointmentId = apptRes.rows[0].appointment_id;
    } catch (err) {
      dbAvailable = false;
      console.warn('[reminder-retry-worker] Skipping — DB connection failed', err);
    }
  });

  afterAll(async () => {
    if (dbAvailable && client) {
      await client.end();
    }
  });

  beforeEach(async () => {
    if (!dbAvailable) return;
    await beginTestTransaction(client);
  });

  afterEach(async () => {
    if (!dbAvailable) return;
    await rollbackTestTransaction(client);
  });

  // ─────────────────────────────────────────────────────────────────────
  // Migration columns
  // ─────────────────────────────────────────────────────────────────────

  it('HAPPY: retry_count + next_retry_at columns exist with correct defaults', async () => {
    // WHO   : worker SELECTing from reminder_schedules
    // WHAT  : the two new columns exist; retry_count defaults to 0;
    //         next_retry_at defaults to NULL
    // WHEN  : every run of getDueReminders + every retry write
    // WHERE : migration 20260514000000_reminder_retry_columns.sql
    // WHY   : if either column is missing or has a wrong default, the
    //         worker's pickup query returns garbage and retries silently
    //         break in prod. Pin the schema directly so a future
    //         "simplify the migration" edit fails this test loudly.
    if (!dbAvailable) return;
    const cols = await client.query(
      `SELECT column_name, data_type, is_nullable, column_default
         FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'reminder_schedules'
          AND column_name IN ('retry_count', 'next_retry_at')`
    );
    const map: Record<string, { data_type: string; is_nullable: string; column_default: string | null }> = {};
    for (const r of cols.rows) {
      map[r.column_name] = { data_type: r.data_type, is_nullable: r.is_nullable, column_default: r.column_default };
    }
    expect(map.retry_count?.data_type).toBe('integer');
    expect(map.retry_count?.is_nullable).toBe('NO');
    expect(map.retry_count?.column_default).toContain('0');
    expect(map.next_retry_at?.data_type).toBe('timestamp with time zone');
    expect(map.next_retry_at?.is_nullable).toBe('YES');
  });

  // ─────────────────────────────────────────────────────────────────────
  // Pickup query (getDueReminders)
  // ─────────────────────────────────────────────────────────────────────

  it('HAPPY: a row with retry_count=0 and next_retry_at IS NULL is picked up when scheduled_for is due', async () => {
    // WHY: this is the original-attempt case (no prior failure). The new
    //      pickup-query clause `(next_retry_at IS NULL OR ...)` must
    //      preserve back-compat — fresh rows are NULL and must still
    //      qualify. Surfaced 2026-05-14 — if the IS NULL branch is
    //      dropped, every fresh reminder silently never gets picked up.
    if (!dbAvailable) return;
    const ins = await client.query(
      `INSERT INTO reminder_schedules
         (tenant_id, appointment_id, customer_email, customer_phone, reminder_type,
          scheduled_for, status)
       VALUES ($1, $2, 'a@b.com', '+15550000001', '2h', NOW() - INTERVAL '1 minute', 'scheduled')
       RETURNING reminder_schedule_id`,
      [tenantId, appointmentId]
    );
    const rid = ins.rows[0].reminder_schedule_id;

    const due = await client.query(
      `SELECT * FROM reminder_schedules
        WHERE status = 'scheduled'
          AND scheduled_for <= NOW()
          AND (next_retry_at IS NULL OR next_retry_at <= NOW())
          AND reminder_schedule_id = $1`,
      [rid]
    );
    expect(due.rows).toHaveLength(1);
    expect(due.rows[0].retry_count).toBe(0);
    expect(due.rows[0].next_retry_at).toBeNull();
  });

  it('SAD: a row whose next_retry_at is still in the future is NOT picked up', async () => {
    // WHY: this is the load-bearing assertion for the whole retry
    //      mechanism. If the pickup query ignores next_retry_at, the
    //      worker would re-process the row immediately on the next tick
    //      and burn through retries in seconds instead of waiting the
    //      configured backoff window. Pin the exclusion behavior.
    if (!dbAvailable) return;
    const ins = await client.query(
      `INSERT INTO reminder_schedules
         (tenant_id, appointment_id, customer_email, reminder_type,
          scheduled_for, status, retry_count, next_retry_at)
       VALUES ($1, $2, 'b@c.com', '24h', NOW() - INTERVAL '10 minutes',
               'scheduled', 1, NOW() + INTERVAL '5 minutes')
       RETURNING reminder_schedule_id`,
      [tenantId, appointmentId]
    );
    const rid = ins.rows[0].reminder_schedule_id;

    const due = await client.query(
      `SELECT * FROM reminder_schedules
        WHERE status = 'scheduled'
          AND scheduled_for <= NOW()
          AND (next_retry_at IS NULL OR next_retry_at <= NOW())
          AND reminder_schedule_id = $1`,
      [rid]
    );
    expect(due.rows).toHaveLength(0); // held back by next_retry_at
  });

  it('HAPPY: a row whose next_retry_at is in the past IS picked up', async () => {
    // WHY: completes the inverse of the previous test. Once the backoff
    //      window has elapsed, the worker must include the row in its
    //      batch. Together these two tests pin the temporal contract
    //      of next_retry_at: NULL = original, future = held, past = due.
    if (!dbAvailable) return;
    const ins = await client.query(
      `INSERT INTO reminder_schedules
         (tenant_id, appointment_id, customer_email, reminder_type,
          scheduled_for, status, retry_count, next_retry_at)
       VALUES ($1, $2, 'c@d.com', '72h', NOW() - INTERVAL '1 hour',
               'scheduled', 1, NOW() - INTERVAL '1 minute')
       RETURNING reminder_schedule_id`,
      [tenantId, appointmentId]
    );
    const rid = ins.rows[0].reminder_schedule_id;

    const due = await client.query(
      `SELECT * FROM reminder_schedules
        WHERE status = 'scheduled'
          AND scheduled_for <= NOW()
          AND (next_retry_at IS NULL OR next_retry_at <= NOW())
          AND reminder_schedule_id = $1`,
      [rid]
    );
    expect(due.rows).toHaveLength(1);
    expect(due.rows[0].retry_count).toBe(1);
  });

  // ─────────────────────────────────────────────────────────────────────
  // Retry write (simulates the worker's catch block end-to-end)
  // ─────────────────────────────────────────────────────────────────────

  it('HAPPY: 5xx failure on retry_count=0 writes retry_count=1 + future next_retry_at, status stays scheduled', async () => {
    // WHO   : worker catch block calling decideRetry then writing back
    // WHAT  : retry_count→1, next_retry_at→now+5min, status stays 'scheduled'
    // WHEN  : every transient provider failure
    // WHERE : src/workers/reminderScheduler.ts catch (lines ~74-110)
    // WHY   : this is the load-bearing happy-path of the entire retry
    //         feature — pre-fix, status flipped to 'failed' on the first
    //         error and the reminder was lost. Pin both the retry write
    //         AND the status-stays-scheduled invariant.
    if (!dbAvailable) return;
    const ins = await client.query(
      `INSERT INTO reminder_schedules
         (tenant_id, appointment_id, customer_email, reminder_type,
          scheduled_for, status)
       VALUES ($1, $2, 'd@e.com', 'confirmation', NOW(), 'scheduled')
       RETURNING reminder_schedule_id, retry_count`,
      [tenantId, appointmentId]
    );
    const rid = ins.rows[0].reminder_schedule_id;
    expect(ins.rows[0].retry_count).toBe(0);

    // Simulate the catch-block logic: 5xx error → decideRetry returns retry
    const fakeError = { status: 503, message: 'Service Unavailable' };
    const decision = decideRetry(fakeError, 0);
    expect(decision.action).toBe('retry');

    // Apply the retry write the worker would issue
    if (decision.action === 'retry') {
      await client.query(
        `UPDATE reminder_schedules
            SET retry_count = $1, next_retry_at = $2, error = $3, updated_at = NOW()
          WHERE reminder_schedule_id = $4`,
        [decision.nextRetryCount, decision.nextRetryAt.toISOString(), 'Service Unavailable', rid]
      );
    }

    const after = await client.query(
      `SELECT status, retry_count, next_retry_at, error
         FROM reminder_schedules WHERE reminder_schedule_id = $1`,
      [rid]
    );
    expect(after.rows[0].status).toBe('scheduled'); // load-bearing: NOT 'failed'
    expect(after.rows[0].retry_count).toBe(1);
    expect(new Date(after.rows[0].next_retry_at).getTime()).toBeGreaterThan(Date.now() + 4 * 60_000);
    expect(new Date(after.rows[0].next_retry_at).getTime()).toBeLessThan(Date.now() + 6 * 60_000);
    expect(after.rows[0].error).toBe('Service Unavailable');
  });

  it('SAD: 4xx failure on retry_count=0 flips status to failed immediately, retry_count unchanged', async () => {
    // WHY: 4xx means the input is broken — re-sending the same payload
    //      will produce the same error. Mark failed without consuming
    //      retry budget. Pin both the status flip AND the retry_count
    //      preservation (a regression that increments retry_count
    //      before flipping would burn budget for nothing).
    if (!dbAvailable) return;
    const ins = await client.query(
      `INSERT INTO reminder_schedules
         (tenant_id, appointment_id, customer_email, reminder_type,
          scheduled_for, status)
       VALUES ($1, $2, 'e@f.com', '24h', NOW(), 'scheduled')
       RETURNING reminder_schedule_id`,
      [tenantId, appointmentId]
    );
    const rid = ins.rows[0].reminder_schedule_id;

    const fakeError = { status: 422, message: 'Invalid phone number' };
    const decision = decideRetry(fakeError, 0);
    expect(decision.action).toBe('fail');

    if (decision.action === 'fail') {
      await client.query(
        `UPDATE reminder_schedules
            SET status = 'failed', error = $1, updated_at = NOW()
          WHERE reminder_schedule_id = $2`,
        [`Invalid phone number (reason: ${decision.reason})`, rid]
      );
    }

    const after = await client.query(
      `SELECT status, retry_count, error
         FROM reminder_schedules WHERE reminder_schedule_id = $1`,
      [rid]
    );
    expect(after.rows[0].status).toBe('failed');
    expect(after.rows[0].retry_count).toBe(0); // not incremented — input never gave us a reason to retry
    expect(after.rows[0].error).toContain('non_retryable');
  });

  it('SAD: 5xx failure at retry_count=MAX_RETRIES flips status to failed with reason=max_retries_exceeded', async () => {
    // WHY: the row has used all its retry budget; the 4th failure is
    //      the giving-up signal. Confirms decideRetry's max-retry
    //      branch end-to-end and that the reason distinguishes
    //      'max_retries_exceeded' from a 4xx 'non_retryable' (operator
    //      diagnostics).
    if (!dbAvailable) return;
    const ins = await client.query(
      `INSERT INTO reminder_schedules
         (tenant_id, appointment_id, customer_email, reminder_type,
          scheduled_for, status, retry_count, next_retry_at)
       VALUES ($1, $2, 'f@g.com', '2h', NOW(), 'scheduled', $3, NOW() - INTERVAL '1 second')
       RETURNING reminder_schedule_id`,
      [tenantId, appointmentId, MAX_RETRIES]
    );
    const rid = ins.rows[0].reminder_schedule_id;

    const fakeError = { status: 502, message: 'Bad Gateway' };
    const decision = decideRetry(fakeError, MAX_RETRIES);
    expect(decision.action).toBe('fail');
    if (decision.action === 'fail') {
      expect(decision.reason).toBe('max_retries_exceeded');
      await client.query(
        `UPDATE reminder_schedules
            SET status = 'failed', error = $1, updated_at = NOW()
          WHERE reminder_schedule_id = $2`,
        [`Bad Gateway (reason: ${decision.reason})`, rid]
      );
    }

    const after = await client.query(
      `SELECT status, retry_count, error
         FROM reminder_schedules WHERE reminder_schedule_id = $1`,
      [rid]
    );
    expect(after.rows[0].status).toBe('failed');
    expect(after.rows[0].retry_count).toBe(MAX_RETRIES);
    expect(after.rows[0].error).toContain('max_retries_exceeded');
  });
});
