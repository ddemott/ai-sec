/**
 * Shared types for ai-sec backend services.
 * Re-exports types from other modules and defines core types used by
 * communications and reminders services.
 */

// Re-export from sub-modules
export * from './versionHistory.js';
export * from './voiceCrm.js';

// ── Consent Types ────────────────────────────────────────────────────

/**
 * Record of customer consent for communications.
 * GDPR/TCPA compliance requires tracking explicit consent.
 */
export interface ConsentRecord {
  consent_record_id: number;
  tenant_id: string;
  customer_id?: string;
  customer_email?: string;
  customer_phone?: string;
  consent_type: 'email' | 'sms' | 'both';
  consent_given: boolean;
  consent_date: string; // ISO date string
  consent_method: 'web_form' | 'sms_reply' | 'verbal' | 'import' | 'booking';
  consent_source?: string;
  ip_address?: string;
  revoked_at?: string;
  revoke_reason?: string;
  created_at?: string;
  updated_at?: string;
}

/**
 * Record of customer opt-out from communications.
 * Tracks STOP/UNSUBSCRIBE requests for compliance.
 */
export interface OptOutRecord {
  optOutRecordId: number;
  tenantId: string;
  customerEmail?: string;
  customerPhone?: string;
  optOutType: 'email' | 'sms' | 'both';
  optOutDate: string; // ISO date string
  optOutMethod: 'stop' | 'unsubscribe' | 'web_form' | 'verbal' | 'complaint';
  originalConsentId?: number;
  notes?: string;
  createdAt?: string;
}

// ── Reminder Types ───────────────────────────────────────────────────

/**
 * Scheduled reminder for an appointment.
 * Used by ReminderService to track when reminders should be sent.
 */
export interface ReminderSchedule {
  reminder_schedule_id: number;
  appointment_id: string;
  tenant_id: string;
  customer_email: string;
  customer_phone?: string;
  reminder_type: 'confirmation' | '72h' | '24h' | '2h';
  scheduled_for: string; // ISO date string
  sent_at?: string;
  status: 'scheduled' | 'sent' | 'failed' | 'cancelled';
  error?: string;
  created_at?: string;
  updated_at?: string;
}

/**
 * Data for creating a new reminder schedule.
 */
export interface ReminderData {
  appointment_id: string;
  tenant_id: string;
  customer_email: string;
  customer_phone?: string;
  reminder_type: 'confirmation' | '72h' | '24h' | '2h';
  scheduled_for: string;
  status?: 'scheduled' | 'sent' | 'failed' | 'cancelled';
}

// ── Appointment Types (subset for reminders) ─────────────────────────

/**
 * Full appointment type (matches database schema).
 * Includes both raw DB fields (snake_case) and convenience fields (for reminders).
 */
export interface Appointment {
  appointment_id: string;
  tenant_id: string;
  customer_id?: string;
  service_id?: string;
  employee_id?: string;
  resource_id?: string;
  start_time: string;
  end_time: string;
  status: string;
  description?: string;
  location?: string;
  is_deleted?: boolean;
  created_at?: string;
  updated_at?: string;
  cancelled_at?: string;
  cancel_reason?: string;
  // Convenience fields for reminders (populated by joins)
  customer_email?: string;
  customer_phone?: string;
  customer_name?: string;
  service_name?: string;
  staff_name?: string;
  date_time?: string; // Alias for start_time
  duration?: number;
  notes?: string;
}

/**
 * Appointment data needed for reminders.
 * Uses camelCase to match ReminderService expectations.
 */
export interface AppointmentForReminder {
  appointmentId: string;
  tenantId: string;
  customerId?: string;
  customerEmail?: string;
  customerPhone?: string;
  customerName?: string;
  serviceId?: string;
  serviceName?: string;
  staffId?: string;
  staffName?: string;
  dateTime: string; // ISO date string
  duration?: number;
  status: string;
  notes?: string;
  cancelledAt?: string;
  cancelReason?: string;
  createdAt?: string;
  updatedAt?: string;
}
