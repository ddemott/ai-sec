import React, { useState, useEffect } from 'react';
import { API_BASE_URL } from '../lib/api';

export default function EmployeeManagementView() {
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [employees, setEmployees] = useState<Array<{ id: string; name: string; skills: string[]; is_active: boolean }>>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newEmployee, setNewEmployee] = useState({ name: '', skills: '' });

  useEffect(() => {
    const tid = localStorage.getItem('tenantId');
    if (tid) {
      setTenantId(tid);
      fetchEmployees(tid);
    }
  }, []);

  async function fetchEmployees(id: string) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE_URL}/employees?tenant_id=${id}`);
      if (!res.ok) throw new Error('Failed to fetch employees');
      const data = await res.json();
      setEmployees(Array.isArray(data) ? data : []);
    } catch {
      setError('Could not load employees for this business.');
    } finally {
      setLoading(false);
    }
  }

  async function handleCreateEmployee(e: React.FormEvent) {
    e.preventDefault();
    if (!tenantId || !newEmployee.name.trim()) return;
    setError(null);
    try {
      const res = await fetch(`${API_BASE_URL}/employees/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenant_id: tenantId,
          name: newEmployee.name.trim(),
          skills: newEmployee.skills.split(',').map(s => s.trim()).filter(Boolean)
        })
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Failed to create employee');
      if (data.employee) {
        setEmployees(prev => [...prev, data.employee]);
      } else {
        fetchEmployees(tenantId);
      }
      setNewEmployee({ name: '', skills: '' });
    } catch {
      setError('Failed to create employee');
    }
  }

  return (
    <div className="bg-white dark:bg-[#111] p-8 rounded-3xl text-gray-900 dark:text-gray-100">
      <h2 className="text-lg font-bold mb-4">Employee Management</h2>
      <form onSubmit={handleCreateEmployee} className="flex flex-col md:flex-row gap-3 mb-6">
        <input
          type="text"
          placeholder="Employee Name"
          value={newEmployee.name}
          onChange={e => setNewEmployee(prev => ({ ...prev, name: e.target.value }))}
          className="flex-1 p-2.5 bg-white dark:bg-[#222] border border-gray-300 dark:border-gray-700 rounded-lg text-sm outline-none dark:text-gray-100"
        />
        <input
          type="text"
          placeholder="Skills (comma separated)"
          value={newEmployee.skills}
          onChange={e => setNewEmployee(prev => ({ ...prev, skills: e.target.value }))}
          className="flex-1 p-2.5 bg-white dark:bg-[#222] border border-gray-300 dark:border-gray-700 rounded-lg text-sm outline-none dark:text-gray-100"
        />
        <button
          type="submit"
          disabled={!tenantId || !newEmployee.name.trim()}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 whitespace-nowrap"
        >
          Add Employee
        </button>
      </form>
      {error && <div className="mb-4 text-sm text-red-600 dark:text-red-400">{error}</div>}
      <div className="border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden">
        <div className="bg-gray-100 dark:bg-[#222] px-4 py-2 text-xs font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400 flex justify-between">
          <span>Name</span>
          <span>Skills</span>
          <span>Status</span>
        </div>
        {loading ? (
          <div className="p-4 text-sm text-gray-500 dark:text-gray-400">Loading employees...</div>
        ) : employees.length === 0 ? (
          <div className="p-4 text-sm text-gray-500 dark:text-gray-400">No employees yet. Add your first employee above.</div>
        ) : (
          employees.map(e => (
            <div key={e.id} className="px-4 py-3 border-t border-gray-100 dark:border-gray-800 flex items-center justify-between text-sm">
              <div className="font-semibold text-gray-900 dark:text-gray-100">{e.name}</div>
              <div className="text-xs text-gray-500 dark:text-gray-400">{e.skills.join(', ')}</div>
              <div className={e.is_active ? 'text-green-600' : 'text-gray-400'}>{e.is_active ? 'Active' : 'Inactive'}</div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
