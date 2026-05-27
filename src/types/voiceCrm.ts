/**
 * Voice CRM types for the backend.
 *
 * Re-exports the shared (cross-runtime) core from shared/voiceCrm.ts.
 * Backend-only request/response DTOs and API wrappers are defined here.
 *
 * The single source of truth for the duplicated interfaces (CustomerNote,
 * VoiceSession*, CustomerContext, formatContextForAI, etc.) now lives in
 * shared/voiceCrm.ts so the dashboard and agent paths stay in sync.
 */

export * from '../../shared/voiceCrm';

import type {
  CustomerNote,
  VoiceSession,
  VoiceSessionDisplay,
  VoiceSessionOutcome,
} from '../../shared/voiceCrm';

/**
 * Request to start a voice session (backend/API only).
 */
export interface StartVoiceSessionRequest {
  tenant_id: string;
  call_id: string;
  caller_phone: string;
}

/**
 * Request to end a voice session (backend/API only).
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
 * Request to add a customer note (backend/API only).
 */
export interface AddCustomerNoteRequest {
  customer_id: string;
  note: string;
  note_type?: CustomerNote['type'];
  call_id?: string;
}

/**
 * Active calls list for dashboard (backend response wrapper).
 */
export interface ActiveCallsResponse {
  calls: VoiceSessionDisplay[];
  total: number;
}

/**
 * Call history response (backend response wrapper).
 */
export interface CallHistoryResponse {
  calls: VoiceSession[];
  total: number;
  has_more: boolean;
}
