import React, { useEffect, useState } from 'react';
import { API_BASE_URL } from '../lib/api';
type Resource = {
  id: string;
  name: string;
  description: string;
};

function getTenantId() {
  if (typeof window !== 'undefined') {
    return localStorage.getItem('tenantId') || '';
  }
  return '';
}

export default function ResourceManagerView() {
  const [resources, setResources] = useState<Resource[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newResource, setNewResource] = useState({ name: '', description: '' });
  const [editResourceId, setEditResourceId] = useState<string | null>(null);
  const [editResource, setEditResource] = useState({ name: '', description: '' });

  const tenantId = getTenantId();

  // Fetch resources
  useEffect(() => {
    async function fetchResources() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`${API_BASE_URL}/resources?tenant_id=${tenantId}`);
        const data = await res.json();
        setResources(Array.isArray(data) ? data : []);
      } catch (err) {
        setError('Failed to fetch resources');
      } finally {
        setLoading(false);
      }
    }
    fetchResources();
  }, [tenantId]);

  // Create resource
  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const res = await fetch(`${API_BASE_URL}/resources/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenant_id: tenantId, ...newResource }),
      });
      const data = await res.json();
      if (data.success) {
        setResources([...resources, data.resource as Resource]);
        setNewResource({ name: '', description: '' });
      } else {
        setError(data.error || 'Failed to create resource');
      }
    } catch {
      setError('Failed to create resource');
    }
  }

  // Update resource
  async function handleUpdate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const res = await fetch(`${API_BASE_URL}/resources/${editResourceId}/update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editResource),
      });
      const data = await res.json();
      if (data.success) {
        setResources(resources.map(r => r.id === editResourceId ? { ...r, ...editResource } : r));
        setEditResourceId(null);
        setEditResource({ name: '', description: '' });
      } else {
        setError(data.error || 'Failed to update resource');
      }
    } catch {
      setError('Failed to update resource');
    }
  }

  // Delete resource
  async function handleDelete(id: string) {
    setError(null);
    try {
      const res = await fetch(`${API_BASE_URL}/resources/${id}/delete`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (data.success) {
        setResources(resources.filter(r => r.id !== id));
      } else {
        setError(data.error || 'Failed to delete resource');
      }
    } catch {
      setError('Failed to delete resource');
    }
  }

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4">Resource & Calendar Management</h1>
      <div className="mb-6">
        <h2 className="text-xl font-semibold mb-2">Resources</h2>
        {error && <div className="text-red-500 mb-2">{error}</div>}
        {loading ? (
          <div>Loading resources...</div>
        ) : (
          <ul className="mb-4">
            {resources.map((r: Resource) => (
              <li key={r.id} className="mb-2 border p-2 rounded">
                {editResourceId === r.id ? (
                  <form onSubmit={handleUpdate} className="flex gap-2">
                    <input
                      type="text"
                      value={editResource.name}
                      onChange={e => setEditResource({ ...editResource, name: e.target.value })}
                      placeholder="Name"
                      className="border px-2 py-1 rounded"
                      required
                    />
                    <input
                      type="text"
                      value={editResource.description}
                      onChange={e => setEditResource({ ...editResource, description: e.target.value })}
                      placeholder="Description"
                      className="border px-2 py-1 rounded"
                    />
                    <button type="submit" className="bg-blue-500 text-white px-3 py-1 rounded">Save</button>
                    <button type="button" onClick={() => setEditResourceId(null)} className="bg-gray-300 px-3 py-1 rounded">Cancel</button>
                  </form>
                ) : (
                  <>
                    <span className="font-semibold">{r.name}</span> <span className="text-gray-500">({r.description})</span>
                    <button onClick={() => { setEditResourceId(r.id); setEditResource({ name: r.name, description: r.description }); }} className="ml-2 text-blue-600">Edit</button>
                    <button onClick={() => handleDelete(r.id)} className="ml-2 text-red-600">Delete</button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
        <form onSubmit={handleCreate} className="flex gap-2">
          <input
            type="text"
            value={newResource.name}
            onChange={e => setNewResource({ ...newResource, name: e.target.value })}
            placeholder="Resource Name"
            className="border px-2 py-1 rounded"
            required
          />
          <input
            type="text"
            value={newResource.description}
            onChange={e => setNewResource({ ...newResource, description: e.target.value })}
            placeholder="Description"
            className="border px-2 py-1 rounded"
          />
          <button type="submit" className="bg-green-500 text-white px-3 py-1 rounded">Add Resource</button>
        </form>
      </div>
      {/* TODO: Add appointment CRUD UI */}
      <div className="mb-6">
        <h2 className="text-xl font-semibold mb-2">Appointments</h2>
        <p>View and manage appointments for all resources.</p>
      </div>
      {/* TODO: Add resource type management UI */}
      <div>
        <h2 className="text-xl font-semibold mb-2">Resource Types</h2>
        <p>Manage types of resources (e.g., truck, stylist, bay, room).</p>
      </div>
    </div>
  );
}
