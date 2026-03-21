import { normalizePhone } from './phone'

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
 * Generic Fetcher
 */
export async function apiFetch<T>(endpoint: string, params?: Record<string, string>): Promise<T> {
  let url = `${API_BASE_URL}${endpoint}`;
  if (params) {
    const searchParams = new URLSearchParams(params);
    url += `?${searchParams.toString()}`;
  }

  const response = await fetch(url, { headers: getHeaders() });

  // Auto-logout on expired/invalid token
  if (response.status === 401) {
    if (typeof window !== 'undefined') {
      localStorage.removeItem('tenantId');
      localStorage.removeItem('userName');
      localStorage.removeItem('authToken');
      window.location.href = '/';
    }
    throw new Error('Session expired. Please log in again.');
  }

  // Auto-logout if tenant no longer exists
  if (response.status === 404) {
    try {
      const body = await response.clone().json();
      if (body.code === 'TENANT_NOT_FOUND' && typeof window !== 'undefined') {
        localStorage.removeItem('tenantId');
        localStorage.removeItem('userName');
        localStorage.removeItem('authToken');
        window.location.href = '/';
        throw new Error('Your business account was not found. Please log in again.');
      }
    } catch {
      // Not a JSON response or not tenant error — fall through
    }
  }

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

  // Auto-logout on expired/invalid token
  if (response.status === 401) {
    if (typeof window !== 'undefined') {
      localStorage.removeItem('tenantId');
      localStorage.removeItem('userName');
      localStorage.removeItem('authToken');
      window.location.href = '/';
    }
    return { success: false, error: 'Session expired. Please log in again.' } as { success: boolean; error?: string } & T;
  }

  // Auto-logout if tenant no longer exists
  if (response.status === 404) {
    const data = await response.clone().json().catch(() => null);
    if (data?.code === 'TENANT_NOT_FOUND' && typeof window !== 'undefined') {
      localStorage.removeItem('tenantId');
      localStorage.removeItem('userName');
      localStorage.removeItem('authToken');
      window.location.href = '/';
      return { success: false, error: 'Your business account was not found.' } as { success: boolean; error?: string } & T;
    }
  }

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
      apiFetch<Record<string, unknown>[]>(`/customers`, tenantId ? { tenant_id: tenantId } : undefined),
    
    create: (tenantId: string | null, data: Record<string, unknown>) => 
      apiMutate<Record<string, unknown>>(`/customers/create`, 'POST', { 
        tenant_id: tenantId, 
        ...data,
        phone: normalizePhone(data.phone)
      }),
    
    update: (id: string, entityTenantId: string, data: Record<string, unknown>) => 
      apiMutate<Record<string, unknown>>(`/customers/${id}`, 'PUT', { 
        tenant_id: getTargetTenantId(entityTenantId), 
        ...data,
        phone: normalizePhone(data.phone)
      }),
    
    delete: (id: string) =>
      apiMutate<Record<string, unknown>>(`/customers/${id}`, 'DELETE'),

    appointments: (customerId: string, tenantId: string | null) =>
      apiFetch<Record<string, unknown>[]>(`/customers/${customerId}/appointments`, tenantId ? { tenant_id: tenantId } : undefined),
  },

  // --- APPOINTMENTS ---
  appointments: {
    list: (tenantId: string | null, opts?: { startDate?: string; endDate?: string }) => {
      const params: Record<string, string> = {};
      if (tenantId) params.tenant_id = tenantId;
      if (opts?.startDate) params.start_date = opts.startDate;
      if (opts?.endDate) params.end_date = opts.endDate;
      return apiFetch<Record<string, unknown>[]>(`/appointments`, Object.keys(params).length > 0 ? params : undefined);
    },
    
    create: (tenantId: string | null, data: Record<string, unknown>) => 
      apiMutate<Record<string, unknown>>(`/appointments/create`, 'POST', { 
        tenant_id: tenantId, 
        ...data,
        customer_phone: normalizePhone(data.customer_phone)
      }),
    
    update: (id: string, entityTenantId: string, data: Record<string, unknown>) => 
      apiMutate<Record<string, unknown>>(`/appointments/${id}/update`, 'POST', { 
        tenant_id: getTargetTenantId(entityTenantId), 
        ...data,
        customer_phone: normalizePhone(data.customer_phone)
      }),
    
    delete: (id: string) =>
      apiMutate<Record<string, unknown>>(`/appointments/${id}`, 'DELETE'),

    cancel: (id: string, tenantId: string | null) =>
      apiMutate<Record<string, unknown>>(`/appointments/${id}/cancel`, 'POST', { tenant_id: tenantId }),
  },

  // --- RESOURCES ---
  resources: {
    list: (tenantId: string | null) => 
      apiFetch<Record<string, unknown>[]>(`/resources`, tenantId ? { tenant_id: tenantId } : undefined),
    
    create: (tenantId: string | null, data: Record<string, unknown>) => 
      apiMutate<Record<string, unknown>>(`/resources/create`, 'POST', { tenant_id: tenantId, ...data }),
    
    update: (id: string, data: Record<string, unknown>, tenantId?: string | null) =>
      apiMutate<Record<string, unknown>>(`/resources/${id}/update`, 'POST', { tenant_id: tenantId, ...data }),

    delete: (id: string, tenantId?: string | null) =>
      apiMutate<Record<string, unknown>>(`/resources/${id}/delete`, 'DELETE', { tenant_id: tenantId }),
  },

  // --- EMPLOYEES ---
  employees: {
    list: (tenantId: string | null) => 
      apiFetch<Record<string, unknown>[]>(`/employees`, tenantId ? { tenant_id: tenantId } : undefined),
    
    create: (tenantId: string | null, data: Record<string, unknown>) => 
      apiMutate<Record<string, unknown>>(`/employees/create`, 'POST', { tenant_id: tenantId, ...data }),
    
    update: (id: string | number, data: Record<string, unknown>) =>
      apiMutate<Record<string, unknown>>(`/employees/${id}/update`, 'POST', data),
    
    delete: (id: string | number, tenantId: string | null) =>
      apiMutate<Record<string, unknown>>(`/employees/${id}/delete`, 'DELETE', { tenant_id: tenantId }),
  },

  // --- MAPPINGS ---
  mappings: {
    listServiceResource: (tenantId: string | null) => 
      apiFetch<Record<string, unknown>[]>(`/mappings/service-resource`, tenantId ? { tenant_id: tenantId } : undefined),
    
    assignServiceResource: (serviceId: string | number, resourceId: string, tenantId: string | null) => 
      apiMutate<Record<string, unknown>>(`/services/${serviceId}/resources/${resourceId}/assign`, 'POST', { tenant_id: tenantId }),
    
    unassignServiceResource: (serviceId: string | number, resourceId: string, tenantId: string | null) => 
      apiMutate<Record<string, unknown>>(`/services/${serviceId}/resources/${resourceId}/unassign`, 'POST', { tenant_id: tenantId }),

    assignServiceEmployee: (serviceId: string | number, employeeId: string | number, tenantId: string | null) => 
      apiMutate<Record<string, unknown>>(`/services/${serviceId}/employees/${employeeId}/assign`, 'POST', { tenant_id: tenantId }),
    
    unassignServiceEmployee: (serviceId: string | number, employeeId: string | number, tenantId: string | null) => 
      apiMutate<Record<string, unknown>>(`/services/${serviceId}/employees/${employeeId}/unassign`, 'POST', { tenant_id: tenantId }),

    listServiceEmployee: (tenantId: string | null) => 
      apiFetch<Record<string, unknown>[]>(`/mappings/service-employee`, tenantId ? { tenant_id: tenantId } : undefined),
  },

  // --- SERVICES ---
  services: {
    list: (tenantId: string | null) => 
      apiFetch<Record<string, unknown>[]>(`/services`, tenantId ? { tenant_id: tenantId } : undefined),
    
    create: (tenantId: string | null, data: Record<string, unknown>) =>
      apiMutate<Record<string, unknown>>(`/services/create`, 'POST', { tenant_id: tenantId, ...data }),

    update: (id: string | number, tenantId: string | null, data: Record<string, unknown>) =>
      apiMutate<Record<string, unknown>>(`/services/${id}/update`, 'POST', { tenant_id: tenantId, ...data }),

    delete: (id: string | number, tenantId: string | null) =>
      apiMutate<Record<string, unknown>>(`/services/${id}/delete?tenant_id=${tenantId}`, 'DELETE'),
  },

    // --- SHIFTS ---
    shifts: {
    list: (tenantId: string | null) => 
      apiFetch<Record<string, unknown>[]>(`/shifts`, tenantId ? { tenant_id: tenantId } : undefined),

    create: (tenantId: string | null, data: Record<string, unknown>) => 
      apiMutate<Record<string, unknown>>(`/shifts/create`, 'POST', { tenant_id: tenantId, ...data }),

    update: (id: number, tenantId: string | null, data: Record<string, unknown>) =>
      apiMutate<Record<string, unknown>>(`/shifts/${id}/update`, 'POST', { tenant_id: tenantId, ...data }),

    delete: (id: number, tenantId: string | null) =>
      apiMutate<Record<string, unknown>>(`/shifts/${id}${tenantId ? `?tenant_id=${tenantId}` : ''}`, 'DELETE'),
    },

    // --- CALENDAR SYNC ---
    calendar: {
    getSettings: (tenantId: string | null) => 
      apiFetch<Record<string, unknown>>(`/calendar/settings`, tenantId ? { tenant_id: tenantId } : undefined),

    updateSettings: (tenantId: string | null, data: Record<string, unknown>) => 
      apiMutate<Record<string, unknown>>(`/calendar/settings`, 'POST', { tenant_id: tenantId, ...data }),

    disconnect: (tenantId: string | null) => 
      apiMutate<Record<string, unknown>>(`/calendar/settings/disconnect`, 'POST', { tenant_id: tenantId }),
    },

    // --- ANALYTICS ---
    analytics: {
    getStats: (tenantId: string | null) => 
      apiFetch<Record<string, unknown>>(`/analytics/stats`, tenantId ? { tenant_id: tenantId } : undefined),
    },

    // --- MASTER SKILLS ---
    skills: {
    list: (tenantId: string | null) => 
      apiFetch<Record<string, unknown>[]>(`/skills`, tenantId ? { tenant_id: tenantId } : undefined),

    create: (tenantId: string | null, data: Record<string, unknown>) => 
      apiMutate<Record<string, unknown>>(`/skills/create`, 'POST', { tenant_id: tenantId, ...data }),

    delete: (id: number, tenantId: string | null) => 
      apiMutate<Record<string, unknown>>(`/skills/${id}`, 'DELETE', tenantId ? { tenant_id: tenantId } : undefined),
    },

    // --- TENANTS & TEMPLATES ---
  tenants: {
    list: () => apiFetch<Record<string, unknown>[]>(`/tenants`),
    getConfig: (tenantId: string | null) => apiFetch<Record<string, unknown>>(`/tenants/${tenantId}/config`),
    update: (id: string, data: Record<string, unknown>) => apiMutate<Record<string, unknown>>(`/tenants/${id}/update-attributes`, 'POST', data),
    updateConfig: (id: string, data: Record<string, unknown>) => apiMutate<Record<string, unknown>>(`/tenants/${id}/update-config`, 'POST', data),
    delete: (id: string) => apiMutate<Record<string, unknown>>(`/tenants/${id}`, 'DELETE'),
    create: (data: Record<string, unknown>) => apiMutate<Record<string, unknown>>(`/tenants/create`, 'POST', data),
    reorder: (order: string[]) => apiMutate<Record<string, unknown>>(`/tenants/reorder`, 'POST', { order }),
  },
  
  templates: {
    list: () => apiFetch<Record<string, unknown>[]>(`/templates`),
    listFull: () => apiFetch<Record<string, unknown>[]>(`/templates/full`),
  },

  // --- CALL SUMMARIES ---
  callSummaries: {
    list: (tenantId: string | null, customerId: string) =>
      apiFetch<Record<string, unknown>[]>(`/call-summaries`, tenantId ? { tenant_id: tenantId, customer_id: customerId } : { customer_id: customerId }),
  },

  // --- VOCABULARY ---
  vocabulary: {
    get: (tenantId: string | null) =>
      apiFetch<{ resource_label: string; resource_plural: string; employee_label: string; employee_plural: string; booking_label: string }>(
        `/vocabulary`, tenantId ? { tenant_id: tenantId } : undefined
      ),
  },

  // --- COVERAGE ---
  coverage: {
    check: (tenantId: string | null, startDate?: string, endDate?: string) => {
      const params: Record<string, string> = {};
      if (tenantId) params.tenant_id = tenantId;
      if (startDate) params.start_date = startDate;
      if (endDate) params.end_date = endDate;
      return apiFetch<Array<{
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
      }>>(`/coverage`, params);
    },
  },

  // --- KNOWLEDGE BASE (RAG) ---
  knowledge: {
    list: (tenantId: string | null) => 
      apiFetch<Record<string, unknown>[]>(`/knowledge`, tenantId ? { tenant_id: tenantId } : undefined),
    
    delete: (id: string, tenantId: string | null) => 
      apiMutate<Record<string, unknown>>(`/knowledge/${id}`, 'DELETE', { tenant_id: tenantId }),
    
    ingest: async (tenantId: string | null, file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      if (tenantId) formData.append('tenant_id', tenantId);

      const response = await fetch(`${API_BASE_URL}/knowledge/ingest`, {
        method: 'POST',
        body: formData, // No JSON headers for multipart/form-data
      });

      return response.json();
    }
  },

  // --- BILLING ---
  billing: {
    checkout: (tenantId: string, plan: 'solo' | 'growth') =>
      apiMutate<{ url: string }>(`/billing/checkout`, 'POST', { tenant_id: tenantId, plan }),

    status: (tenantId: string) =>
      apiFetch<{ subscription_status: string; subscription_plan: string | null }>(`/billing/status`, { tenant_id: tenantId }),
  },
};
