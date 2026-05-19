/**
 * Metric-emission coverage for ReminderProcessor.processReminder().
 *
 * Closes TODO.md Phase 5: "Monitoring dashboard for reminder delivery
 * rates." Two counters added:
 *   - reminders_sent_total{channel, outcome} — every delivery attempt's
 *     result, per channel.
 *   - reminders_skipped_total{reason} — reminders that skipped delivery
 *     entirely (appointment vanished / cancelled / no consent / threw).
 *
 * Why pin emission with dedicated tests: the existing
 * src/services/reminders/reminders.test.ts asserts business-logic
 * outcomes (status updates, communicationService calls). The metrics
 * are silent side-effects — a refactor could drop the .inc() call
 * without any other test failing. Pinning each branch here makes the
 * dashboard contract load-bearing in the test suite.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ReminderProcessor } from './reminderProcessor.js';
import type { ReminderRepository } from './reminderRepository.js';
import type { CommunicationService } from '../communications/index.js';
import type { ConsentService } from '../consentService.js';
import type { ReminderSchedule } from './types.js';
import type { Appointment } from '../../types/index.js';
import { registry, remindersSentTotal, remindersSkippedTotal } from '../metrics.js';

// ── Test helpers ─────────────────────────────────────────────────────

function buildReminder(overrides: Partial<ReminderSchedule> = {}): ReminderSchedule {
  return {
    reminder_schedule_id: 1,
    appointment_id: 'a1111111-1111-1111-1111-111111111111',
    tenant_id: 't1111111-1111-1111-1111-111111111111',
    customer_email: 'cust@example.com',
    customer_phone: '+15551234567',
    reminder_type: '24h',
    scheduled_for: new Date().toISOString(),
    status: 'scheduled',
    ...overrides,
  };
}

function buildAppointment(overrides: Partial<Appointment> = {}): Appointment {
  // Future date so the "time passed" branch doesn't fire.
  const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  // ReminderProcessor reads BOTH snake_case (consent check) and camelCase
  // (sendReminder) fields off the appointment, so the fixture sets both
  // to match the shape the real getAppointmentDetails() builds.
  return {
    id: 'a1111111-1111-1111-1111-111111111111',
    tenantId: 't1111111-1111-1111-1111-111111111111',
    customer_email: 'cust@example.com',
    customer_phone: '+15551234567',
    customerEmail: 'cust@example.com',
    customerPhone: '+15551234567',
    customerName: 'Customer',
    serviceName: 'Service',
    staffName: 'Staff',
    dateTime: future,
    duration: 60,
    status: 'scheduled',
    ...overrides,
  };
}

function buildMockRepository(opts: {
  reminder: ReminderSchedule | null;
  appointment: Appointment | null;
}): ReminderRepository {
  return {
    getReminder: vi.fn().mockResolvedValue(opts.reminder),
    getAppointmentDetails: vi.fn().mockResolvedValue(opts.appointment),
    updateReminderStatus: vi.fn().mockResolvedValue(undefined),
  } as unknown as ReminderRepository;
}

function buildMockCommService(opts: {
  emailSuccess: boolean;
  smsSuccess: boolean;
}): CommunicationService {
  return {
    sendAppointmentConfirmation: vi.fn().mockResolvedValue({
      email: { success: opts.emailSuccess },
      sms: { success: opts.smsSuccess },
    }),
    sendAppointmentReminder: vi.fn().mockResolvedValue({
      email: { success: opts.emailSuccess },
      sms: { success: opts.smsSuccess },
    }),
    sendSMS: vi.fn().mockResolvedValue({ success: opts.smsSuccess }),
  } as unknown as CommunicationService;
}

function buildMockConsentService(consents: boolean): ConsentService {
  return {
    checkConsent: vi.fn().mockResolvedValue(consents),
  } as unknown as ConsentService;
}

function readCounter(name: string, labels: Record<string, string>): number {
  const snap = (
    name === 'reminders_sent_total' ? remindersSentTotal : remindersSkippedTotal
  ).snapshot();
  const labelKey = Object.entries(labels)
    .sort()
    .map(([k, v]) => `${k}=${v}`)
    .join('|');
  const match = snap.find((s) => {
    const sKey = Object.entries(s.labels)
      .sort()
      .map(([k, v]) => `${k}=${v}`)
      .join('|');
    return sKey === labelKey;
  });
  return match?.value ?? 0;
}

beforeEach(() => {
  registry.clearAll();
});

describe('ReminderProcessor metrics', () => {
  it('HAPPY: email success → reminders_sent_total{channel=email,outcome=success}+=1', async () => {
    // WHO: reminder worker delivering a 24h reminder.
    // WHAT: email goes out successfully; SMS skipped (no phone consent).
    // WHEN: every successful email reminder.
    // WHERE: ReminderProcessor.sendReminder email branch.
    // WHY: pins the success-side counter so a regression that drops
    //      the .inc() call (or mis-labels it) fails fast.
    const consents = buildMockConsentService(true);
    const comm = buildMockCommService({ emailSuccess: true, smsSuccess: false });
    const repo = buildMockRepository({
      reminder: buildReminder({ customer_phone: undefined }),
      appointment: buildAppointment({ customer_phone: undefined, customerPhone: undefined }),
    });
    const processor = new ReminderProcessor(repo, comm, consents);

    await processor.processReminder('1');

    expect(readCounter('reminders_sent_total', { channel: 'email', outcome: 'success' })).toBe(1);
    expect(readCounter('reminders_sent_total', { channel: 'sms', outcome: 'success' })).toBe(0);
    expect(readCounter('reminders_skipped_total', { reason: 'no_consent' })).toBe(0);
  });

  it('HAPPY: sms success → reminders_sent_total{channel=sms,outcome=success}+=1', async () => {
    // WHO: reminder worker delivering a 2h reminder via SMS.
    // WHAT: SMS goes out successfully; email skipped (no email consent).
    // WHEN: every successful SMS reminder.
    // WHERE: ReminderProcessor.sendReminder sms branch.
    // WHY: pins the per-channel counter independently — a refactor
    //      that copy-pastes from the email branch without re-labeling
    //      would surface as the sms label always zero.
    const consents = {
      checkConsent: vi
        .fn()
        .mockImplementation(
          async (_tenantId: string, _email?: string, _phone?: string, channel?: 'email' | 'sms') =>
            channel === 'sms'
        ),
    } as unknown as ConsentService;
    const comm = buildMockCommService({ emailSuccess: false, smsSuccess: true });
    const repo = buildMockRepository({
      reminder: buildReminder({ customer_email: undefined }),
      appointment: buildAppointment({ customer_email: undefined, customerEmail: undefined }),
    });
    const processor = new ReminderProcessor(repo, comm, consents);

    await processor.processReminder('1');

    expect(readCounter('reminders_sent_total', { channel: 'sms', outcome: 'success' })).toBe(1);
    expect(readCounter('reminders_sent_total', { channel: 'email', outcome: 'success' })).toBe(0);
  });

  it('SAD: email failure → reminders_sent_total{channel=email,outcome=failure}+=1', async () => {
    // WHO: reminder worker hitting a Gmail SMTP error.
    // WHAT: email .send() returns success:false; metric records the
    //       failure with channel=email + outcome=failure.
    // WHEN: every channel-level delivery failure — what the dashboard
    //       needs to ALERT on.
    // WHERE: ReminderProcessor.sendReminder email branch.
    // WHY: this is the load-bearing metric for paging when delivery
    //       breaks. If the counter doesn't increment when send fails,
    //       the alert never fires and customers miss reminders silently.
    const consents = buildMockConsentService(true);
    const comm = buildMockCommService({ emailSuccess: false, smsSuccess: false });
    const repo = buildMockRepository({
      reminder: buildReminder({ customer_phone: undefined }),
      appointment: buildAppointment({ customer_phone: undefined, customerPhone: undefined }),
    });
    const processor = new ReminderProcessor(repo, comm, consents);

    await processor.processReminder('1');

    expect(readCounter('reminders_sent_total', { channel: 'email', outcome: 'failure' })).toBe(1);
    expect(readCounter('reminders_sent_total', { channel: 'email', outcome: 'success' })).toBe(0);
  });

  it('SAD: appointment not found → reminders_skipped_total{reason=appointment_not_found}+=1', async () => {
    // WHO: race where the appointment was deleted between worker
    //      tick and lookup.
    // WHAT: getAppointmentDetails returns null; reminder marked failed.
    // WHEN: high-volume rate of this skip reason suggests a deletion
    //       cascade is dropping appointments without their reminders.
    // WHERE: ReminderProcessor.processReminder early-return branch.
    // WHY: pins the not-found counter — distinguishes from
    //      no_consent and cancelled in the dashboard breakdown.
    const consents = buildMockConsentService(true);
    const comm = buildMockCommService({ emailSuccess: true, smsSuccess: true });
    const repo = buildMockRepository({
      reminder: buildReminder(),
      appointment: null,
    });
    const processor = new ReminderProcessor(repo, comm, consents);

    await processor.processReminder('1');

    expect(readCounter('reminders_skipped_total', { reason: 'appointment_not_found' })).toBe(1);
    expect(readCounter('reminders_sent_total', { channel: 'email', outcome: 'success' })).toBe(0);
  });

  it('SAD: appointment cancelled → reminders_skipped_total{reason=appointment_cancelled}+=1', async () => {
    // WHO: customer cancelled the appointment after the reminder was
    //      scheduled.
    // WHAT: appointment.status === 'cancelled'; reminder updated to
    //       cancelled; metric records the skip.
    // WHEN: cancellation traffic — high volume in this label is a
    //       UX signal (customers cancelling frequently is a product
    //       insight, not a delivery bug).
    // WHERE: ReminderProcessor.processReminder cancellation guard.
    // WHY: keeps cancellations separate from delivery failures so
    //       success rate isn't polluted by a perfectly-working
    //       cancellation flow.
    const consents = buildMockConsentService(true);
    const comm = buildMockCommService({ emailSuccess: true, smsSuccess: true });
    const repo = buildMockRepository({
      reminder: buildReminder(),
      appointment: buildAppointment({ status: 'cancelled' }),
    });
    const processor = new ReminderProcessor(repo, comm, consents);

    await processor.processReminder('1');

    expect(readCounter('reminders_skipped_total', { reason: 'appointment_cancelled' })).toBe(1);
  });

  it('SAD: no consent → reminders_skipped_total{reason=no_consent}+=1', async () => {
    // WHO: customer never opted into communications, or revoked
    //      after the reminder was scheduled.
    // WHAT: consent check returns false; reminder cancelled before
    //       sendReminder runs.
    // WHEN: every no-consent reminder — important for the customer-
    //       acquisition funnel insight (are we asking for consent
    //       at the right point in the booking flow?).
    // WHERE: ReminderProcessor.processReminder consent guard.
    // WHY: pins the consent-skip counter independently of cancellations
    //       and not-found, so the dashboard can isolate "we have
    //       customers we can't legally reach" as a distinct signal.
    const consents = buildMockConsentService(false);
    const comm = buildMockCommService({ emailSuccess: true, smsSuccess: true });
    const repo = buildMockRepository({
      reminder: buildReminder(),
      appointment: buildAppointment(),
    });
    const processor = new ReminderProcessor(repo, comm, consents);

    await processor.processReminder('1');

    expect(readCounter('reminders_skipped_total', { reason: 'no_consent' })).toBe(1);
    expect(readCounter('reminders_sent_total', { channel: 'email', outcome: 'success' })).toBe(0);
  });

  it('SAD: processing error → reminders_skipped_total{reason=processing_error}+=1', async () => {
    // WHO: any uncaught error during processing — DB connection drop,
    //      JSON parse failure on appointment row, etc.
    // WHAT: outer try/catch fires; metric records the bucket-of-last-
    //       resort error.
    // WHEN: unexpected failures — should be near-zero in steady state.
    //       Non-zero is the page-the-on-call signal.
    // WHERE: ReminderProcessor.processReminder outer catch.
    // WHY: separates "expected business outcomes" (cancelled,
    //       no_consent) from "code is broken" (processing_error)
    //       so the alert routing can differ.
    const consents = buildMockConsentService(true);
    const comm = buildMockCommService({ emailSuccess: true, smsSuccess: true });
    const repo = {
      getReminder: vi.fn().mockResolvedValue(buildReminder()),
      getAppointmentDetails: vi.fn().mockRejectedValue(new Error('DB exploded')),
      updateReminderStatus: vi.fn().mockResolvedValue(undefined),
    } as unknown as ReminderRepository;
    const processor = new ReminderProcessor(repo, comm, consents);

    await processor.processReminder('1');

    expect(readCounter('reminders_skipped_total', { reason: 'processing_error' })).toBe(1);
  });
});
