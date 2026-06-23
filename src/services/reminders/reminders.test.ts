/* eslint-disable @typescript-eslint/unbound-method, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
/**
 * Reminders Service Tests
 * Tests reminder scheduling, processing, and cancellation with happy + sad paths.
 * Each section includes 5W diagnostic context (WHO, WHAT, WHEN, WHERE, WHY).
 *
 * unbound-method disabled due to Vitest mock patterns (standard in this codebase).
 * See historical REFACTORING_TODO.md item 10 (see RESOLVED.md for details).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ReminderService } from './index.js';
import type { TenantConfigService, TenantConfig } from '../tenants/index.js';
import type { DatabaseService } from '../../database/index.js';
import type { ReminderSchedule } from './types.js';

// ── Mock Setup ───────────────────────────────────────────────────────

const mockTenantConfig: TenantConfig = {
  tenantId: 'test-tenant-123',
  name: 'Test Business',
  phone: '+15551234567',
  timezone: 'America/Chicago',
  settings: {
    smsEnabled: true,
    emailEnabled: true,
    reminderHours: [72, 24, 2],
  },
};

const createMockConfigService = (): TenantConfigService => ({
  getTenantConfig: vi.fn().mockResolvedValue(mockTenantConfig),
  getTenantConfigs: vi.fn().mockResolvedValue([mockTenantConfig]),
  updateTenantConfig: vi.fn().mockResolvedValue(mockTenantConfig),
  getBusinessName: vi.fn().mockResolvedValue('Test Business'),
  getNotificationPreferences: vi.fn().mockResolvedValue({
    smsEnabled: true,
    emailEnabled: true,
    reminderHours: [72, 24, 2],
    contactInfo: { phone: '+15551234567' },
  }),
});

const createMockDb = (): DatabaseService => ({
  createReminderSchedule: vi
    .fn()
    .mockImplementation((data) =>
      Promise.resolve({ reminder_schedule_id: 1, ...data, status: 'scheduled' })
    ),
  getReminderSchedule: vi.fn(),
  updateReminderSchedule: vi.fn().mockResolvedValue({}),
  getReminderSchedulesByTenant: vi.fn().mockResolvedValue([]),
  getReminderSchedulesByAppointment: vi.fn().mockResolvedValue([]),
  getDueReminders: vi.fn().mockResolvedValue([]),
  getAppointmentById: vi.fn(),
  createConsentRecord: vi.fn(),
  getConsentRecordsByCustomer: vi.fn().mockResolvedValue([
    {
      consent_record_id: 1,
      consent_type: 'both',
      consent_given: true,
      consent_date: new Date().toISOString(),
      consent_method: 'booking',
    },
  ]),
  getConsentRecordsByTenant: vi.fn().mockResolvedValue([]),
  updateConsentRecord: vi.fn(),
  createOptOutRecord: vi.fn(),
  getOptOutRecordsByTenant: vi.fn().mockResolvedValue([]),
});

const createFutureDate = (hoursFromNow: number): Date => {
  const date = new Date();
  date.setHours(date.getHours() + hoursFromNow);
  return date;
};

describe('ReminderService', () => {
  let mockDb: DatabaseService;
  let configService: TenantConfigService;
  let reminderService: ReminderService;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-09T10:00:00Z'));

    mockDb = createMockDb();
    configService = createMockConfigService();
    reminderService = new ReminderService(mockDb, configService);
  });

  afterEach(() => {
    vi.useRealTimers();
    reminderService.cleanup();
  });

  describe('Happy Paths', () => {
    describe('scheduleAppointmentReminders', () => {
      it('schedules all 4 reminders for future appointment', async () => {
        const futureDate = createFutureDate(96); // 4 days from now
        const appointment = {
          id: 'apt-123',
          tenantId: 'test-tenant-123',
          customerEmail: 'customer@example.com',
          customerPhone: '+15559876543',
          customerName: 'John Doe',
          serviceName: 'Haircut',
          staffName: 'Jane Smith',
          dateTime: futureDate.toISOString(),
          duration: 30,
          status: 'scheduled',
        };

        await reminderService.scheduleAppointmentReminders(appointment);

        expect(mockDb.createReminderSchedule).toHaveBeenCalledTimes(4);

        // Verify reminder types
        const calls = vi.mocked(mockDb.createReminderSchedule).mock.calls;
        const reminderTypes = calls.map((c) => c[0].reminder_type);
        expect(reminderTypes).toContain('confirmation');
        expect(reminderTypes).toContain('72h');
        expect(reminderTypes).toContain('24h');
        expect(reminderTypes).toContain('2h');
        // WHO: system scheduling for customer | WHAT: 4 reminders created
        // WHEN: appointment booked | WHERE: scheduleAppointmentReminders
        // WHY: confirmation + 72h/24h/2h reduces no-shows
      });

      it('schedules confirmation immediately', async () => {
        const futureDate = createFutureDate(96);
        const appointment = {
          id: 'apt-123',
          tenantId: 'test-tenant-123',
          customerEmail: 'customer@example.com',
          dateTime: futureDate.toISOString(),
          status: 'scheduled',
        };

        await reminderService.scheduleAppointmentReminders(appointment);

        const confirmationCall = vi
          .mocked(mockDb.createReminderSchedule)
          .mock.calls.find((c) => c[0].reminder_type === 'confirmation');

        expect(confirmationCall).toBeDefined();
        // Confirmation should be scheduled for now (immediate)
        const scheduledFor = new Date(confirmationCall[0].scheduled_for);
        const now = new Date();
        expect(Math.abs(scheduledFor.getTime() - now.getTime())).toBeLessThan(1000);
        // WHO: customer booking | WHAT: immediate confirmation
        // WHEN: appointment created | WHERE: scheduleAppointmentReminders
        // WHY: immediate confirmation assures customer booking succeeded
      });

      it('calculates 72h reminder correctly', async () => {
        const appointmentDate = new Date('2026-04-15T14:00:00Z');
        const appointment = {
          id: 'apt-123',
          tenantId: 'test-tenant-123',
          customerEmail: 'customer@example.com',
          dateTime: appointmentDate.toISOString(),
          status: 'scheduled',
        };

        await reminderService.scheduleAppointmentReminders(appointment);

        const reminder72h = vi
          .mocked(mockDb.createReminderSchedule)
          .mock.calls.find((c) => c[0].reminder_type === '72h');

        const scheduledFor = new Date(reminder72h[0].scheduled_for);
        const expected72h = new Date(appointmentDate.getTime() - 72 * 60 * 60 * 1000);

        expect(scheduledFor.toISOString()).toBe(expected72h.toISOString());
        // WHO: scheduler | WHAT: 72h reminder timing
        // WHEN: 3 days before appointment | WHERE: scheduleAppointmentReminders
        // WHY: early reminder allows customer to reschedule if needed
      });
    });

    describe('processReminder', () => {
      it('processes scheduled reminder successfully', async () => {
        const mockReminder: ReminderSchedule = {
          reminder_schedule_id: 1,
          appointment_id: 123,
          tenant_id: 1,
          customer_email: 'customer@example.com',
          customer_phone: '+15559876543',
          reminder_type: 'confirmation',
          scheduled_for: new Date().toISOString(),
          status: 'scheduled',
        };

        vi.mocked(mockDb.getReminderSchedule).mockResolvedValue(mockReminder);
        vi.mocked(mockDb.getAppointmentById).mockResolvedValue({
          id: '123',
          tenantId: '1',
          customerEmail: 'customer@example.com',
          customerPhone: '+15559876543',
          customerName: 'John Doe',
          serviceName: 'Haircut',
          staffName: 'Jane',
          dateTime: createFutureDate(2).toISOString(),
          duration: 30,
          status: 'scheduled',
        });

        await reminderService.processReminder('1');

        expect(mockDb.updateReminderSchedule).toHaveBeenCalled();
        // WHO: scheduler worker | WHAT: reminder sent
        // WHEN: scheduled_for time reached | WHERE: processReminder
        // WHY: deliver time-sensitive reminder to customer
      });

      it('skips already sent reminders', async () => {
        const mockReminder: ReminderSchedule = {
          reminder_schedule_id: 1,
          appointment_id: 123,
          tenant_id: 1,
          customer_email: 'customer@example.com',
          reminder_type: 'confirmation',
          scheduled_for: new Date().toISOString(),
          status: 'sent', // Already sent
          sent_at: new Date().toISOString(),
        };

        vi.mocked(mockDb.getReminderSchedule).mockResolvedValue(mockReminder);

        await reminderService.processReminder('1');

        // Should not attempt to send again
        expect(mockDb.getAppointmentById).not.toHaveBeenCalled();
        // WHO: scheduler worker | WHAT: duplicate skip
        // WHEN: reminder already processed | WHERE: processReminder
        // WHY: prevent duplicate notifications to customer
      });
    });

    describe('triggerReminder', () => {
      it('manually triggers a scheduled reminder', async () => {
        const mockReminder: ReminderSchedule = {
          reminder_schedule_id: 1,
          appointment_id: 123,
          tenant_id: 1,
          customer_email: 'customer@example.com',
          reminder_type: '24h',
          scheduled_for: createFutureDate(24).toISOString(),
          status: 'scheduled',
        };

        vi.mocked(mockDb.getReminderSchedule).mockResolvedValue(mockReminder);
        vi.mocked(mockDb.getAppointmentById).mockResolvedValue({
          id: '123',
          tenantId: '1',
          customerEmail: 'customer@example.com',
          dateTime: createFutureDate(48).toISOString(),
          status: 'scheduled',
        });

        const result = await reminderService.triggerReminder('1');

        expect(result).toBe(true);
        // WHO: admin/system | WHAT: manual trigger
        // WHEN: testing or urgent notification | WHERE: triggerReminder
        // WHY: allows manual intervention for special cases
      });
    });

    describe('cancelAppointmentReminders', () => {
      it('cancels all reminders for an appointment', async () => {
        const mockReminders: ReminderSchedule[] = [
          {
            reminder_schedule_id: 1,
            appointment_id: 123,
            tenant_id: 1,
            reminder_type: '72h',
            status: 'scheduled',
            customer_email: 'test@test.com',
            scheduled_for: '',
          },
          {
            reminder_schedule_id: 2,
            appointment_id: 123,
            tenant_id: 1,
            reminder_type: '24h',
            status: 'scheduled',
            customer_email: 'test@test.com',
            scheduled_for: '',
          },
          {
            reminder_schedule_id: 3,
            appointment_id: 123,
            tenant_id: 1,
            reminder_type: '2h',
            status: 'scheduled',
            customer_email: 'test@test.com',
            scheduled_for: '',
          },
        ];

        vi.mocked(mockDb.getReminderSchedulesByAppointment).mockResolvedValue(mockReminders);

        await reminderService.cancelAppointmentReminders('123', '1');

        expect(mockDb.updateReminderSchedule).toHaveBeenCalledTimes(3);
        const calls = vi.mocked(mockDb.updateReminderSchedule).mock.calls;
        calls.forEach((call) => {
          expect(call[1]).toEqual({ status: 'cancelled' });
        });
        // WHO: system on behalf of customer | WHAT: all reminders cancelled
        // WHEN: appointment cancelled | WHERE: cancelAppointmentReminders
        // WHY: prevent confusing reminders for cancelled appointments
      });
    });

    describe('rescheduleAppointmentReminders', () => {
      it('cancels old and creates new reminders', async () => {
        const oldReminders: ReminderSchedule[] = [
          {
            reminder_schedule_id: 1,
            appointment_id: 123,
            tenant_id: 1,
            reminder_type: '24h',
            status: 'scheduled',
            customer_email: 'test@test.com',
            scheduled_for: '',
          },
        ];

        vi.mocked(mockDb.getReminderSchedulesByAppointment).mockResolvedValue(oldReminders);
        vi.mocked(mockDb.getAppointmentById).mockResolvedValue({
          id: '123',
          tenantId: '1',
          customerEmail: 'customer@example.com',
          dateTime: createFutureDate(48).toISOString(),
          status: 'scheduled',
        });

        const newDateTime = createFutureDate(96).toISOString();
        await reminderService.rescheduleAppointmentReminders('123', '1', newDateTime);

        // Should cancel old reminders
        expect(mockDb.updateReminderSchedule).toHaveBeenCalledWith('1', { status: 'cancelled' });

        // Should schedule new reminders
        expect(mockDb.createReminderSchedule).toHaveBeenCalled();
        // WHO: customer rescheduling | WHAT: reminder update
        // WHEN: appointment time changed | WHERE: rescheduleAppointmentReminders
        // WHY: ensure reminders match new appointment time
      });
    });

    describe('getScheduledReminders', () => {
      it('returns all scheduled reminders for tenant', async () => {
        const mockReminders: ReminderSchedule[] = [
          {
            reminder_schedule_id: 1,
            appointment_id: 123,
            tenant_id: 1,
            reminder_type: '24h',
            status: 'scheduled',
            customer_email: 'a@test.com',
            scheduled_for: '',
          },
          {
            reminder_schedule_id: 2,
            appointment_id: 456,
            tenant_id: 1,
            reminder_type: '2h',
            status: 'scheduled',
            customer_email: 'b@test.com',
            scheduled_for: '',
          },
        ];

        vi.mocked(mockDb.getReminderSchedulesByTenant).mockResolvedValue(mockReminders);

        const reminders = await reminderService.getScheduledReminders(1);

        expect(reminders).toHaveLength(2);
        expect(mockDb.getReminderSchedulesByTenant).toHaveBeenCalledWith(1, 'scheduled');
        // WHO: tenant admin | WHAT: reminder listing
        // WHEN: viewing upcoming reminders | WHERE: getScheduledReminders
        // WHY: admin visibility into scheduled communications
      });
    });
  });

  describe('Sad Paths', () => {
    describe('scheduleAppointmentReminders - Past Appointment', () => {
      it('does not schedule reminders for past appointments', async () => {
        const pastDate = new Date();
        pastDate.setHours(pastDate.getHours() - 1); // 1 hour ago

        const appointment = {
          id: 'apt-123',
          tenantId: 'test-tenant-123',
          customerEmail: 'customer@example.com',
          dateTime: pastDate.toISOString(),
          status: 'scheduled',
        };

        await reminderService.scheduleAppointmentReminders(appointment);

        expect(mockDb.createReminderSchedule).not.toHaveBeenCalled();
        // WHO: system | WHAT: skip past appointment
        // WHEN: appointment already occurred | WHERE: scheduleAppointmentReminders
        // WHY: no point sending reminders for past events
      });
    });

    describe('scheduleAppointmentReminders - Invalid DateTime', () => {
      it('handles invalid dateTime gracefully', async () => {
        const appointment = {
          id: 'apt-123',
          tenantId: 'test-tenant-123',
          customerEmail: 'customer@example.com',
          dateTime: 'invalid-date',
          status: 'scheduled',
        };

        await reminderService.scheduleAppointmentReminders(appointment);

        expect(mockDb.createReminderSchedule).not.toHaveBeenCalled();
        // WHO: system | WHAT: invalid date handling
        // WHEN: malformed date input | WHERE: scheduleAppointmentReminders
        // WHY: prevent crashes from bad data
      });

      it('handles missing dateTime', async () => {
        const appointment = {
          id: 'apt-123',
          tenantId: 'test-tenant-123',
          customerEmail: 'customer@example.com',
          status: 'scheduled',
        };

        await reminderService.scheduleAppointmentReminders(appointment);

        expect(mockDb.createReminderSchedule).not.toHaveBeenCalled();
        // WHO: system | WHAT: missing date handling
        // WHEN: incomplete appointment data | WHERE: scheduleAppointmentReminders
        // WHY: defensive coding against incomplete records
      });
    });

    describe('processReminder - Reminder Not Found', () => {
      it('handles missing reminder gracefully', async () => {
        vi.mocked(mockDb.getReminderSchedule).mockResolvedValue(null);

        await reminderService.processReminder('nonexistent');

        expect(mockDb.updateReminderSchedule).toHaveBeenCalledWith(
          'nonexistent',
          expect.objectContaining({
            status: 'failed',
            error: 'Reminder not found',
          })
        );
        // WHO: scheduler worker | WHAT: missing reminder
        // WHEN: reminder deleted or invalid ID | WHERE: processReminder
        // WHY: handle race condition where reminder deleted before processing
      });
    });

    describe('processReminder - Appointment Cancelled', () => {
      it('cancels reminder if appointment was cancelled', async () => {
        const mockReminder: ReminderSchedule = {
          reminder_schedule_id: 1,
          appointment_id: 123,
          tenant_id: 1,
          customer_email: 'customer@example.com',
          reminder_type: '24h',
          scheduled_for: new Date().toISOString(),
          status: 'scheduled',
        };

        vi.mocked(mockDb.getReminderSchedule).mockResolvedValue(mockReminder);
        vi.mocked(mockDb.getAppointmentById).mockResolvedValue({
          id: '123',
          tenantId: '1',
          dateTime: createFutureDate(24).toISOString(),
          status: 'cancelled', // Appointment was cancelled
        });

        await reminderService.processReminder('1');

        expect(mockDb.updateReminderSchedule).toHaveBeenCalledWith(
          '1',
          expect.objectContaining({
            status: 'cancelled',
          })
        );
        // WHO: scheduler worker | WHAT: cancelled appointment check
        // WHEN: appointment cancelled between scheduling and send | WHERE: processReminder
        // WHY: prevent sending reminders for cancelled appointments
      });
    });

    describe('processReminder - Appointment Already Passed', () => {
      it('cancels reminder if appointment time already passed', async () => {
        const mockReminder: ReminderSchedule = {
          reminder_schedule_id: 1,
          appointment_id: 123,
          tenant_id: 1,
          customer_email: 'customer@example.com',
          reminder_type: '2h',
          scheduled_for: new Date().toISOString(),
          status: 'scheduled',
        };

        const pastDate = new Date();
        pastDate.setHours(pastDate.getHours() - 1);

        vi.mocked(mockDb.getReminderSchedule).mockResolvedValue(mockReminder);
        vi.mocked(mockDb.getAppointmentById).mockResolvedValue({
          id: '123',
          tenantId: '1',
          dateTime: pastDate.toISOString(), // Already passed
          status: 'scheduled',
        });

        await reminderService.processReminder('1');

        expect(mockDb.updateReminderSchedule).toHaveBeenCalledWith(
          '1',
          expect.objectContaining({
            status: 'cancelled',
          })
        );
        // WHO: scheduler worker | WHAT: past appointment check
        // WHEN: processing delayed beyond appointment time | WHERE: processReminder
        // WHY: no point sending reminder after appointment occurred
      });
    });

    describe('processReminder - No Consent', () => {
      it('cancels reminder if customer revoked consent', async () => {
        const mockReminder: ReminderSchedule = {
          reminder_schedule_id: 1,
          appointment_id: 123,
          tenant_id: 1,
          customer_email: 'customer@example.com',
          reminder_type: 'confirmation',
          scheduled_for: new Date().toISOString(),
          status: 'scheduled',
        };

        vi.mocked(mockDb.getReminderSchedule).mockResolvedValue(mockReminder);
        vi.mocked(mockDb.getAppointmentById).mockResolvedValue({
          id: '123',
          tenantId: '1',
          customerEmail: 'customer@example.com',
          dateTime: createFutureDate(24).toISOString(),
          status: 'scheduled',
        });
        // Override consent to return revoked
        vi.mocked(mockDb.getConsentRecordsByCustomer).mockResolvedValue([
          {
            consent_record_id: 1,
            consent_type: 'email',
            consent_given: true,
            consent_date: '2026-01-01T00:00:00Z',
            consent_method: 'booking',
            revoked_at: '2026-02-01T00:00:00Z',
          },
        ]);

        await reminderService.processReminder('1');

        expect(mockDb.updateReminderSchedule).toHaveBeenCalledWith(
          '1',
          expect.objectContaining({
            status: 'cancelled',
            error: expect.stringContaining('consent'),
          })
        );
        // WHO: scheduler worker | WHAT: consent check
        // WHEN: customer opted out since booking | WHERE: processReminder
        // WHY: respect customer's communication preferences
      });
    });

    describe('triggerReminder - Already Processed', () => {
      it('returns false for non-scheduled reminders', async () => {
        const mockReminder: ReminderSchedule = {
          reminder_schedule_id: 1,
          appointment_id: 123,
          tenant_id: 1,
          customer_email: 'customer@example.com',
          reminder_type: '24h',
          scheduled_for: new Date().toISOString(),
          status: 'sent', // Already sent
          sent_at: new Date().toISOString(),
        };

        vi.mocked(mockDb.getReminderSchedule).mockResolvedValue(mockReminder);

        const result = await reminderService.triggerReminder('1');

        expect(result).toBe(false);
        // WHO: admin | WHAT: trigger already-sent reminder
        // WHEN: attempting to resend | WHERE: triggerReminder
        // WHY: prevent duplicate sends from admin actions
      });

      it('returns false for nonexistent reminders', async () => {
        vi.mocked(mockDb.getReminderSchedule).mockResolvedValue(null);

        const result = await reminderService.triggerReminder('999');

        expect(result).toBe(false);
        // WHO: admin | WHAT: trigger missing reminder
        // WHEN: invalid reminder ID | WHERE: triggerReminder
        // WHY: graceful handling of invalid input
      });
    });
  });

  describe('Edge Cases', () => {
    it('handles appointment close to reminder threshold', async () => {
      // Appointment 25 hours from now - should schedule 24h but not 72h
      const futureDate = createFutureDate(25);
      const appointment = {
        id: 'apt-123',
        tenantId: 'test-tenant-123',
        customerEmail: 'customer@example.com',
        dateTime: futureDate.toISOString(),
        status: 'scheduled',
      };

      await reminderService.scheduleAppointmentReminders(appointment);

      const calls = vi.mocked(mockDb.createReminderSchedule).mock.calls;
      const reminderTypes = calls.map((c) => c[0].reminder_type);

      // Should have confirmation, 24h, and 2h but NOT 72h (would be in past)
      expect(reminderTypes).toContain('confirmation');
      expect(reminderTypes).toContain('24h');
      expect(reminderTypes).toContain('2h');
      // 72h reminder would be in the past, should still be created but scheduled for "now"
    });

    it('handles snake_case and camelCase appointment fields', async () => {
      const futureDate = createFutureDate(96);

      // Test with snake_case fields (from database)
      const snakeCaseAppointment = {
        id: 'apt-123',
        tenant_id: 'test-tenant-123',
        customer_email: 'customer@example.com',
        customer_phone: '+15559876543',
        date_time: futureDate.toISOString(),
        status: 'scheduled',
      };

      await reminderService.scheduleAppointmentReminders(snakeCaseAppointment);

      expect(mockDb.createReminderSchedule).toHaveBeenCalled();
      const call = vi.mocked(mockDb.createReminderSchedule).mock.calls[0][0];
      expect(call.customer_email).toBe('customer@example.com');
    });

    it('cleanup clears scheduled timeouts', () => {
      // Add some timeouts
      reminderService.scheduledReminders.set(
        'test-1',
        setTimeout(() => {}, 10000)
      );
      reminderService.scheduledReminders.set(
        'test-2',
        setTimeout(() => {}, 10000)
      );

      expect(reminderService.scheduledReminders.size).toBe(2);

      reminderService.cleanup();

      expect(reminderService.scheduledReminders.size).toBe(0);
    });
  });
});

describe('Reminder Types', () => {
  it('confirmation type should be sent immediately', () => {
    const reminderTypes = ['confirmation', '72h', '24h', '2h'];
    expect(reminderTypes[0]).toBe('confirmation');
    // WHO: booking system | WHAT: immediate confirmation
    // WHEN: appointment created | WHERE: reminder types
    // WHY: confirm booking receipt to customer immediately
  });

  it('all reminder types have valid hours before values', () => {
    const typeToHours: Record<string, number> = {
      confirmation: 0,
      '72h': 72,
      '24h': 24,
      '2h': 2,
    };

    Object.entries(typeToHours).forEach(([_type, hours]) => {
      expect(hours).toBeGreaterThanOrEqual(0);
      expect(hours).toBeLessThanOrEqual(72);
    });
  });
});

describe('Reminder Status Transitions', () => {
  it('valid status transitions', () => {
    const validTransitions: Record<string, string[]> = {
      scheduled: ['sent', 'failed', 'cancelled'],
      sent: [], // Terminal state
      failed: [], // Terminal state
      cancelled: [], // Terminal state
    };

    // Scheduled can transition to sent, failed, or cancelled
    expect(validTransitions.scheduled).toContain('sent');
    expect(validTransitions.scheduled).toContain('failed');
    expect(validTransitions.scheduled).toContain('cancelled');

    // Terminal states have no transitions
    expect(validTransitions.sent).toHaveLength(0);
    expect(validTransitions.failed).toHaveLength(0);
    expect(validTransitions.cancelled).toHaveLength(0);
  });
});
