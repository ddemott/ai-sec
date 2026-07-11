import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PoolClient } from 'pg';
import type { FastifyBaseLogger } from 'fastify';

import {
  scheduleRemindersForAppointment,
  rescheduleRemindersForAppointment,
  type WithTenantClient,
} from '../../../src/services/reminders/scheduleForAppointment';

/**
 * Unit coverage for the appointment-create → reminders wire.
 *
 * What this file pins:
 *   - HAPPY: future appointment with both contact methods produces 4
 *     reminder_schedules rows (confirmation + 72h/24h/2h) with correct
 *     scheduled_for offsets relative to start_time.
 *   - HAPPY: customer with phone-only or email-only still gets 4 rows
 *     (worker decides at send time whether to deliver via SMS or email).
 *   - SAD: past appointment writes zero rows (no useful reminder for
 *     a moment that already passed; matches the walk-in carve-out).
 *   - SAD: appointment vanished between RPC and lookup writes zero rows.
 *   - SAD: unparseable start_time writes zero rows.
 *   - SAD: DB error inside the helper is swallowed and logged, never
 *     bubbles back to the caller. A reminder write-failure must never
 *     break the underlying booking response.
 *
 * What this file does NOT cover:
 *   - The worker side (src/workers/reminderScheduler.ts) — covered by
 *     its own tests.
 *   - End-to-end DB-level write — covered by the e2e spec under
 *     dashboard/e2e/reminder-on-create.spec.ts against real Postgres.
 */
const TENANT_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const APPOINTMENT_ID = 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff';

interface LoggedQuery {
  text: string;
  params: unknown[];
}

function buildMockClient(opts: {
  appointmentRow?: {
    start_time: string;
    customer_email: string | null;
    customer_phone: string | null;
  } | null;
  insertThrows?: Error;
}): { client: PoolClient; queries: LoggedQuery[] } {
  const queries: LoggedQuery[] = [];
  const client = {
    query: vi.fn(async (text: string, params: unknown[]) => {
      queries.push({ text, params });
      if (text.includes('FROM appointments a')) {
        return { rows: opts.appointmentRow === null ? [] : [opts.appointmentRow] };
      }
      if (text.includes('INSERT INTO reminder_schedules') && opts.insertThrows) {
        throw opts.insertThrows;
      }
      return { rows: [] };
    }),
  } as unknown as PoolClient;
  return { client, queries };
}

function buildWithTenantClient(client: PoolClient): WithTenantClient {
  return async (_tenantId, fn) => fn(client);
}

/**
 * The helper writes one multi-row INSERT (4 reminder_schedules rows in
 * one statement, 6 params per row → 24 params total). This unpacks the
 * single query's flat params back into row-shaped objects so the test
 * bodies can keep using "find the 24h row, check its scheduled_for"
 * patterns without caring about whether the underlying SQL is 1 or 4
 * INSERTs. If the row shape ever changes (added a column, removed
 * one), this is the only place that needs to update.
 */
interface ReminderInsertRow {
  appointmentId: string;
  tenantId: string;
  email: string | null;
  phone: string | null;
  type: string;
  scheduledFor: string;
}
function unpackReminderInserts(q: LoggedQuery): ReminderInsertRow[] {
  const COLS_PER_ROW = 6;
  const rows: ReminderInsertRow[] = [];
  for (let i = 0; i < q.params.length; i += COLS_PER_ROW) {
    rows.push({
      appointmentId: q.params[i] as string,
      tenantId: q.params[i + 1] as string,
      email: q.params[i + 2] as string | null,
      phone: q.params[i + 3] as string | null,
      type: q.params[i + 4] as string,
      scheduledFor: q.params[i + 5] as string,
    });
  }
  return rows;
}

