export interface Appointment {
  id: string;
  tenant_id: string;
  resource_id: string;
  customer_id: string;
  employee_id?: string | number | null;
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
  id: string;
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
  id: string;
  name: string;
  business_type: string;
  system_prompt: string;
  voice_id: string;
  first_message: string;
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
  id: string;
  tenant_id: string;
  name: string;
  description?: string | null;
  is_active: boolean;
  capabilities?: string[];
  created_at?: string;
}

export interface Employee {
  id: string;
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
  id: string;
  tenant_id: string;
  name: string;
  subtitle?: string;
  description?: string;
  duration_minutes: number;
  price?: number | null;
  required_skills?: string[];
  required_resources?: string[];
}

export interface Shift {
  id: string;
  tenant_id: string;
  employee_id: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  is_active: boolean;
}

export interface Skill {
  id: string;
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
  vapi_assistant_id?: string | null;
  vapi_phone_number_id?: string | null;
  phone_status?: string;
  created_at?: string;
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

export interface JobberSyncStatus {
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
}

export interface CoverageItem {
  service_id: string;
  service_name: string;
  duration_minutes: number;
  coverage_status: 'full' | 'partial' | 'uncovered' | 'no_staff' | 'no_resource';
  total_open_hours: number;
  covered_hours: number;
  gap_hours: number;
  has_qualified_staff: boolean;
  has_capable_resource: boolean;
  qualified_employee_count: number;
  capable_resource_count: number;
  gap_details: Array<{ date: string; day_name: string; gap_start: string; gap_end: string }>;
}

export interface StaffingEntry {
  service_id: string;
  service_name: string;
  duration_minutes: number;
  employees: Array<{ id: string; name: string; shift_start: string | null; shift_end: string | null }>;
}

export interface CallSummary {
  id: string;
  tenant_id: string;
  customer_id: string;
  call_id: string;
  summary: string;
  created_at: string;
  call_timestamp?: string;
  has_transcript?: boolean;
}

export interface UserFeedback {
  id: string;
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
  id: string;
  title: string | null;
  section: string | null;
  content: string;
  source: string | null;
  created_at: string;
}
