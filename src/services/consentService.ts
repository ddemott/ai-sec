import type { DatabaseService } from '../database/index.js';
import type { ConsentRecord, OptOutRecord } from '../types/index.js';

export class ConsentService {
  constructor(private db: DatabaseService) {}

  /**
   * Record customer consent for communications
   */
  async recordConsent(consentData: Omit<ConsentRecord, 'id'>): Promise<ConsentRecord> {
    const rawTenantId = consentData.tenant_id ?? (consentData as any).tenantId;
    const tenantId = typeof rawTenantId === 'string' ? parseInt(rawTenantId, 10) : rawTenantId;

    const consent: Omit<ConsentRecord, 'id'> = {
      ...consentData,
      tenant_id: tenantId,
      customer_id:
        consentData.customer_id !== undefined && typeof consentData.customer_id === 'string'
          ? parseInt(consentData.customer_id, 10)
          : consentData.customer_id,
    };

    // Store in database
    const result = await this.db.createConsentRecord(consent);

    console.log(
      `✅ Consent recorded for ${result.customer_email || result.customer_phone} (${
        result.consent_type
      })`,
    );
    return result;
  }

  /**
   * Check if customer has given consent for a specific communication type
   */
  async checkConsent(
    tenantId: number,
    customerEmail?: string,
    customerPhone?: string,
    consentType: 'email' | 'sms' = 'email',
  ): Promise<boolean> {
    const consents = await this.db.getConsentRecordsByCustomer(
      tenantId,
      customerEmail,
      customerPhone,
    );

    // Find the most recent consent for the requested type
    const relevantConsents = consents
      .filter((consent) => {
        if (consentType === 'email' && !customerEmail) return false;
        if (consentType === 'sms' && !customerPhone) return false;
        return consent.consent_type === consentType || consent.consent_type === 'both';
      })
      .sort((a, b) => new Date(b.consent_date).getTime() - new Date(a.consent_date).getTime());

    if (relevantConsents.length === 0) {
      return false;
    }

    const latestConsent = relevantConsents[0];

    // Check if consent was revoked
    if (latestConsent.revoked_at) {
      return false;
    }

    return latestConsent.consent_given;
  }

  /**
   * Revoke customer consent
   */
  async revokeConsent(
    tenantId: number,
    customerEmail?: string,
    customerPhone?: string,
    consentType: 'email' | 'sms' | 'both' = 'both',
    reason?: string,
  ): Promise<boolean> {
    const consents = await this.db.getConsentRecordsByCustomer(
      tenantId,
      customerEmail,
      customerPhone,
    );

    let revokedCount = 0;
    let filteredConsents: ConsentRecord[] = [];
    if (consentType === 'both') {
      filteredConsents = consents.filter(
        (c) =>
          (c.consent_type === 'email' || c.consent_type === 'sms' || c.consent_type === 'both') &&
          !c.revoked_at,
      );
    } else {
      filteredConsents = consents.filter(
        (c) => (c.consent_type === consentType || c.consent_type === 'both') && !c.revoked_at,
      );
    }

    if (filteredConsents.length === 0) {
      return false;
    }

    if (consentType === 'both') {
      for (const consent of filteredConsents) {
        await this.db.updateConsentRecord(consent.id, {
          revoked_at: new Date().toISOString(),
          revoke_reason: reason || 'User requested opt-out',
        });
        revokedCount++;
      }
    } else {
      // Only revoke the first matching consent for non-'both' types
      const consent = filteredConsents[0];
      await this.db.updateConsentRecord(consent.id, {
        revoked_at: new Date().toISOString(),
        revoke_reason: reason || 'User requested opt-out',
      });
      revokedCount++;
    }

    if (revokedCount > 0) {
      console.log(`✅ Consent revoked for ${customerEmail || customerPhone} (${consentType})`);
    }

    return revokedCount > 0;
  }