describe('scheduleRemindersForAppointment', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it('HAPPY: writes 4 reminder rows with correct scheduled_for offsets for a future appointment', async () => {
    // WHO: dashboard user creating an appointment 24h ahead
    // WHAT: helper writes confirmation (now) + 72h/24h/2h-before rows
    // WHEN: immediately after POST /appointments/create succeeds
    // WHERE: src/services/reminders/scheduleForAppointment.ts
    // WHY: pins the row count + scheduled_for math so a regression
    //      that drops one reminder type (or shifts the 24h offset to
    //      e.g. 1 day in ms vs hours-in-ms) fails fast.
    const now = new Date('2026-05-11T10:00:00Z');
    vi.useFakeTimers();
    vi.setSystemTime(now);

    const startTime = new Date('2026-05-12T10:00:00Z'); // 24h ahead
    const { client, queries } = buildMockClient({
      appointmentRow: {
        start_time: startTime.toISOString(),
        customer_email: 'cust@example.com',
        customer_phone: '+15551234567',
      },
    });

    await scheduleRemindersForAppointment(buildWithTenantClient(client), TENANT_ID, APPOINTMENT_ID);

    const inserts = queries.filter((q) => q.text.includes('INSERT INTO reminder_schedules'));
    expect(inserts).toHaveLength(1);
    const rows = unpackReminderInserts(inserts[0]);
    expect(rows).toHaveLength(4);

    const byType = new Map(rows.map((r) => [r.type, r]));
    expect(byType.get('confirmation')?.scheduledFor).toBe(now.toISOString());
    expect(byType.get('72h')?.scheduledFor).toBe(
      new Date(startTime.getTime() - 72 * 60 * 60 * 1000).toISOString()
    );
    expect(byType.get('24h')?.scheduledFor).toBe(
      new Date(startTime.getTime() - 24 * 60 * 60 * 1000).toISOString()
    );
    expect(byType.get('2h')?.scheduledFor).toBe(
      new Date(startTime.getTime() - 2 * 60 * 60 * 1000).toISOString()
    );

    for (const row of rows) {
      expect(row.appointmentId).toBe(APPOINTMENT_ID);
      expect(row.tenantId).toBe(TENANT_ID);
      expect(row.email).toBe('cust@example.com');
      expect(row.phone).toBe('+15551234567');
    }
  });

  it('HAPPY: writes rows even when customer has phone but no email', async () => {
    // WHO: tire shop walk-in customer with phone-only contact
    // WHAT: helper still schedules 4 rows; worker filters by consent at send time
    // WHEN: customer profile has email NULL
    // WHERE: src/services/reminders/scheduleForAppointment.ts
    // WHY: customers.email is nullable; we must not 500 or skip silently
    const now = new Date('2026-05-11T10:00:00Z');
    vi.useFakeTimers();
    vi.setSystemTime(now);

    const { client, queries } = buildMockClient({
      appointmentRow: {
        start_time: '2026-05-13T10:00:00Z',
        customer_email: null,
        customer_phone: '+15551234567',
      },
    });

    await scheduleRemindersForAppointment(buildWithTenantClient(client), TENANT_ID, APPOINTMENT_ID);

    const inserts = queries.filter((q) => q.text.includes('INSERT INTO reminder_schedules'));
    expect(inserts).toHaveLength(1);
    const rows = unpackReminderInserts(inserts[0]);
    expect(rows).toHaveLength(4);
    for (const row of rows) {
      expect(row.email).toBeNull();
      expect(row.phone).toBe('+15551234567');
    }
  });

  it('SAD: writes zero rows for a past appointment', async () => {
    // WHO: operator recording a walk-in for a moment that already passed
    // WHAT: helper detects past start_time and skips silently
    // WHEN: 5 minutes after the appointment's start_time
    // WHERE: src/services/reminders/scheduleForAppointment.ts
    // WHY: the walk-in carve-out (booking-past-time intentionally allowed)
    //      should not produce useless reminders that the worker would
    //      have to immediately mark cancelled.
    const now = new Date('2026-05-11T10:05:00Z');
    vi.useFakeTimers();
    vi.setSystemTime(now);

    const { client, queries } = buildMockClient({
      appointmentRow: {
        start_time: '2026-05-11T10:00:00Z', // 5min ago
        customer_email: 'cust@example.com',
        customer_phone: '+15551234567',
      },
    });

    await scheduleRemindersForAppointment(buildWithTenantClient(client), TENANT_ID, APPOINTMENT_ID);

    const inserts = queries.filter((q) => q.text.includes('INSERT INTO reminder_schedules'));
    expect(inserts).toHaveLength(0);
  });

  it('SAD: writes zero rows when the appointment lookup returns nothing', async () => {
    // WHO: race where the appointment row vanishes between RPC + lookup
    //      (e.g. concurrent rollback inside the same tenant transaction)
    // WHAT: helper handles empty rows gracefully — no crash, no writes
    // WHEN: the RPC reported success but the SELECT finds zero rows
    // WHERE: src/services/reminders/scheduleForAppointment.ts
    // WHY: real-world only; defensive against an unlikely race that
    //      would otherwise dereference undefined.
    const { client, queries } = buildMockClient({ appointmentRow: null });

    await scheduleRemindersForAppointment(buildWithTenantClient(client), TENANT_ID, APPOINTMENT_ID);

    const inserts = queries.filter((q) => q.text.includes('INSERT INTO reminder_schedules'));
    expect(inserts).toHaveLength(0);
  });

  it('SAD: writes zero rows when start_time is unparseable', async () => {
    // WHO: a corrupted appointments row (start_time NULL or invalid string)
    // WHAT: helper rejects the lookup result and returns silently
    // WHEN: start_time fails Date parsing
    // WHERE: src/services/reminders/scheduleForAppointment.ts
    // WHY: prevents new Date(NaN) from cascading into Infinity / -Infinity
    //      offsets that Postgres would reject with a less actionable error
    const { client, queries } = buildMockClient({
      appointmentRow: {
        start_time: 'definitely-not-a-date',
        customer_email: 'cust@example.com',
        customer_phone: '+15551234567',
      },
    });

    await scheduleRemindersForAppointment(buildWithTenantClient(client), TENANT_ID, APPOINTMENT_ID);

    const inserts = queries.filter((q) => q.text.includes('INSERT INTO reminder_schedules'));
    expect(inserts).toHaveLength(0);
  });

  it('SAD: swallows DB error and logs it without bubbling to caller', async () => {
    // WHO: backend during a transient Postgres failure on the reminder INSERT
    // WHAT: helper catches the error, logs via the provided logger, returns
    //       cleanly. The caller (POST /appointments/create) must not 500.
    // WHEN: INSERT throws (e.g. table missing, FK violation, connection blip)
    // WHERE: src/services/reminders/scheduleForAppointment.ts catch block
    // WHY: reminders are fire-and-forget; an outage of the reminder
    //      subsystem must NEVER fail the user-facing booking that has
    //      already committed.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-11T10:00:00Z'));

    const { client } = buildMockClient({
      appointmentRow: {
        start_time: '2026-05-12T10:00:00Z',
        customer_email: 'cust@example.com',
        customer_phone: '+15551234567',
      },
      insertThrows: new Error('connection terminated'),
    });

    const logger = {
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
      trace: vi.fn(),
      fatal: vi.fn(),
      level: 'info',
      child: vi.fn(),
      silent: vi.fn(),
    };

    await expect(
      scheduleRemindersForAppointment(
        buildWithTenantClient(client),
        TENANT_ID,
        APPOINTMENT_ID,
        logger as unknown as FastifyBaseLogger
      )
    ).resolves.toBeUndefined();

    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error.mock.calls[0][0]).toMatchObject({
      tenantId: TENANT_ID,
      appointmentId: APPOINTMENT_ID,
    });
  });
});

