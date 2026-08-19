/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * ESLint rules disabled for this file as part of historical full cleanup (REFACTORING_TODO item 10; see RESOLVED.md for details).
 * These are the remaining dynamic/any-heavy areas after previous tranches.
 */

/**
 * Record of customer opt-out from communications.
 * Tracks STOP/UNSUBSCRIBE requests for compliance.
 */
// Stubs for types that were moved or are in the process of being normalized
// (see historical REFACTORING_TODO.md and recent shared/ extractions; see RESOLVED.md). These allow the
// backend to build and start while the full cleanup completes.
export interface ConsentRecord {
  consent_record_id: number;
  tenant_id: string;
  customer_id?: string;
  consent_type: string;
  consent_given?: boolean;
  consent_date?: string;
  granted?: boolean;
  granted_at?: string;
  revoked_at?: string;
  [key: string]: any;
}

export interface ReminderSchedule {
  reminder_schedule_id: number;
  tenant_id: string;
  appointment_id: string;
  reminder_type: string;
  scheduled_for: string;
  /**
   * Minutes before the appointment this reminder fires (0 = confirmation).
   * Source of truth for the lead — do NOT re-derive it from reminder_type.
   * NOT NULL in the DB (migration 20260712010000); optional here only because
   * hand-built test fixtures predate it.
   */
  lead_minutes?: number;
  status: string;
  [key: string]: any;
}

export interface ReminderData {
  [key: string]: any;
}

export interface AppointmentForReminder {
  appointment_id: string;
  [key: string]: any;
}

export interface Appointment {
  appointment_id: string;
  [key: string]: any;
}

export interface OptOutRecord {
  opt_out_record_id: number;
  tenant_id: string;
  customer_email?: string;
  customer_phone?: string;
  opt_out_type: 'email' | 'sms' | 'both';
  opt_out_date: string; // ISO date string
  opt_out_method: 'stop' | 'unsubscribe' | 'web_form' | 'verbal' | 'complaint';
  original_consent_record_id?: number;
  notes?: string;
  created_at?: string;
}
