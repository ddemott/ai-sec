/* eslint-disable @typescript-eslint/unbound-method */
/**
 * ESLint rules disabled for this file as part of historical full cleanup (REFACTORING_TODO item 10; see RESOLVED.md for details).
 * These are the remaining dynamic/any-heavy areas after previous tranches.
 */

/**
 * Database Adapter Tests
 *
 * Comprehensive tests for the DatabaseService adapter layer
 * that bridges secretary-hq patterns with the communications/reminders services.
 *
 * Test Structure:
 * - Happy Paths: Successful operations with valid inputs
 * - Sad Paths: Error handling for invalid inputs, missing data, failures
 * - Edge Cases: Boundary conditions, concurrent operations, special values
 *
 * Each test includes 5W diagnostic comments:
 * - WHO: Which actor/component is involved
 * - WHAT: What action is being tested
 * - WHEN: Under what conditions/state
 * - WHERE: Which method/function
 * - WHY: Why this test matters (business/technical reason)
 */

import { describe, it, expect, vi } from 'vitest';
import type { Pool, PoolClient, QueryResult } from 'pg';
import type {
  ReminderSchedule,
  ReminderData,
  ConsentRecord,
  OptOutRecord,
  AppointmentForReminder,
} from '../../src/types/index.js';

// Mock pg module
vi.mock('pg', () => {
  return {
    Pool: vi.fn().mockImplementation(() => ({
      connect: vi.fn(),
      end: vi.fn(),
    })),
  };
});

// Import after mocking
import { PostgresDatabaseService, createDatabaseService } from '../../src/database/index.js';

// ── Test Helpers ────────────────────────────────────────────────────────

function createMockClient(queryResults: QueryResult[] = []): PoolClient {
  let callIndex = 0;
  return {
    query: vi.fn().mockImplementation(() => {
      return Promise.resolve(queryResults[callIndex++] || { rows: [] });
    }),
    release: vi.fn(),
  } as unknown as PoolClient;
}

function createMockPool(client: PoolClient): Pool {
  return {
    connect: vi.fn().mockResolvedValue(client),
    end: vi.fn(),
  } as unknown as Pool;
}

// ── Sample Test Data ────────────────────────────────────────────────────

const sampleReminderData: ReminderData = {
  appointment_id: 1001,
  tenant_id: 1,
  customer_email: 'customer@example.com',
  customer_phone: '+15551234567',
  reminder_type: '24h',
  scheduled_for: '2026-04-15T10:00:00.000Z',
};

const sampleReminderSchedule: ReminderSchedule = {
  reminder_schedule_id: 1,
  appointment_id: 1001,
  tenant_id: 1,
  customer_email: 'customer@example.com',
  customer_phone: '+15551234567',
  reminder_type: '24h',
  scheduled_for: '2026-04-15T10:00:00.000Z',
  status: 'scheduled',
  created_at: '2026-04-14T10:00:00.000Z',
  updated_at: '2026-04-14T10:00:00.000Z',
};

const sampleConsentRecord: Omit<ConsentRecord, 'consent_record_id'> = {
  tenant_id: 1,
  customer_email: 'customer@example.com',
  customer_phone: '+15551234567',
  consent_type: 'both',
  consent_given: true,
  consent_date: '2026-04-10T10:00:00.000Z',
  consent_method: 'web_form',
  consent_source: 'booking_flow',
  ip_address: '192.168.1.1',
};

const sampleOptOutRecord: Omit<OptOutRecord, 'opt_out_record_id'> = {
  tenant_id: '1',
  customer_email: 'customer@example.com',
  customer_phone: '+15551234567',
  opt_out_type: 'both',
  opt_out_date: '2026-04-14T10:00:00.000Z',
  opt_out_method: 'stop',
  notes: 'Customer texted STOP',
};

// ══════════════════════════════════════════════════════════════════════════
// HAPPY PATHS
// ══════════════════════════════════════════════════════════════════════════

