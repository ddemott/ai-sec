/**
 * Types for Voice CRM Integration
 *
 * These types support showing customer context when voice calls are answered.
 */

/**
 * Customer information from the CRM
 */
export interface CustomerInfo {
  id: string;
  name: string | null;
  phone: string;
  email: string | null;
  address: string | null;
  created_at: string;
}

/**
 * Appointment summary for customer context
 */
export interface AppointmentSummary {
  id: string;
  start_time: string;
  end_time: string;
  status: string;
  description: string | null;
  resource_name: string | null;
  employee_name: string | null;
}

/**
 * Appointment history statistics
 */
export interface AppointmentHistory {
  total: number;
  completed: number;
  cancelled: number;
  last_appointment: AppointmentSummary | null;
  upcoming_appointments: AppointmentSummary[];
}

/**
 * Note attached to a customer record
 */
export interface CustomerNote {
  id: string;
  text: string;
  type: 'general' | 'call' | 'preference' | 'important';
  call_id?: string;
  created_at: string;
}

/**
 * Full customer context for voice calls
 */
export interface CustomerContext {
  is_known_customer: boolean;
  customer: CustomerInfo | null;
  appointment_history: AppointmentHistory;
  notes: CustomerNote[];
  preferences: Record<string, unknown>;
  tags: string[];
  member_since?: string;
  session_id?: string;
}

/**
 * Voice session status
 */
export type VoiceSessionStatus = 'active' | 'completed' | 'failed' | 'transferred';

/**
 * Voice session outcome
 */
export type VoiceSessionOutcome =
  | 'appointment_booked'
  | 'appointment_rescheduled'
  | 'appointment_cancelled'
  | 'info_provided'
  | 'transferred'
  | 'voicemail'
  | 'abandoned'
  | 'other';

/**
 * Voice session record
 */
export interface VoiceSession {
  id: string;
  tenant_id: string;
  call_id: string;
  caller_phone: string;
  customer_id: string | null;
  customer_context: CustomerContext;
  status: VoiceSessionStatus;
  started_at: string;
  ended_at: string | null;
  duration_seconds: number | null;
  transcript: string | null;
  summary: string | null;
  outcome: VoiceSessionOutcome | null;
  appointment_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

/**
 * Request to start a voice session
 */
export interface StartVoiceSessionRequest {
  tenant_id: string;
  call_id: string;
  caller_phone: string;
}

/**
 * Request to end a voice session
 */
export interface EndVoiceSessionRequest {
  tenant_id: string;
  call_id: string;
  duration_seconds?: number;
  outcome?: VoiceSessionOutcome;
  transcript?: string;
  summary?: string;
  appointment_id?: string;
}

/**
 * Request to add a customer note
 */
export interface AddCustomerNoteRequest {
  customer_id: string;
  note: string;
  note_type?: CustomerNote['type'];
  call_id?: string;
}

/**
 * Voice session for dashboard display
 */
export interface VoiceSessionDisplay {
  id: string;
  call_id: string;
  caller_phone: string;
  customer_name: string | null;
  customer_id: string | null;
  status: VoiceSessionStatus;
  started_at: string;
  duration_seconds: number | null;
  outcome: VoiceSessionOutcome | null;
  is_known_customer: boolean;
}

/**
 * Active calls list for dashboard
 */
export interface ActiveCallsResponse {
  calls: VoiceSessionDisplay[];
  total: number;
}

/**
 * Call history response
 */
export interface CallHistoryResponse {
  calls: VoiceSession[];
  total: number;
  has_more: boolean;
}

/**
 * Format customer context as a string for AI prompts
 */
export function formatContextForAI(context: CustomerContext): string {
  if (!context.is_known_customer) {
    return 'New caller - no previous history with this business.';
  }

  const lines: string[] = [];

  // Customer info
  if (context.customer) {
    lines.push(`Returning customer: ${context.customer.name || 'Name unknown'}`);
    if (context.member_since) {
      const memberSince = new Date(context.member_since);
      const months = Math.floor((Date.now() - memberSince.getTime()) / (30 * 24 * 60 * 60 * 1000));
      lines.push(`Customer for ${months} months`);
    }
  }

  // Appointment history
  const history = context.appointment_history;
  if (history.total > 0) {
    lines.push(`Appointment history: ${history.total} total (${history.completed} completed, ${history.cancelled} cancelled)`);
  }

  // Upcoming appointments
  if (history.upcoming_appointments.length > 0) {
    const upcoming = history.upcoming_appointments[0];
    const date = new Date(upcoming.start_time);
    lines.push(`Next appointment: ${date.toLocaleDateString()} at ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`);
    if (upcoming.description) {
      lines.push(`  Service: ${upcoming.description}`);
    }
  }

  // Notes (most recent 3)
  if (context.notes.length > 0) {
    lines.push('Recent notes:');
    const recentNotes = context.notes.slice(-3);
    for (const note of recentNotes) {
      lines.push(`  - ${note.text}`);
    }
  }

  // Preferences
  const prefs = context.preferences;
  if (Object.keys(prefs).length > 0) {
    lines.push(`Preferences: ${JSON.stringify(prefs)}`);
  }

  // Tags
  if (context.tags.length > 0) {
    lines.push(`Tags: ${context.tags.join(', ')}`);
  }

  return lines.join('\n');
}
