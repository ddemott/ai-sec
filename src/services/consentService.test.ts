/**
 * Tests for Consent Service.
 * Migrated from ai-secretary - provides GDPR/TCPA-compliant consent management.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DatabaseService } from '../database/index.js';

describe('ConsentService', () => {
  // Mock database service
  const createMockDb = () => ({
    createConsentRecord: vi.fn().mockImplementation((data) => ({
      id: 'consent-1',
      ...data,
    })),
    getConsentRecordsByCustomer: vi.fn().mockResolvedValue([]),
    getConsentRecordsByTenant: vi.fn().mockResolvedValue([]),
    updateConsentRecord: vi.fn().mockResolvedValue(true),
    createOptOutRecord: vi.fn().mockImplementation((data) => ({
      id: 1,
      ...data,
    })),
    getOptOutRecordsByTenant: vi.fn().mockResolvedValue([]),
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('recordConsent', () => {
    it('should record consent with all required fields', async () => {
      const { ConsentService } = await import('./consentService');
      const mockDb = createMockDb();
      const service = new ConsentService(mockDb as unknown as DatabaseService);

      const result = await service.recordConsent({
        tenant_id: 'f234e471-0e60-4163-86c9-93cfd9338e3a',
        customer_email: 'test@example.com',
        consent_type: 'email',
        consent_given: true,
        consent_date: new Date().toISOString(),
        consent_method: 'web',
      });

      expect(result).toBeDefined();
      expect(result.id).toBe('consent-1');
      expect(mockDb.createConsentRecord).toHaveBeenCalled();
    });

    it('should pass tenant_id as UUID string', async () => {
      const { ConsentService } = await import('./consentService');
      const mockDb = createMockDb();
      const service = new ConsentService(mockDb as unknown as DatabaseService);

      await service.recordConsent({
        tenant_id: 'f234e471-0e60-4163-86c9-93cfd9338e3a',
        customer_email: 'test@example.com',
        consent_type: 'sms',
        consent_given: true,
        consent_date: new Date().toISOString(),
        consent_method: 'phone',
      });

      const call = mockDb.createConsentRecord.mock.calls[0][0];
      expect(call.tenant_id).toBe('f234e471-0e60-4163-86c9-93cfd9338e3a');
    });
  });

  describe('checkConsent', () => {
    it('should return true when valid consent exists', async () => {
      const { ConsentService } = await import('./consentService');
      const mockDb = createMockDb();
      mockDb.getConsentRecordsByCustomer.mockResolvedValue([
        {
          id: '1',
          consent_type: 'email',
          consent_given: true,
          consent_date: new Date().toISOString(),
          revoked_at: null,
        },
      ]);

      const service = new ConsentService(mockDb as unknown as DatabaseService);
      const result = await service.checkConsent(1, 'test@example.com', undefined, 'email');

      expect(result).toBe(true);
    });

    it('should return false when no consent exists', async () => {
      const { ConsentService } = await import('./consentService');
      const mockDb = createMockDb();
      mockDb.getConsentRecordsByCustomer.mockResolvedValue([]);

      const service = new ConsentService(mockDb as unknown as DatabaseService);
      const result = await service.checkConsent(1, 'test@example.com', undefined, 'email');

      expect(result).toBe(false);
    });

    it('should return false when consent is revoked', async () => {
      const { ConsentService } = await import('./consentService');
      const mockDb = createMockDb();
      mockDb.getConsentRecordsByCustomer.mockResolvedValue([
        {
          id: '1',
          consent_type: 'email',
          consent_given: true,
          consent_date: new Date().toISOString(),
          revoked_at: new Date().toISOString(), // Revoked
        },
      ]);

      const service = new ConsentService(mockDb as unknown as DatabaseService);
      const result = await service.checkConsent(1, 'test@example.com', undefined, 'email');

      expect(result).toBe(false);
    });

    it('should handle "both" consent type', async () => {
      const { ConsentService } = await import('./consentService');
      const mockDb = createMockDb();
      mockDb.getConsentRecordsByCustomer.mockResolvedValue([
        {
          id: '1',
          consent_type: 'both',
          consent_given: true,
          consent_date: new Date().toISOString(),
          revoked_at: null,
        },
      ]);

      const service = new ConsentService(mockDb as unknown as DatabaseService);

      // Should work for email
      const emailResult = await service.checkConsent(1, 'test@example.com', undefined, 'email');
      expect(emailResult).toBe(true);

      // Should work for SMS
      const smsResult = await service.checkConsent(1, undefined, '+15551234567', 'sms');
      expect(smsResult).toBe(true);
    });

    it('should use most recent consent record', async () => {
      const { ConsentService } = await import('./consentService');
      const mockDb = createMockDb();
      const oldDate = new Date('2023-01-01');
      const newDate = new Date('2024-01-01');

      mockDb.getConsentRecordsByCustomer.mockResolvedValue([
        {
          id: '1',
          consent_type: 'email',
          consent_given: true,
          consent_date: oldDate.toISOString(),
          revoked_at: null,
        },
        {
          id: '2',
          consent_type: 'email',
          consent_given: false, // Most recent says no consent
          consent_date: newDate.toISOString(),
          revoked_at: null,
        },
      ]);

      const service = new ConsentService(mockDb as unknown as DatabaseService);
      const result = await service.checkConsent(1, 'test@example.com', undefined, 'email');

      expect(result).toBe(false); // Most recent consent says no
    });
  });

  describe('revokeConsent', () => {
    it('should revoke existing consent', async () => {
      const { ConsentService } = await import('./consentService');
      const mockDb = createMockDb();
      mockDb.getConsentRecordsByCustomer.mockResolvedValue([
        {
          consent_record_id: 1,
          consent_type: 'email',
          consent_given: true,
          revoked_at: null,
        },
      ]);

      const service = new ConsentService(mockDb as unknown as DatabaseService);
      const result = await service.revokeConsent(
        1,
        'test@example.com',
        undefined,
        'email',
        'User requested'
      );

      expect(result).toBe(true);
      expect(mockDb.updateConsentRecord).toHaveBeenCalledWith(
        1,
        expect.objectContaining({
          revoke_reason: 'User requested',
        })
      );
    });

    it('should return false when no consent exists to revoke', async () => {
      const { ConsentService } = await import('./consentService');
      const mockDb = createMockDb();
      mockDb.getConsentRecordsByCustomer.mockResolvedValue([]);

      const service = new ConsentService(mockDb as unknown as DatabaseService);
      const result = await service.revokeConsent(1, 'test@example.com', undefined, 'email');

      expect(result).toBe(false);
    });

    it('should revoke all consents when type is "both"', async () => {
      const { ConsentService } = await import('./consentService');
      const mockDb = createMockDb();
      mockDb.getConsentRecordsByCustomer.mockResolvedValue([
        { id: '1', consent_type: 'email', revoked_at: null },
        { id: '2', consent_type: 'sms', revoked_at: null },
      ]);

      const service = new ConsentService(mockDb as unknown as DatabaseService);
      const result = await service.revokeConsent(1, 'test@example.com', '+15551234567', 'both');

      expect(result).toBe(true);
      expect(mockDb.updateConsentRecord).toHaveBeenCalledTimes(2);
    });
  });

  describe('recordOptOut', () => {
    it('should record opt-out and revoke consent', async () => {
      const { ConsentService } = await import('./consentService');
      const mockDb = createMockDb();
      mockDb.getConsentRecordsByCustomer.mockResolvedValue([
        { id: '1', consent_type: 'sms', revoked_at: null },
      ]);

      const service = new ConsentService(mockDb as unknown as DatabaseService);

      const result = await service.recordOptOut({
        tenant_id: 'f234e471-0e60-4163-86c9-93cfd9338e3a',
        customer_phone: '+15551234567',
        opt_out_type: 'sms',
        opt_out_date: new Date().toISOString(),
        opt_out_method: 'stop',
      });

      expect(result).toBeDefined();
      expect(mockDb.createOptOutRecord).toHaveBeenCalled();
      expect(mockDb.updateConsentRecord).toHaveBeenCalled(); // Consent revoked
    });

    it('should handle snake_case input fields', async () => {
      const { ConsentService } = await import('./consentService');
      const mockDb = createMockDb();
      mockDb.getConsentRecordsByCustomer.mockResolvedValue([]);

      const service = new ConsentService(mockDb as unknown as DatabaseService);

      // The OptOutRecord type uses camelCase but this test deliberately passes
      // a snake_case-flavored payload to verify the service normalizes/handles
      // both shapes. The dual cast documents the intentional shape mismatch.
      await service.recordOptOut({
        tenant_id: 'f234e471-0e60-4163-86c9-93cfd9338e3a',
        customer_phone: '+15551234567',
        opt_out_type: 'sms',
        opt_out_method: 'stop',
      });

      expect(mockDb.createOptOutRecord).toHaveBeenCalled();
    });
  });

  describe('processOptOutCommand', () => {
    it('should process STOP command for SMS', async () => {
      const { ConsentService } = await import('./consentService');
      const mockDb = createMockDb();
      mockDb.getConsentRecordsByCustomer.mockResolvedValue([]);

      const service = new ConsentService(mockDb as unknown as DatabaseService);

      const result = await service.processOptOutCommand(1, 'STOP', '+15551234567');

      expect(result).toBeDefined();
      expect(mockDb.createOptOutRecord).toHaveBeenCalled();
      const call = mockDb.createOptOutRecord.mock.calls[0][0];
      expect(call.opt_out_type).toBe('sms');
    });

    it('should process UNSUBSCRIBE command for email', async () => {
      const { ConsentService } = await import('./consentService');
      const mockDb = createMockDb();
      mockDb.getConsentRecordsByCustomer.mockResolvedValue([]);

      const service = new ConsentService(mockDb as unknown as DatabaseService);

      const result = await service.processOptOutCommand(
        1,
        'UNSUBSCRIBE',
        undefined,
        'test@example.com'
      );

      expect(result).toBeDefined();
      const call = mockDb.createOptOutRecord.mock.calls[0][0];
      expect(call.opt_out_type).toBe('email');
    });

    it('should handle case-insensitive commands', async () => {
      const { ConsentService } = await import('./consentService');
      const mockDb = createMockDb();
      mockDb.getConsentRecordsByCustomer.mockResolvedValue([]);

      const service = new ConsentService(mockDb as unknown as DatabaseService);

      await service.processOptOutCommand(1, 'stop', '+15551234567');
      await service.processOptOutCommand(1, 'STOP', '+15551234568');
      await service.processOptOutCommand(1, 'Stop', '+15551234569');

      expect(mockDb.createOptOutRecord).toHaveBeenCalledTimes(3);
    });
  });

  describe('canReceiveCommunications', () => {
    it('should return capabilities based on consent', async () => {
      const { ConsentService } = await import('./consentService');
      const mockDb = createMockDb();
      mockDb.getConsentRecordsByCustomer.mockResolvedValue([
        {
          consent_type: 'email',
          consent_given: true,
          consent_date: new Date().toISOString(),
          revoked_at: null,
        },
      ]);

      const service = new ConsentService(mockDb as unknown as DatabaseService);

      const result = await service.canReceiveCommunications(1, 'test@example.com', '+15551234567');

      expect(result.canReceiveEmail).toBe(true);
      expect(result.canReceiveSMS).toBe(false); // Only email consent
      expect(result.hasConsent).toBe(true);
    });

    it('should return all false when no consent exists', async () => {
      const { ConsentService } = await import('./consentService');
      const mockDb = createMockDb();
      mockDb.getConsentRecordsByCustomer.mockResolvedValue([]);

      const service = new ConsentService(mockDb as unknown as DatabaseService);

      const result = await service.canReceiveCommunications(1, 'test@example.com', '+15551234567');

      expect(result.canReceiveEmail).toBe(false);
      expect(result.canReceiveSMS).toBe(false);
      expect(result.hasConsent).toBe(false);
    });
  });

  describe('getConsentRecords', () => {
    it('should return all consent records for tenant', async () => {
      const { ConsentService } = await import('./consentService');
      const mockDb = createMockDb();
      const mockRecords = [
        { id: '1', consent_type: 'email' },
        { id: '2', consent_type: 'sms' },
      ];
      mockDb.getConsentRecordsByTenant.mockResolvedValue(mockRecords);

      const service = new ConsentService(mockDb as unknown as DatabaseService);

      const result = await service.getConsentRecords(1);

      expect(result).toEqual(mockRecords);
      expect(mockDb.getConsentRecordsByTenant).toHaveBeenCalledWith(1);
    });
  });

  describe('getOptOutRecords', () => {
    it('should return all opt-out records for tenant', async () => {
      const { ConsentService } = await import('./consentService');
      const mockDb = createMockDb();
      const mockRecords = [
        { id: 1, opt_out_type: 'email' },
        { id: 2, opt_out_type: 'sms' },
      ];
      mockDb.getOptOutRecordsByTenant.mockResolvedValue(mockRecords);

      const service = new ConsentService(mockDb as unknown as DatabaseService);

      const result = await service.getOptOutRecords(1);

      expect(result).toEqual(mockRecords);
      expect(mockDb.getOptOutRecordsByTenant).toHaveBeenCalledWith(1);
    });
  });
});
