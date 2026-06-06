export interface Appointment {
  appointment_id: string;
  tenant_id: string;
  resource_id: string;
  customer_id: string;
  employee_id?: string | null;
  start_time: string;
  end_time: string;
  status: 'scheduled' | 'completed' | 'canceled';
  description: string;
  location?: string;
  customers?: {
    name: string;
    first_name?: string;
    last_name?: string;
    phone: string;
    metadata?: Record<string, unknown>;
  };
  resources?: {
    name: string;
  };
  // Structured name fields
  first_name?: string;
  last_name?: string;
  // Combined display name (legacy / convenience — prefer customers.name)
  name?: string;
}

export interface Customer {
  customer_id: string;
  tenant_id: string;
  phone: string;
  name: string; // full name (legacy)
  email: string;
  address: string; // address line 1
  // Optional structured fields
  first_name?: string;
  last_name?: string;
  address_line2?: string;
  city?: string;
  state?: string;
  postal_code?: string;
  timezone?: string;
  notes?: string;
  metadata: Record<string, unknown>;
}

export interface Tenant {
  tenant_id: string;
  name: string;
  business_type: string;
  // Nullable in the DB schema and routinely null for newly-created tenants
  // before the AI persona is configured. Consumers must guard.
  system_prompt: string | null;
  voice_id: string | null;
  first_message: string | null;
  team_size?: number;
  timezone?: string;
  // Customer-preference capture (Phone Assistant config). When enabled, the AI
  // remembers durable facts about callers and uses them for personal service +
  // relevant upsells. Instructions are owner-authored guidance; null = use the
  // agent's built-in default guidance.
  save_preferences_enabled?: boolean;
  preferences_instructions?: string | null;
}

export interface BusinessTemplate {
  business_type: string;
  display_name: string;
  category: string;
  sort_order?: number;
  system_prompt_template: string;
  first_message: string;
  voice_id: string;
  default_resource_name: string;
  default_resource_description: string;
  resource_label?: string;
  resource_plural?: string;
  employee_label?: string;
  employee_plural?: string;
  booking_label?: string;
  example_services?: string[];
}

export interface Resource {
  resource_id: string;
  tenant_id: string;
  name: string;
  description?: string | null;
  is_active: boolean;
  capabilities?: string[];
  created_at?: string;
  is_auto_seeded?: boolean;
}

export interface Employee {
  employee_id: string;
  tenant_id: string;
  name: string;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  phone?: string | null;
  skills: string[];
  is_active: boolean;
  is_deleted?: boolean;
  type?: 'employee' | 'user';
}

export interface Service {
  service_id: string;
  tenant_id: string;
  name: string;
  subtitle?: string;
  description?: string;
  duration_minutes: number;
  price?: number | null;
  required_skills?: string[];
  required_resources?: string[];
  is_auto_seeded?: boolean;
}

export interface ScheduleEntry {
  // Composite PK: (tenant_id, employee_id, shift_date). The surrogate
  // employee_schedule_id was dropped 2026-05-18 — see migration
  // 20260518130000.
  tenant_id: string;
  employee_id: string;
  shift_date: string; // YYYY-MM-DD
  start_time: string | null;
  end_time: string | null;
  is_off: boolean;
}

export interface EffectiveShift {
  shift_date: string; // YYYY-MM-DD
  day_of_week: number;
  start_time: string | null;
  end_time: string | null;
  is_override: boolean;
  is_off: boolean;
}

export interface BulkEffectiveShift extends EffectiveShift {
  employee_id: string;
}

export interface Skill {
  // Composite PK: (tenant_id, name). The surrogate tenant_skill_id was
  // dropped 2026-05-18 — see migration 20260518110000. `name` is the
  // identifier used in URLs (lowercase + dash slug) and in
  // services.required_skills / employees.skills text[] columns.
  tenant_id: string;
  name: string;
  description?: string | null;
}

export interface ServiceMapping {
  service_id: string;
  employee_id?: string;
  resource_id?: string;
  tenant_id: string;
}

export interface TenantFull extends Tenant {
  timezone?: string;
  owner_phone?: string | null;
  inbound_phone?: string | null;
  stripe_customer_id?: string | null;
  stripe_subscription_id?: string | null;
  subscription_status?: string;
  subscription_plan?: string | null;
  sort_order?: number;
  telnyx_phone_number_id?: string | null;
  phone_status?: string;
  created_at?: string;
  // Read-only template defaults projected onto the tenant by the
  // SuperAdmin /tenants list query — not persisted columns on tenants
  // themselves, but available on the row for display + revert-to-default
  // UX in the admin console.
  system_prompt_template?: string;
  first_message_template?: string;
}

export interface CalendarSettings {
  tenant_id: string;
  provider: string;
  external_calendar_id: string;
  is_active: boolean;
  token_expires_at?: string;
  created_at?: string;
  updated_at?: string;
}

export interface JobberSettings {
  tenant_id: string;
  provider: 'jobber';
  is_active: boolean;
  last_sync_at?: string;
  created_at?: string;
  updated_at?: string;
}

/**
 * Sync-status shape returned by /jobber/sync/status, /hubspot/sync/status,
 * /square/sync/status, and /servicetitan/sync/status. Backend builds it
 * via `getCrmSyncStatus()` in src/services/crmSyncStatus.ts.
 */
export interface CrmSyncStatus {
  last_sync_at: string | null;
  pending_count: number;
  error_count: number;
  total_mapped: { customers: number; appointments: number };
}

