import { normalizePhone } from './phone';
import type {
  Appointment,
  Customer,
  ReminderDeliveryStats,
  Resource,
  Employee,
  Service,
  ScheduleEntry,
  EffectiveShift,
  BulkEffectiveShift,
  Skill,
  ServiceMapping,
  TenantFull,
  BusinessTemplate,
  Tenant,
  CalendarSettings,
  AnalyticsStats,
  AnalyticsCalls,
  AnalyticsCohorts,
  AiCostSummary,
  Vocabulary,
  CoverageItem,
  CallSummary,
  CrmSyncStatus,
  SquareSettings,
  VoiceSession,
  VoiceSessionDisplay,
  CustomerContext,
  RecordHistoryResponse,
  DeletedRecordsResponse,
  RecordRestorePreview,
  RecentChangesResponse,
  VersionedTable,
  ChangeSource,
  RecordVersion,
  VersionComparison,
  TeamUser,
  CustomerMessage,
  AuditLogResponse,
  KnowledgeExplainResponse,
  TenantDataExportResponse,
} from './types';

export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ||
  (typeof window !== 'undefined' ? 'https://localhost:4001' : 'https://localhost:4001');

export const SUPER_ADMIN_TENANT_ID = '00000000-0000-0000-0000-000000000000';

/**
 * Common headers for all API requests (BUG-012: includes JWT token)
 */
const getHeaders = () => {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  const token = getLocalStorageItem('authToken');
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
};

/**
 * Safe localStorage access utility
 */
export function getLocalStorageItem(key: string) {
  if (typeof window !== 'undefined' && window.localStorage) {
    return window.localStorage.getItem(key);
  }
  return null;
}

/**
 * Logic to determine which tenant_id to send based on current session
 * If current user is SuperAdmin, we use the specific entity's tenant_id
 */
export function getTargetTenantId(entityTenantId?: string) {
  const currentTenantId = getLocalStorageItem('tenantId');
  if (currentTenantId === SUPER_ADMIN_TENANT_ID && entityTenantId) {
    return entityTenantId;
  }
  return currentTenantId;
}

/**
 * Module-level callback invoked when any API response returns 402 (subscription required).
 * Registered once by the dashboard root on mount so the plain api.ts module can trigger
 * a toast without importing React components.
 */
let subscriptionRequiredCallback: (() => void) | null = null;

export function setSubscriptionRequiredCallback(cb: () => void): void {
  subscriptionRequiredCallback = cb;
}

/**
 * Force logout: clear all auth state and redirect to login.
 * Single source of truth for auth cleanup — used by apiFetch, apiMutate, and hooks.
 */
export function forceLogout() {
  if (typeof window !== 'undefined') {
    localStorage.removeItem('tenantId');
    localStorage.removeItem('userName');
    localStorage.removeItem('authToken');
    localStorage.removeItem('managedTenantId');
    localStorage.removeItem('managedTenantName');
    window.location.href = '/';
  }
}

/**
 * Decode JWT payload without verification (client-side expiry check only).
 */
function decodeJwtPayload(token: string): { exp?: number } | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    return JSON.parse(atob(parts[1])) as { exp?: number } | null;
  } catch {
    return null;
  }
}

/**
 * Check if the current token is within 10 minutes of expiry and refresh it proactively.
 * Prevents users from being forcibly logged out mid-session.
 */
let refreshInProgress: Promise<void> | null = null;
const TOKEN_REFRESH_BUFFER_MS = 10 * 60 * 1000; // 10 minutes before expiry

