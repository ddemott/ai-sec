/* eslint-disable @typescript-eslint/unbound-method, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
/**
 * REGRESSION — the reminder retry policy must actually be REACHABLE.
 *
 * THE BUG (found 2026-07-13): `ReminderService.processReminder` wrapped
 * everything in try/catch and, on ANY failure, marked the row 'failed' itself
 * and returned NORMALLY. The worker's catch block — which owns `decideRetry()`,
 * `retry_count`, `next_retry_at` and the whole 5m/30m/2h backoff — only runs
 * when processReminder THROWS. It structurally could not.
 *
 * So `retryPolicy.ts`, `MAX_RETRIES`, and migration 20260514000000 were
 * decoration. One transient Telnyx 5xx permanently killed a customer's reminder
 * and nobody ever heard about it. Production agreed: `max(retry_count)` was
 * NULL — not one row had ever retried, ever.
 *
 * Nothing caught it because no test asserted the SEAM. There were tests for
 * retryPolicy (pure, passing) and tests for processReminder (passing) — and the
 * bug lived precisely in the gap between them: two correct halves that were
 * never wired together. That is what this file exists to hold shut.
 *
 * A method that swallows the error its caller was built to handle is not being
 * defensive. It is lying about what happened.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ReminderService, ReminderSendError } from '../../src/services/reminders/index.js';
import { decideRetry } from '../../src/services/reminders/retryPolicy.js';
import type { DatabaseService } from '../../src/database/index.js';
import type { TenantConfigService, TenantConfig } from '../../src/services/tenants/index.js';

const REMINDER_ID = '1';

const tenantConfig: TenantConfig = {
  tenantId: 't1',
  name: 'Test Business',
  phone: '+15551234567',
  timezone: 'America/Chicago',
  settings: { smsEnabled: true, emailEnabled: true, reminderHours: [24] },
};

const configService = (): TenantConfigService =>
  ({
    getTenantConfig: vi.fn().mockResolvedValue(tenantConfig),
    getBusinessName: vi.fn().mockResolvedValue('Test Business'),
    getNotificationPreferences: vi.fn().mockResolvedValue({
      smsEnabled: true,
      emailEnabled: true,
      reminderHours: [24],
      contactInfo: { phone: '+15551234567' },
    }),
  }) as unknown as TenantConfigService;

/** A due reminder for a real, future, consented appointment — everything is fine
 *  except the provider, which is exactly the case that must retry. */
const db = (opts: { consented: boolean }): DatabaseService =>
  ({
    getReminderSchedule: vi.fn().mockResolvedValue({
      reminder_schedule_id: 1,
      tenant_id: 't1',
      appointment_id: 'a1',
      reminder_type: 'confirmation',
      lead_minutes: 0,
      status: 'scheduled',
      customer_phone: '+15551112222',
      customer_email: null,
      scheduled_for: new Date('2026-04-09T10:00:00Z').toISOString(),
    }),
    getAppointmentById: vi.fn().mockResolvedValue({
      appointment_id: 'a1',
      tenant_id: 't1',
      status: 'scheduled',
      dateTime: new Date(Date.now() + 86_400_000).toISOString(),
      customerName: 'Reba',
      customerPhone: '+15551112222',
    }),
    getConsentRecordsByCustomer: vi.fn().mockResolvedValue(
      opts.consented
        ? [
            {
              consent_record_id: 1,
              consent_type: 'both',
              consent_given: true,
              consent_date: new Date().toISOString(),
            },
          ]
        : []
    ),
    updateReminderSchedule: vi.fn().mockResolvedValue({}),
  }) as unknown as DatabaseService;

describe('REGRESSION: a transient send failure must reach the worker, not die in the service', () => {
  let service: ReminderService;
  let database: DatabaseService;

  beforeEach(() => {
    vi.clearAllMocks();
    database = db({ consented: true });
    service = new ReminderService(database, configService());
  });

  it('SAD: a failed send THROWS out of processReminder (the worker cannot retry what it never sees)', async () => {
    // WHO: a customer whose confirmation text hit a Telnyx 503.
    // WHAT: processReminder must propagate the failure.
    // WHEN: any transient provider blip.
    // WHERE: src/services/reminders/index.ts processReminder.
    // WHY: the worker's decideRetry/backoff lives in a `catch`. If this method
    //      returns normally, that catch is dead code and the reminder is lost
    //      forever after ONE failure. This is the assertion the original bug
    //      would have failed.
    vi.spyOn(
      service as unknown as { sendReminder: () => Promise<boolean> },
      'sendReminder'
    ).mockResolvedValue(false);

    await expect(service.processReminder(REMINDER_ID)).rejects.toThrow(ReminderSendError);

    // ...and it must NOT have unilaterally marked the row terminally failed —
    // that decision belongs to the worker, which knows the retry count.
    const statusWrites = (database.updateReminderSchedule as ReturnType<typeof vi.fn>).mock.calls;
    const markedFailed = statusWrites.some(
      (c: unknown[]) => (c[1] as { status?: string })?.status === 'failed'
    );
    expect(markedFailed).toBe(false);
  });

  it('HAPPY: the thrown failure is classified RETRYABLE, so the backoff actually engages', async () => {
    // WHY: throwing is only half the fix. The error must also survive
    //      retryPolicy's triage — a status-less send failure is deliberately
    //      treated as retryable ("better to over-retry than lose"). This closes
    //      the loop end-to-end: failure → throw → decideRetry → 'retry'.
    const decision = decideRetry(new ReminderSendError('Communication failed', REMINDER_ID), 0);

    expect(decision.action).toBe('retry');
    expect(decision.nextRetryCount).toBe(1);
  });

  it('HAPPY: a successful send still marks the row sent and throws nothing', async () => {
    // WHY: guard against over-correcting. The rethrow must not turn a healthy
    //      send into an error path.
    vi.spyOn(
      service as unknown as { sendReminder: () => Promise<boolean> },
      'sendReminder'
    ).mockResolvedValue(true);

    await expect(service.processReminder(REMINDER_ID)).resolves.toBeUndefined();

    const statusWrites = (database.updateReminderSchedule as ReturnType<typeof vi.fn>).mock.calls;
    expect(
      statusWrites.some((c: unknown[]) => (c[1] as { status?: string })?.status === 'sent')
    ).toBe(true);
  });

  it('SAD: a no-consent cancellation is NOT an error — it must not retry (and must not throw)', async () => {
    // WHO: a customer who never agreed to be texted.
    // WHY: suppression is legally correct and must stay terminal. Retrying it
    //      would re-attempt an unlawful send every 5 minutes. The fix adds a
    //      metric + log to this branch (it used to be utterly silent) WITHOUT
    //      turning it into a retryable failure — the distinction between "we
    //      couldn't send" and "we must not send" is the whole point.
    database = db({ consented: false });
    service = new ReminderService(database, configService());

    await expect(service.processReminder(REMINDER_ID)).resolves.toBeUndefined();

    const statusWrites = (database.updateReminderSchedule as ReturnType<typeof vi.fn>).mock.calls;
    const cancelled = statusWrites.find(
      (c: unknown[]) => (c[1] as { status?: string })?.status === 'cancelled'
    );
    expect(cancelled).toBeTruthy();
  });
});
