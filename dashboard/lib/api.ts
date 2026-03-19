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

  // BUG-012: Auto-logout on expired/invalid token
  if (response.status === 401) {
    if (typeof window !== 'undefined') {
      localStorage.removeItem('tenantId');
      localStorage.removeItem('userName');
      localStorage.removeItem('authToken');
      window.location.href = '/';
    }
    throw new Error('Session expired. Please log in again.');
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
  body?: any
): Promise<{ success: boolean; error?: string } & T> {
  const url = `${API_BASE_URL}${endpoint}`;
  
  const response = await fetch(url, {
    method,
    headers: getHeaders(),
    body: body ? JSON.stringify(body) : undefined,
  });

  // BUG-012: Auto-logout on expired/invalid token
  if (response.status === 401) {
    if (typeof window !== 'undefined') {
      localStorage.removeItem('tenantId');
      localStorage.removeItem('userName');
      localStorage.removeItem('authToken');
      window.location.href = '/';
    }
    return { success: false, error: 'Session expired. Please log in again.' } as any;
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
      apiFetch<any[]>(`/customers`, tenantId ? { tenant_id: tenantId } : undefined),
    
    create: (tenantId: string | null, data: any) => 
      apiMutate<any>(`/customers/create`, 'POST', { 
        tenant_id: tenantId, 
        ...data,
        phone: normalizePhone(data.phone)
      }),
    
    update: (id: string, entityTenantId: string, data: any) => 
      apiMutate<any>(`/customers/${id}`, 'PUT', { 
        tenant_id: getTargetTenantId(entityTenantId), 
        ...data,
        phone: normalizePhone(data.phone)
      }),
    
    delete: (id: string) =>
      apiMutate<any>(`/customers/${id}`, 'DELETE'),

    appointments: (customerId: string, tenantId: string | null) =>
      apiFetch<any[]>(`/customers/${customerId}/appointments`, tenantId ? { tenant_id: tenantId } : undefined),
  },

  // --- APPOINTMENTS ---
  appointments: {
    list: (tenantId: string | null, opts?: { startDate?: string; endDate?: string }) => {
      const params: Record<string, string> = {};
      if (tenantId) params.tenant_id = tenantId;
      if (opts?.startDate) params.start_date = opts.startDate;
      if (opts?.endDate) params.end_date = opts.endDate;
      return apiFetch<any[]>(`/appointments`, Object.keys(params).length > 0 ? params : undefined);
    },
    
    create: (tenantId: string | null, data: any) => 
      apiMutate<any>(`/appointments/create`, 'POST', { 
        tenant_id: tenantId, 
        ...data,
        customer_phone: normalizePhone(data.customer_phone)
      }),
    
    update: (id: string, entityTenantId: string, data: any) => 
      apiMutate<any>(`/appointments/${id}/update`, 'POST', { 
        tenant_id: getTargetTenantId(entityTenantId), 
        ...data,
        customer_phone: normalizePhone(data.customer_phone)
      }),
    
    delete: (id: string) =>
      apiMutate<any>(`/appointments/${id}`, 'DELETE'),

    cancel: (id: string, tenantId: string | null) =>
      apiMutate<any>(`/appointments/${id}/cancel`, 'POST', { tenant_id: tenantId }),
  },

  // --- RESOURCES ---
  resources: {
    list: (tenantId: string | null) => 
      apiFetch<any[]>(`/resources`, tenantId ? { tenant_id: tenantId } : undefined),
    
    create: (tenantId: string | null, data: any) => 
      apiMutate<any>(`/resources/create`, 'POST', { tenant_id: tenantId, ...data }),
    
    update: (id: string, data: any, tenantId?: string | null) =>
      apiMutate<any>(`/resources/${id}/update`, 'POST', { tenant_id: tenantId, ...data }),

    delete: (id: string, tenantId?: string | null) =>
      apiMutate<any>(`/resources/${id}/delete`, 'DELETE', { tenant_id: tenantId }),
  },

  // --- EMPLOYEES ---
  employees: {
    list: (tenantId: string | null) => 
      apiFetch<any[]>(`/employees`, tenantId ? { tenant_id: tenantId } : undefined),
    
    create: (tenantId: string | null, data: any) => 
      apiMutate<any>(`/employees/create`, 'POST', { tenant_id: tenantId, ...data }),
    
    update: (id: number, data: any) => 
      apiMutate<any>(`/employees/${id}/update`, 'POST', data),
    
    delete: (id: number, tenantId: string | null) => 
      apiMutate<any>(`/employees/${id}/delete`, 'DELETE', { tenant_id: tenantId }),
  },

  // --- MAPPINGS ---
  mappings: {
    listServiceResource: (tenantId: string | null) => 
      apiFetch<any[]>(`/mappings/service-resource`, tenantId ? { tenant_id: tenantId } : undefined),
    
    assignServiceResource: (serviceId: number, resourceId: string, tenantId: string | null) => 
      apiMutate<any>(`/services/${serviceId}/resources/${resourceId}/assign`, 'POST', { tenant_id: tenantId }),
    
    unassignServiceResource: (serviceId: number, resourceId: string, tenantId: string | null) => 
      apiMutate<any>(`/services/${serviceId}/resources/${resourceId}/unassign`, 'POST', { tenant_id: tenantId }),

    assignServiceEmployee: (serviceId: number, employeeId: string | number, tenantId: string | null) => 
      apiMutate<any>(`/services/${serviceId}/employees/${employeeId}/assign`, 'POST', { tenant_id: tenantId }),
    
    unassignServiceEmployee: (serviceId: number, employeeId: string | number, tenantId: string | null) => 
      apiMutate<any>(`/services/${serviceId}/employees/${employeeId}/unassign`, 'POST', { tenant_id: tenantId }),

    listServiceEmployee: (tenantId: string | null) => 
      apiFetch<any[]>(`/mappings/service-employee`, tenantId ? { tenant_id: tenantId } : undefined),
  },

  // --- SERVICES ---
  services: {
    list: (tenantId: string | null) => 
      apiFetch<any[]>(`/services`, tenantId ? { tenant_id: tenantId } : undefined),
    
    create: (tenantId: string | null, data: any) =>
      apiMutate<any>(`/services/create`, 'POST', { tenant_id: tenantId, ...data }),

    update: (id: number, tenantId: string | null, data: any) =>
      apiMutate<any>(`/services/${id}/update`, 'POST', { tenant_id: tenantId, ...data }),

    delete: (id: number, tenantId: string | null) =>
      apiMutate<any>(`/services/${id}/delete`, 'DELETE', { tenant_id: tenantId }),
  },

    // --- SHIFTS ---
    shifts: {
    list: (tenantId: string | null) => 
      apiFetch<any[]>(`/shifts`, tenantId ? { tenant_id: tenantId } : undefined),

    create: (tenantId: string | null, data: any) => 
      apiMutate<any>(`/shifts/create`, 'POST', { tenant_id: tenantId, ...data }),

    update: (id: number, tenantId: string | null, data: any) =>
      apiMutate<any>(`/shifts/${id}/update`, 'POST', { tenant_id: tenantId, ...data }),

    delete: (id: number, tenantId: string | null) =>
      apiMutate<any>(`/shifts/${id}`, 'DELETE', tenantId ? { tenant_id: tenantId } : undefined),
    },

    // --- CALENDAR SYNC ---
    calendar: {
    getSettings: (tenantId: string | null) => 
      apiFetch<any>(`/calendar/settings`, tenantId ? { tenant_id: tenantId } : undefined),

    updateSettings: (tenantId: string | null, data: any) => 
      apiMutate<any>(`/calendar/settings`, 'POST', { tenant_id: tenantId, ...data }),

    disconnect: (tenantId: string | null) => 
      apiMutate<any>(`/calendar/settings/disconnect`, 'POST', { tenant_id: tenantId }),
    },

    // --- ANALYTICS ---
    analytics: {
    getStats: (tenantId: string | null) => 
      apiFetch<any>(`/analytics/stats`, tenantId ? { tenant_id: tenantId } : undefined),
    },

    // --- MASTER SKILLS ---
    skills: {
    list: (tenantId: string | null) => 
      apiFetch<any[]>(`/skills`, tenantId ? { tenant_id: tenantId } : undefined),

    create: (tenantId: string | null, data: any) => 
      apiMutate<any>(`/skills/create`, 'POST', { tenant_id: tenantId, ...data }),

    delete: (id: number, tenantId: string | null) => 
      apiMutate<any>(`/skills/${id}`, 'DELETE', tenantId ? { tenant_id: tenantId } : undefined),
    },

    // --- TENANTS & TEMPLATES ---
  tenants: {
    list: () => apiFetch<any[]>(`/tenants`),
    getConfig: (tenantId: string | null) => apiFetch<any>(`/tenants/${tenantId}/config`),
    update: (id: string, data: any) => apiMutate<any>(`/tenants/${id}/update-attributes`, 'POST', data),
    updateConfig: (id: string, data: any) => apiMutate<any>(`/tenants/${id}/update-config`, 'POST', data),
    delete: (id: string) => apiMutate<any>(`/tenants/${id}`, 'DELETE'),
    create: (data: any) => apiMutate<any>(`/tenants/create`, 'POST', data),
  },
  
  templates: {
    list: () => apiFetch<any[]>(`/templates`),
    listFull: () => apiFetch<any[]>(`/templates/full`),
  },

  // --- CALL SUMMARIES ---
  callSummaries: {
    list: (tenantId: string | null, customerId: string) =>
      apiFetch<any[]>(`/call-summaries`, tenantId ? { tenant_id: tenantId, customer_id: customerId } : { customer_id: customerId }),
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
      apiFetch<any[]>(`/knowledge`, tenantId ? { tenant_id: tenantId } : undefined),
    
    delete: (id: string, tenantId: string | null) => 
      apiMutate<any>(`/knowledge/${id}`, 'DELETE', { tenant_id: tenantId }),
    
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
  }
};