  /**
   * Record an opt-out request (STOP, UNSUBSCRIBE, etc.)
   */
  async recordOptOut(optOutData: Omit<OptOutRecord, 'id'>): Promise<OptOutRecord> {
    // Ensure tenantId is a number (handle both camelCase and snake_case for input resilience)
    const rawTenantId = optOutData.tenantId ?? (optOutData as any).tenant_id;
    const tenantId = Number(rawTenantId);

    if (Number.isNaN(tenantId)) {
      throw new Error('tenantId must be a valid number');
    }

    // Ensure camelCase format for repository
    const camelCaseData: Omit<OptOutRecord, 'id'> = {
      tenantId,
      customerEmail: optOutData.customerEmail ?? (optOutData as any).customer_email,
      customerPhone: optOutData.customerPhone ?? (optOutData as any).customer_phone,
      optOutType: optOutData.optOutType ?? (optOutData as any).opt_out_type,
      optOutDate:
        optOutData.optOutDate ?? (optOutData as any).opt_out_date ?? new Date().toISOString(),
      optOutMethod: optOutData.optOutMethod ?? (optOutData as any).opt_out_method,
      originalConsentId: optOutData.originalConsentId ?? (optOutData as any).original_consent_id,
      notes: optOutData.notes,
    };

    // Store opt-out record using repository
    const optOut = await this.db.createOptOutRecord(camelCaseData);

    // Also revoke any existing consent
    let revokeReason = '';
    if (optOut.optOutMethod === 'unsubscribe') {
      revokeReason = 'Opt-out via unsubscribe';
    } else if (optOut.optOutMethod === 'stop') {
      revokeReason = 'Opt-out via stop';
    } else {
      revokeReason = `Opt-out via ${optOut.optOutMethod}`;
    }

    await this.revokeConsent(
      optOut.tenantId,
      optOut.customerEmail,
      optOut.customerPhone,
      optOut.optOutType,
      revokeReason,
    );

    console.log(
      `✅ Opt-out recorded for ${optOut.customerEmail || optOut.customerPhone} (${
        optOut.optOutType
      })`,
    );
    return optOut;
  }

  /**
   * Process STOP/UNSUBSCRIBE commands from SMS or email
   */
  async processOptOutCommand(
    tenantId: number,
    command: string,
    customerPhone?: string,
    customerEmail?: string,
    messageBody?: string,
  ): Promise<OptOutRecord | null> {
    const commandLower = command.toLowerCase().trim();

    let optOutType: 'email' | 'sms' | 'both' = 'both';

    if (commandLower === 'stop') {
      optOutType = 'sms';
    } else if (commandLower === 'unsubscribe') {
      optOutType = 'email';
    }

    return this.recordOptOut({
      tenantId: tenantId,
      customerEmail: customerEmail,
      customerPhone: customerPhone,
      optOutType: optOutType,
      optOutDate: new Date().toISOString(),
      optOutMethod: customerPhone ? 'stop' : 'unsubscribe',
      notes: messageBody,
    });
  }

  /**
   * Get all consent records for a tenant
   */
  async getConsentRecords(tenantId: number): Promise<ConsentRecord[]> {
    return await this.db.getConsentRecordsByTenant(tenantId);
  }

  /**
   * Get opt-out records for a tenant
   */
  async getOptOutRecords(tenantId: number): Promise<OptOutRecord[]> {
    return await this.db.getOptOutRecordsByTenant(tenantId);
  }

  /**
   * Check if a customer can receive communications
   */
  async canReceiveCommunications(
    tenantId: number | string,
    customerEmail?: string,
    customerPhone?: string,
  ): Promise<{
    canReceiveEmail: boolean;
    canReceiveSMS: boolean;
    hasConsent: boolean;
  }> {
    const numTenantId = typeof tenantId === 'string' ? parseInt(tenantId, 10) || 0 : tenantId;
    const canReceiveEmail = customerEmail
      ? await this.checkConsent(numTenantId, customerEmail, undefined, 'email')
      : false;
    const canReceiveSMS = customerPhone
      ? await this.checkConsent(numTenantId, undefined, customerPhone, 'sms')
      : false;

    return {
      canReceiveEmail,
      canReceiveSMS,
      hasConsent: canReceiveEmail || canReceiveSMS,
    };
  }
}
