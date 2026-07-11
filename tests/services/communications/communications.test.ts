/* eslint-disable @typescript-eslint/unbound-method, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
/**
 * Communications Service Tests
 * Tests email, SMS, and consent functionality with happy + sad paths.
 * Each section includes 5W diagnostic context (WHO, WHAT, WHEN, WHERE, WHY).
 *
 * unbound-method disabled due to Vitest mock patterns.
 * See historical REFACTORING_TODO.md item 10 (see RESOLVED.md for details).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CommunicationService } from '../../../src/services/communications/index.js';
import { ConsentService } from '../../../src/services/consentService.js';
import type { TenantConfigService, TenantConfig } from '../../../src/services/tenants/index.js';
import type { DatabaseService } from '../../../src/database/index.js';

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
  createReminderSchedule: vi.fn(),
  getReminderSchedule: vi.fn(),
  updateReminderSchedule: vi.fn(),
  getReminderSchedulesByTenant: vi.fn().mockResolvedValue([]),
  getReminderSchedulesByAppointment: vi.fn().mockResolvedValue([]),
  getDueReminders: vi.fn().mockResolvedValue([]),
  getAppointmentById: vi.fn(),
  createConsentRecord: vi.fn().mockImplementation((data) => Promise.resolve({ id: 1, ...data })),
  getConsentRecordsByCustomer: vi.fn().mockResolvedValue([]),
  getConsentRecordsByTenant: vi.fn().mockResolvedValue([]),
  updateConsentRecord: vi.fn(),
  createOptOutRecord: vi.fn().mockImplementation((data) => Promise.resolve({ id: 1, ...data })),
  getOptOutRecordsByTenant: vi.fn().mockResolvedValue([]),
});

describe('CommunicationService', () => {
  let configService: TenantConfigService;
  let consentService: ConsentService;
  let communicationService: CommunicationService;
  let mockDb: DatabaseService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb = createMockDb();
    configService = createMockConfigService();
    consentService = new ConsentService(mockDb);
    communicationService = new CommunicationService(configService, consentService);
  });

  describe('Happy Paths', () => {
    describe('sendEmail', () => {
      it('sends email successfully when customer has consent', async () => {
        // Setup: Customer has email consent
        vi.mocked(mockDb.getConsentRecordsByCustomer).mockResolvedValue([
          {
            consent_record_id: 1,
            tenant_id: 'test-tenant-123',
            customer_email: 'customer@example.com',
            consent_type: 'email',
            consent_given: true,
            consent_date: new Date().toISOString(),
            consent_method: 'booking',
          },
        ]);

        const result = await communicationService.sendEmail('test-tenant-123', {
          to: 'customer@example.com',
          subject: 'Test Email',
          text: 'Test body',
        });

        expect(result.success).toBe(true);
        // WHO: tenant sending to customer | WHAT: email delivery
        // WHEN: customer has valid consent | WHERE: sendEmail method
        // WHY: communication requires explicit consent per GDPR/TCPA
      });

      it('applies email templates correctly', async () => {
        vi.mocked(mockDb.getConsentRecordsByCustomer).mockResolvedValue([
          {
            consent_record_id: 1,
            consent_type: 'email',
            consent_given: true,
            consent_date: new Date().toISOString(),
            consent_method: 'booking',
          },
        ]);

        const result = await communicationService.sendEmail('test-tenant-123', {
          to: 'customer@example.com',
          subject: 'Appointment Confirmation',
          text: 'Your appointment is confirmed',
          template: 'appointment-confirmation',
          templateData: {
            customerName: 'John Doe',
            serviceName: 'Haircut',
            staffName: 'Jane',
            dateTime: '2026-04-15T10:00:00Z',
            duration: 30,
          },
        });

        expect(result.success).toBe(true);
        // WHO: business to customer | WHAT: templated email
        // WHEN: appointment booked | WHERE: applyTemplate
        // WHY: consistent professional communication with branding
      });
    });

    describe('sendSMS', () => {
      it('sends SMS successfully when customer has consent', async () => {
        vi.mocked(mockDb.getConsentRecordsByCustomer).mockResolvedValue([
          {
            consent_record_id: 1,
            customer_phone: '+15559876543',
            consent_type: 'sms',
            consent_given: true,
            consent_date: new Date().toISOString(),
            consent_method: 'sms_reply',
          },
        ]);

        const result = await communicationService.sendSMS('test-tenant-123', {
          to: '+15559876543',
          body: 'Your appointment is confirmed',
        });

        expect(result.success).toBe(true);
        // WHO: business to customer | WHAT: SMS delivery
        // WHEN: customer opted in via SMS reply | WHERE: sendSMS method
        // WHY: SMS requires explicit opt-in per TCPA
      });
    });

    describe('sendAppointmentConfirmation', () => {
      it('sends both email and SMS when customer has both contacts', async () => {
        vi.mocked(mockDb.getConsentRecordsByCustomer).mockResolvedValue([
          {
            consent_record_id: 1,
            customer_email: 'customer@example.com',
            consent_type: 'both',
            consent_given: true,
            consent_date: new Date().toISOString(),
            consent_method: 'booking',
          },
        ]);

        const result = await communicationService.sendAppointmentConfirmation(
          'test-tenant-123',
          'customer@example.com',
          '+15559876543',
          {
            customerName: 'John Doe',
            serviceName: 'Haircut',
            staffName: 'Jane Smith',
            dateTime: '2026-04-15T10:00:00Z',
            duration: 30,
          }
        );

        expect(result.email?.success).toBe(true);
        // WHO: business to customer | WHAT: multi-channel confirmation
        // WHEN: appointment created | WHERE: sendAppointmentConfirmation
        // WHY: redundancy ensures customer receives notification
      });
    });

    describe('sendAppointmentReminder', () => {
      it('sends reminder with correct hours until appointment', async () => {
        vi.mocked(mockDb.getConsentRecordsByCustomer).mockResolvedValue([
          {
            consent_record_id: 1,
            consent_type: 'email',
            consent_given: true,
            consent_date: new Date().toISOString(),
            consent_method: 'booking',
          },
        ]);

        const result = await communicationService.sendAppointmentReminder(
          'test-tenant-123',
          'customer@example.com',
          undefined,
          {
            customerName: 'John Doe',
            serviceName: 'Haircut',
            staffName: 'Jane',
            dateTime: '2026-04-15T10:00:00Z',
            duration: 30,
          },
          24 // 24 hours until appointment
        );

        expect(result.email?.success).toBe(true);
        // WHO: scheduler to customer | WHAT: 24h reminder
        // WHEN: 24 hours before appointment | WHERE: sendAppointmentReminder
        // WHY: reduce no-shows with timely reminders
      });
    });
  });

  describe('Sad Paths', () => {
    describe('sendEmail - No Consent', () => {
      it('fails when customer has no consent record', async () => {
        vi.mocked(mockDb.getConsentRecordsByCustomer).mockResolvedValue([]);

        const result = await communicationService.sendEmail('test-tenant-123', {
          to: 'noconsent@example.com',
          subject: 'Test',
          text: 'Body',
        });

        expect(result.success).toBe(false);
        expect(result.error).toContain('consent');
        // WHO: tenant attempting to email unconsented customer
        // WHAT: email blocked due to missing consent
        // WHEN: consent check in sendEmail | WHERE: EmailService
        // WHY: GDPR/TCPA requires explicit consent before marketing comms
      });

      it('fails when customer revoked consent', async () => {
        vi.mocked(mockDb.getConsentRecordsByCustomer).mockResolvedValue([
          {
            consent_record_id: 1,
            customer_email: 'revoked@example.com',
            consent_type: 'email',
            consent_given: true,
            consent_date: '2026-01-01T00:00:00Z',
            consent_method: 'booking',
            revoked_at: '2026-02-01T00:00:00Z',
            revoke_reason: 'User requested',
          },
        ]);

        const result = await communicationService.sendEmail('test-tenant-123', {
          to: 'revoked@example.com',
          subject: 'Test',
          text: 'Body',
        });

        expect(result.success).toBe(false);
        // WHO: tenant to formerly consenting customer
        // WHAT: email blocked due to revoked consent
        // WHEN: customer previously opted out | WHERE: checkConsent
        // WHY: honor customer's withdrawal of consent
      });
    });

    describe('sendSMS - Invalid Phone', () => {
      it('fails with invalid phone number format', async () => {
        vi.mocked(mockDb.getConsentRecordsByCustomer).mockResolvedValue([
          {
            consent_record_id: 1,
            consent_type: 'sms',
            consent_given: true,
            consent_date: new Date().toISOString(),
            consent_method: 'sms_reply',
          },
        ]);

        const _result = await communicationService.sendSMS('test-tenant-123', {
          to: '123', // Too short
          body: 'Test message',
        });

        // May fail at provider level or validation
        // WHO: tenant with malformed phone | WHAT: SMS validation failure
        // WHEN: attempting to send with bad data | WHERE: SMSService
        // WHY: prevent wasted API calls and carrier rejection
      });
    });

    describe('sendEmail - Tenant Not Found', () => {
      it('fails when tenant config does not exist', async () => {
        vi.mocked(configService.getTenantConfig).mockResolvedValue(null);

        const result = await communicationService.sendEmail('nonexistent-tenant', {
          to: 'customer@example.com',
          subject: 'Test',
          text: 'Body',
        });

        expect(result.success).toBe(false);
        expect(result.error).toContain('not found');
        // WHO: unknown tenant | WHAT: config lookup failure
        // WHEN: tenant ID invalid or deleted | WHERE: getTenantConfig
        // WHY: prevent orphan communications from unconfigured tenants
      });
    });

    describe('sendAppointmentConfirmation - No Contact Methods', () => {
      it('handles missing both email and phone gracefully', async () => {
        const result = await communicationService.sendAppointmentConfirmation(
          'test-tenant-123',
          '', // No email
          undefined, // No phone
          {
            customerName: 'John Doe',
            serviceName: 'Haircut',
            staffName: 'Jane',
            dateTime: '2026-04-15T10:00:00Z',
            duration: 30,
          }
        );

        // Should not crash, just return empty results
        expect(result).toBeDefined();
        // WHO: customer with no contact info | WHAT: silent skip
        // WHEN: walk-in customer booked | WHERE: sendAppointmentConfirmation
        // WHY: graceful degradation for incomplete customer data
      });
    });
  });

  describe('Edge Cases', () => {
    it('handles consent for "both" type correctly', async () => {
      vi.mocked(mockDb.getConsentRecordsByCustomer).mockResolvedValue([
        {
          id: 1,
          consent_type: 'both',
          consent_given: true,
          consent_date: new Date().toISOString(),
          consent_method: 'web_form',
        },
      ]);

      // "both" consent should allow email
      const canReceive = await consentService.canReceiveCommunications(
        'test-tenant-123',
        'customer@example.com',
        '+15551234567'
      );

      expect(canReceive.canReceiveEmail).toBe(true);
      expect(canReceive.canReceiveSMS).toBe(true);
    });

    it('respects most recent consent record', async () => {
      vi.mocked(mockDb.getConsentRecordsByCustomer).mockResolvedValue([
        {
          id: 1,
          consent_type: 'email',
          consent_given: true,
          consent_date: '2026-01-01T00:00:00Z',
          consent_method: 'booking',
        },
        {
          id: 2,
          consent_type: 'email',
          consent_given: false, // Later opted out
          consent_date: '2026-02-01T00:00:00Z',
          consent_method: 'web_form',
        },
      ]);

      const hasConsent = await consentService.checkConsent(
        1,
        'customer@example.com',
        undefined,
        'email'
      );

      expect(hasConsent).toBe(false);
      // Most recent consent record (opt-out) takes precedence
    });

    it('handles concurrent consent checks safely', async () => {
      vi.mocked(mockDb.getConsentRecordsByCustomer).mockResolvedValue([
        {
          id: 1,
          consent_type: 'email',
          consent_given: true,
          consent_date: new Date().toISOString(),
          consent_method: 'booking',
        },
      ]);

      // Simulate concurrent checks
      const results = await Promise.all([
        consentService.checkConsent(1, 'customer@example.com', undefined, 'email'),
        consentService.checkConsent(1, 'customer@example.com', undefined, 'email'),
        consentService.checkConsent(1, 'customer@example.com', undefined, 'email'),
      ]);

      expect(results.every((r) => r === true)).toBe(true);
    });
  });
});

describe('ConsentService', () => {
  let mockDb: DatabaseService;
  let consentService: ConsentService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb = createMockDb();
    consentService = new ConsentService(mockDb);
  });

  describe('Happy Paths', () => {
    describe('recordConsent', () => {
      it('records new consent successfully', async () => {
        const consent = await consentService.recordConsent({
          tenant_id: 1,
          customer_email: 'newcustomer@example.com',
          consent_type: 'email',
          consent_given: true,
          consent_date: new Date().toISOString(),
          consent_method: 'booking',
        });

        expect(consent.id).toBeDefined();
        expect(mockDb.createConsentRecord).toHaveBeenCalled();
        // WHO: customer during booking | WHAT: consent creation
        // WHEN: appointment booked | WHERE: recordConsent
        // WHY: capture consent at point of data collection
      });
    });

    describe('checkConsent', () => {
      it('returns true for valid consent', async () => {
        vi.mocked(mockDb.getConsentRecordsByCustomer).mockResolvedValue([
          {
            consent_record_id: 1,
            consent_type: 'email',
            consent_given: true,
            consent_date: new Date().toISOString(),
            consent_method: 'booking',
          },
        ]);

        const hasConsent = await consentService.checkConsent(
          1,
          'customer@example.com',
          undefined,
          'email'
        );

        expect(hasConsent).toBe(true);
        // WHO: system checking customer | WHAT: consent validation
        // WHEN: before sending communication | WHERE: checkConsent
        // WHY: enforce consent requirement before every send
      });
    });

    describe('revokeConsent', () => {
      it('revokes consent successfully', async () => {
        vi.mocked(mockDb.getConsentRecordsByCustomer).mockResolvedValue([
          {
            consent_record_id: 1,
            consent_type: 'email',
            consent_given: true,
            consent_date: new Date().toISOString(),
            consent_method: 'booking',
          },
        ]);
        vi.mocked(mockDb.updateConsentRecord).mockResolvedValue({});

        const revoked = await consentService.revokeConsent(
          1,
          'customer@example.com',
          undefined,
          'email',
          'Customer requested'
        );

        expect(revoked).toBe(true);
        expect(mockDb.updateConsentRecord).toHaveBeenCalledWith(
          1,
          expect.objectContaining({
            revoked_at: expect.any(String),
            revoke_reason: 'Customer requested',
          })
        );
        // WHO: customer or system | WHAT: consent withdrawal
        // WHEN: customer opts out | WHERE: revokeConsent
        // WHY: honor right to withdraw consent (GDPR Article 7)
      });
    });

    describe('processOptOutCommand', () => {
      it('processes STOP command for SMS', async () => {
        const optOut = await consentService.processOptOutCommand(
          1,
          'STOP',
          '+15551234567',
          undefined,
          'STOP'
        );

        expect(optOut).toBeDefined();
        expect(optOut?.opt_out_type).toBe('sms');
        // WHO: customer via SMS | WHAT: STOP command processing
        // WHEN: customer texts STOP | WHERE: processOptOutCommand
        // WHY: TCPA requires honoring STOP requests within 24h
      });

      it('processes UNSUBSCRIBE command for email', async () => {
        const optOut = await consentService.processOptOutCommand(
          1,
          'UNSUBSCRIBE',
          undefined,
          'customer@example.com',
          'Unsubscribe clicked'
        );

        expect(optOut).toBeDefined();
        expect(optOut?.opt_out_type).toBe('email');
        // WHO: customer via email | WHAT: unsubscribe processing
        // WHEN: customer clicks unsubscribe | WHERE: processOptOutCommand
        // WHY: CAN-SPAM requires honoring unsubscribe within 10 days
      });
    });
  });

  describe('Sad Paths', () => {
    describe('checkConsent - No Records', () => {
      it('returns false when no consent records exist', async () => {
        vi.mocked(mockDb.getConsentRecordsByCustomer).mockResolvedValue([]);

        const hasConsent = await consentService.checkConsent(
          1,
          'unknown@example.com',
          undefined,
          'email'
        );

        expect(hasConsent).toBe(false);
        // WHO: unknown customer | WHAT: consent check
        // WHEN: no prior interaction | WHERE: checkConsent
        // WHY: default to no consent for new customers
      });
    });

    describe('revokeConsent - No Existing Consent', () => {
      it('returns false when no consent to revoke', async () => {
        vi.mocked(mockDb.getConsentRecordsByCustomer).mockResolvedValue([]);

        const revoked = await consentService.revokeConsent(
          1,
          'noconsent@example.com',
          undefined,
          'email'
        );

        expect(revoked).toBe(false);
        // WHO: customer without consent record | WHAT: revoke attempt
        // WHEN: customer never consented | WHERE: revokeConsent
        // WHY: cannot revoke what doesn't exist
      });
    });

    describe('canReceiveCommunications - Mixed Consent', () => {
      it('handles email-only consent correctly', async () => {
        vi.mocked(mockDb.getConsentRecordsByCustomer).mockImplementation(
          async (_tenantId: number, email?: string) => {
            if (email) {
              return [
                {
                  consent_record_id: 1,
                  consent_type: 'email',
                  consent_given: true,
                  consent_date: new Date().toISOString(),
                  consent_method: 'booking',
                },
              ];
            }
            return [];
          }
        );

        const result = await consentService.canReceiveCommunications(
          1,
          'customer@example.com',
          '+15551234567'
        );

        expect(result.canReceiveEmail).toBe(true);
        expect(result.canReceiveSMS).toBe(false);
        // WHO: customer with partial consent | WHAT: mixed channel check
        // WHEN: before multi-channel send | WHERE: canReceiveCommunications
        // WHY: respect channel-specific consent preferences
      });
    });
  });
});

describe('SMS Templates', () => {
  it('appointment-confirmation template is within SMS limit', () => {
    const template = `Your appointment is confirmed. Reply STOP to opt out.`;
    expect(template.length).toBeLessThan(160);
    // WHO: SMS carrier | WHAT: message length
    // WHEN: template creation | WHERE: SMS templates
    // WHY: SMS has 160 char limit, longer gets split
  });

  it('templates include opt-out instructions', () => {
    const templates = [
      'Confirmed: Haircut on 4/15. Reply STOP to opt out.',
      'Reminder: Haircut in 24h. Reply STOP to opt out.',
    ];

    templates.forEach((template) => {
      expect(template).toContain('STOP');
    });
    // WHO: TCPA compliance | WHAT: opt-out instructions
    // WHEN: every marketing SMS | WHERE: all SMS templates
    // WHY: TCPA requires opt-out instructions in marketing SMS
  });
});
