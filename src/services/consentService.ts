/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any */
/**
 * ESLint rules disabled for this file as part of historical full cleanup (REFACTORING_TODO item 10; see RESOLVED.md for details).
 * These are the remaining dynamic/any-heavy areas after previous tranches.
 */

import { isOptOutKeyword, normalizeKeyword, NotAnOptOutCommandError } from './smsKeywords';
import type { DatabaseService } from '../database/index.js';
import type { ConsentRecord, OptOutRecord } from '../types/index.js';

export class ConsentService {
  constructor(private db: DatabaseService) {}

  /**
   * Record customer consent for communications
   */
  async recordConsent(
    consentData: Omit<ConsentRecord, 'consent_record_id'>
  ): Promise<ConsentRecord> {
    const consent: Omit<ConsentRecord, 'consent_record_id'> = {
      ...consentData,
    };

    // Store in database
    const result = await this.db.createConsentRecord(consent);

    console.log(
      `✅ Consent recorded for ${result.customer_email || result.customer_phone} (${
        result.consent_type
      })`
    );
    return result;
  }

  /**
   * Check if customer has given consent for a specific communication type
   */
  async checkConsent(
    tenantId: string,
    customerEmail?: string,
    customerPhone?: string,
    consentType: 'email' | 'sms' = 'email'
  ): Promise<boolean> {
    const consents = await this.db.getConsentRecordsByCustomer(
      tenantId,
      customerEmail,
      customerPhone
    );

    // Find the most recent consent for the requested type
    const relevantConsents = consents
      .filter((consent) => {
        if (consentType === 'email' && !customerEmail) return false;
        if (consentType === 'sms' && !customerPhone) return false;
        return consent.consent_type === consentType || consent.consent_type === 'both';
      })
      .sort(
        (a, b) => new Date(b.consent_date || 0).getTime() - new Date(a.consent_date || 0).getTime()
      );

    if (relevantConsents.length === 0) {
      return false;
    }

    const latestConsent = relevantConsents[0];

    // Check if consent was revoked
    if (latestConsent.revoked_at) {
      return false;
    }

    return !!latestConsent.consent_given;
  }