async function ensureTokenFresh(): Promise<void> {
  const token = getLocalStorageItem('authToken');
  if (!token) return;

  const payload = decodeJwtPayload(token);
  if (!payload?.exp) return;

  const expiresAt = payload.exp * 1000;
  const now = Date.now();

  // If more than 10 minutes until expiry, token is fresh
  if (expiresAt - now > TOKEN_REFRESH_BUFFER_MS) return;

  // If already expired, force logout
  if (now >= expiresAt) {
    forceLogout();
    return;
  }

  // Token is about to expire — refresh it
  if (refreshInProgress) return refreshInProgress;

  refreshInProgress = (async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/auth/refresh`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
      });
      if (response.ok) {
        const data = (await response.json()) as { success?: boolean; token?: string };
        if (data.success && data.token) {
          localStorage.setItem('authToken', data.token);
        }
      }
    } catch {
      // Refresh failed — token will expire naturally, then 401 triggers logout
    } finally {
      refreshInProgress = null;
    }
  })();

  return refreshInProgress;
}

/**
 * Check response for auth failures (401, tenant-not-found 404) and force logout if needed.
 * Also handles 402 (subscription required) by firing the registered callback.
 * Returns an error message string if a terminal condition was triggered, or null if fine.
 */
async function checkAuthFailure(response: Response): Promise<string | null> {
  if (response.status === 401) {
    forceLogout();
    return 'Session expired. Please log in again.';
  }
  if (response.status === 402) {
    subscriptionRequiredCallback?.();
    return 'Upgrade required to access this feature.';
  }
  if (response.status === 404) {
    try {
      const body = (await response.clone().json()) as { code?: string };
      if (body.code === 'TENANT_NOT_FOUND') {
        forceLogout();
        return 'Your business account was not found. Please log in again.';
      }
    } catch {
      // Not a JSON response or not tenant error — fall through
    }
  }
  return null;
}

/**
 * Detect self-signed cert errors and redirect user to accept the backend certificate.
 * Browser throws TypeError("Failed to fetch") when the cert is untrusted.
 */
let certRedirectTriggered = false;
function handleFetchError(err: unknown) {
  if (
    err instanceof TypeError &&
    err.message === 'Failed to fetch' &&
    !certRedirectTriggered &&
    typeof window !== 'undefined' &&
    API_BASE_URL.startsWith('https://localhost')
  ) {
    certRedirectTriggered = true;
    // Reset after 10 seconds so the user can retry if the redirect didn't help
    setTimeout(() => {
      certRedirectTriggered = false;
    }, 10000);
    // Redirect to backend so the user can accept the self-signed cert
    window.location.href = `${API_BASE_URL}/health?redirect=${encodeURIComponent(window.location.href)}`;
  }
}

/**
 * Generic Fetcher
 */
/**
 * Build the query record for the analytics endpoints: tenant_id plus an
 * optional From/To window. Empty/absent bounds are dropped so the backend
 * treats them as all-time. Returns undefined when there is no tenant — the
 * endpoints require tenant_id, so sending date bounds without it would only
 * produce a tenant-less request (400/404); better to send nothing.
 */
function analyticsQuery(
  tenantId: string | null,
  range?: { start_date?: string; end_date?: string }
): Record<string, string> | undefined {
  if (!tenantId) return undefined;
  const query: Record<string, string> = { tenant_id: tenantId };
  if (range?.start_date) query.start_date = range.start_date;
  if (range?.end_date) query.end_date = range.end_date;
  return query;
}

export async function apiFetch<T>(endpoint: string, params?: Record<string, string>): Promise<T> {
  await ensureTokenFresh();
  let url = `${API_BASE_URL}${endpoint}`;
  if (params) {
    const searchParams = new URLSearchParams(params);
    url += `?${searchParams.toString()}`;
  }

  let response: Response;
  try {
    response = await fetch(url, { headers: getHeaders() });
  } catch (err) {
    handleFetchError(err);
    throw err;
  }

  const authError = await checkAuthFailure(response);
  if (authError) throw new Error(authError);

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || `API Error: ${response.status}`);
  }
  return response.json() as Promise<T>;
}

/**
 * Generic Mutation (POST/PUT/DELETE)
 */
async function apiMutate<T>(
  endpoint: string,
  method: 'POST' | 'PUT' | 'DELETE' | 'PATCH',
  body?: Record<string, unknown>
): Promise<{ success: boolean; error?: string } & T> {
  await ensureTokenFresh();
  const url = `${API_BASE_URL}${endpoint}`;

  const headers = getHeaders();
  if (!body) delete headers['Content-Type'];

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    handleFetchError(err);
    throw err;
  }

  const authError = await checkAuthFailure(response);
  if (authError)
    return { success: false, error: authError } as { success: boolean; error?: string } & T;

  const json = (await response.json()) as unknown;
  const obj = json as Record<string, unknown>;
  if (!response.ok) {
    const errMsg = typeof obj['error'] === 'string' ? obj['error'] : `Error: ${response.status}`;
    return { success: false, error: errMsg, ...obj } as { success: boolean; error?: string } & T;
  }
  return { success: true, ...obj } as { success: boolean; error?: string } & T;
}

/**
 * Entity-Specific API Library
 */
export const Api = {
  // --- CUSTOMERS ---
  customers: {
    list: (tenantId: string | null) =>
      apiFetch<Customer[]>(`/customers`, tenantId ? { tenant_id: tenantId } : undefined),

    create: (tenantId: string | null, data: Partial<Customer>) =>
      apiMutate<{ customer: Customer }>(`/customers/create`, 'POST', {
        tenant_id: tenantId,
        ...data,
        phone: normalizePhone(data.phone),
      }),

    update: (id: string, entityTenantId: string, data: Partial<Customer>) =>
      apiMutate<{ customer: Customer }>(`/customers/${id}`, 'PUT', {
        tenant_id: getTargetTenantId(entityTenantId),
        ...data,
        phone: normalizePhone(data.phone),
      }),

    delete: (id: string) => apiMutate(`/customers/${id}`, 'DELETE'),

    appointments: (customerId: string, tenantId: string | null) =>
      apiFetch<Appointment[]>(
        `/customers/${customerId}/appointments`,
        tenantId ? { tenant_id: tenantId } : undefined
      ),
  },

  // --- APPOINTMENTS ---
  appointments: {
    list: (tenantId: string | null, opts?: { startDate?: string; endDate?: string }) => {
      const params: Record<string, string> = {};
      if (tenantId) params.tenant_id = tenantId;
      if (opts?.startDate) params.start_date = opts.startDate;
      if (opts?.endDate) params.end_date = opts.endDate;
      return apiFetch<Appointment[]>(
        `/appointments`,
        Object.keys(params).length > 0 ? params : undefined
      );
    },

    create: (tenantId: string | null, data: Partial<Appointment> & Record<string, unknown>) =>
      // On overlap, the backend returns 409 with `error_code: 'TIMESLOT_OCCUPIED'`
      // and a `conflict` block describing the existing appointment so the
      // dashboard can surface it (see ConflictModal). apiMutate spreads the
      // response body, so these fields flow through the typed return.
      apiMutate<{
        appointment_id?: string;
        error_code?: string;
        conflict?: {
          appointment_id: string;
          start_time: string;
          end_time: string;
          customer_name: string | null;
          employee_name: string | null;
          resource_name: string | null;
          description: string | null;
        };
        next_available?: Array<{
          start_time: string;
          end_time: string;
          employee_id: string;
          employee_name: string;
          resource_id: string;
          resource_name: string;
          skill_count: number;
        }>;
      }>(`/appointments/create`, 'POST', {
        tenant_id: tenantId,
        ...data,
        customer_phone: normalizePhone(data.customer_phone as string | undefined),
      }),

    update: (
      id: string,
      entityTenantId: string,
      data: Partial<Appointment> & Record<string, unknown>
    ) =>
      apiMutate(`/appointments/${id}/update`, 'POST', {
        tenant_id: getTargetTenantId(entityTenantId),
        ...data,
        customer_phone: normalizePhone(data.customer_phone as string | undefined),
      }),

    delete: (id: string) => apiMutate(`/appointments/${id}`, 'DELETE'),

    cancel: (id: string, tenantId: string | null) =>
      apiMutate(`/appointments/${id}/cancel`, 'POST', { tenant_id: tenantId }),

    // Reactivate flips a canceled appointment back to scheduled. Returns 409
    // with `error_code: 'TIMESLOT_OCCUPIED'` + a `conflict` block when the
    // slot was rebooked while canceled (mirrors /appointments/create's
    // shape so the dashboard can reuse ConflictModal). Returns 400 with
    // `error_code: 'NOT_CANCELED'` when the row isn't currently canceled —
    // the UI should refresh and clear the reactivate affordance.
    reactivate: (id: string, tenantId: string | null) =>
      apiMutate<{
        error_code?: string;
        conflict?: {
          appointment_id: string;
          start_time: string;
          end_time: string;
          customer_name: string | null;
          employee_name: string | null;
          resource_name: string | null;
          description: string | null;
        };
      }>(`/appointments/${id}/reactivate`, 'POST', { tenant_id: tenantId }),

    sendSelfServiceLinks: (id: string, tenantId?: string | null) =>
      apiMutate<{ message?: string; cancelLink?: string; rescheduleLink?: string }>(
        `/appointments/${id}/send-self-service-links`,
        'POST',
        tenantId ? { tenant_id: tenantId } : undefined
      ),
  },

  // --- RESOURCES ---
  resources: {
    list: (tenantId: string | null) =>
      apiFetch<Resource[]>(`/resources`, tenantId ? { tenant_id: tenantId } : undefined),

    create: (tenantId: string | null, data: Partial<Resource>) =>
      apiMutate<{ resource: Resource }>(`/resources/create`, 'POST', {
        tenant_id: tenantId,
        ...data,
      }),

    update: (id: string, data: Partial<Resource>, tenantId?: string | null) =>
      apiMutate(`/resources/${id}/update`, 'POST', { tenant_id: tenantId, ...data }),

    delete: (id: string, tenantId?: string | null) =>
      apiMutate(`/resources/${id}/delete`, 'DELETE', { tenant_id: tenantId }),
  },

  // --- EMPLOYEES ---
  employees: {
    list: (tenantId: string | null) =>
      apiFetch<Employee[]>(`/employees`, tenantId ? { tenant_id: tenantId } : undefined),

    create: (tenantId: string | null, data: Partial<Employee>) =>
      apiMutate<{ employee: Employee }>(`/employees/create`, 'POST', {
        tenant_id: tenantId,
        ...data,
      }),

    update: (id: string, data: Partial<Employee>) =>
      apiMutate<{ employee: Employee }>(`/employees/${id}/update`, 'POST', data),

    delete: (id: string, tenantId: string | null) =>
      apiMutate(`/employees/${id}/delete`, 'DELETE', { tenant_id: tenantId }),
  },

  // --- USERS (login + role management) ---
  users: {
    list: (tenantId: string | null) =>
      apiFetch<{ success: true; users: TeamUser[] }>(
        `/users`,
        tenantId ? { tenant_id: tenantId } : undefined
      ),

    invite: (
      tenantId: string | null,
      data: { email: string; full_name: string; role: 'owner' | 'front_desk' }
    ) => apiMutate<{ user_id: string }>(`/users/invite`, 'POST', { tenant_id: tenantId, ...data }),

    updateRole: (id: string, tenantId: string | null, role: 'owner' | 'front_desk') =>
      apiMutate<{ role: 'owner' | 'front_desk' }>(`/users/${id}/role`, 'PATCH', {
        tenant_id: tenantId,
        role,
      }),
  },

  // --- MAPPINGS ---
  mappings: {
    listServiceResource: (tenantId: string | null) =>
      apiFetch<ServiceMapping[]>(
        `/mappings/service-resource`,
        tenantId ? { tenant_id: tenantId } : undefined
      ),

    assignServiceResource: (serviceId: string, resourceId: string, tenantId: string | null) =>
      apiMutate(`/services/${serviceId}/resources/${resourceId}/assign`, 'POST', {
        tenant_id: tenantId,
      }),

    unassignServiceResource: (serviceId: string, resourceId: string, tenantId: string | null) =>
      apiMutate(`/services/${serviceId}/resources/${resourceId}/unassign`, 'POST', {
        tenant_id: tenantId,
      }),

    assignServiceEmployee: (serviceId: string, employeeId: string, tenantId: string | null) =>
      apiMutate(`/services/${serviceId}/employees/${employeeId}/assign`, 'POST', {
        tenant_id: tenantId,
      }),

    unassignServiceEmployee: (serviceId: string, employeeId: string, tenantId: string | null) =>
      apiMutate(`/services/${serviceId}/employees/${employeeId}/unassign`, 'POST', {
        tenant_id: tenantId,
      }),

    listServiceEmployee: (tenantId: string | null) =>
      apiFetch<ServiceMapping[]>(
        `/mappings/service-employee`,
        tenantId ? { tenant_id: tenantId } : undefined
      ),
  },

  // --- SERVICES ---
  services: {
    list: (tenantId: string | null) =>
      apiFetch<Service[]>(`/services`, tenantId ? { tenant_id: tenantId } : undefined),

    create: (tenantId: string | null, data: Partial<Service>) =>
      apiMutate<{ service: Service }>(`/services/create`, 'POST', { tenant_id: tenantId, ...data }),

    update: (id: string, tenantId: string | null, data: Partial<Service>) =>
      apiMutate<{ service: Service }>(`/services/${id}/update`, 'POST', {
        tenant_id: tenantId,
        ...data,
      }),

    delete: (id: string, tenantId: string | null) =>
      apiMutate(`/services/${id}/delete?tenant_id=${tenantId}`, 'DELETE'),
  },

  // --- SHIFTS ---
  // No legacy weekly-pattern CRUD anymore — the wizard collects the
  // weekly pattern in form state and posts it directly to expandWeekly.
  // Date-specific entries are managed via `schedule` below
  // (employee_schedule table) and the copy-week + expand-weekly RPCs.
  shifts: {
    schedule: {
      list: (tenantId: string | null) =>
        apiFetch<ScheduleEntry[]>(
          `/shifts/overrides`,
          tenantId ? { tenant_id: tenantId } : undefined
        ),

      forDate: (tenantId: string | null, employeeId: string, startDate: string, endDate: string) =>
        apiFetch<EffectiveShift[]>(`/shifts/overrides`, {
          ...(tenantId ? { tenant_id: tenantId } : {}),
          employee_id: employeeId,
          start_date: startDate,
          end_date: endDate,
        }),

      /** Bulk: effective shifts for ALL employees on a date range (scheduler) */
      bulkForDate: (tenantId: string | null, startDate: string, endDate: string) =>
        apiFetch<BulkEffectiveShift[]>(`/shifts/overrides`, {
          ...(tenantId ? { tenant_id: tenantId } : {}),
          start_date: startDate,
          end_date: endDate,
        }),

      save: (tenantId: string | null, data: Partial<ScheduleEntry>) =>
        apiMutate<{ override: ScheduleEntry }>(`/shifts/overrides/create`, 'POST', {
          tenant_id: tenantId,
          ...data,
        }),

      // 2026-05-18 pilot #3: composite-key path (employee_id, shift_date).
      // Tenant comes from JWT — no query param needed.
      remove: (employeeId: string, shiftDate: string, tenantId: string | null) =>
        apiMutate(
          `/shifts/overrides/${encodeURIComponent(employeeId)}/${encodeURIComponent(shiftDate)}${tenantId ? `?tenant_id=${tenantId}` : ''}`,
          'DELETE'
        ),
    },

    copyWeek: (
      tenantId: string | null,
      employeeId: string,
      sourceStart: string,
      targetStart: string
    ) =>
      apiMutate<{ copied: number }>(`/shifts/copy-week`, 'POST', {
        tenant_id: tenantId,
        employee_id: employeeId,
        source_start: sourceStart,
        target_start: targetStart,
      }),

    /**
     * Fan a caller-supplied weekly pattern out into N weeks of
     * date-specific employee_schedule rows. Booking RPCs read only
     * employee_schedule, so this is the bridge that makes
     * post-onboarding bookings work. Idempotent — safe to re-call.
     *
     * Pattern is `{ day_of_week, start_time, end_time }[]`. The wizard
     * collects it in form state and posts it here at finalize; there
     * is no separate weekly-pattern table anymore.
     */
    expandWeekly: (
      tenantId: string | null,
      employeeId: string,
      pattern: Array<{ day_of_week: number; start_time: string; end_time: string }>,
      weeksAhead?: number
    ) =>
      apiMutate<{ inserted: number; rangeStart: string; rangeEnd: string }>(
        `/shifts/expand-weekly`,
        'POST',
        { tenant_id: tenantId, employee_id: employeeId, pattern, weeks_ahead: weeksAhead }
      ),
  },

  // --- CALENDAR SYNC ---
  calendar: {
    getSettings: (tenantId: string | null) =>
      apiFetch<CalendarSettings | null>(
        `/calendar/settings`,
        tenantId ? { tenant_id: tenantId } : undefined
      ),

    getAuthUrl: (tenantId: string | null, provider: 'google' | 'outlook' = 'google') =>
      apiFetch<{ url: string }>(
        `/calendar/auth/${provider}`,
        tenantId ? { tenant_id: tenantId } : undefined
      ),

    updateSettings: (tenantId: string | null, data: Partial<CalendarSettings>) =>
      apiMutate<{ settings: CalendarSettings }>(`/calendar/settings`, 'POST', {
        tenant_id: tenantId,
        ...data,
      }),

    disconnect: (tenantId: string | null) =>
      apiMutate(`/calendar/settings/disconnect`, 'POST', { tenant_id: tenantId }),
  },

  // --- ANALYTICS ---
  analytics: {
    getStats: (tenantId: string | null) =>
      apiFetch<AnalyticsStats>(`/analytics/stats`, tenantId ? { tenant_id: tenantId } : undefined),

    getCalls: (tenantId: string | null, range?: { start_date?: string; end_date?: string }) =>
      apiFetch<AnalyticsCalls>(`/analytics/calls`, analyticsQuery(tenantId, range)),

    getAiCost: (tenantId: string | null) =>
      apiFetch<AiCostSummary>(`/analytics/ai-cost`, tenantId ? { tenant_id: tenantId } : undefined),

    getCohorts: (tenantId: string | null, range?: { start_date?: string; end_date?: string }) =>
      apiFetch<AnalyticsCohorts>(`/analytics/cohorts`, analyticsQuery(tenantId, range)),
  },

  // --- REMINDERS (delivery monitoring) ---
  reminders: {
    deliveryStats: (tenantId: string | null) =>
      apiFetch<ReminderDeliveryStats>(
        `/reminders/delivery-stats`,
        tenantId ? { tenant_id: tenantId } : undefined
      ),
  },

  // --- MASTER SKILLS ---
  skills: {
    list: (tenantId: string | null) =>
      apiFetch<Skill[]>(`/skills`, tenantId ? { tenant_id: tenantId } : undefined),

    create: (tenantId: string | null, data: Partial<Skill>) =>
      apiMutate<{ skill: Skill }>(`/skills/create`, 'POST', { tenant_id: tenantId, ...data }),

    // 2026-05-18 composite-key retrofit pilot #2: the surrogate
    // tenant_skill_id was dropped; the route now keys on the slug name.
    // Argument renamed so a wrong-type caller fails at type-check time.
    delete: (name: string, tenantId: string | null) =>
      apiMutate(
        `/skills/${encodeURIComponent(name)}`,
        'DELETE',
        tenantId ? { tenant_id: tenantId } : undefined
      ),
  },

  // --- TENANTS & TEMPLATES ---
  tenants: {
    list: () => apiFetch<TenantFull[]>(`/tenants`),
    getConfig: (tenantId: string | null) => apiFetch<Tenant>(`/tenants/${tenantId}/config`),
    update: (id: string, data: Partial<TenantFull>) =>
      apiMutate(`/tenants/${id}/update-attributes`, 'POST', data as Record<string, unknown>),
    updateConfig: (id: string, data: Partial<Tenant>) =>
      apiMutate(`/tenants/${id}/update-config`, 'POST', data as Record<string, unknown>),
    delete: (id: string) => apiMutate(`/tenants/${id}`, 'DELETE'),
    create: (data: Record<string, unknown>) =>
      apiMutate<{ tenant_id: string }>(`/tenants/create`, 'POST', data),
    reorder: (order: string[]) => apiMutate(`/tenants/reorder`, 'POST', { order }),
    // Wizard Done — promotes every is_auto_seeded row to user-owned so a
    // post-launch business_type change in Settings doesn't wipe them.
    // See routes/tenants.ts /finalize-setup.
    finalizeSetup: (id: string) =>
      apiMutate<{ services: number; resources: number }>(
        `/tenants/${id}/finalize-setup`,
        'POST',
        {}
      ),
  },

  templates: {
    list: () => apiFetch<BusinessTemplate[]>(`/templates`),
    listFull: () => apiFetch<BusinessTemplate[]>(`/templates/full`),
  },

  // --- FEEDBACK ---
  feedback: {
    submit: (
      tenantId: string | null,
      data: { page: string; context?: string; comment: string; rating?: number }
    ) => apiMutate(`/feedback`, 'POST', { tenant_id: tenantId, ...data }),
  },

  // --- CALL SUMMARIES ---
  callSummaries: {
    list: (tenantId: string | null, customerId: string) =>
      apiFetch<CallSummary[]>(
        `/call-summaries`,
        tenantId ? { tenant_id: tenantId, customer_id: customerId } : { customer_id: customerId }
      ),
  },

  // --- VOCABULARY ---
  vocabulary: {
    get: (tenantId: string | null) =>
      apiFetch<Vocabulary>(`/vocabulary`, tenantId ? { tenant_id: tenantId } : undefined),
  },

  // --- COVERAGE ---
  coverage: {
    check: (tenantId: string | null, startDate?: string, endDate?: string) => {
      const params: Record<string, string> = {};
      if (tenantId) params.tenant_id = tenantId;
      if (startDate) params.start_date = startDate;
      if (endDate) params.end_date = endDate;
      return apiFetch<CoverageItem[]>(`/coverage`, params);
    },
  },

  // --- KNOWLEDGE BASE (RAG) ---
  knowledge: {
    list: (tenantId: string | null) =>
      apiFetch<
        Array<{
          tenant_doc_id: string;
          title: string;
          section: string | null;
          content: string;
          source: string;
          created_at: string;
        }>
      >(`/knowledge`, tenantId ? { tenant_id: tenantId } : undefined),

    delete: (id: string, tenantId: string | null) =>
      apiMutate(`/knowledge/${id}`, 'DELETE', { tenant_id: tenantId }),

    // `source` defaults to 'policy-questionnaire' (the preset-question
    // catalog path). Caller passes 'custom-question' for owner-authored
    // Q&A added via the new Custom Questions section. The discriminator
    // lets the questionnaire UI filter its own preset answers without
    // mixing in custom entries.
    add: (
      tenantId: string | null,
      data: { question: string; answer: string; category?: string; source?: string }
    ) =>
      apiMutate<{ success: boolean; tenant_doc_id: string }>(`/knowledge/add`, 'POST', {
        tenant_id: tenantId,
        ...data,
        source: data.source ?? 'policy-questionnaire',
      }),

    update: (
      id: string,
      tenantId: string | null,
      data: { question: string; answer: string; category?: string }
    ) =>
      apiMutate<{ success: boolean }>(`/knowledge/${id}`, 'PUT', {
        tenant_id: tenantId,
        ...data,
        source: 'policy-questionnaire',
      }),

    unanswered: (tenantId: string | null) =>
      apiFetch<{
        success: boolean;
        questions: Array<{
          unanswered_question_id: string;
          question: string;
          caller_phone: string | null;
          caller_message: string | null;
          created_at: string;
        }>;
      }>(`/knowledge/unanswered`, tenantId ? { tenant_id: tenantId } : undefined),

    resolveUnanswered: (id: string, tenantId: string | null) =>
      apiMutate<{ success: boolean }>(`/knowledge/unanswered/${id}/resolve`, 'PATCH', {
        tenant_id: tenantId,
      }),

    ingest: async (tenantId: string | null, file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      if (tenantId) formData.append('tenant_id', tenantId);

      const token = getLocalStorageItem('authToken');
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const response = await fetch(`${API_BASE_URL}/knowledge/ingest`, {
        method: 'POST',
        headers,
        body: formData,
      });

      return response.json() as Promise<{
        success: boolean;
        chunksIngested: number;
        error?: string;
      }>;
    },

    // Upload a PDF/txt/md info sheet: prefills the standard questions from its
    // prose and adds any **Q:/**A: custom questions, all staged for review.
    importDocument: async (tenantId: string | null, file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      if (tenantId) formData.append('tenant_id', tenantId);

      const token = getLocalStorageItem('authToken');
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const response = await fetch(`${API_BASE_URL}/knowledge/import-document`, {
        method: 'POST',
        headers,
        body: formData,
      });

      return response.json() as Promise<{
        success: boolean;
        standard_answers?: Array<{
          questionId: string | null;
          question: string;
          answer: string | null;
        }>;
        custom_questions?: Array<{ question: string; answer: string }>;
        malformed?: string[];
        confirmed?: number;
        error?: string;
      }>;
    },

    importWebsite: (tenantId: string | null, url: string) =>
      apiMutate<{
        success: boolean;
        extracted?: any[];
        discovered?: any[];
        confirmed?: number;
        suggestions?: number;
        error?: string;
      }>(`/knowledge/import-website`, 'POST', { tenant_id: tenantId, url }),

    suggestions: (tenantId: string | null) =>
      apiFetch<{
        success: boolean;
        suggestions: Array<{
          id: string;
          question_id: string | null;
          question: string;
          answer: string;
          source_url: string | null;
          confidence: number | null;
          status: string;
          created_at: string;
        }>;
      }>(`/knowledge/suggestions`, tenantId ? { tenant_id: tenantId } : undefined),

    approveSuggestion: (id: string, tenantId: string | null) =>
      apiMutate<{ success: boolean }>(`/knowledge/suggestions/${id}`, 'PATCH', {
        tenant_id: tenantId,
        status: 'confirmed',
      }),

    rejectSuggestion: (id: string, tenantId: string | null) =>
      apiMutate<{ success: boolean }>(`/knowledge/suggestions/${id}`, 'PATCH', {
        tenant_id: tenantId,
        status: 'rejected',
      }),

    // "Explain this answer" RAG debugger — shows which KB chunks the AI
    // retrieves for a question + their scores (owner-only on the backend).
    explain: (tenantId: string | null, question: string) =>
      apiMutate<KnowledgeExplainResponse>(`/knowledge/explain`, 'POST', {
        tenant_id: tenantId,
        question,
      }),
  },

  // --- AUDIT LOG (owner-only change history) ---
  auditLog: {
    list: (
      tenantId: string | null,
      params?: {
        limit?: number;
        offset?: number;
        table_name?: string;
        start_date?: string;
        end_date?: string;
      }
    ) => {
      const query: Record<string, string> = {};
      if (tenantId) query.tenant_id = tenantId;
      if (params?.limit != null) query.limit = String(params.limit);
      if (params?.offset != null) query.offset = String(params.offset);
      if (params?.table_name) query.table_name = params.table_name;
      if (params?.start_date) query.start_date = params.start_date;
      if (params?.end_date) query.end_date = params.end_date;
      return apiFetch<AuditLogResponse>(
        `/audit-log`,
        Object.keys(query).length > 0 ? query : undefined
      );
    },
  },

  // --- DATA EXPORT (owner-only data portability) ---
  exportData: {
    tenantData: (tenantId: string | null) =>
      apiFetch<TenantDataExportResponse>(
        `/export/tenant-data`,
        tenantId ? { tenant_id: tenantId } : undefined
      ),
  },

  // --- BILLING ---
  billing: {
    checkout: (tenantId: string, plan: 'solo' | 'growth' | 'professional') =>
      apiMutate<{ url: string }>(`/billing/checkout`, 'POST', { tenant_id: tenantId, plan }),

    status: (tenantId: string) =>
      apiFetch<{ subscription_status: string; subscription_plan: string | null }>(
        `/billing/status`,
        { tenant_id: tenantId }
      ),

    portal: (tenantId: string) =>
      apiMutate<{ url: string }>(`/billing/portal`, 'POST', { tenant_id: tenantId }),
  },

  // --- PHONE PROVISIONING ---
  provisioning: {
    activate: (tenantId: string, areaCode?: string) =>
      apiMutate<{ success: boolean; phone_number: string; telnyx_phone_number_id: string }>(
        `/provisioning/activate`,
        'POST',
        { tenant_id: tenantId, ...(areaCode ? { area_code: areaCode } : {}) }
      ),

    deactivate: (tenantId: string) =>
      apiMutate<{ success: boolean }>(`/provisioning/deactivate`, 'POST', { tenant_id: tenantId }),

    status: (tenantId: string) =>
      apiFetch<{
        phone_status: string;
        inbound_phone: string | null;
        telnyx_phone_number_id: string | null;
      }>(`/provisioning/status`, { tenant_id: tenantId }),
  },

  // --- SQUARE CRM ---
  square: {
    getSettings: (tenantId: string | null) =>
      apiFetch<SquareSettings | null>(
        `/square/settings`,
        tenantId ? { tenant_id: tenantId } : undefined
      ),

    getAuthUrl: (tenantId: string | null) =>
      apiFetch<{ success: boolean; authUrl: string }>(
        `/square/auth`,
        tenantId ? { tenant_id: tenantId } : undefined
      ),

    disconnect: (tenantId: string | null) =>
      apiMutate(`/square/settings/disconnect`, 'POST', { tenant_id: tenantId }),

    triggerSync: (tenantId: string | null) =>
      apiMutate<{ customersSynced: number; appointmentsSynced: number; errors: number }>(
        `/square/sync`,
        'POST',
        { tenant_id: tenantId }
      ),

    getSyncStatus: (tenantId: string | null) =>
      apiFetch<CrmSyncStatus>(
        `/square/sync/status`,
        tenantId ? { tenant_id: tenantId } : undefined
      ),
  },

  // --- VOICE CRM (Call Context) ---
  voice: {
    // Get active calls for dashboard
    getActiveCalls: (tenantId: string | null) =>
      apiFetch<{ calls: VoiceSessionDisplay[]; total: number }>(
        `/voice/active`,
        tenantId ? { tenant_id: tenantId } : undefined
      ),

    // Get call history with optional filters
    getHistory: (
      tenantId: string | null,
      opts?: { customer_id?: string; status?: string; limit?: number; offset?: number }
    ) => {
      const params: Record<string, string> = {};
      if (tenantId) params.tenant_id = tenantId;
      if (opts?.customer_id) params.customer_id = opts.customer_id;
      if (opts?.status) params.status = opts.status;
      if (opts?.limit) params.limit = String(opts.limit);
      if (opts?.offset) params.offset = String(opts.offset);
      return apiFetch<{ calls: VoiceSession[]; total: number; has_more: boolean }>(
        `/voice/history`,
        Object.keys(params).length > 0 ? params : undefined
      );
    },

    // Get a specific voice session
    getSession: (tenantId: string | null, callId: string) =>
      apiFetch<VoiceSession>(
        `/voice/session/${callId}`,
        tenantId ? { tenant_id: tenantId } : undefined
      ),

    // Get customer context (for viewing customer profile enrichment)
    getCustomerContext: (tenantId: string | null, customerId: string) =>
      apiFetch<CustomerContext>(
        `/voice/customer/${customerId}/context`,
        tenantId ? { tenant_id: tenantId } : undefined
      ),

    // Get call history for a specific customer
    getCustomerCalls: (tenantId: string | null, customerId: string, limit?: number) =>
      apiFetch<{ calls: VoiceSession[] }>(`/voice/customer/${customerId}/calls`, {
        ...(tenantId ? { tenant_id: tenantId } : {}),
        ...(limit ? { limit: String(limit) } : {}),
      }),

    // Add a note to a customer
    addCustomerNote: (
      tenantId: string | null,
      data: { customer_id: string; note: string; note_type?: string; call_id?: string }
    ) =>
      apiMutate<{ success: boolean }>(`/voice/customer/note`, 'POST', {
        tenant_id: tenantId,
        ...data,
      }),

    // Soft-delete a single call record (owner-only; recoverable, hidden from
    // lists + analytics).
    deleteCall: (tenantId: string | null, voiceSessionId: string) =>
      apiMutate(`/voice/session/${voiceSessionId}`, 'DELETE', { tenant_id: tenantId }),

    // Bulk soft-delete finished calls older than N days (owner-only). Returns
    // the number of calls removed.
    deleteOldCalls: (tenantId: string | null, olderThanDays: number) =>
      apiMutate<{ result?: { deleted: number } }>(`/voice/delete-old`, 'POST', {
        tenant_id: tenantId,
        older_than_days: olderThanDays,
      }),

    // Get customer context by phone (used during active calls)
    getContextByPhone: (tenantId: string | null, phone: string) =>
      apiFetch<CustomerContext>(
        `/voice/context/${encodeURIComponent(phone)}`,
        tenantId ? { tenant_id: tenantId } : undefined
      ),

    // List caller messages left during voice calls (owner inbox)
    listMessages: (
      tenantId: string | null,
      opts?: { status?: string; limit?: number; offset?: number }
    ) =>
      apiFetch<CustomerMessage[]>(
        `/voice/messages`,
        tenantId
          ? {
              tenant_id: tenantId,
              ...(opts?.status ? { status: opts.status } : {}),
              ...(opts?.limit !== undefined ? { limit: String(opts.limit) } : {}),
              ...(opts?.offset !== undefined ? { offset: String(opts.offset) } : {}),
            }
          : undefined
      ),

    // Mark a message as read or actioned
    updateMessageStatus: (messageId: string, status: 'new' | 'read' | 'actioned') =>
      apiMutate<{ success: boolean }>(`/voice/messages/${messageId}`, 'PATCH', { status }),
  },

  // --- Version History API ---
  versionHistory: {
    // Get full history for a record
    getHistory: (tenantId: string | null, table: VersionedTable, recordId: string) =>
      apiFetch<RecordHistoryResponse>(
        `/records/${table}/${recordId}/history`,
        tenantId ? { tenant_id: tenantId } : undefined
      ),

    // Get a specific version
    getVersion: (
      tenantId: string | null,
      table: VersionedTable,
      recordId: string,
      versionNumber: number
    ) =>
      apiFetch<RecordVersion>(
        `/records/${table}/${recordId}/version/${versionNumber}`,
        tenantId ? { tenant_id: tenantId } : undefined
      ),

    // Compare two versions
    compareVersions: (
      tenantId: string | null,
      table: VersionedTable,
      recordId: string,
      versionA: number,
      versionB: number
    ) =>
      apiFetch<{
        record_id: string;
        table_name: string;
        version_a: number;
        version_b: number;
        differences: VersionComparison[];
      }>(
        `/records/${table}/${recordId}/compare/${versionA}/${versionB}`,
        tenantId ? { tenant_id: tenantId } : undefined
      ),

    // Get restore preview (all fields with historical values)
    getRestorePreview: (tenantId: string | null, table: VersionedTable, recordId: string) =>
      apiFetch<RecordRestorePreview>(
        `/records/${table}/${recordId}/restore-preview`,
        tenantId ? { tenant_id: tenantId } : undefined
      ),

    // Restore specific fields from a version
    restoreFields: (
      tenantId: string | null,
      table: VersionedTable,
      recordId: string,
      // Either a single group or a batch of groups restored in one transaction.
      data: (
        | { source_version: number; fields: string[] }
        | { restores: { source_version: number; fields: string[] }[] }
      ) & {
        restored_by?: string;
        change_source?: ChangeSource;
      }
    ) =>
      apiMutate<{ success: boolean; data: Record<string, unknown>; message: string }>(
        `/records/${table}/${recordId}/restore-fields`,
        'POST',
        { tenant_id: tenantId, ...data }
      ),

    // Soft delete a record
    softDelete: (
      tenantId: string | null,
      table: VersionedTable,
      recordId: string,
      data?: { deleted_by?: string; change_source?: ChangeSource }
    ) =>
      apiMutate<{ success: boolean; message: string }>(
        `/records/${table}/${recordId}/soft-delete`,
        'POST',
        { tenant_id: tenantId, ...(data || {}) }
      ),

    // Restore a soft-deleted record
    restoreDeleted: (
      tenantId: string | null,
      table: VersionedTable,
      recordId: string,
      data?: { restored_by?: string; change_source?: ChangeSource }
    ) =>
      apiMutate<{ success: boolean; message: string }>(
        `/records/${table}/${recordId}/restore`,
        'POST',
        { tenant_id: tenantId, ...(data || {}) }
      ),

    // Get deleted records for a table
    getDeleted: (
      tenantId: string | null,
      table: VersionedTable,
      opts?: { limit?: number; offset?: number }
    ) => {
      const params: Record<string, string> = {};
      if (tenantId) params.tenant_id = tenantId;
      if (opts?.limit) params.limit = String(opts.limit);
      if (opts?.offset) params.offset = String(opts.offset);
      return apiFetch<DeletedRecordsResponse>(
        `/records/${table}/deleted`,
        Object.keys(params).length > 0 ? params : undefined
      );
    },

    // Copy fields from one record to another
    copyFields: (
      tenantId: string | null,
      table: VersionedTable,
      data: {
        source_record_id: string;
        target_record_id: string;
        fields: string[];
        copied_by?: string;
        change_source?: ChangeSource;
      }
    ) =>
      apiMutate<{ success: boolean; data: Record<string, unknown>; message: string }>(
        `/records/${table}/copy-fields`,
        'POST',
        { tenant_id: tenantId, ...data }
      ),

    // Get recent changes across all tables
    getRecentChanges: (
      tenantId: string | null,
      opts?: {
        limit?: number;
        offset?: number;
        table?: VersionedTable;
        change_type?: string;
        change_source?: ChangeSource;
      }
    ) => {
      const params: Record<string, string> = {};
      if (tenantId) params.tenant_id = tenantId;
      if (opts?.limit) params.limit = String(opts.limit);
      if (opts?.offset) params.offset = String(opts.offset);
      if (opts?.table) params.table = opts.table;
      if (opts?.change_type) params.change_type = opts.change_type;
      if (opts?.change_source) params.change_source = opts.change_source;
      return apiFetch<RecentChangesResponse>(
        `/records/recent-changes`,
        Object.keys(params).length > 0 ? params : undefined
      );
    },
  },

  communications: {
    history: (
      tenantId: string | null,
      opts?: { type?: 'all' | 'sms' | 'email'; limit?: number; offset?: number }
    ) => {
      const params: Record<string, string> = {};
      if (tenantId) params.tenant_id = tenantId;
      if (opts?.type) params.type = opts.type;
      if (opts?.limit != null) params.limit = String(opts.limit);
      if (opts?.offset != null) params.offset = String(opts.offset);
      return apiFetch<{
        success: boolean;
        history: Array<{
          communications_history_id: number;
          customer_id: string | null;
          channel: 'sms' | 'email';
          direction: string;
          recipient: string;
          subject: string | null;
          body: string;
          status: string;
          provider_message_id: string | null;
          error: string | null;
          created_at: string;
        }>;
        total: number;
      }>('/communications/history', Object.keys(params).length > 0 ? params : undefined);
    },
  },
};
