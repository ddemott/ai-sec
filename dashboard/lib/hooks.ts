import { useState, useEffect, useCallback } from 'react';
import { Api } from './api';
import { useActiveTenantId } from '@/lib/SessionContext';
import type { Customer, Resource, Employee, Service, Skill } from './types';

/**
 * Generic form state hook. Manages form fields, dirty tracking, and reset.
 * Eliminates the repeated useState + handleChange pattern across CRUD views.
 *
 * Usage:
 *   const { form, setField, setForm, reset, isDirty } = useFormState({ name: '', email: '' });
 *   <Input value={form.name} onChange={e => setField('name', e.target.value)} />
 */
export function useFormState<T extends Record<string, unknown>>(initialState: T) {
  const [form, setForm] = useState<T>(initialState);
  const [original, setOriginal] = useState<T>(initialState);

  const setField = useCallback(<K extends keyof T>(key: K, value: T[K]) => {
    setForm(prev => ({ ...prev, [key]: value }));
  }, []);

  const reset = useCallback((newState?: T) => {
    const state = newState ?? original;
    setForm(state);
    setOriginal(state);
  }, [original]);

  const isDirty = JSON.stringify(form) !== JSON.stringify(original);

  return { form, setField, setForm, reset, isDirty };
}

/**
 * Hook to fetch and manage static data for the active tenant.
 * Automatically uses the active tenant ID from SessionContext.
 */
export function useStaticData(tenantIdOverride?: string | null) {
  const contextTenantId = useActiveTenantId();
  const tenantId = tenantIdOverride !== undefined ? tenantIdOverride : contextTenantId;
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [resources, setResources] = useState<Resource[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
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
