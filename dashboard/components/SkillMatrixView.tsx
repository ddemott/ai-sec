'use client'

import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react'
import { 
  ShieldCheck, 
  Users, 
  Wrench, 
  PlusCircle, 
  Check,
  X,
  Search,
  Settings
} from 'lucide-react'
import { Api } from '../lib/api'
import { useSession, useStaticData } from '../lib/hooks'
import { useVocabulary } from '@/lib/VocabularyContext'
import { Button } from './ui/Button'
import { Input } from './ui/Input'

export default function SkillMatrixView({ overrideTenantId }: { overrideTenantId?: string | null }) {
  const { tenantId } = useSession(overrideTenantId)
  const { employees, resources, services, loading, refresh } = useStaticData(tenantId)
  const vocab = useVocabulary()
  
  const [empMappings, setEmpMappings] = useState<any[]>([])
  const [resMappings, setResMappings] = useState<any[]>([])
  const [searchTerm, setSearchTerm] = useState('')
  const [filterType, setFilterType] = useState<'all' | 'employee' | 'resource'>('all')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (tenantId) {
      fetchMappings()
    }
  }, [tenantId])

  async function fetchMappings() {
    try {
      const [eMap, rMap] = await Promise.all([
        Api.mappings.listServiceEmployee(tenantId),
        Api.mappings.listServiceResource(tenantId)
      ])
      setEmpMappings(Array.isArray(eMap) ? eMap : [])
      setResMappings(Array.isArray(rMap) ? rMap : [])
    } catch (err) {
      console.error("Failed to fetch mappings")
      setEmpMappings([])
      setResMappings([])
    }
  }

  // Combine employees and resources into a single list of entities
  const entities = useMemo(() => {
    const emps = (employees || []).filter(e => e.type !== 'user').map(e => ({
      ...e,
      type: 'employee' as const
    }))
    const res = (resources || []).map(r => ({
      ...r,
      type: 'resource' as const
    }))
    return [...emps, ...res]
  }, [employees, resources])

  const filteredEntities = useMemo(() => {
    return entities.filter(e => {
      const matchesSearch = e.name.toLowerCase().includes(searchTerm.toLowerCase())
      const matchesType = filterType === 'all' || e.type === filterType
      return matchesSearch && matchesType
    })
  }, [entities, searchTerm, filterType])

  // Debounce guard to prevent rapid duplicate requests (BUG-043)
  const pendingToggle = useRef<string | null>(null)

  async function toggleMapping(entityType: 'employee' | 'resource', entityId: any, serviceId: number) {
    const key = `${entityType}-${entityId}-${serviceId}`
    if (pendingToggle.current === key) return
    pendingToggle.current = key
    setSaving(true)
    const isMapped = entityType === 'employee' 
      ? empMappings.some(m => m.employee_id === entityId && m.service_id === serviceId)
      : resMappings.some(m => m.resource_id === entityId && m.service_id === serviceId)

    try {
      if (entityType === 'employee') {
        if (isMapped) {
          await Api.mappings.unassignServiceEmployee(serviceId, entityId, tenantId)
          setEmpMappings(empMappings.filter(m => !(m.employee_id === entityId && m.service_id === serviceId)))
        } else {
          await Api.mappings.assignServiceEmployee(serviceId, entityId, tenantId)
          setEmpMappings([...empMappings, { employee_id: entityId, service_id: serviceId }])
        }
      } else {
        if (isMapped) {
          await Api.mappings.unassignServiceResource(serviceId, entityId, tenantId)
          setResMappings(resMappings.filter(m => !(m.resource_id === entityId && m.service_id === serviceId)))
        } else {
          await Api.mappings.assignServiceResource(serviceId, entityId, tenantId)
          setResMappings([...resMappings, { resource_id: entityId, service_id: serviceId }])
        }
      }
    } catch (err) {
      alert("Mapping failed")
    } finally {
      setSaving(false)
      pendingToggle.current = null
    }
  }

  if (loading && entities.length === 0) {
    return <div className="p-8 text-gray-500 italic">Loading service matrix...</div>
  }

  return (
    <div className="flex-1 flex flex-col bg-white dark:bg-[#111] overflow-hidden text-gray-900 dark:text-gray-100 p-8 transition-colors duration-200">
      <header className="mb-8 shrink-0">
        <div className="flex items-center mb-6">
          <div className="bg-purple-100 dark:bg-purple-900/30 p-2 rounded-lg mr-4 text-purple-600 dark:text-purple-400">
            <ShieldCheck className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-3xl font-bold">Service Assignment Matrix</h1>
            <p className="text-gray-500 dark:text-gray-400 text-sm">Align your people and places with the services you provide.</p>
          </div>
        </div>

        <div className="flex flex-col md:flex-row gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input 
              placeholder={`Search ${vocab.employee_plural.toLowerCase()} or ${vocab.resource_plural.toLowerCase()}...`}
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="pl-10"
            />
          </div>
          <div className="flex gap-2 bg-gray-100 dark:bg-[#222] p-1 rounded-xl font-bold">
            <button 
              onClick={() => setFilterType('all')}
              className={`px-4 py-2 text-xs rounded-lg transition-all ${filterType === 'all' ? 'bg-white dark:bg-[#333] shadow-sm text-blue-600 dark:text-blue-400' : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'}`}
            >
              All
            </button>
            <button 
              onClick={() => setFilterType('employee')}
              className={`px-4 py-2 text-xs rounded-lg transition-all ${filterType === 'employee' ? 'bg-white dark:bg-[#333] shadow-sm text-blue-600 dark:text-blue-400' : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'}`}
            >
              People
            </button>
            <button 
              onClick={() => setFilterType('resource')}
              className={`px-4 py-2 text-xs rounded-lg transition-all ${filterType === 'resource' ? 'bg-white dark:bg-[#333] shadow-sm text-blue-600 dark:text-blue-400' : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'}`}
            >
              Places
            </button>
          </div>
        </div>
      </header>

      {/* MATRIX GRID */}
      <div className="flex-1 overflow-auto border border-gray-200 dark:border-gray-800 rounded-3xl bg-gray-50/30 dark:bg-black/20">
        <table className="w-full border-collapse min-w-[800px]">
          <thead className="sticky top-0 z-20 bg-gray-100 dark:bg-[#1a1a1a] border-b border-gray-200 dark:border-gray-800">
            <tr>
              <th className="p-4 text-left text-xs font-bold text-gray-400 uppercase tracking-widest bg-gray-100 dark:bg-[#1a1a1a] sticky left-0 z-30 min-w-[200px]">
                Entity
              </th>
              {(services || []).map(service => (
                <th key={service.id} className="p-4 text-center text-[10px] font-bold text-gray-400 uppercase tracking-widest border-l border-gray-200 dark:border-gray-800 min-w-[150px]">
                  {service.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredEntities.map((entity, idx) => (
              <tr key={`${entity.type}-${entity.id}`} className={idx % 2 === 0 ? 'bg-white/50 dark:bg-white/5' : ''}>
                <td className="p-4 bg-gray-50 dark:bg-[#1a1a1a] border-b border-gray-200 dark:border-gray-800 sticky left-0 z-10 shadow-[2px_0_5px_rgba(0,0,0,0.05)]">
                  <div className="flex items-center">
                    <div className={`p-1.5 rounded-lg mr-3 ${entity.type === 'employee' ? 'bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400' : 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400'}`}>
                      {entity.type === 'employee' ? <Users className="w-3 h-3" /> : <Wrench className="w-3 h-3" />}
                    </div>
                    <div>
                      <div className="font-bold text-sm leading-none mb-1">{entity.name}</div>
                      <div className="text-[10px] text-gray-400 uppercase font-bold tracking-tighter">{entity.type === 'employee' ? vocab.employee_label : vocab.resource_label}</div>
                    </div>
                  </div>
                </td>
                {(services || []).map(service => {
                  const isMapped = entity.type === 'employee'
                    ? (empMappings || []).some(m => m.employee_id === entity.id && m.service_id === service.id)
                    : (resMappings || []).some(m => m.resource_id === entity.id && m.service_id === service.id)
                  
                  return (
                    <td 
                      key={service.id} 
                      className="p-0 border-b border-l border-gray-100 dark:border-gray-800 text-center"
                    >
                      <button
                        disabled={saving}
                        onClick={() => toggleMapping(entity.type, entity.id, service.id)}
                        className={`w-full h-full p-4 flex items-center justify-center transition-all ${isMapped ? 'bg-blue-50/50 dark:bg-blue-900/10 text-blue-600 dark:text-blue-400' : 'text-gray-300 dark:text-gray-800 hover:text-gray-400 dark:hover:text-gray-700'}`}
                      >
                        {isMapped ? <Check className="w-5 h-5 stroke-[3]" /> : <X className="w-4 h-4 opacity-30" />}
                      </button>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <footer className="mt-6 flex items-center justify-between text-xs text-gray-400 font-medium shrink-0 px-2">
        <div className="flex items-center gap-4">
          <div className="flex items-center">
            <div className="w-3 h-3 rounded-full bg-green-500 mr-2" /> {vocab.employee_label}
          </div>
          <div className="flex items-center">
            <div className="w-3 h-3 rounded-full bg-blue-500 mr-2" /> {vocab.resource_label}
          </div>
        </div>
        <p>Tip: Toggling a cell instantly updates the AI's scheduling logic.</p>
      </footer>
    </div>
  )
}
