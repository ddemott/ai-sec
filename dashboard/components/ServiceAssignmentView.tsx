import React, { useState, useEffect } from 'react';
import { API_BASE_URL } from '../lib/api';

export default function ServiceAssignmentView() {
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [services, setServices] = useState<Array<{ id: string; name: string }>>([]);
  const [employees, setEmployees] = useState<Array<{ id: string; name: string }>>([]);
  const [resources, setResources] = useState<Array<{ id: string; name: string }>>([]);
  const [assignments, setAssignments] = useState<Record<string, { employeeIds: string[]; resourceIds: string[] }>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const tid = localStorage.getItem('tenantId');
    if (tid) {
      setTenantId(tid);
      fetchAll(tid);
    }
  }, []);

  async function fetchAll(id: string) {
    setLoading(true);
    setError(null);
    try {
      const [svcRes, empRes, resRes] = await Promise.all([
        fetch(`${API_BASE_URL}/services?tenant_id=${id}`),
        fetch(`${API_BASE_URL}/employees?tenant_id=${id}`),
        fetch(`${API_BASE_URL}/resources?tenant_id=${id}`)
      ]);
      const [svc, emp, res] = await Promise.all([
        svcRes.json(), empRes.json(), resRes.json()
      ]);
      setServices(Array.isArray(svc) ? svc : []);
      setEmployees(Array.isArray(emp) ? emp : []);
      setResources(Array.isArray(res) ? res : []);
      // Optionally fetch assignments
      const assignRes = await fetch(`${API_BASE_URL}/service_assignments?tenant_id=${id}`);
      const assignData = await assignRes.json();
      setAssignments(assignData || {});
    } catch {
      setError('Failed to load service assignments');
    } finally {
      setLoading(false);
    }
  }

  async function handleAssignmentChange(serviceId: string, employeeIds: string[], resourceIds: string[]) {
    setError(null);
    try {
      const res = await fetch(`${API_BASE_URL}/service_assignments/update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenant_id: tenantId,
          service_id: serviceId,
          employee_ids: employeeIds,
          resource_ids: resourceIds
        })
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Failed to update assignments');
      setAssignments(prev => ({ ...prev, [serviceId]: { employeeIds, resourceIds } }));
    } catch {
      setError('Failed to update assignments');
    }
  }

  return (
    <div className="bg-white dark:bg-[#111] p-8 rounded-3xl text-gray-900 dark:text-gray-100">
      <h2 className="text-lg font-bold mb-4">Service Assignment</h2>
      {error && <div className="mb-4 text-sm text-red-600 dark:text-red-400">{error}</div>}
      {loading ? (
        <div className="p-4 text-sm text-gray-500 dark:text-gray-400">Loading assignments...</div>
      ) : services.length === 0 ? (
        <div className="p-4 text-sm text-gray-500 dark:text-gray-400">No services found. Add services first.</div>
      ) : (
        services.map(svc => (
          <div key={svc.id} className="mb-6 border border-gray-200 dark:border-gray-800 rounded-xl p-4">
            <div className="font-semibold text-gray-900 dark:text-gray-100 mb-2">{svc.name}</div>
            <div className="flex flex-col md:flex-row gap-4">
              <div className="flex-1">
                <label className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase mb-1">Assign Employees</label>
                <select
                  multiple
                  value={assignments[svc.id]?.employeeIds || []}
                  onChange={e => {
                    const selected = Array.from(e.target.selectedOptions).map(o => o.value);
                    handleAssignmentChange(svc.id, selected, assignments[svc.id]?.resourceIds || []);
                  }}
                  className="w-full p-2 bg-white dark:bg-[#222] border border-gray-300 dark:border-gray-700 rounded-lg text-sm"
                >
                  {employees.map(emp => (
                    <option key={emp.id} value={emp.id}>{emp.name}</option>
                  ))}
                </select>
              </div>
              <div className="flex-1">
                <label className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase mb-1">Assign Resources</label>
                <select
                  multiple
                  value={assignments[svc.id]?.resourceIds || []}
                  onChange={e => {
                    const selected = Array.from(e.target.selectedOptions).map(o => o.value);
                    handleAssignmentChange(svc.id, assignments[svc.id]?.employeeIds || [], selected);
                  }}
                  className="w-full p-2 bg-white dark:bg-[#222] border border-gray-300 dark:border-gray-700 rounded-lg text-sm"
                >
                  {resources.map(res => (
                    <option key={res.id} value={res.id}>{res.name}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        ))
      )}
    </div>
  );
}
