'use client'

import React, { useEffect, useState } from 'react';
import { 
  Wrench, 
  PlusCircle, 
  CheckCircle2, 
  Trash2,
  AlertCircle,
  Tag,
  Info
} from 'lucide-react';
import { Api } from '../lib/api';
import { useStaticData } from '../lib/hooks'
import { useActiveTenantId } from '../lib/SessionContext';
import { useVocabulary } from '@/lib/VocabularyContext';
import { Button } from './ui/Button';
import { Input } from './ui/Input';
import { Card } from './ui/Card';
import { Badge } from './ui/Badge';
import { Modal } from './ui/Modal';

type Resource = {
  id: string;
  name: string;
  description?: string | null;
  is_active: boolean;
};

type Mapping = {
  service_id: string;
  resource_id?: string;
};

export default function ResourceManagerView() {
  const tenantId = useActiveTenantId();
  const vocab = useVocabulary();
  const { resources: staticResources, services, loading: staticLoading, refresh } = useStaticData(tenantId);
  const [resources, setResources] = useState<Resource[]>([]);
  const [mappings, setMappings] = useState<Mapping[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Create/Edit State
  const [newResource, setNewResource] = useState({ name: '', description: '' });
  const [selectedResource, setSelectedResource] = useState<Resource | null>(null);
  const [editForm, setEditForm] = useState({ name: '', description: '', is_active: true });
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (tenantId) {
      fetchMappings(tenantId);
    }
  }, [tenantId]);

  useEffect(() => {
    setResources(staticResources);
    setLoading(staticLoading);
  }, [staticResources, staticLoading]);

  async function fetchMappings(tid: string) {
    try {
      const mData = await Api.mappings.listServiceResource(tid);
      setMappings(Array.isArray(mData) ? mData : []);
    } catch {
      setError('Failed to fetch resource mappings');
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!newResource.name.trim() || !tenantId) return;
    setSaving(true);
    setError(null);
    try {
      const res = await Api.resources.create(tenantId, newResource);
      if (res.success) {
        refresh();
        setNewResource({ name: '', description: '' });
      } else {
        setError(res.error || 'Failed to create resource');
      }
    } catch {
      setError('Failed to create resource');
    } finally {
      setSaving(false);
    }
  }

  async function handleUpdateResource() {
    if (!selectedResource || !editForm.name.trim()) return;
    setSaving(true);
    try {
      const res = await Api.resources.update(selectedResource.id, {
        name: editForm.name.trim(),
        description: editForm.description.trim(),
        is_active: editForm.is_active
      }, tenantId);
      if (res.success) {
        refresh();
        setIsEditModalOpen(false);
      } else {
        setError(res.error || "Failed to update resource");
      }
    } catch {
      setError("Failed to update resource");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Are you sure you want to delete this resource?')) return;
    setError(null);
    try {
      const res = await Api.resources.delete(id, tenantId);
      if (res.success) {
        refresh();
      } else {
        setError(res.error || 'Failed to delete resource');
      }
    } catch {
      setError('Failed to delete resource');
    }
  }

  async function toggleServiceMapping(serviceId: string, resourceId: string) {
    const isMapped = (mappings || []).some(m => m.service_id === serviceId && m.resource_id === resourceId);
    
    try {
      const res = isMapped 
        ? await Api.mappings.unassignServiceResource(serviceId, resourceId, tenantId)
        : await Api.mappings.assignServiceResource(serviceId, resourceId, tenantId);

      if (res.success) {
        if (isMapped) {
          setMappings(mappings.filter(m => !(m.service_id === serviceId && m.resource_id === resourceId)));
        } else {
          setMappings([...mappings, { service_id: serviceId, resource_id: resourceId }]);
        }
      } else {
        setError(res.error || 'Failed to update service mapping');
      }
    } catch {
      setError('Failed to update service mapping');
    }
  }

  if (loading && resources.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Button variant="ghost" isLoading={true} size="lg">{`Loading ${vocab.resource_plural.toLowerCase()}...`}</Button>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-y-auto p-8 transition-colors duration-200" style={{ backgroundColor: 'var(--bg-surface)', color: 'var(--text-primary)' }}>
      <header className="mb-8">
        <div className="flex items-center mb-6">
          <div className="p-2 rounded-lg mr-4" style={{ backgroundColor: 'var(--accent-muted)', color: 'var(--accent-soft)' }}>
            <Wrench className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-3xl font-display">{vocab.resource_plural} & Services</h1>
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Define which services can be performed at each location.</p>
          </div>
        </div>

        <form onSubmit={handleCreate} className="max-w-md flex gap-3">
          <div className="flex-1 space-y-2">
            <Input 
              placeholder={`${vocab.resource_label} Name (e.g. Bay 1)`}
              value={newResource.name}
              onChange={e => setNewResource({ ...newResource, name: e.target.value })}
              required
            />
            <Input 
              placeholder="Description"
              value={newResource.description}
              onChange={e => setNewResource({ ...newResource, description: e.target.value })}
              className="text-sm"
            />
          </div>
          <Button 
            type="submit"
            isLoading={saving}
            disabled={!newResource.name.trim()}
            className="self-start py-3 whitespace-nowrap"
          >
            {`Add ${vocab.resource_label}`}
          </Button>
        </form>
      </header>

      {error && (
        <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-2xl text-red-700 dark:text-red-400 flex items-center">
          <AlertCircle className="w-5 h-5 mr-3" />
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {resources.map(res => (
          <Card 
            key={res.id} 
            onClick={() => { 
              setSelectedResource(res); 
              setEditForm({ name: res.name, description: res.description || '', is_active: res.is_active !== false });
              setIsEditModalOpen(true); 
            }}
            className="cursor-pointer hover:shadow-xl transition-all group"
          >
            <div className="flex justify-between items-start mb-4">
              <div className="p-3 rounded-2xl shadow-sm" style={{ backgroundColor: 'var(--bg-raised)' }}>
                <Wrench className="w-6 h-6 transition-colors" style={{ color: 'var(--text-muted)' }} />
              </div>
              <Badge variant={res.is_active !== false ? 'success' : 'secondary'}>
                {res.is_active !== false ? 'Active' : 'Inactive'}
              </Badge>
            </div>
            
            <h3 className="text-xl font-bold mb-2">{res.name}</h3>
            <p className="text-sm mb-4 line-clamp-1" style={{ color: 'var(--text-secondary)' }}>{res.description || 'No description provided'}</p>
            
            <div className="flex flex-wrap gap-1">
              {(mappings || []).filter(m => m.resource_id === res.id).length > 0 ? (
                (mappings || []).filter(m => m.resource_id === res.id).map(m => {
                  const s = (services || []).find(s => s.id === m.service_id);
                  return s ? (
                    <Badge key={s.id} variant="primary" className="text-[10px] uppercase">
                      {s.name}
                    </Badge>
                  ) : null;
                })
              ) : (
                <span className="text-xs text-gray-400 italic">No services supported</span>
              )}
            </div>
          </Card>
        ))}
      </div>

      <Modal
        isOpen={isEditModalOpen && !!selectedResource}
        onClose={() => setIsEditModalOpen(false)}
        title={selectedResource?.name || vocab.resource_label}
        disableBackdropClose
        footer={
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setIsEditModalOpen(false)}>Cancel</Button>
            <Button onClick={handleUpdateResource} isLoading={saving}>Save Changes</Button>
          </div>
        }
      >
        <div className="space-y-8 max-h-[60vh] overflow-y-auto pr-2">
          {/* IDENTIFICATION EDIT */}
          <section className="space-y-4">
            <h4 className="text-xs font-bold text-gray-400 uppercase tracking-widest flex items-center">
              <Wrench className="w-3 h-3 mr-2" /> Basic Info
            </h4>
            <div className="space-y-3">
              <Input 
                label={`${vocab.resource_label} Name`}
                value={editForm.name}
                onChange={e => setEditForm({ ...editForm, name: e.target.value })}
              />
              <Input
                label="Description"
                value={editForm.description}
                onChange={e => setEditForm({ ...editForm, description: e.target.value })}
              />
              <div className="flex items-center justify-between pt-2">
                <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>Active</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={editForm.is_active}
                  onClick={() => setEditForm({ ...editForm, is_active: !editForm.is_active })}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${editForm.is_active ? '' : 'bg-gray-300 dark:bg-gray-600'}`}
                  style={editForm.is_active ? { backgroundColor: 'var(--accent)' } : undefined}
                >
                  <span className={`inline-block h-4 w-4 rounded-full bg-white transition-transform ${editForm.is_active ? 'translate-x-6' : 'translate-x-1'}`} />
                </button>
              </div>
            </div>
          </section>

          {/* Service Toggle Section */}
          <section>
            <h4 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-4 flex items-center">
              <Tag className="w-3 h-3 mr-2" /> Supported Services
            </h4>
            <div className="grid grid-cols-1 gap-2">
              {(services || []).map(service => {
                const isMapped = (mappings || []).some(m => m.service_id === service.id && m.resource_id === selectedResource?.id);
                return (
                  <button 
                    key={service.id}
                    onClick={() => selectedResource && toggleServiceMapping(service.id, selectedResource.id)}
                    className={`flex items-center justify-between p-4 rounded-2xl text-sm font-bold transition-all ${isMapped ? 'text-white shadow-md' : ''}`}
                    style={isMapped ? { backgroundColor: 'var(--accent)' } : { backgroundColor: 'var(--bg-raised)', color: 'var(--text-secondary)' }}
                  >
                    {service.name}
                    {isMapped ? <CheckCircle2 className="w-5 h-5 text-white" /> : <PlusCircle className="w-5 h-5 opacity-30" />}
                  </button>
                );
              })}
              {(services || []).length === 0 && (
                <div className="text-center p-8 border-2 border-dashed rounded-3xl" style={{ borderColor: 'var(--border-soft)', color: 'var(--text-muted)' }}>
                  No services defined in the catalog.
                </div>
              )}
            </div>
          </section>

          <Card variant="info">
            <h4 className="text-sm font-bold mb-2 flex items-center gap-2">
              <Info className="w-4 h-4 mr-2" /> Capacity Alignment
            </h4>
            <p className="text-xs leading-relaxed">
              Toggling services here determines which appointments can be booked for this {vocab.resource_label.toLowerCase()}.
              The AI agent will only schedule a service if it&apos;s enabled for the specific location or piece of equipment.
            </p>
          </Card>

          <section className="pt-4 border-t" style={{ borderColor: 'var(--border-soft)' }}>
            <Button 
                variant="ghost" 
                size="sm" 
                className="text-red-600 dark:text-red-400 font-bold hover:bg-red-50 dark:hover:bg-red-900/10"
                onClick={() => { if (selectedResource) handleDelete(selectedResource.id); setIsEditModalOpen(false); }}
            >
              <Trash2 className="w-4 h-4 mr-2" /> {`Delete ${vocab.resource_label}`}
            </Button>
          </section>
        </div>
      </Modal>
    </div>
  );
}
