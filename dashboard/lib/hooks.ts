import { useState, useEffect, useCallback } from 'react';
import { Api, getLocalStorageItem, SUPER_ADMIN_TENANT_ID } from './api';

/**
 * Hook to manage session and authentication logic
 */
export function useSession(overrideTenantId?: string | null) {
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [userName, setUserName] = useState<string | null>(null);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);

  useEffect(() => {
    // If override provided, use it. Otherwise use localStorage
    if (overrideTenantId) {
      setTenantId(overrideTenantId);
      const storedUserName = getLocalStorageItem('userName');
      setUserName(storedUserName);
      const storedTenantId = getLocalStorageItem('tenantId');
      setIsSuperAdmin(storedTenantId === SUPER_ADMIN_TENANT_ID);
    } else {
      const storedTenantId = getLocalStorageItem('tenantId');
      const storedUserName = getLocalStorageItem('userName');
      
      setTenantId(storedTenantId);
      setUserName(storedUserName);
      setIsSuperAdmin(storedTenantId === SUPER_ADMIN_TENANT_ID);
    }
  }, [overrideTenantId]);

  const logout = useCallback(() => {
    localStorage.removeItem('tenantId');
    localStorage.removeItem('userName');
    localStorage.removeItem('authToken');
    setTenantId(null);
    setUserName(null);
    setIsSuperAdmin(false);
    window.location.href = '/';
  }, []);

  return {
    tenantId,
    userName,
    isSuperAdmin,
    logout
  };
}

/**
 * Hook to fetch and manage static data for a tenant
 */
export function useStaticData(tenantId: string | null) {
  const [customers, setCustomers] = useState<Record<string, unknown>[]>([]);
  const [resources, setResources] = useState<Record<string, unknown>[]>([]);
  const [employees, setEmployees] = useState<Record<string, unknown>[]>([]);
  const [services, setServices] = useState<Record<string, unknown>[]>([]);
  const [skills, setSkills] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!tenantId) return;

    setLoading(true);
    setError(null);

    const [cRes, rRes, eRes, sRes, skRes] = await Promise.allSettled([
      Api.customers.list(tenantId),
      Api.resources.list(tenantId),
      Api.employees.list(tenantId),
      Api.services.list(tenantId),
      Api.skills.list(tenantId),
    ]);

    setCustomers(cRes.status === 'fulfilled' && Array.isArray(cRes.value) ? cRes.value : []);
    setResources(rRes.status === 'fulfilled' && Array.isArray(rRes.value) ? rRes.value : []);
    setEmployees(eRes.status === 'fulfilled' && Array.isArray(eRes.value) ? eRes.value : []);
    setServices(sRes.status === 'fulfilled' && Array.isArray(sRes.value) ? sRes.value : []);
    setSkills(skRes.status === 'fulfilled' && Array.isArray(skRes.value) ? skRes.value : []);

    const failures = [cRes, rRes, eRes, sRes, skRes].filter(r => r.status === 'rejected');
    if (failures.length > 0) {
      const firstError = (failures[0] as PromiseRejectedResult).reason;
      console.error('Some data fetches failed', failures);
      setError(firstError?.message || 'Some data failed to load');
    }

    setLoading(false);
  }, [tenantId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return {
    customers,
    resources,
    employees,
    services,
    skills,
    loading,
    error,
    refresh: fetchData
  };
}