describe('PostgresDatabaseService', () => {
  describe('Happy Paths', () => {
    describe('Reminder Operations', () => {
      it('creates a reminder schedule successfully', async () => {
        // WHO: ReminderService scheduling a reminder for a customer
        // WHAT: Creating a new reminder schedule record in the database
        // WHEN: Valid reminder data is provided with all required fields
        // WHERE: createReminderSchedule method
        // WHY: Core functionality for scheduling appointment reminders

        const mockClient = createMockClient([
          { rows: [] }, // set_tenant_context
          { rows: [{ ...sampleReminderSchedule }] }, // INSERT
        ]);
        const mockPool = createMockPool(mockClient);
        const service = new PostgresDatabaseService(mockPool);

        const result = await service.createReminderSchedule(sampleReminderData);

        expect(result).toEqual(sampleReminderSchedule);
        expect(mockClient.query).toHaveBeenCalledTimes(3); // context set, insert, context clear
        expect(mockClient.release).toHaveBeenCalled();
      });

      it('retrieves a reminder schedule by ID', async () => {
        // WHO: ReminderScheduler checking status of a reminder
        // WHAT: Fetching a specific reminder by its ID
        // WHEN: Reminder exists in database
        // WHERE: getReminderSchedule method
        // WHY: Needed for status checks and before triggering sends

        const mockClient = createMockClient([{ rows: [sampleReminderSchedule] }]);
        const mockPool = createMockPool(mockClient);
        const service = new PostgresDatabaseService(mockPool);

        const result = await service.getReminderSchedule('1');

        expect(result).toEqual(sampleReminderSchedule);
        expect(mockClient.query).toHaveBeenCalledWith(
          'SELECT * FROM reminder_schedules WHERE reminder_schedule_id = $1',
          ['1']
        );
      });

      it('updates reminder status to sent', async () => {
        // WHO: ReminderProcessor after successfully sending a reminder
        // WHAT: Updating reminder status to "sent" with timestamp
        // WHEN: Reminder has been successfully delivered
        // WHERE: updateReminderSchedule method
        // WHY: Track delivery status for reporting and prevent duplicate sends

        const updatedReminder = {
          ...sampleReminderSchedule,
          status: 'sent' as const,
          sent_at: '2026-04-15T10:00:00.000Z',
        };
        const mockClient = createMockClient([{ rows: [updatedReminder] }]);
        const mockPool = createMockPool(mockClient);
        const service = new PostgresDatabaseService(mockPool);

        const result = await service.updateReminderSchedule('1', {
          status: 'sent',
          sent_at: '2026-04-15T10:00:00.000Z',
        });

        expect(result?.status).toBe('sent');
        expect(result?.sent_at).toBe('2026-04-15T10:00:00.000Z');
      });

      it('gets all scheduled reminders for a tenant', async () => {
        // WHO: Admin dashboard requesting reminder overview
        // WHAT: Fetching all scheduled reminders for a specific tenant
        // WHEN: Tenant has multiple reminders in various states
        // WHERE: getReminderSchedulesByTenant method
        // WHY: Dashboard needs to display pending reminders to business owner

        const reminders = [
          sampleReminderSchedule,
          { ...sampleReminderSchedule, reminder_schedule_id: 2, reminder_type: '2h' },
        ];
        const mockClient = createMockClient([
          { rows: [] }, // set_tenant_context
          { rows: reminders }, // SELECT
        ]);
        const mockPool = createMockPool(mockClient);
        const service = new PostgresDatabaseService(mockPool);

        const result = await service.getReminderSchedulesByTenant(1, 'scheduled');

        expect(result).toHaveLength(2);
        expect(result[0].reminder_type).toBe('24h');
        expect(result[1].reminder_type).toBe('2h');
      });

      it('gets reminders for a specific appointment', async () => {
        // WHO: System handling appointment reschedule
        // WHAT: Fetching all reminders associated with an appointment
        // WHEN: Appointment is being modified
        // WHERE: getReminderSchedulesByAppointment method
        // WHY: Need to cancel/reschedule all related reminders when appointment changes

        const reminders = [
          { ...sampleReminderSchedule, reminder_type: '72h' },
          { ...sampleReminderSchedule, id: 2, reminder_type: '24h' },
          { ...sampleReminderSchedule, id: 3, reminder_type: '2h' },
        ];
        const mockClient = createMockClient([
          { rows: [] }, // set_tenant_context
          { rows: reminders }, // SELECT
        ]);
        const mockPool = createMockPool(mockClient);
        const service = new PostgresDatabaseService(mockPool);

        const result = await service.getReminderSchedulesByAppointment('1001', 1);

        expect(result).toHaveLength(3);
      });

      it('gets due reminders ready to be sent', async () => {
        // WHO: Background reminder scheduler (cron job)
        // WHAT: Fetching all reminders that are due for sending
        // WHEN: Scheduled time has passed and status is still "scheduled"
        // WHERE: getDueReminders method
        // WHY: Core scheduler functionality to process reminders on time

        const dueReminders = [
          sampleReminderSchedule,
          { ...sampleReminderSchedule, id: 2, tenant_id: 2 },
        ];
        const mockClient = createMockClient([{ rows: dueReminders }]);
        const mockPool = createMockPool(mockClient);
        const service = new PostgresDatabaseService(mockPool);

        const result = await service.getDueReminders();

        expect(result).toHaveLength(2);
        expect(mockClient.query).toHaveBeenCalledWith(
          expect.stringContaining("status = 'scheduled'")
        );
      });
    });

    describe('Appointment Operations', () => {
      it('retrieves appointment with customer details for reminders', async () => {
        // WHO: ReminderService preparing to send a reminder
        // WHAT: Fetching appointment with joined customer/service/staff data
        // WHEN: Reminder is due and needs appointment details for message
        // WHERE: getAppointmentById method
        // WHY: Reminder messages need customer name, service, staff for personalization

        const appointment: AppointmentForReminder = {
          id: 'apt-123',
          tenantId: '1',
          customerId: 'cust-456',
          customerEmail: 'customer@example.com',
          customerPhone: '+15551234567',
          customerName: 'John Doe',
          serviceName: 'Haircut',
          staffName: 'Jane Smith',
          dateTime: '2026-04-15T14:00:00.000Z',
          duration: 30,
          status: 'confirmed',
          notes: 'First visit',
        };
        // setTenantContext runs first now, so the mock must answer it before the
        // SELECT. The tenant id is mandatory: `appointments` is FORCE RLS with
        // no admin-bypass policy, so a context-less read returns nothing and a
        // live appointment reads as "not found" (prod, 2026-08-20).
        const mockClient = createMockClient([{ rows: [] }, { rows: [appointment] }]);
        const mockPool = createMockPool(mockClient);
        const service = new PostgresDatabaseService(mockPool);

        const result = await service.getAppointmentById(
          'apt-123',
          'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
        );

        expect(result).toEqual(appointment);
        expect(result?.customerName).toBe('John Doe');
        expect(result?.serviceName).toBe('Haircut');
      });
    });

    describe('Consent Operations', () => {
      it('creates a consent record for a customer', async () => {
        // WHO: Booking system recording customer consent
        // WHAT: Creating a new consent record in the database
        // WHEN: Customer agrees to receive communications during booking
        // WHERE: createConsentRecord method
        // WHY: GDPR/TCPA compliance requires explicit consent tracking

        const consentWithId: ConsentRecord = { id: 1, ...sampleConsentRecord };
        const mockClient = createMockClient([
          { rows: [] }, // set_tenant_context
          { rows: [consentWithId] }, // INSERT
        ]);
        const mockPool = createMockPool(mockClient);
        const service = new PostgresDatabaseService(mockPool);

        const result = await service.createConsentRecord(sampleConsentRecord);

        expect(result.id).toBe(1);
        expect(result.consent_given).toBe(true);
        expect(result.consent_type).toBe('both');
      });

      it('retrieves consent records by customer email', async () => {
        // WHO: CommunicationService checking before sending email
        // WHAT: Fetching consent records for a specific customer
        // WHEN: About to send marketing or transactional email
        // WHERE: getConsentRecordsByCustomer method
        // WHY: Must verify consent before sending to comply with regulations

        const consents: ConsentRecord[] = [
          { id: 1, ...sampleConsentRecord },
          {
            id: 2,
            ...sampleConsentRecord,
            consent_type: 'email' as const,
            consent_date: '2026-03-01T10:00:00.000Z',
          },
        ];
        const mockClient = createMockClient([
          { rows: [] }, // set_tenant_context
          { rows: consents }, // SELECT
        ]);
        const mockPool = createMockPool(mockClient);
        const service = new PostgresDatabaseService(mockPool);

        const result = await service.getConsentRecordsByCustomer(1, 'customer@example.com');

        expect(result).toHaveLength(2);
        expect(result[0].consent_type).toBe('both');
      });

      it('retrieves all consent records for a tenant', async () => {
        // WHO: Admin viewing consent dashboard
        // WHAT: Fetching all consent records for compliance review
        // WHEN: Admin needs to audit consent status
        // WHERE: getConsentRecordsByTenant method
        // WHY: Businesses need visibility into consent status for audits

        const consents: ConsentRecord[] = [
          { id: 1, ...sampleConsentRecord },
          { id: 2, ...sampleConsentRecord, customer_email: 'other@example.com' },
        ];
        const mockClient = createMockClient([
          { rows: [] }, // set_tenant_context
          { rows: consents }, // SELECT
        ]);
        const mockPool = createMockPool(mockClient);
        const service = new PostgresDatabaseService(mockPool);

        const result = await service.getConsentRecordsByTenant(1);

        expect(result).toHaveLength(2);
      });

      it('updates consent record to revoked', async () => {
        // WHO: Customer requesting to stop communications
        // WHAT: Marking consent as revoked with reason
        // WHEN: Customer texts STOP or clicks unsubscribe
        // WHERE: updateConsentRecord method
        // WHY: Must honor revocation requests immediately for compliance

        const revokedConsent: ConsentRecord = {
          id: 1,
          ...sampleConsentRecord,
          consent_given: false,
          revoked_at: '2026-04-14T12:00:00.000Z',
          revoke_reason: 'Customer requested via STOP',
        };
        const mockClient = createMockClient([{ rows: [revokedConsent] }]);
        const mockPool = createMockPool(mockClient);
        const service = new PostgresDatabaseService(mockPool);

        const result = await service.updateConsentRecord(1, {
          consent_given: false,
          revoked_at: '2026-04-14T12:00:00.000Z',
          revoke_reason: 'Customer requested via STOP',
        });

        expect(result?.consent_given).toBe(false);
        expect(result?.revoked_at).toBe('2026-04-14T12:00:00.000Z');
      });
    });

    describe('Opt-Out Operations', () => {
      it('creates an opt-out record', async () => {
        // WHO: System processing STOP SMS from customer
        // WHAT: Creating opt-out record to track the request
        // WHEN: Customer sends STOP/UNSUBSCRIBE message
        // WHERE: createOptOutRecord method
        // WHY: Legal requirement to track opt-out requests with audit trail

        const optOutWithId: OptOutRecord = { id: 1, ...sampleOptOutRecord };
        const mockClient = createMockClient([
          { rows: [] }, // set_tenant_context
          { rows: [optOutWithId] }, // INSERT
        ]);
        const mockPool = createMockPool(mockClient);
        const service = new PostgresDatabaseService(mockPool);

        const result = await service.createOptOutRecord(sampleOptOutRecord);

        expect(result.id).toBe(1);
        expect(result.opt_out_type).toBe('both');
        expect(result.opt_out_method).toBe('stop');
      });

      it('retrieves opt-out records for a tenant', async () => {
        // WHO: Admin reviewing opt-out compliance
        // WHAT: Fetching all opt-out records for the business
        // WHEN: Compliance audit or report generation
        // WHERE: getOptOutRecordsByTenant method
        // WHY: Businesses need to demonstrate compliance with opt-out handling

        const optOuts: OptOutRecord[] = [
          { id: 1, ...sampleOptOutRecord },
          { id: 2, ...sampleOptOutRecord, customerEmail: 'other@example.com' },
        ];
        const mockClient = createMockClient([
          { rows: [] }, // set_tenant_context
          { rows: optOuts }, // SELECT
        ]);
        const mockPool = createMockPool(mockClient);
        const service = new PostgresDatabaseService(mockPool);

        const result = await service.getOptOutRecordsByTenant(1);

        expect(result).toHaveLength(2);
      });
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // SAD PATHS
  // ══════════════════════════════════════════════════════════════════════════

  describe('Sad Paths', () => {
    describe('Reminder Operations - Not Found', () => {
      it('returns null when reminder does not exist', async () => {
        // WHO: System trying to update a reminder that was deleted
        // WHAT: Attempting to fetch a non-existent reminder
        // WHEN: Reminder ID does not exist in database
        // WHERE: getReminderSchedule method
        // WHY: Must handle missing records gracefully without crashing

        const mockClient = createMockClient([
          { rows: [] }, // Empty result
        ]);
        const mockPool = createMockPool(mockClient);
        const service = new PostgresDatabaseService(mockPool);

        const result = await service.getReminderSchedule('99999');

        expect(result).toBeNull();
      });

      it('returns null when updating non-existent reminder', async () => {
        // WHO: ReminderProcessor trying to mark deleted reminder as sent
        // WHAT: Attempting to update a reminder that doesn't exist
        // WHEN: Reminder was deleted between fetch and update
        // WHERE: updateReminderSchedule method
        // WHY: Race condition handling - reminder deleted during processing

        const mockClient = createMockClient([
          { rows: [] }, // UPDATE returns empty
        ]);
        const mockPool = createMockPool(mockClient);
        const service = new PostgresDatabaseService(mockPool);

        const result = await service.updateReminderSchedule('99999', {
          status: 'sent',
        });

        expect(result).toBeNull();
      });

      it('returns empty array when tenant has no reminders', async () => {
        // WHO: Dashboard requesting reminders for new tenant
        // WHAT: Fetching reminders when none exist
        // WHEN: Tenant just signed up, no appointments yet
        // WHERE: getReminderSchedulesByTenant method
        // WHY: New tenants should see empty state, not error

        const mockClient = createMockClient([
          { rows: [] }, // set_tenant_context
          { rows: [] }, // SELECT returns empty
        ]);
        const mockPool = createMockPool(mockClient);
        const service = new PostgresDatabaseService(mockPool);

        const result = await service.getReminderSchedulesByTenant(1);

        expect(result).toEqual([]);
      });
    });

    describe('Appointment Operations - Not Found', () => {
      it('returns null for non-existent appointment', async () => {
        // WHO: ReminderService trying to fetch deleted appointment
        // WHAT: Attempting to get appointment that doesn't exist
        // WHEN: Appointment was cancelled and soft-deleted
        // WHERE: getAppointmentById method
        // WHY: Reminder should be cancelled if appointment no longer exists

        const mockClient = createMockClient([
          { rows: [] }, // setTenantContext
          { rows: [] }, // Empty result
        ]);
        const mockPool = createMockPool(mockClient);
        const service = new PostgresDatabaseService(mockPool);

        const result = await service.getAppointmentById(
          'nonexistent-id',
          'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
        );

        expect(result).toBeNull();
      });
    });

    describe('Consent Operations - Edge Cases', () => {
      it('returns empty array when customer has no consent records', async () => {
        // WHO: CommunicationService checking new customer
        // WHAT: Checking consent for customer with no prior records
        // WHEN: Customer never provided consent (e.g., manual import)
        // WHERE: getConsentRecordsByCustomer method
        // WHY: Absence of consent means no permission to communicate

        const mockClient = createMockClient([
          { rows: [] }, // set_tenant_context
          { rows: [] }, // SELECT returns empty
        ]);
        const mockPool = createMockPool(mockClient);
        const service = new PostgresDatabaseService(mockPool);

        const result = await service.getConsentRecordsByCustomer(1, 'unknown@example.com');

        expect(result).toEqual([]);
      });

      it('returns consent record when updating with no changes', async () => {
        // WHO: System with accidental duplicate update request
        // WHAT: Calling update with empty changes object
        // WHEN: Bug causes empty update to be sent
        // WHERE: updateConsentRecord method
        // WHY: Should return existing record, not error

        const existingConsent: ConsentRecord = { id: 1, ...sampleConsentRecord };
        const mockClient = createMockClient([
          { rows: [existingConsent] }, // SELECT existing record
        ]);
        const mockPool = createMockPool(mockClient);
        const service = new PostgresDatabaseService(mockPool);

        const result = await service.updateConsentRecord(1, {});

        expect(result).toEqual(existingConsent);
      });
    });

    describe('Database Connection Errors', () => {
      it('propagates connection error from pool', async () => {
        // WHO: System during database outage
        // WHAT: Attempting operation when DB is unavailable
        // WHEN: Database server is down or unreachable
        // WHERE: Any database operation
        // WHY: Must propagate errors for proper error handling upstream

        const mockPool = {
          connect: vi.fn().mockRejectedValue(new Error('Connection refused')),
          end: vi.fn(),
        } as unknown as Pool;
        const service = new PostgresDatabaseService(mockPool);

        await expect(service.getReminderSchedule('1')).rejects.toThrow('Connection refused');
      });

      it('propagates query error from client', async () => {
        // WHO: System with invalid query parameter
        // WHAT: Executing query that fails at database level
        // WHEN: SQL constraint violation or syntax error
        // WHERE: Any query execution
        // WHY: Query errors should bubble up for debugging

        const mockClient = {
          query: vi.fn().mockRejectedValue(new Error('violates foreign key constraint')),
          release: vi.fn(),
        } as unknown as PoolClient;
        const mockPool = createMockPool(mockClient);
        const service = new PostgresDatabaseService(mockPool);

        await expect(service.createReminderSchedule(sampleReminderData)).rejects.toThrow(
          'violates foreign key constraint'
        );

        // Ensure connection is released even on error
        expect(mockClient.release).toHaveBeenCalled();
      });
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // EDGE CASES
  // ══════════════════════════════════════════════════════════════════════════

  describe('Edge Cases', () => {
    describe('RLS Context Management', () => {
      it('sets tenant context before queries and clears after', async () => {
        // WHO: Multi-tenant system enforcing row-level security
        // WHAT: Setting and clearing tenant context around operations
        // WHEN: Any tenant-scoped database operation
        // WHERE: withTenantClient helper
        // WHY: RLS requires context to be set for proper data isolation

        const mockClient = createMockClient([
          { rows: [] }, // set_tenant_context
          { rows: [sampleReminderSchedule] }, // INSERT
          { rows: [] }, // clear context (ignored error)
        ]);
        const mockPool = createMockPool(mockClient);
        const service = new PostgresDatabaseService(mockPool);

        await service.createReminderSchedule(sampleReminderData);

        const calls = (mockClient.query as ReturnType<typeof vi.fn>).mock.calls;

        // First call should set tenant context
        expect(calls[0][0]).toContain('set_tenant_context');
        expect(calls[0][1]).toContain('1'); // tenant_id

        // Last call should clear context
        expect(calls[2][0]).toContain("set_config('app.current_tenant_id', ''");
      });

      it('releases connection even when context clear fails', async () => {
        // WHO: System during partial database failure
        // WHAT: Ensuring connection release despite context clear error
        // WHEN: Context clear query fails (rare)
        // WHERE: withTenantClient finally block
        // WHY: Connection leaks cause pool exhaustion

        let callCount = 0;
        const mockClient = {
          query: vi.fn().mockImplementation((query: string) => {
            callCount++;
            if (query.includes("set_config('app.current_tenant_id', ''")) {
              return Promise.reject(new Error('Context clear failed'));
            }
            if (callCount === 1) return Promise.resolve({ rows: [] }); // context set
            return Promise.resolve({ rows: [sampleReminderSchedule] }); // INSERT
          }),
          release: vi.fn(),
        } as unknown as PoolClient;
        const mockPool = createMockPool(mockClient);
        const service = new PostgresDatabaseService(mockPool);

        // Should not throw despite context clear error
        const result = await service.createReminderSchedule(sampleReminderData);

        expect(result).toEqual(sampleReminderSchedule);
        expect(mockClient.release).toHaveBeenCalled();
      });
    });

    describe('Optional Fields Handling', () => {
      it('handles reminder without optional phone number', async () => {
        // WHO: System scheduling email-only reminder
        // WHAT: Creating reminder without phone number
        // WHEN: Customer only provided email during booking
        // WHERE: createReminderSchedule method
        // WHY: Phone is optional; email-only reminders are valid

        const dataWithoutPhone: ReminderData = {
          ...sampleReminderData,
          customer_phone: undefined,
        };
        const reminderWithoutPhone: ReminderSchedule = {
          ...sampleReminderSchedule,
          customer_phone: undefined,
        };
        const mockClient = createMockClient([
          { rows: [] }, // set_tenant_context
          { rows: [reminderWithoutPhone] }, // INSERT
        ]);
        const mockPool = createMockPool(mockClient);
        const service = new PostgresDatabaseService(mockPool);

        const result = await service.createReminderSchedule(dataWithoutPhone);

        expect(result.customer_phone).toBeUndefined();
        expect(result.customer_email).toBe('customer@example.com');
      });

      it('handles consent without customer_id (anonymous consent)', async () => {
        // WHO: System recording consent for walk-in customer
        // WHAT: Creating consent with only email/phone, no customer ID
        // WHEN: Customer hasn't been created in CRM yet
        // WHERE: createConsentRecord method
        // WHY: Consent can be recorded before customer record exists

        const anonymousConsent: Omit<ConsentRecord, 'consent_record_id'> = {
          ...sampleConsentRecord,
          customer_id: undefined,
        };
        const mockClient = createMockClient([
          { rows: [] }, // set_tenant_context
          { rows: [{ consent_record_id: 1, ...anonymousConsent }] }, // INSERT
        ]);
        const mockPool = createMockPool(mockClient);
        const service = new PostgresDatabaseService(mockPool);

        const result = await service.createConsentRecord(anonymousConsent);

        expect(result.customer_id).toBeUndefined();
        expect(result.customer_email).toBe('customer@example.com');
      });
    });

    describe('Partial Update Handling', () => {
      it('updates only status field', async () => {
        // WHO: ReminderProcessor updating reminder to failed state
        // WHAT: Updating only the status field, not sent_at
        // WHEN: Reminder delivery failed
        // WHERE: updateReminderSchedule method
        // WHY: Failed reminders should update status without sent_at timestamp

        const failedReminder = { ...sampleReminderSchedule, status: 'failed' as const };
        const mockClient = createMockClient([{ rows: [failedReminder] }]);
        const mockPool = createMockPool(mockClient);
        const service = new PostgresDatabaseService(mockPool);

        const result = await service.updateReminderSchedule('1', {
          status: 'failed',
        });

        expect(result?.status).toBe('failed');
        expect(result?.sent_at).toBeUndefined();
      });

      it('updates status with error message', async () => {
        // WHO: ReminderProcessor recording delivery failure details
        // WHAT: Updating status and error message together
        // WHEN: External service (the SMS provider/SendGrid) returned error
        // WHERE: updateReminderSchedule method
        // WHY: Error details needed for debugging and retry logic

        const failedReminder = {
          ...sampleReminderSchedule,
          status: 'failed' as const,
          error: 'Invalid phone number format',
        };
        const mockClient = createMockClient([{ rows: [failedReminder] }]);
        const mockPool = createMockPool(mockClient);
        const service = new PostgresDatabaseService(mockPool);

        const result = await service.updateReminderSchedule('1', {
          status: 'failed',
          error: 'Invalid phone number format',
        });

        expect(result?.status).toBe('failed');
        expect(result?.error).toBe('Invalid phone number format');
      });
    });

    describe('Query Filtering', () => {
      it('filters consent by both email and phone', async () => {
        // WHO: CommunicationService with multiple contact methods
        // WHAT: Finding consent that matches both email AND phone
        // WHEN: Customer has both contacts on file
        // WHERE: getConsentRecordsByCustomer method
        // WHY: More precise matching when both identifiers available

        const mockClient = createMockClient([
          { rows: [] }, // set_tenant_context
          { rows: [{ consent_record_id: 1, ...sampleConsentRecord }] }, // SELECT
        ]);
        const mockPool = createMockPool(mockClient);
        const service = new PostgresDatabaseService(mockPool);

        const result = await service.getConsentRecordsByCustomer(
          1,
          'customer@example.com',
          '+15551234567'
        );

        expect(result).toHaveLength(1);

        const queryCall = (mockClient.query as ReturnType<typeof vi.fn>).mock.calls[1];
        expect(queryCall[0]).toContain('customer_email = $2');
        expect(queryCall[0]).toContain('customer_phone = $3');
      });

      it('filters reminders by status when provided', async () => {
        // WHO: Dashboard showing only pending reminders
        // WHAT: Filtering reminders by specific status
        // WHEN: Admin wants to see only scheduled (not sent/failed)
        // WHERE: getReminderSchedulesByTenant method
        // WHY: Dashboard needs filtered views for usability

        const mockClient = createMockClient([
          { rows: [] }, // set_tenant_context
          { rows: [sampleReminderSchedule] }, // SELECT with filter
        ]);
        const mockPool = createMockPool(mockClient);
        const service = new PostgresDatabaseService(mockPool);

        await service.getReminderSchedulesByTenant(1, 'scheduled');

        const queryCall = (mockClient.query as ReturnType<typeof vi.fn>).mock.calls[1];
        expect(queryCall[0]).toContain('status = $2');
        expect(queryCall[1]).toContain('scheduled');
      });
    });

    describe('Numeric ID Type Handling', () => {
      it('handles string tenant ID conversion', async () => {
        // WHO: API layer passing tenant ID as string
        // WHAT: Converting string tenant ID to proper format
        // WHEN: Request comes from HTTP route with string param
        // WHERE: setTenantContext function
        // WHY: RLS requires UUID format but IDs may come as strings

        const mockClient = createMockClient([
          { rows: [] }, // set_tenant_context
          { rows: [sampleReminderSchedule] }, // INSERT
        ]);
        const mockPool = createMockPool(mockClient);
        const service = new PostgresDatabaseService(mockPool);

        await service.createReminderSchedule({
          ...sampleReminderData,
          tenant_id: 1,
        });

        const contextCall = (mockClient.query as ReturnType<typeof vi.fn>).mock.calls[0];
        expect(contextCall[1]).toEqual(['1']); // Should be string
      });
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // FACTORY AND POOL MANAGEMENT
  // ══════════════════════════════════════════════════════════════════════════

  describe('Factory and Pool Management', () => {
    it('createDatabaseService returns a DatabaseService instance', () => {
      // WHO: Application startup initializing services
      // WHAT: Creating database service via factory function
      // WHEN: Server initialization
      // WHERE: createDatabaseService factory
      // WHY: Factory pattern enables dependency injection and testing

      const mockPool = {
        connect: vi.fn(),
        end: vi.fn(),
      } as unknown as Pool;

      const service = createDatabaseService(mockPool);

      expect(service).toBeDefined();
      expect(typeof service.createReminderSchedule).toBe('function');
      expect(typeof service.getConsentRecordsByCustomer).toBe('function');
    });

    it('PostgresDatabaseService constructor accepts optional pool', () => {
      // WHO: Service needing explicit database connection
      // WHAT: Creating service with provided pool
      // WHEN: Constructor called with explicit pool
      // WHERE: PostgresDatabaseService constructor
      // WHY: Allows dependency injection for testing and custom configs

      const mockPool = {
        connect: vi.fn(),
        end: vi.fn(),
      } as unknown as Pool;

      const service = new PostgresDatabaseService(mockPool);

      expect(service).toBeDefined();
      expect(typeof service.createReminderSchedule).toBe('function');
    });
  });
});