export interface HubSpotSettings {
  tenant_id: string;
  provider: 'hubspot';
  is_active: boolean;
  last_sync_at?: string;
  created_at?: string;
  updated_at?: string;
}

export interface SquareSettings {
  tenant_id: string;
  provider: 'square';
  is_active: boolean;
  last_sync_at?: string;
  created_at?: string;
  updated_at?: string;
}

export interface ServiceTitanSettings {
  tenant_id: string;
  provider: 'servicetitan';
  is_active: boolean;
  last_sync_at?: string;
  created_at?: string;
  updated_at?: string;
}

export interface AnalyticsStats {
  calls: { total: number; today: number; week: number };
  appointments: { total: number; today: number; week: number; upcoming: number };
  customers: { total: number; new_this_week: number };
  recent_activity: Array<{ type: string; description: string; timestamp: string }>;
}

export interface Vocabulary {
  resource_label: string;
  resource_plural: string;
  employee_label: string;
  employee_plural: string;
  booking_label: string;
  /** Industry-specific service-name examples from the matched
   *  business_template; empty when no template is matched. */
  example_services: string[];
  /** Mirror of example_services for resource names. */
  example_resources: string[];
}

export interface CoverageItem {
  service_id: string;
  service_name: string;
  check_date: string;
  gap_hours: number[];
  covered_hours: number[];
  total_open_hours: number;
  coverage_pct: number;
  status: string;
  details: Record<string, unknown>;
}

export interface CallSummary {
  call_summary_id: string;
  tenant_id: string;
  customer_id: string;
  call_id: string;
  summary: string;
  created_at: string;
  call_timestamp?: string;
  has_transcript?: boolean;
}

export interface UserFeedback {
  user_feedback_id: string;
  tenant_id: string;
  user_id?: string;
  page: string;
  context?: string;
  comment: string;
  rating?: number;
  created_at: string;
  user_name?: string;
  tenant_name?: string;
}

export interface KnowledgeEntry {
  tenant_doc_id: string;
  title: string | null;
  section: string | null;
  content: string;
  source: string | null;
  created_at: string;
}

// --- VOICE CRM TYPES (single source of truth) ---
// Re-exported from shared/voiceCrm.ts (the cross-runtime canonical definitions).
// This eliminates the previous duplication between src/types/voiceCrm.ts
// and this file. formatContextForAI lives only in the shared module
// (used by the voice agent for prompt building).

export type {
  CustomerInfo,
  AppointmentSummary,
  AppointmentHistory,
  CustomerNote,
  CustomerContext,
  VoiceSessionStatus,
  VoiceSessionOutcome,
  VoiceSession,
  VoiceSessionDisplay,
} from '../../shared/voiceCrm';

// --- VERSION HISTORY TYPES ---

export type ChangeType = 'create' | 'update' | 'delete' | 'restore' | 'sync' | 'merge';

export type ChangeSource =
  | 'local'
  | 'hubspot'
  | 'jobber'
  | 'square'
  | 'servicetitan'
  | 'voice_call'
  | 'system'
  | 'api';

export type VersionedTable =
  | 'customers'
  | 'appointments'
  | 'voice_sessions'
  | 'employees'
  | 'services'
  | 'resources';

export interface RecordVersion {
  record_version_id: string;
  tenant_id: string;
  table_name: VersionedTable;
  record_id: string;
  version_number: number;
  data: Record<string, unknown>;
  changed_fields: string[];
  previous_values: Record<string, unknown>;
  change_type: ChangeType;
  change_source: ChangeSource;
  changed_by: string | null;
  change_summary: string | null;
  changed_at: string;
}

export interface RecordHistoryResponse {
  record_id: string;
  table_name: VersionedTable;
  current_version: number;
  versions: RecordVersion[];
  is_deleted: boolean;
  deleted_at: string | null;
  deleted_by: string | null;
}

export interface DeletedRecord {
  record_id: string;
  tenant_id: string;
  table_name: VersionedTable;
  name: string | null;
  phone: string | null;
  email: string | null;
  deleted_at: string;
  deleted_by: string | null;
  version_count: number;
  last_data: Record<string, unknown>;
}

export interface DeletedRecordsResponse {
  records: DeletedRecord[];
  total: number;
}

export interface FieldRestoreOption {
  field: string;
  current_value: unknown;
  versions: Array<{
    version_number: number;
    value: unknown;
    changed_at: string;
    change_source: ChangeSource;
  }>;
}

export interface RecordRestorePreview {
  record_id: string;
  table_name: VersionedTable;
  fields: FieldRestoreOption[];
}

export interface RecentChange {
  record_version_id: string;
  tenant_id: string;
  table_name: VersionedTable;
  record_id: string;
  version_number: number;
  change_type: ChangeType;
  change_source: ChangeSource;
  changed_by: string | null;
  change_summary: string | null;
  changed_at: string;
  record_name: string | null;
  record_phone: string | null;
}

export interface RecentChangesResponse {
  changes: RecentChange[];
  total: number;
}

export interface VersionComparison {
  field_name: string;
  value_a: unknown;
  value_b: unknown;
}

// One row in the Team Logins / Access view. Mirrors the GET /users
// response: minimal user record + an `is_self` flag the server attaches
// so the UI can disable role-edit / disable-self controls.
export interface TeamUser {
  user_id: string;
  email: string;
  full_name: string | null;
  role: 'owner' | 'front_desk';
  created_at: string;
  is_self: boolean;
}
