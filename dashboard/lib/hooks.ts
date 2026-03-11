import { useState, useEffect, useCallback } from 'react';
import { Api, getLocalStorageItem, SUPER_ADMIN_TENANT_ID } from './api';

/**
 * Hook to manage session and authentication logic
 */
export function useSession() {
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [userName, setUserName] = useState<string | null>(null);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);

  useEffect(() => {
    const storedTenantId = getLocalStorageItem('tenantId');
    const storedUserName = getLocalStorageItem('userName');
    
    setTenantId(storedTenantId);
    setUserName(storedUserName);
    setIsSuperAdmin(storedTenantId === SUPER_ADMIN_TENANT_ID);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem('tenantId');
    localStorage.removeItem('userName');
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
  const [customers, setCustomers] = useState<any[]>([]);
  const [resources, setResources] = useState<any[]>([]);
  const [employees, setEmployees] = useState<any[]>([]);
  const [services, setServices] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!tenantId) return;
    
    setLoading(true);
    setError(null);
    try {
      const [cRes, rRes, eRes, sRes] = await Promise.all([
        Api.customers.list(tenantId),
        Api.resources.list(tenantId),
        Api.employees.list(tenantId),
        Api.services.list(tenantId)
      ]);
      
      setCustomers(Array.isArray(cRes) ? cRes : []);
      setResources(Array.isArray(rRes) ? rRes : []);
      setEmployees(Array.isArray(eRes) ? eRes : []);
      setServices(Array.isArray(sRes) ? sRes : []);
    } catch (err: any) {
      console.error('Failed to fetch static data', err);
      setError(err.message || 'Failed to fetch data');
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return {
    customers,
    resources,
    employees,
    services,
    loading,
    error,
    refresh: fetchData
  };
}