  /**
   * Revoke customer consent
   */
  async revokeConsent(
    tenantId: string,
    customerEmail?: string,
    customerPhone?: string,
    consentType: 'email' | 'sms' | 'both' = 'both',
    reason?: string
  ): Promise<boolean> {
    const consents = await this.db.getConsentRecordsByCustomer(
      tenantId,
      customerEmail,
      customerPhone
    );

    let revokedCount = 0;
    let filteredConsents: ConsentRecord[] = [];
    if (consentType === 'both') {
      filteredConsents = consents.filter(
        (c) =>
          (c.consent_type === 'email' || c.consent_type === 'sms' || c.consent_type === 'both') &&
          !c.revoked_at
      );
    } else {
      filteredConsents = consents.filter(
        (c) => (c.consent_type === consentType || c.consent_type === 'both') && !c.revoked_at
      );
    }

    if (filteredConsents.length === 0) {
      return false;
    }

    if (consentType === 'both') {
      for (const consent of filteredConsents) {
        await this.db.updateConsentRecord(consent.consent_record_id, {
          revoked_at: new Date().toISOString(),
          revoke_reason: reason || 'User requested opt-out',
        });
        revokedCount++;
      }
    } else {
      // Only revoke the first matching consent for non-'both' types
      const consent = filteredConsents[0];
      await this.db.updateConsentRecord(consent.consent_record_id, {
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
  async recordOptOut(optOutData: Omit<OptOutRecord, 'opt_out_record_id'>): Promise<OptOutRecord> {
    if (!optOutData.tenant_id) {
      throw new Error('tenant_id is required');
    }

    const record: Omit<OptOutRecord, 'opt_out_record_id'> = {
      tenant_id: optOutData.tenant_id,
      customer_email: optOutData.customer_email ?? (optOutData as any).customer_email,
      customer_phone: optOutData.customer_phone ?? (optOutData as any).customer_phone,
      opt_out_type: optOutData.opt_out_type ?? (optOutData as any).opt_out_type,
      opt_out_date:
        optOutData.opt_out_date ?? (optOutData as any).opt_out_date ?? new Date().toISOString(),
      opt_out_method: optOutData.opt_out_method ?? (optOutData as any).opt_out_method,
      original_consent_record_id:
        optOutData.original_consent_record_id ?? (optOutData as any).original_consent_record_id,
      notes: optOutData.notes,
    };

    // Store opt-out record using repository
    const optOut = await this.db.createOptOutRecord(record);

    // Also revoke any existing consent
    let revokeReason = '';
    if (optOut.opt_out_method === 'unsubscribe') {
      revokeReason = 'Opt-out via unsubscribe';
    } else if (optOut.opt_out_method === 'stop') {
      revokeReason = 'Opt-out via stop';
    } else {
      revokeReason = `Opt-out via ${optOut.opt_out_method}`;
    }

    await this.revokeConsent(
      optOut.tenant_id,
      optOut.customer_email,
      optOut.customer_phone,
      optOut.opt_out_type,
      revokeReason
    );

    console.log(
      `✅ Opt-out recorded for ${optOut.customer_email || optOut.customer_phone} (${
        optOut.opt_out_type
      })`
    );
    return optOut;
  }

  /**
   * Process STOP/UNSUBSCRIBE commands from SMS or email
   */
  async processOptOutCommand(
    tenantId: string,
    command: string,
    customerPhone?: string,
    customerEmail?: string,
    messageBody?: string
  ): Promise<OptOutRecord | null> {
    const commandLower = normalizeKeyword(command);

    // REFUSE anything that isn't actually an opt-out.
    //
    // This method used to record an opt-out for WHATEVER command it was handed:
    // the old if/else only special-cased 'stop' and 'unsubscribe', and everything
    // else fell through to the default opt_out_type of 'both'. So passing it
    // 'START' — the keyword a customer texts to RESUME messages — opted them out
    // of everything instead. A method named processOptOutCommand must refuse to
    // do anything but process an opt-out; opt-IN belongs in recordConsent().
    // (Shipped and caught in review on PR #238.)
    if (!isOptOutKeyword(commandLower)) {
      throw new NotAnOptOutCommandError(command);
    }

    // 'unsubscribe' is the email keyword; every other CTIA keyword arrives over
    // SMS. Previously only 'stop' mapped to 'sms' and the rest (STOPALL/END/QUIT/
    // CANCEL) fell through to 'both' — silently killing the customer's EMAIL too,
    // which they never asked for and which no carrier keyword implies.
    const optOutType: 'email' | 'sms' | 'both' = commandLower === 'unsubscribe' ? 'email' : 'sms';

    return this.recordOptOut({
      tenant_id: tenantId,
      customer_email: customerEmail,
      customer_phone: customerPhone,
      opt_out_type: optOutType,
      opt_out_date: new Date().toISOString(),
      opt_out_method: customerPhone ? 'stop' : 'unsubscribe',
      notes: messageBody,
    });
  }

  /**
   * Get all consent records for a tenant
   */
  async getConsentRecords(tenantId: string): Promise<ConsentRecord[]> {
    return await this.db.getConsentRecordsByTenant(tenantId);
  }

  /**
   * Get opt-out records for a tenant
   */
  async getOptOutRecords(tenantId: string): Promise<OptOutRecord[]> {
    return await this.db.getOptOutRecordsByTenant(tenantId);
  }

  /**
   * Check if a customer can receive communications
   */
  async canReceiveCommunications(
    tenantId: string,
    customerEmail?: string,
    customerPhone?: string
  ): Promise<{
    canReceiveEmail: boolean;
    canReceiveSMS: boolean;
    hasConsent: boolean;
  }> {
    const canReceiveEmail = customerEmail
      ? await this.checkConsent(tenantId, customerEmail, undefined, 'email')
      : false;
    const canReceiveSMS = customerPhone
      ? await this.checkConsent(tenantId, undefined, customerPhone, 'sms')
      : false;

    return {
      canReceiveEmail,
      canReceiveSMS,
      hasConsent: canReceiveEmail || canReceiveSMS,
    };
  }
}
