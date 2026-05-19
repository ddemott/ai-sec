'use client';

import React, { useState, useMemo, useEffect, useRef } from 'react';
import { ShieldCheck, Users, Wrench, Check, X, Search } from 'lucide-react';
import { Api } from '../lib/api';
import { useStaticData } from '../lib/hooks';
import { useActiveTenantId } from '../lib/SessionContext';
import { useVocabulary } from '@/lib/VocabularyContext';
import { Input } from './ui/Input';
import { showToast } from './ui/Toast';

export default function SkillMatrixView() {
  const tenantId = useActiveTenantId();
  const { employees, resources, services, loading } = useStaticData(tenantId);
  const vocab = useVocabulary();

  const [empMappings, setEmpMappings] = useState<{ employee_id?: string; service_id: string }[]>(
    []
  );
  const [resMappings, setResMappings] = useState<{ resource_id?: string; service_id: string }[]>(
    []
  );
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'employee' | 'resource'>('all');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (tenantId) {
      void fetchMappings();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  async function fetchMappings() {
    try {
      const [eMap, rMap] = await Promise.all([
        Api.mappings.listServiceEmployee(tenantId),
        Api.mappings.listServiceResource(tenantId),
      ]);
      setEmpMappings(Array.isArray(eMap) ? eMap : []);
      setResMappings(Array.isArray(rMap) ? rMap : []);
    } catch {
      console.error('Failed to fetch mappings');
      setEmpMappings([]);
      setResMappings([]);
    }
  }

  // Combine employees and resources into a single list of entities.
  // Both branches expose `entity_id` so the table can key, compare, and
  // toggle without caring which underlying domain table the row came from.
  const entities = useMemo(() => {
    const emps = (employees || [])
      .filter((e) => e.type !== 'user')
      .map((e) => ({
        ...e,
        entity_id: e.employee_id,
        type: 'employee' as const,
      }));
    const res = (resources || []).map((r) => ({
      ...r,
      entity_id: r.resource_id,
      type: 'resource' as const,
    }));
    return [...emps, ...res];
  }, [employees, resources]);

  const filteredEntities = useMemo(() => {
    return entities.filter((e) => {
      const matchesSearch = e.name.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesType = filterType === 'all' || e.type === filterType;
      return matchesSearch && matchesType;
    });
  }, [entities, searchTerm, filterType]);

  // Debounce guard to prevent rapid duplicate requests (BUG-043)
  const pendingToggle = useRef<string | null>(null);

  async function toggleMapping(
    entityType: 'employee' | 'resource',
    entityId: string,
    serviceId: string
  ) {
    const key = `${entityType}-${entityId}-${serviceId}`;
    if (pendingToggle.current === key) return;
    pendingToggle.current = key;
    setSaving(true);
    const isMapped =
      entityType === 'employee'
        ? empMappings.some((m) => m.employee_id === entityId && m.service_id === serviceId)
        : resMappings.some((m) => m.resource_id === entityId && m.service_id === serviceId);

    try {
      if (entityType === 'employee') {
        if (isMapped) {
          await Api.mappings.unassignServiceEmployee(serviceId, entityId, tenantId);
          setEmpMappings(
            empMappings.filter((m) => !(m.employee_id === entityId && m.service_id === serviceId))
          );
        } else {
          await Api.mappings.assignServiceEmployee(serviceId, entityId, tenantId);
          setEmpMappings([...empMappings, { employee_id: entityId, service_id: serviceId }]);
        }
      } else {
        if (isMapped) {
          await Api.mappings.unassignServiceResource(serviceId, entityId, tenantId);
          setResMappings(
            resMappings.filter((m) => !(m.resource_id === entityId && m.service_id === serviceId))
          );
        } else {
          await Api.mappings.assignServiceResource(serviceId, entityId, tenantId);
          setResMappings([...resMappings, { resource_id: entityId, service_id: serviceId }]);
        }
      }
    } catch {
      showToast('Mapping failed', 'error');
    } finally {
      setSaving(false);
      pendingToggle.current = null;
    }
  }

  if (loading && entities.length === 0) {
    return <div className="p-8 text-gray-500 italic">Loading service matrix...</div>;
  }

  return (
    <div
      className="flex-1 flex flex-col overflow-hidden p-8 transition-colors duration-200"
      style={{ backgroundColor: 'var(--bg-surface)', color: 'var(--text-primary)' }}
    >
      <header className="mb-8 shrink-0">
        <div className="flex items-center mb-6">
          <div className="bg-purple-100 dark:bg-purple-900/30 p-2 rounded-lg mr-4 text-purple-600 dark:text-purple-400">
            <ShieldCheck className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-3xl font-display">Service Assignments</h1>
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              Align your people and places with the services you provide.
            </p>
          </div>
        </div>

        <div className="flex flex-col md:flex-row gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input
              placeholder={`Search ${vocab.employee_plural.toLowerCase()} or ${vocab.resource_plural.toLowerCase()}...`}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
            />
          </div>
          <div
            className="flex gap-2 p-1 rounded-xl font-bold"
            style={{ backgroundColor: 'var(--bg-raised)' }}
          >
            <button
              onClick={() => setFilterType('all')}
              className={`px-4 py-2 text-xs rounded-lg transition-all ${filterType === 'all' ? 'shadow-sm' : ''}`}
              style={
                filterType === 'all'
                  ? { backgroundColor: 'var(--bg-surface)', color: 'var(--accent-soft)' }
                  : { color: 'var(--text-secondary)' }
              }
            >
              All
            </button>
            <button
              onClick={() => setFilterType('employee')}
              className={`px-4 py-2 text-xs rounded-lg transition-all ${filterType === 'employee' ? 'shadow-sm' : ''}`}
              style={
                filterType === 'employee'
                  ? { backgroundColor: 'var(--bg-surface)', color: 'var(--accent-soft)' }
                  : { color: 'var(--text-secondary)' }
              }
            >
              People
            </button>
            <button
              onClick={() => setFilterType('resource')}
              className={`px-4 py-2 text-xs rounded-lg transition-all ${filterType === 'resource' ? 'shadow-sm' : ''}`}
              style={
                filterType === 'resource'
                  ? { backgroundColor: 'var(--bg-surface)', color: 'var(--accent-soft)' }
                  : { color: 'var(--text-secondary)' }
              }
            >
              Places
            </button>
          </div>
        </div>
      </header>

      {/* MATRIX GRID */}
      <div
        className="flex-1 overflow-auto border rounded-3xl"
        style={{ borderColor: 'var(--border-soft)', backgroundColor: 'var(--bg-raised)' }}
      >
        <table className="w-full border-collapse min-w-[800px]">
          <thead
            className="sticky top-0 z-20 border-b"
            style={{ backgroundColor: 'var(--bg-raised)', borderColor: 'var(--border-soft)' }}
          >
            <tr>
              <th
                className="p-4 text-left text-xs font-bold uppercase tracking-widest sticky left-0 z-30 min-w-[200px]"
                style={{ backgroundColor: 'var(--bg-raised)', color: 'var(--text-muted)' }}
              >
                Entity
              </th>
              {(services || []).map((service) => (
                <th
                  key={service.service_id}
                  className="p-4 text-center text-[10px] font-bold uppercase tracking-widest border-l min-w-[150px]"
                  style={{ color: 'var(--text-muted)', borderColor: 'var(--border-soft)' }}
                >
                  {service.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredEntities.map((entity, idx) => (
              <tr
                key={`${entity.type}-${entity.entity_id}`}
                className={idx % 2 === 0 ? 'bg-white/50 dark:bg-white/5' : ''}
              >
                <td
                  className="p-4 border-b sticky left-0 z-10 shadow-[2px_0_5px_rgba(0,0,0,0.05)]"
                  style={{ backgroundColor: 'var(--bg-raised)', borderColor: 'var(--border-soft)' }}
                >
                  <div className="flex items-center">
                    <div
                      className={`p-1.5 rounded-lg mr-3 ${entity.type === 'employee' ? 'bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400' : ''}`}
                      style={
                        entity.type === 'resource'
                          ? { backgroundColor: 'var(--accent-muted)', color: 'var(--accent-soft)' }
                          : undefined
                      }
                    >
                      {entity.type === 'employee' ? (
                        <Users className="w-3 h-3" />
                      ) : (
                        <Wrench className="w-3 h-3" />
                      )}
                    </div>
                    <div>
                      <div className="font-bold text-sm leading-none mb-1">{entity.name}</div>
                      <div className="text-[10px] text-gray-400 uppercase font-bold tracking-tighter">
                        {entity.type === 'employee' ? vocab.employee_label : vocab.resource_label}
                      </div>
                    </div>
                  </div>
                </td>
                {(services || []).map((service) => {
                  const isMapped =
                    entity.type === 'employee'
                      ? (empMappings || []).some(
                          (m) =>
                            m.employee_id === entity.entity_id &&
                            m.service_id === service.service_id
                        )
                      : (resMappings || []).some(
                          (m) =>
                            m.resource_id === entity.entity_id &&
                            m.service_id === service.service_id
                        );

                  return (
                    <td
                      key={service.service_id}
                      className="p-0 border-b border-l text-center"
                      style={{ borderColor: 'var(--border-soft)' }}
                    >
                      <button
                        disabled={saving}
                        onClick={() =>
                          toggleMapping(entity.type, entity.entity_id, service.service_id)
                        }
                        className={`w-full h-full p-4 flex items-center justify-center transition-all ${isMapped ? '' : 'text-gray-300 dark:text-gray-800 hover:text-gray-400 dark:hover:text-gray-700'}`}
                        style={
                          isMapped
                            ? {
                                backgroundColor: 'var(--accent-muted)',
                                color: 'var(--accent-soft)',
                              }
                            : undefined
                        }
                      >
                        {isMapped ? (
                          <Check className="w-5 h-5 stroke-[3]" />
                        ) : (
                          <X className="w-4 h-4 opacity-30" />
                        )}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <footer className="mt-6 flex items-center justify-between text-xs text-gray-400 font-medium shrink-0 px-2">
        <div className="flex items-center gap-4">
          <div className="flex items-center">
            <div
              className="w-3 h-3 rounded-full mr-2"
              style={{ backgroundColor: 'var(--success)' }}
            />{' '}
            {vocab.employee_label}
          </div>
          <div className="flex items-center">
            <div
              className="w-3 h-3 rounded-full mr-2"
              style={{ backgroundColor: 'var(--accent)' }}
            />{' '}
            {vocab.resource_label}
          </div>
        </div>
        <p>Tip: Toggling a cell instantly updates the AI&apos;s scheduling logic.</p>
      </footer>
    </div>
  );
}
