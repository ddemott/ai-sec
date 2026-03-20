'use client'

import React, { useState, useEffect } from 'react'
import { 
  PlusCircle, 
  Settings, 
  Users, 
  Wrench, 
  CheckCircle2, 
  ChevronRight, 
  Info,
  Trash2,
  Tag,
  AlertCircle
} from 'lucide-react'
import { Api } from '../lib/api'
import { useSession, useStaticData } from '../lib/hooks'
import { useVocabulary } from '@/lib/VocabularyContext'
import { Button } from './ui/Button'
import { Card } from './ui/Card'
import { Input } from './ui/Input'
import { Modal } from './ui/Modal'
import { Badge } from './ui/Badge'

type Service = {
  id: number
  name: string
  description: string
  duration_minutes: number
  price?: number
}

export default function ServiceAssignmentView({ overrideTenantId }: { overrideTenantId?: string | null }) {
  const { tenantId } = useSession(overrideTenantId)
  const vocab = useVocabulary()
  const { services, resources, employees, loading, error: staticError, refresh } = useStaticData(tenantId)
  
  const [resMappings, setResMappings] = useState<{ service_id: number; resource_id: string }[]>([])
  const [empMappings, setEmpMappings] = useState<{ service_id: number; employee_id: number }[]>([])
  const [actionError, setActionError] = useState<string | null>(null)

  // Wizard State (Creation)
  const [isWizardOpen, setIsWizardOpen] = useState(false)
  const [wizardStep, setWizardStep] = useState(1)
  const [wizardData, setWizardData] = useState<Partial<Service>>({
    name: '',
    description: '',
    duration_minutes: 30,
  })
  const [selectedResourceIds, setSelectedResourceIds] = useState<string[]>([])
  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState<string[]>([])

  // Edit State
  const [selectedService, setSelectedService] = useState<Service | null>(null)
  const [isEditModalOpen, setIsEditModalOpen] = useState(false)
  const [editForm, setEditForm] = useState<Partial<Service>>({})
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (tenantId) fetchMappings()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId])

  async function fetchMappings() {
    try {
      const [rMap, eMap] = await Promise.all([
        Api.mappings.listServiceResource(tenantId),
        Api.mappings.listServiceEmployee(tenantId)
      ])
      setResMappings(rMap)
      setEmpMappings(eMap)
    } catch {
      console.error("Failed to fetch mappings")
    }
  }

  const nextStep = () => setWizardStep(s => s + 1)
  const prevStep = () => setWizardStep(s => s - 1)

  async function handleCreateService() {
    setActionError(null)
    try {
      const res = await Api.services.create(tenantId, { ...wizardData })
      if (!res.success) throw new Error(res.error || "Failed to save service")
      
      const serviceId = res.service.id

      // Save Mappings
      await Promise.all([
        ...selectedResourceIds.map(rid => Api.mappings.assignServiceResource(serviceId, rid, tenantId)),
        ...selectedEmployeeIds.map(eid => Api.mappings.assignServiceEmployee(serviceId, eid, tenantId))
      ])
      
      setIsWizardOpen(false)
      setWizardStep(1)
      setWizardData({ name: '', description: '', duration_minutes: 30 })
      setSelectedResourceIds([])
      setSelectedEmployeeIds([])
      refresh()
      fetchMappings()
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : String(err))
    }
  }

  async function handleUpdateService() {
    if (!selectedService || !editForm.name?.trim()) return
    setSaving(true)
    setActionError(null)
    try {
      const res = await Api.services.update(selectedService.id, tenantId, editForm)
      if (res.success) {
        refresh()
        setIsEditModalOpen(false)
      } else {
        setActionError(res.error || "Update failed")
      }
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  async function handleDeleteService(id: number) {
    if (!confirm("Are you sure? This will remove the service definition permanently.")) return
    setActionError(null)
    try {
      const res = await Api.services.delete(id, tenantId)
      if (res.success) {
        refresh()
        setIsEditModalOpen(false)
      } else {
        setActionError(res.error || "Delete failed")
      }
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : String(err))
    }
  }

  async function toggleResourceMapping(serviceId: number, resourceId: string) {
    const isMapped = resMappings.some(m => m.service_id === serviceId && m.resource_id === resourceId)
    try {
      if (isMapped) {
        await Api.mappings.unassignServiceResource(serviceId, resourceId, tenantId)
        setResMappings(resMappings.filter(m => !(m.service_id === serviceId && m.resource_id === resourceId)))
      } else {
        await Api.mappings.assignServiceResource(serviceId, resourceId, tenantId)
        setResMappings([...resMappings, { service_id: serviceId, resource_id: resourceId }])
      }
    } catch { alert("Mapping update failed") }
  }

  async function toggleEmployeeMapping(serviceId: number, employeeId: number) {
    const isMapped = empMappings.some(m => m.service_id === serviceId && m.employee_id === employeeId)
    try {
      if (isMapped) {
        await Api.mappings.unassignServiceEmployee(serviceId, employeeId, tenantId)
        setEmpMappings(empMappings.filter(m => !(m.service_id === serviceId && m.employee_id === employeeId)))
      } else {
        await Api.mappings.assignServiceEmployee(serviceId, employeeId, tenantId)
        setEmpMappings([...empMappings, { service_id: serviceId, employee_id: employeeId }])
      }
    } catch { alert("Mapping update failed") }
  }

  if (loading && services.length === 0) {
    return <div className="p-8 flex items-center justify-center text-gray-500 italic">Loading catalog...</div>
  }

  return (
    <div className="flex-1 flex flex-col bg-white dark:bg-[#111] overflow-y-auto text-gray-900 dark:text-gray-100 p-8 transition-colors duration-200">
      <header className="mb-8 flex items-center justify-between">
        <div className="flex items-center">
          <div className="bg-blue-100 dark:bg-blue-900/30 p-2 rounded-lg mr-4 text-blue-600 dark:text-blue-400">
            <Settings className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-3xl font-bold">Service Catalog</h1>
            <p className="text-gray-500 dark:text-gray-400 text-sm">Manage your business offerings and operational logic.</p>
          </div>
        </div>
        <Button 
          onClick={() => setIsWizardOpen(true)}
          icon={PlusCircle}
        >
          New Service Wizard
        </Button>
      </header>

      {(staticError || actionError) && (
        <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-2xl text-red-700 dark:text-red-400 flex items-center gap-3">
          <AlertCircle className="w-5 h-5" />
          <span className="font-bold">{actionError || staticError}</span>
        </div>
      )}

      {/* Service List */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {services.map(service => (
          <Card 
            key={service.id} 
            className="relative group cursor-pointer hover:border-blue-500/50 transition-all"
            onClick={() => {
              setSelectedService(service);
              setEditForm({ name: service.name, description: service.description, duration_minutes: service.duration_minutes, price: service.price });
              setIsEditModalOpen(true);
            }}
          >
            <h3 className="text-xl font-bold mb-1">{service.name}</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4 h-10 overflow-hidden line-clamp-2">{service.description}</p>
            
            <div className="flex items-center gap-2 mb-4">
              <Badge variant="default">{service.duration_minutes} MIN</Badge>
              {service.price > 0 && <Badge variant="info">${service.price}</Badge>}
            </div>

            <div className="space-y-3 pt-4 border-t border-gray-100 dark:border-gray-800">
              <div className="flex items-center text-xs font-bold uppercase tracking-tighter">
                <Wrench className="w-3 h-3 mr-2 text-blue-500" />
                <span className="text-gray-400">{vocab.resource_plural}: </span>
                <span className="ml-1 text-gray-600 dark:text-gray-300">{resMappings.filter(m => m.service_id === service.id).length} assigned</span>
              </div>
              <div className="flex items-center text-xs font-bold uppercase tracking-tighter">
                <Users className="w-3 h-3 mr-2 text-green-500" />
                <span className="text-gray-400">{vocab.employee_plural}: </span>
                <span className="ml-1 text-gray-600 dark:text-gray-300">{empMappings.filter(m => m.service_id === service.id).length} authorized</span>
              </div>
            </div>
          </Card>
        ))}
      </div>

      {/* EDIT MODAL */}
      <Modal
        isOpen={isEditModalOpen && !!selectedService}
        onClose={() => setIsEditModalOpen(false)}
        title={selectedService?.name || 'Edit Service'}
        footer={
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setIsEditModalOpen(false)}>Cancel</Button>
            <Button onClick={handleUpdateService} loading={saving}>Save Changes</Button>
          </div>
        }
      >
        <div className="space-y-8 max-h-[70vh] overflow-y-auto pr-2">
          {/* BASIC INFO */}
          <section className="space-y-4">
            <h4 className="text-xs font-bold text-gray-400 uppercase tracking-widest flex items-center">
              <Tag className="w-3 h-3 mr-2" /> Service Details
            </h4>
            <div className="grid grid-cols-1 gap-4">
              <Input 
                label="Name"
                value={editForm.name}
                onChange={e => setEditForm({ ...editForm, name: e.target.value })}
              />
              <div>
                <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1 ml-1 tracking-widest">Description</label>
                <textarea 
                  className="w-full p-3 bg-gray-50 dark:bg-[#222] border border-gray-100 dark:border-gray-800 rounded-xl text-sm h-20 outline-none focus:ring-2 focus:ring-blue-500"
                  value={editForm.description}
                  onChange={e => setEditForm({ ...editForm, description: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <Input 
                  label="Duration (Min)"
                  type="number"
                  value={editForm.duration_minutes}
                  onChange={e => setEditForm({ ...editForm, duration_minutes: parseInt(e.target.value) })}
                />
                <Input 
                  label="Price ($)"
                  type="number"
                  value={editForm.price}
                  onChange={e => setEditForm({ ...editForm, price: parseFloat(e.target.value) })}
                />
              </div>
            </div>
          </section>

          {/* MAPPINGS WITHIN EDIT */}
          <section className="space-y-4">
            <h4 className="text-xs font-bold text-gray-400 uppercase tracking-widest flex items-center">
              <Wrench className="w-3 h-3 mr-2" /> {vocab.resource_plural} & {vocab.employee_plural}
            </h4>
            <div className="space-y-6">
              <div>
                <p className="text-[10px] font-bold text-gray-400 uppercase mb-3 ml-1">Authorized {vocab.resource_plural}</p>
                <div className="flex flex-wrap gap-2">
                  {resources.map(res => {
                    const isMapped = resMappings.some(m => m.service_id === selectedService?.id && m.resource_id === res.id)
                    return (
                      <button 
                        key={res.id}
                        onClick={() => selectedService && toggleResourceMapping(selectedService.id, res.id)}
                        className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition-all ${isMapped ? 'bg-blue-600 text-white border-blue-600' : 'bg-white dark:bg-[#222] border-gray-200 dark:border-gray-800 text-gray-500'}`}
                      >
                        {res.name}
                      </button>
                    )
                  })}
                </div>
              </div>
              <div>
                <p className="text-[10px] font-bold text-gray-400 uppercase mb-3 ml-1">Qualified {vocab.employee_plural}</p>
                <div className="flex flex-wrap gap-2">
                  {employees.filter(e => e.type !== 'user').map(emp => {
                    const isMapped = empMappings.some(m => m.service_id === selectedService?.id && m.employee_id === emp.id)
                    return (
                      <button 
                        key={emp.id}
                        onClick={() => selectedService && toggleEmployeeMapping(selectedService.id, emp.id)}
                        className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition-all ${isMapped ? 'bg-green-600 text-white border-green-600' : 'bg-white dark:bg-[#222] border-gray-200 dark:border-gray-800 text-gray-500'}`}
                      >
                        {emp.name}
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>
          </section>

          <section className="pt-6 border-t border-gray-100 dark:border-gray-800">
            <Button 
              variant="ghost" 
              className="text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20 w-full justify-center"
              icon={Trash2}
              onClick={() => selectedService && handleDeleteService(selectedService.id)}
            >
              Delete Service Permanently
            </Button>
          </section>
        </div>
      </Modal>

      {/* WIZARD MODAL (CREATION) */}
      <Modal
        isOpen={isWizardOpen}
        onClose={() => setIsWizardOpen(false)}
        title={`New Service Wizard - Step ${wizardStep} of 3`}
        footer={
          <div className="flex items-center justify-between w-full">
            <Button 
              variant="ghost"
              onClick={() => wizardStep === 1 ? setIsWizardOpen(false) : prevStep()}
            >
              {wizardStep === 1 ? 'Cancel' : 'Back'}
            </Button>
            
            {wizardStep < 3 ? (
              <Button 
                onClick={nextStep}
                disabled={wizardStep === 1 && !wizardData.name}
              >
                Next <ChevronRight className="w-4 h-4 ml-2" />
              </Button>
            ) : (
              <Button 
                onClick={handleCreateService}
                variant="success"
              >
                Create Service
              </Button>
            )}
          </div>
        }
      >
        <div className="min-h-[300px]">
          {wizardStep === 1 && (
            <div className="space-y-6">
              <header>
                <h2 className="text-2xl font-bold mb-2">Service Details</h2>
                <p className="text-gray-500 dark:text-gray-400">Tell us what this service is called and how long it takes.</p>
              </header>
              <div className="space-y-4">
                <Input 
                  label="Service Name"
                  placeholder="e.g. Front End Alignment"
                  value={wizardData.name}
                  onChange={e => setWizardData({...wizardData, name: e.target.value})}
                />
                <div>
                  <label className="block text-xs font-bold text-gray-400 dark:text-gray-500 uppercase mb-1 ml-1">Description</label>
                  <textarea 
                    className="w-full p-3 bg-gray-50 dark:bg-[#222] border border-gray-200 dark:border-gray-800 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none h-24 text-sm"
                    placeholder="What is included in this service?"
                    value={wizardData.description}
                    onChange={e => setWizardData({...wizardData, description: e.target.value})}
                  />
                </div>
                <Input 
                  label="Base Duration (Minutes)"
                  type="number"
                  value={wizardData.duration_minutes}
                  onChange={e => setWizardData({...wizardData, duration_minutes: parseInt(e.target.value)})}
                />
              </div>
            </div>
          )}

          {wizardStep === 2 && (
            <div className="space-y-6">
              <header>
                <h2 className="text-2xl font-bold mb-2">{vocab.resource_plural} & Equipment</h2>
                <p className="text-gray-500 dark:text-gray-400">Which {vocab.resource_plural.toLowerCase()} can this service be performed at?</p>
              </header>
              <div className="grid grid-cols-2 gap-3 max-h-60 overflow-y-auto pr-2">
                {resources.map(res => (
                  <Card 
                    key={res.id}
                    onClick={() => setSelectedResourceIds(prev => prev.includes(res.id) ? prev.filter(id => id !== res.id) : [...prev, res.id])}
                    className={`p-4 cursor-pointer border-2 transition-all ${selectedResourceIds.includes(res.id) ? 'border-blue-600 bg-blue-50 dark:bg-blue-900/20' : 'border-transparent hover:bg-gray-100 dark:hover:bg-gray-800'}`}
                  >
                    <div className="font-bold">{res.name}</div>
                    <div className="text-xs text-gray-500 line-clamp-1">{res.description || 'No description'}</div>
                  </Card>
                ))}
              </div>
              <div className="p-4 bg-blue-50 dark:bg-blue-900/10 rounded-2xl flex items-start">
                <Info className="w-5 h-5 text-blue-500 mr-3 shrink-0 mt-0.5" />
                <p className="text-xs text-blue-800 dark:text-blue-300 leading-relaxed">
                  Selecting specific {vocab.resource_plural.toLowerCase()} ensures the AI only books this service where the necessary tools or space are available.
                </p>
              </div>
            </div>
          )}

          {wizardStep === 3 && (
            <div className="space-y-6">
              <header>
                <h2 className="text-2xl font-bold mb-2">Qualified {vocab.employee_plural}</h2>
                <p className="text-gray-500 dark:text-gray-400">Which {vocab.employee_plural.toLowerCase()} are qualified to perform this service?</p>
              </header>
              <div className="grid grid-cols-2 gap-3 max-h-60 overflow-y-auto pr-2">
                {employees.filter(e => e.type !== 'user').map(emp => (
                  <Card 
                    key={emp.id}
                    onClick={() => setSelectedEmployeeIds(prev => prev.includes(emp.id.toString()) ? prev.filter(id => id !== emp.id.toString()) : [...prev, emp.id.toString()])}
                    className={`p-4 cursor-pointer border-2 transition-all ${selectedEmployeeIds.includes(emp.id.toString()) ? 'border-blue-600 bg-blue-50 dark:bg-blue-900/20' : 'border-transparent hover:bg-gray-100 dark:hover:bg-gray-800'}`}
                  >
                    <div className="font-bold">{emp.name}</div>
                    <div className="text-xs text-gray-500 line-clamp-1">Qualified for mapped services</div>
                  </Card>
                ))}
              </div>
              <div className="p-6 bg-green-50 dark:bg-green-900/10 rounded-[2rem] border border-green-100 dark:border-green-800/30">
                <h4 className="text-sm font-bold text-green-800 dark:text-green-400 mb-2 flex items-center">
                  <CheckCircle2 className="w-4 h-4 mr-2" /> Ready to Finalize
                </h4>
                <p className="text-xs text-green-700 dark:text-green-500 leading-relaxed">
                  You&apos;ve selected {selectedEmployeeIds.length} {vocab.employee_plural.toLowerCase()} and {selectedResourceIds.length} {vocab.resource_plural.toLowerCase()}.
                  Click <strong>Create Service</strong> to update your catalog and sync the AI&apos;s scheduling logic.
                </p>
              </div>
            </div>
          )}
        </div>
      </Modal>
    </div>
  )
}
