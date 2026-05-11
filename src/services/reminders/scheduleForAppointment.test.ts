import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PoolClient } from 'pg';

import { scheduleRemindersForAppointment, type WithTenantClient } from './scheduleForAppointment';

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

    await scheduleRemindersForAppointment(
      buildWithTenantClient(client),
      TENANT_ID,
      APPOINTMENT_ID,
    );

    const inserts = queries.filter((q) => q.text.includes('INSERT INTO reminder_schedules'));
    expect(inserts).toHaveLength(4);

    const byType = new Map<string, LoggedQuery>();
    for (const ins of inserts) {
      byType.set(ins.params[4] as string, ins);
    }
    expect(byType.get('confirmation')?.params[5]).toBe(now.toISOString());
    expect(byType.get('72h')?.params[5]).toBe(
      new Date(startTime.getTime() - 72 * 60 * 60 * 1000).toISOString(),
    );
    expect(byType.get('24h')?.params[5]).toBe(
      new Date(startTime.getTime() - 24 * 60 * 60 * 1000).toISOString(),
    );
    expect(byType.get('2h')?.params[5]).toBe(
      new Date(startTime.getTime() - 2 * 60 * 60 * 1000).toISOString(),
    );

    for (const ins of inserts) {
      expect(ins.params[0]).toBe(APPOINTMENT_ID);
      expect(ins.params[1]).toBe(TENANT_ID);
      expect(ins.params[2]).toBe('cust@example.com');
      expect(ins.params[3]).toBe('+15551234567');
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

    await scheduleRemindersForAppointment(
      buildWithTenantClient(client),
      TENANT_ID,
      APPOINTMENT_ID,
    );

    const inserts = queries.filter((q) => q.text.includes('INSERT INTO reminder_schedules'));
    expect(inserts).toHaveLength(4);
    for (const ins of inserts) {
      expect(ins.params[2]).toBeNull();
      expect(ins.params[3]).toBe('+15551234567');
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

    await scheduleRemindersForAppointment(
      buildWithTenantClient(client),
      TENANT_ID,
      APPOINTMENT_ID,
    );

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

    await scheduleRemindersForAppointment(
      buildWithTenantClient(client),
      TENANT_ID,
      APPOINTMENT_ID,
    );

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

    await scheduleRemindersForAppointment(
      buildWithTenantClient(client),
      TENANT_ID,
      APPOINTMENT_ID,
    );

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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        logger as any,
      ),
    ).resolves.toBeUndefined();

    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error.mock.calls[0][0]).toMatchObject({
      tenantId: TENANT_ID,
      appointmentId: APPOINTMENT_ID,
    });
  });
});
