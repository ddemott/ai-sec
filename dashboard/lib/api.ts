import { normalizePhone } from './phone'
import type {
  Appointment, Customer, Resource, Employee, Service, Shift, Skill,
  ServiceMapping, TenantFull, BusinessTemplate, Tenant,
  CalendarSettings, AnalyticsStats, Vocabulary, CoverageItem, StaffingEntry,
  CallSummary,
} from './types'

export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ||
  (typeof window !== 'undefined'
    ? 'https://localhost:3000'
    : 'https://localhost:3000');

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
 * Check response for auth failures (401, tenant-not-found 404) and force logout if needed.
 * Returns an error message string if logout was triggered, or null if response is fine.
 */
async function checkAuthFailure(response: Response): Promise<string | null> {
  if (response.status === 401) {
    forceLogout();
    return 'Session expired. Please log in again.';
  }
  if (response.status === 404) {
    try {
      const body = await response.clone().json();
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
 * Generic Fetcher
 */
export async function apiFetch<T>(endpoint: string, params?: Record<string, string>): Promise<T> {
  let url = `${API_BASE_URL}${endpoint}`;
  if (params) {
    const searchParams = new URLSearchParams(params);
    url += `?${searchParams.toString()}`;
  }

  const response = await fetch(url, { headers: getHeaders() });

  const authError = await checkAuthFailure(response);
  if (authError) throw new Error(authError);

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || `API Error: ${response.status}`);
  }
  return response.json();
}

/**
 * Generic Mutation (POST/PUT/DELETE)
 */
async function apiMutate<T>(
  endpoint: string,
  method: 'POST' | 'PUT' | 'DELETE',
  body?: Record<string, unknown>
): Promise<{ success: boolean; error?: string } & T> {
  const url = `${API_BASE_URL}${endpoint}`;

  const response = await fetch(url, {
    method,
    headers: getHeaders(),
    body: body ? JSON.stringify(body) : undefined,
  });

  const authError = await checkAuthFailure(response);
  if (authError) return { success: false, error: authError } as { success: boolean; error?: string } & T;

  const data = await response.json();
  if (!response.ok) {
    return { success: false, error: data.error || `Error: ${response.status}`, ...data };
  }
  return { success: true, ...data };
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

    delete: (id: string) =>
      apiMutate(`/customers/${id}`, 'DELETE'),

    appointments: (customerId: string, tenantId: string | null) =>
      apiFetch<Appointment[]>(`/customers/${customerId}/appointments`, tenantId ? { tenant_id: tenantId } : undefined),
  },

  // --- APPOINTMENTS ---
  appointments: {
    list: (tenantId: string | null, opts?: { startDate?: string; endDate?: string }) => {
      const params: Record<string, string> = {};
      if (tenantId) params.tenant_id = tenantId;
      if (opts?.startDate) params.start_date = opts.startDate;
      if (opts?.endDate) params.end_date = opts.endDate;
      return apiFetch<Appointment[]>(`/appointments`, Object.keys(params).length > 0 ? params : undefined);
    },

    create: (tenantId: string | null, data: Partial<Appointment> & Record<string, unknown>) =>
      apiMutate<{ appointment_id: string }>(`/appointments/create`, 'POST', {
        tenant_id: tenantId,
        ...data,
        customer_phone: normalizePhone(data.customer_phone as string | undefined),
      }),

    update: (id: string, entityTenantId: string, data: Partial<Appointment> & Record<string, unknown>) =>
      apiMutate(`/appointments/${id}/update`, 'POST', {
        tenant_id: getTargetTenantId(entityTenantId),
        ...data,
        customer_phone: normalizePhone(data.customer_phone as string | undefined),
      }),

    delete: (id: string) =>
      apiMutate(`/appointments/${id}`, 'DELETE'),

    cancel: (id: string, tenantId: string | null) =>
      apiMutate(`/appointments/${id}/cancel`, 'POST', { tenant_id: tenantId }),
  },

  // --- RESOURCES ---
  resources: {
    list: (tenantId: string | null) =>
      apiFetch<Resource[]>(`/resources`, tenantId ? { tenant_id: tenantId } : undefined),

    create: (tenantId: string | null, data: Partial<Resource>) =>
      apiMutate<{ resource: Resource }>(`/resources/create`, 'POST', { tenant_id: tenantId, ...data }),

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
      apiMutate<{ employee: Employee }>(`/employees/create`, 'POST', { tenant_id: tenantId, ...data }),

    update: (id: string, data: Partial<Employee>) =>
      apiMutate<{ employee: Employee }>(`/employees/${id}/update`, 'POST', data),

    delete: (id: string, tenantId: string | null) =>
      apiMutate(`/employees/${id}/delete`, 'DELETE', { tenant_id: tenantId }),
  },

  // --- MAPPINGS ---
  mappings: {
    listServiceResource: (tenantId: string | null) =>
      apiFetch<ServiceMapping[]>(`/mappings/service-resource`, tenantId ? { tenant_id: tenantId } : undefined),

    assignServiceResource: (serviceId: string, resourceId: string, tenantId: string | null) =>
      apiMutate(`/services/${serviceId}/resources/${resourceId}/assign`, 'POST', { tenant_id: tenantId }),

    unassignServiceResource: (serviceId: string, resourceId: string, tenantId: string | null) =>
      apiMutate(`/services/${serviceId}/resources/${resourceId}/unassign`, 'POST', { tenant_id: tenantId }),

    assignServiceEmployee: (serviceId: string, employeeId: string, tenantId: string | null) =>
      apiMutate(`/services/${serviceId}/employees/${employeeId}/assign`, 'POST', { tenant_id: tenantId }),

    unassignServiceEmployee: (serviceId: string, employeeId: string, tenantId: string | null) =>
      apiMutate(`/services/${serviceId}/employees/${employeeId}/unassign`, 'POST', { tenant_id: tenantId }),

    listServiceEmployee: (tenantId: string | null) =>
      apiFetch<ServiceMapping[]>(`/mappings/service-employee`, tenantId ? { tenant_id: tenantId } : undefined),
  },

  // --- SERVICES ---
  services: {
    list: (tenantId: string | null) =>
      apiFetch<Service[]>(`/services`, tenantId ? { tenant_id: tenantId } : undefined),

    create: (tenantId: string | null, data: Partial<Service>) =>
      apiMutate<{ service: Service }>(`/services/create`, 'POST', { tenant_id: tenantId, ...data }),

    update: (id: string | number, tenantId: string | null, data: Partial<Service>) =>
      apiMutate<{ service: Service }>(`/services/${id}/update`, 'POST', { tenant_id: tenantId, ...data }),

    delete: (id: string, tenantId: string | null) =>
      apiMutate(`/services/${id}/delete?tenant_id=${tenantId}`, 'DELETE'),
  },

  // --- SHIFTS ---
  shifts: {
    list: (tenantId: string | null) =>
      apiFetch<Shift[]>(`/shifts`, tenantId ? { tenant_id: tenantId } : undefined),

    create: (tenantId: string | null, data: Partial<Shift>) =>
      apiMutate<{ shift: Shift }>(`/shifts/create`, 'POST', { tenant_id: tenantId, ...data }),

    update: (id: string, tenantId: string | null, data: Partial<Shift>) =>
      apiMutate<{ shift: Shift }>(`/shifts/${id}/update`, 'POST', { tenant_id: tenantId, ...data }),

    delete: (id: string, tenantId: string | null) =>
      apiMutate(`/shifts/${id}${tenantId ? `?tenant_id=${tenantId}` : ''}`, 'DELETE'),
  },

  // --- CALENDAR SYNC ---
  calendar: {
    getSettings: (tenantId: string | null) =>
      apiFetch<CalendarSettings | null>(`/calendar/settings`, tenantId ? { tenant_id: tenantId } : undefined),

    updateSettings: (tenantId: string | null, data: Partial<CalendarSettings>) =>
      apiMutate<{ settings: CalendarSettings }>(`/calendar/settings`, 'POST', { tenant_id: tenantId, ...data }),

    disconnect: (tenantId: string | null) =>
      apiMutate(`/calendar/settings/disconnect`, 'POST', { tenant_id: tenantId }),
  },

  // --- ANALYTICS ---
  analytics: {
    getStats: (tenantId: string | null) =>
      apiFetch<AnalyticsStats>(`/analytics/stats`, tenantId ? { tenant_id: tenantId } : undefined),
  },

  // --- MASTER SKILLS ---
  skills: {
    list: (tenantId: string | null) =>
      apiFetch<Skill[]>(`/skills`, tenantId ? { tenant_id: tenantId } : undefined),

    create: (tenantId: string | null, data: Partial<Skill>) =>
      apiMutate<{ skill: Skill }>(`/skills/create`, 'POST', { tenant_id: tenantId, ...data }),

    delete: (id: string, tenantId: string | null) =>
      apiMutate(`/skills/${id}`, 'DELETE', tenantId ? { tenant_id: tenantId } : undefined),
  },

  // --- TENANTS & TEMPLATES ---
  tenants: {
    list: () => apiFetch<TenantFull[]>(`/tenants`),
    getConfig: (tenantId: string | null) => apiFetch<Tenant>(`/tenants/${tenantId}/config`),
    update: (id: string, data: Partial<TenantFull>) => apiMutate(`/tenants/${id}/update-attributes`, 'POST', data as Record<string, unknown>),
    updateConfig: (id: string, data: Partial<Tenant>) => apiMutate(`/tenants/${id}/update-config`, 'POST', data as Record<string, unknown>),
    delete: (id: string) => apiMutate(`/tenants/${id}`, 'DELETE'),
    create: (data: Record<string, unknown>) => apiMutate<{ tenant_id: string }>(`/tenants/create`, 'POST', data),
    reorder: (order: string[]) => apiMutate(`/tenants/reorder`, 'POST', { order }),
  },

  templates: {
    list: () => apiFetch<BusinessTemplate[]>(`/templates`),
    listFull: () => apiFetch<BusinessTemplate[]>(`/templates/full`),
  },

  // --- FEEDBACK ---
  feedback: {
    submit: (tenantId: string | null, data: { page: string; context?: string; comment: string; rating?: number }) =>
      apiMutate(`/feedback`, 'POST', { tenant_id: tenantId, ...data }),
  },

  // --- CALL SUMMARIES ---
  callSummaries: {
    list: (tenantId: string | null, customerId: string) =>
      apiFetch<CallSummary[]>(`/call-summaries`, tenantId ? { tenant_id: tenantId, customer_id: customerId } : { customer_id: customerId }),
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

  // --- STAFFING MAP ---
  staffing: {
    get: (tenantId: string | null, dayOfWeek?: number) => {
      const params: Record<string, string> = {};
      if (tenantId) params.tenant_id = tenantId;
      if (dayOfWeek !== undefined) params.day_of_week = String(dayOfWeek);
      return apiFetch<StaffingEntry[]>(`/coverage/staffing`, params);
    },
  },

  // --- KNOWLEDGE BASE (RAG) ---
  knowledge: {
    list: (tenantId: string | null) =>
      apiFetch<Array<{ id: string; title: string; content: string; source: string; created_at: string }>>(`/knowledge`, tenantId ? { tenant_id: tenantId } : undefined),

    delete: (id: string, tenantId: string | null) =>
      apiMutate(`/knowledge/${id}`, 'DELETE', { tenant_id: tenantId }),

    ingest: async (tenantId: string | null, file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      if (tenantId) formData.append('tenant_id', tenantId);

      const response = await fetch(`${API_BASE_URL}/knowledge/ingest`, {
        method: 'POST',
        body: formData,
      });

      return response.json() as Promise<{ success: boolean; chunksIngested: number; error?: string }>;
    }
  },

  // --- BILLING ---
  billing: {
    checkout: (tenantId: string, plan: 'solo' | 'growth') =>
      apiMutate<{ url: string }>(`/billing/checkout`, 'POST', { tenant_id: tenantId, plan }),

    status: (tenantId: string) =>
      apiFetch<{ subscription_status: string; subscription_plan: string | null }>(`/billing/status`, { tenant_id: tenantId }),
  },

  // --- PHONE PROVISIONING ---
  provisioning: {
    activate: (tenantId: string, areaCode?: string) =>
      apiMutate<{ success: boolean; phone_number: string; assistant_id: string; phone_number_id: string }>(
        `/provisioning/activate`, 'POST',
        { tenant_id: tenantId, ...(areaCode ? { area_code: areaCode } : {}) }
      ),

    deactivate: (tenantId: string) =>
      apiMutate<{ success: boolean }>(`/provisioning/deactivate`, 'POST', { tenant_id: tenantId }),

    status: (tenantId: string) =>
      apiFetch<{ phone_status: string; inbound_phone: string | null; vapi_assistant_id: string | null }>(
        `/provisioning/status`, { tenant_id: tenantId }
      ),
  },
};