/**
 * rescheduleRemindersForAppointment — wraps scheduleRemindersForAppointment
 * with a cancel-then-seed step used by `/appointments/:id/update` when the
 * operator moves an appointment's start_time. Tests pin:
 *
 *   - HAPPY: cancels existing scheduled rows (one UPDATE) AND re-seeds the
 *     4-row bundle (4 INSERTs).
 *   - SAD: UPDATE failure on cancel is logged but does NOT block the seed —
 *     the customer must still get correctly-timed reminders for the new
 *     start_time even if the audit-trail cancel failed transiently.
 *   - SAD: seed failure post-cancel is swallowed by the inner helper (same
 *     contract as the underlying scheduleRemindersForAppointment).
 */
describe('rescheduleRemindersForAppointment', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it('HAPPY: cancels existing scheduled rows and re-seeds the 4-row bundle', async () => {
    // WHO: tenant moving an appointment from 14:00 to 16:00.
    // WHAT: helper issues an UPDATE reminder_schedules SET status='cancelled'
    //       for the appointment's currently-scheduled rows, then writes 4
    //       fresh reminder rows.
    // WHEN: every reschedule that changed start_time (the route's guard).
    // WHERE: src/services/reminders/scheduleForAppointment.ts
    //        rescheduleRemindersForAppointment.
    // WHY: pins the cancel-then-seed sequence + row counts. A regression
    //      that drops the cancel step would let the worker fire BOTH the
    //      old and new reminder bundles, double-notifying the customer.
    const now = new Date('2026-05-11T10:00:00Z');
    vi.useFakeTimers();
    vi.setSystemTime(now);

    const startTime = new Date('2026-05-12T10:00:00Z'); // 24h ahead
    const { client, queries } = buildMockClient({
      appointmentRow: {
        start_time: startTime.toISOString(),
        customer_email: 'cust@example.com',
        customer_phone: '+15551234567',
      },
    });

    await rescheduleRemindersForAppointment(
      buildWithTenantClient(client),
      TENANT_ID,
      APPOINTMENT_ID
    );

    const cancels = queries.filter(
      (q) => q.text.includes('UPDATE reminder_schedules') && q.text.includes("status = 'cancelled'")
    );
    expect(cancels).toHaveLength(1);
    expect(cancels[0].params).toEqual([APPOINTMENT_ID, TENANT_ID]);

    const inserts = queries.filter((q) => q.text.includes('INSERT INTO reminder_schedules'));
    expect(inserts).toHaveLength(1);
    expect(unpackReminderInserts(inserts[0])).toHaveLength(4);
  });

  it('SAD: UPDATE failure during cancel is logged but does NOT block the seed step', async () => {
    // WHO: a transient DB blip on the UPDATE — e.g., row lock contention
    //      with the worker reading the same appointment, or a connection
    //      that drops mid-statement.
    // WHAT: helper catches the UPDATE error, logs it, AND STILL CALLS the
    //       seed step. Customer ends up with the new-time reminders even
    //       though the audit-trail cancel was lost.
    // WHEN: rare but real — Postgres lock contention shows up under load.
    // WHERE: src/services/reminders/scheduleForAppointment.ts — the
    //        try/catch around the UPDATE statement, AND the unconditional
    //        seed call below it.
    // WHY: reminders are customer-facing. The audit trail for cancel
    //      ("we cancelled the old reminder") is operational nice-to-have;
    //      the new-time reminder is load-bearing UX. Trade: lose the
    //      cancel row, keep the customer informed of the right time.
    let updateCalled = false;
    let insertCount = 0;
    const client = {
      query: vi.fn(async (text: string) => {
        if (text.includes('UPDATE reminder_schedules')) {
          updateCalled = true;
          throw new Error('lock timeout on reminder_schedules');
        }
        if (text.includes('FROM appointments a')) {
          return {
            rows: [
              {
                start_time: '2026-05-12T10:00:00Z',
                customer_email: 'cust@example.com',
                customer_phone: '+15551234567',
              },
            ],
          };
        }
        if (text.includes('INSERT INTO reminder_schedules')) {
          insertCount++;
          return { rows: [] };
        }
        return { rows: [] };
      }),
    } as unknown as PoolClient;

    const logger = {
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
      trace: vi.fn(),
      fatal: vi.fn(),
      level: 'info',
      child: vi.fn(),
      silent: vi.fn(),
    };

    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-11T10:00:00Z'));

    await rescheduleRemindersForAppointment(
      buildWithTenantClient(client),
      TENANT_ID,
      APPOINTMENT_ID,
      logger as unknown as FastifyBaseLogger
    );

    expect(updateCalled).toBe(true);
    // One multi-row INSERT covers all 4 reminder rows (see helper). The
    // assertion stays "seed proceeded despite cancel failure" — counting
    // statements not rows.
    expect(insertCount).toBe(1);
    expect(logger.error).toHaveBeenCalled();
    // The log must surface tenantId + appointmentId so support can find the row
    expect(logger.error.mock.calls[0][0]).toMatchObject({
      tenantId: TENANT_ID,
      appointmentId: APPOINTMENT_ID,
    });
  });

  it('SAD: never throws even when both cancel AND seed fail (caller contract)', async () => {
    // WHO: a complete reminder-subsystem outage — both the cancel UPDATE
    //      and the seed INSERTs raise.
    // WHAT: helper returns cleanly (resolves to undefined), never throws.
    //       The caller (POST /:id/update) must not 500 just because
    //       reminders fell over.
    // WHEN: rare double-failure scenario. The contract still has to hold.
    // WHERE: the catch block around the UPDATE + the underlying
    //        scheduleRemindersForAppointment's own catch block.
    // WHY: the update RPC is the user-facing path. A double-failure on
    //      the fire-and-forget reminder side must not propagate. Pin the
    //      never-throw contract so a refactor that "improves" the error
    //      handling (e.g., re-throwing on certain error types) can't
    //      silently regress the user-facing reliability.
    const client = {
      query: vi.fn(async () => {
        throw new Error('reminder subsystem unreachable');
      }),
    } as unknown as PoolClient;

    await expect(
      rescheduleRemindersForAppointment(buildWithTenantClient(client), TENANT_ID, APPOINTMENT_ID)
    ).resolves.toBeUndefined();
  });
});
