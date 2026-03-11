'use client'

import React, { useEffect, useState } from 'react';
import { 
  Wrench, 
  PlusCircle, 
  X, 
  CheckCircle2, 
  Trash2,
  AlertCircle,
  Tag,
  Info
} from 'lucide-react';
import { Api } from '../lib/api';
import { useSession, useStaticData } from '../lib/hooks';
import { Button } from './ui/Button';
import { Input } from './ui/Input';
import { Card } from './ui/Card';
import { Badge } from './ui/Badge';
import { Modal } from './ui/Modal';

type Resource = {
  id: string;
  name: string;
  description: string;
  is_active: boolean;
};

type Mapping = {
  service_id: number;
  resource_id: string;
};

export default function ResourceManagerView() {
  const { tenantId } = useSession();
  const { resources: staticResources, services, loading: staticLoading, refresh } = useStaticData(tenantId);
  const [resources, setResources] = useState<Resource[]>([]);
  const [mappings, setMappings] = useState<Mapping[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Create/Edit State
  const [newResource, setNewResource] = useState({ name: '', description: '' });
  const [selectedResource, setSelectedResource] = useState<Resource | null>(null);
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
    } catch (err) {
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

  async function handleDelete(id: string) {
    if (!confirm('Are you sure you want to delete this resource?')) return;
    setError(null);
    try {
      const res = await Api.resources.delete(id);
      if (res.success) {
        refresh();
      } else {
        setError(res.error || 'Failed to delete resource');
      }
    } catch {
      setError('Failed to delete resource');
    }
  }

  async function toggleServiceMapping(serviceId: number, resourceId: string) {
    const isMapped = mappings.some(m => m.service_id === serviceId && m.resource_id === resourceId);
    
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
    } catch (err) {
      setError('Failed to update service mapping');
    }
  }

  if (loading && resources.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Button variant="ghost" isLoading={true} size="lg">Loading resources...</Button>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col bg-white dark:bg-[#111] overflow-y-auto text-gray-900 dark:text-gray-100 p-8 transition-colors duration-200">
      <header className="mb-8">
        <div className="flex items-center mb-6">
          <div className="bg-blue-100 dark:bg-blue-900/30 p-2 rounded-lg mr-4 text-blue-600 dark:text-blue-400">
            <Wrench className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-3xl font-bold">Resources & Facilities</h1>
            <p className="text-gray-500 dark:text-gray-400 text-sm">Manage your bays, stations, and equipment.</p>
          </div>
        </div>

        <form onSubmit={handleCreate} className="max-w-md flex gap-3">
          <div className="flex-1 space-y-2">
            <Input 
              placeholder="Resource Name (e.g. Bay 1)"
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
            className="self-start py-3"
          >
            {!saving && <PlusCircle className="w-5 h-5 mr-2" />}
            Add
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
          <div 
            key={res.id} 
            onClick={() => { setSelectedResource(res); setIsEditModalOpen(true); }}
            className="bg-gray-50 dark:bg-[#1a1a1a] border border-gray-200 dark:border-gray-800 p-6 rounded-3xl cursor-pointer hover:border-blue-500/50 hover:shadow-xl transition-all group"
          >
            <div className="flex justify-between items-start mb-4">
              <div className="bg-white dark:bg-[#222] p-3 rounded-2xl shadow-sm">
                <Wrench className="w-6 h-6 text-gray-400 group-hover:text-blue-500 transition-colors" />
              </div>
              <Badge variant={res.is_active !== false ? 'success' : 'secondary'}>
                {res.is_active !== false ? 'Active' : 'Inactive'}
              </Badge>
            </div>
            
            <h3 className="text-xl font-bold mb-2">{res.name}</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4 line-clamp-1">{res.description || 'No description provided'}</p>
            
            <div className="flex flex-wrap gap-1">
              {mappings.filter(m => m.resource_id === res.id).length > 0 ? (
                mappings.filter(m => m.resource_id === res.id).slice(0, 3).map(m => {
                  const s = services.find(s => s.id === m.service_id);
                  return s ? (
                    <Badge key={s.id} variant="primary">
                      {s.name}
                    </Badge>
                  ) : null;
                })
              ) : (
                <span className="text-xs text-gray-400 italic">No services assigned</span>
              )}
              {mappings.filter(m => m.resource_id === res.id).length > 3 && (
                <span className="text-[10px] font-bold text-gray-400 px-2 py-0.5">+{mappings.filter(m => m.resource_id === res.id).length - 3} more</span>
              )}
            </div>
          </div>
        ))}
      </div>

      <Modal
        isOpen={isEditModalOpen && !!selectedResource}
        onClose={() => setIsEditModalOpen(false)}
        title={selectedResource?.name || 'Resource'}
        footer={
          <Button onClick={() => setIsEditModalOpen(false)} className="px-8">Done</Button>
        }
      >
        <div className="space-y-8 max-h-[60vh] overflow-y-auto">
          <section>
            <h4 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-4 flex items-center">
              <Tag className="w-3 h-3 mr-2" /> Supported Services
            </h4>
            <div className="grid grid-cols-1 gap-2">
              {services.map(service => {
                const isMapped = mappings.some(m => m.service_id === service.id && m.resource_id === selectedResource?.id);
                return (
                  <button 
                    key={service.id}
                    onClick={() => selectedResource && toggleServiceMapping(service.id, selectedResource.id)}
                    className={`flex items-center justify-between p-3 rounded-xl text-sm font-bold transition-all ${isMapped ? 'bg-blue-600 text-white shadow-md' : 'bg-gray-100 dark:bg-[#222] text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-800'}`}
                  >
                    {service.name}
                    {isMapped ? <CheckCircle2 className="w-4 h-4" /> : <PlusCircle className="w-4 h-4 opacity-50" />}
                  </button>
                );
              })}
            </div>
          </section>

          <Card variant="info">
            <h4 className="text-sm font-bold mb-2 flex items-center">
              <Info className="w-4 h-4 mr-2" /> Dynamic Scheduling
            </h4>
            <p className="text-xs leading-relaxed">
              Toggling services here determines which appointments can be booked for this resource.
              The AI agent will only schedule a service if it's enabled for the specific resource.
            </p>
          </Card>

          <section className="pt-4 border-t border-gray-100 dark:border-gray-800">
            <Button 
                variant="ghost" 
                size="sm" 
                className="text-red-600 dark:text-red-400 font-bold hover:bg-red-50 dark:hover:bg-red-900/10"
                onClick={() => { selectedResource && handleDelete(selectedResource.id); setIsEditModalOpen(false); }}
            >
              <Trash2 className="w-4 h-4 mr-2" /> Delete Resource
            </Button>
          </section>
        </div>
      </Modal>
    </div>
  );
}
