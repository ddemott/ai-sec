'use client'

import React, { useState, useEffect } from 'react'
import { 
  PlusCircle, 
  Settings, 
  Users, 
  Wrench, 
  CheckCircle2, 
  ChevronRight, 
  ChevronLeft,
  Info,
  AlertCircle,
  Loader2,
  Trash2
} from 'lucide-react'
import { API_BASE_URL } from '../lib/api'

type Service = {
  id: number
  name: string
  description: string
  duration_minutes: number
  required_skills: string[]
  required_resources: string[]
}

type Resource = {
  id: string
  name: string
  description?: string
}

type Employee = {
  id: number
  name: string
  skills: string[]
}

export default function ServiceAssignmentView() {
  const [tenantId, setTenantId] = useState<string | null>(null)
  const [services, setServices] = useState<Service[]>([])
  const [resources, setResources] = useState<Resource[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Wizard State
  const [isWizardOpen, setIsWizardOpen] = useState(false)
  const [wizardStep, setWizardStep] = useState(1)
  const [wizardData, setWizardData] = useState<Partial<Service>>({
    name: '',
    description: '',
    duration_minutes: 30,
    required_skills: [],
    required_resources: []
  })
  const [selectedResourceIds, setSelectedResourceIds] = useState<string[]>([])
  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState<number[]>([])

  useEffect(() => {
    const tid = localStorage.getItem('tenantId')
    if (tid) {
      setTenantId(tid)
      fetchInitialData(tid)
    }
  }, [])

  async function fetchInitialData(tid: string) {
    setLoading(true)
    try {
      const [sRes, rRes, eRes] = await Promise.all([
        fetch(`${API_BASE_URL}/services?tenant_id=${tid}`),
        fetch(`${API_BASE_URL}/resources?tenant_id=${tid}`),
        fetch(`${API_BASE_URL}/employees?tenant_id=${tid}`)
      ])
      
      const [sData, rData, eData] = await Promise.all([
        sRes.json(),
        rRes.json(),
        eRes.json()
      ])

      setServices(Array.isArray(sData) ? sData : [])
      setResources(Array.isArray(rData) ? rData : [])
      setEmployees(Array.isArray(eData) ? eData : [])
    } catch (err) {
      setError("Failed to load configuration data.")
    } finally {
      setLoading(false)
    }
  }

  const nextStep = () => setWizardStep(s => s + 1)
  const prevStep = () => setWizardStep(s => s - 1)

  async function handleSaveService() {
    setLoading(true)
    try {
      // 1. Save Service
      const res = await fetch(`${API_BASE_URL}/services/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...wizardData, tenant_id: tenantId })
      })
      const data = await res.json()
      if (!res.ok || !data.success) throw new Error(data.error || "Failed to save service")
      
      const serviceId = data.service.id

      // 2. Save Mappings (Parallel)
      await Promise.all([
        ...selectedResourceIds.map(rid => 
          fetch(`${API_BASE_URL}/services/${serviceId}/resources/${rid}/assign`, { 
            method: 'POST', 
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tenant_id: tenantId })
          })
        ),
        ...selectedEmployeeIds.map(eid => 
          fetch(`${API_BASE_URL}/services/${serviceId}/employees/${eid}/assign`, { 
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tenant_id: tenantId })
          })
        )
      ])

      setIsWizardOpen(false)
      setWizardStep(1)
      setWizardData({ name: '', description: '', duration_minutes: 30, required_skills: [], required_resources: [] })
      setSelectedResourceIds([])
      setSelectedEmployeeIds([])
      if (tenantId) fetchInitialData(tenantId)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  if (loading && !isWizardOpen) {
    return <div className="p-8 flex items-center justify-center"><Loader2 className="animate-spin mr-2" /> Loading configuration...</div>
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
            <p className="text-gray-500 dark:text-gray-400 text-sm">Define what you do and who/where it happens.</p>
          </div>
        </div>
        <button 
          onClick={() => setIsWizardOpen(true)}
          className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-xl font-bold flex items-center shadow-lg transition-all active:scale-95"
        >
          <PlusCircle className="w-5 h-5 mr-2" />
          New Service Wizard
        </button>
      </header>

      {error && (
        <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-2xl text-red-700 dark:text-red-400 flex items-center">
          <AlertCircle className="w-5 h-5 mr-3" />
          {error}
        </div>
      )}

      {/* Service List */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {services.map(service => (
          <div key={service.id} className="bg-gray-50 dark:bg-[#1a1a1a] border border-gray-200 dark:border-gray-800 p-6 rounded-3xl relative group">
            <h3 className="text-xl font-bold mb-1">{service.name}</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4 h-10 overflow-hidden line-clamp-2">{service.description}</p>
            
            <div className="flex items-center text-xs font-bold text-gray-400 uppercase tracking-widest mb-4">
              <span className="bg-gray-200 dark:bg-gray-800 px-2 py-1 rounded mr-3">{service.duration_minutes} MIN</span>
            </div>

            <div className="space-y-3">
              <div className="flex items-center text-sm">
                <Wrench className="w-4 h-4 mr-2 text-blue-500" />
                <span className="text-gray-600 dark:text-gray-300">Resources: </span>
                <span className="ml-1 font-semibold">{resources.filter(r => service.required_resources.includes(r.name)).length || 'Generic'}</span>
              </div>
              <div className="flex items-center text-sm">
                <Users className="w-4 h-4 mr-2 text-green-500" />
                <span className="text-gray-600 dark:text-gray-300">Employees: </span>
                <span className="ml-1 font-semibold">{employees.filter(e => service.required_skills.some(s => e.skills.includes(s))).length || 'Any'}</span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* WIZARD MODAL */}
      {isWizardOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-[#1a1a1a] w-full max-w-2xl rounded-[2.5rem] shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-300">
            
            {/* Progress Header */}
            <div className="bg-gray-50 dark:bg-[#222] p-6 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
              <div className="flex items-center space-x-2">
                {[1, 2, 3].map(step => (
                  <div 
                    key={step} 
                    className={`h-2 w-12 rounded-full transition-all duration-500 ${step <= wizardStep ? 'bg-blue-600' : 'bg-gray-200 dark:bg-gray-800'}`} 
                  />
                ))}
              </div>
              <span className="text-xs font-bold text-gray-400 uppercase tracking-widest">Step {wizardStep} of 3</span>
            </div>

            <div className="p-8">
              {wizardStep === 1 && (
                <div className="space-y-6 animate-in slide-in-from-right-4 duration-300">
                  <header>
                    <h2 className="text-2xl font-bold mb-2">Service Details</h2>
                    <p className="text-gray-500 dark:text-gray-400">Tell us what this service is called and how long it takes.</p>
                  </header>
                  <div className="space-y-4">
                    <div>
                      <label className="text-xs font-bold text-gray-500 uppercase ml-1">Service Name</label>
                      <input 
                        className="w-full p-4 bg-gray-50 dark:bg-[#222] border-none rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none"
                        placeholder="e.g. Front End Alignment"
                        value={wizardData.name}
                        onChange={e => setWizardData({...wizardData, name: e.target.value})}
                      />
                    </div>
                    <div>
                      <label className="text-xs font-bold text-gray-500 uppercase ml-1">Description</label>
                      <textarea 
                        className="w-full p-4 bg-gray-50 dark:bg-[#222] border-none rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none h-24"
                        placeholder="What is included in this service?"
                        value={wizardData.description}
                        onChange={e => setWizardData({...wizardData, description: e.target.value})}
                      />
                    </div>
                    <div>
                      <label className="text-xs font-bold text-gray-500 uppercase ml-1">Base Duration (Minutes)</label>
                      <input 
                        type="number"
                        className="w-full p-4 bg-gray-50 dark:bg-[#222] border-none rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none"
                        value={wizardData.duration_minutes}
                        onChange={e => setWizardData({...wizardData, duration_minutes: parseInt(e.target.value)})}
                      />
                    </div>
                  </div>
                </div>
              )}

              {wizardStep === 2 && (
                <div className="space-y-6 animate-in slide-in-from-right-4 duration-300">
                  <header>
                    <h2 className="text-2xl font-bold mb-2">Location & Equipment</h2>
                    <p className="text-gray-500 dark:text-gray-400">Where can this service be performed?</p>
                  </header>
                  <div className="grid grid-cols-2 gap-3">
                    {resources.map(res => (
                      <button 
                        key={res.id}
                        onClick={() => setSelectedResourceIds(prev => prev.includes(res.id) ? prev.filter(id => id !== res.id) : [...prev, res.id])}
                        className={`p-4 rounded-2xl text-left border-2 transition-all ${selectedResourceIds.includes(res.id) ? 'border-blue-600 bg-blue-50 dark:bg-blue-900/20' : 'border-transparent bg-gray-50 dark:bg-[#222] hover:bg-gray-100 dark:hover:bg-gray-800'}`}
                      >
                        <div className="font-bold">{res.name}</div>
                        <div className="text-xs text-gray-500 line-clamp-1">{res.description || 'No description'}</div>
                      </button>
                    ))}
                  </div>
                  <div className="p-4 bg-blue-50 dark:bg-blue-900/10 rounded-2xl flex items-start">
                    <Info className="w-5 h-5 text-blue-500 mr-3 shrink-0 mt-0.5" />
                    <p className="text-xs text-blue-800 dark:text-blue-300 leading-relaxed">
                      Selecting specific resources ensures the AI only books this service in locations that have the necessary tools or space.
                    </p>
                  </div>
                </div>
              )}

              {wizardStep === 3 && (
                <div className="space-y-6 animate-in slide-in-from-right-4 duration-300">
                  <header>
                    <h2 className="text-2xl font-bold mb-2">Qualified Experts</h2>
                    <p className="text-gray-500 dark:text-gray-400">Who is trained to perform this service?</p>
                  </header>
                  <div className="grid grid-cols-2 gap-3">
                    {employees.map(emp => (
                      <button 
                        key={emp.id}
                        onClick={() => setSelectedEmployeeIds(prev => prev.includes(emp.id) ? prev.filter(id => id !== emp.id) : [...prev, emp.id])}
                        className={`p-4 rounded-2xl text-left border-2 transition-all ${selectedEmployeeIds.includes(emp.id) ? 'border-blue-600 bg-blue-50 dark:bg-blue-900/20' : 'border-transparent bg-gray-50 dark:bg-[#222] hover:bg-gray-100 dark:hover:bg-gray-800'}`}
                      >
                        <div className="font-bold">{emp.name}</div>
                        <div className="text-xs text-gray-500 line-clamp-1">{emp.skills.join(', ') || 'No skills listed'}</div>
                      </button>
                    ))}
                  </div>
                  <div className="p-6 bg-green-50 dark:bg-green-900/10 rounded-[2rem] border border-green-100 dark:border-green-800/30">
                    <h4 className="text-sm font-bold text-green-800 dark:text-green-400 mb-2 flex items-center">
                      <CheckCircle2 className="w-4 h-4 mr-2" /> Ready to Finalize
                    </h4>
                    <p className="text-xs text-green-700 dark:text-green-500 leading-relaxed">
                      You've selected {selectedEmployeeIds.length} expert(s) and {selectedResourceIds.length} location(s). 
                      Click <strong>Create Service</strong> to update your catalog and sync the AI's scheduling logic.
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* Footer Buttons */}
            <footer className="p-6 bg-gray-50 dark:bg-[#222] border-t border-gray-100 dark:border-gray-800 flex items-center justify-between">
              <button 
                onClick={() => wizardStep === 1 ? setIsWizardOpen(false) : prevStep()}
                className="px-6 py-3 text-gray-500 font-bold hover:bg-gray-200 dark:hover:bg-gray-800 rounded-xl transition-colors"
              >
                {wizardStep === 1 ? 'Cancel' : 'Back'}
              </button>
              
              {wizardStep < 3 ? (
                <button 
                  onClick={nextStep}
                  disabled={wizardStep === 1 && !wizardData.name}
                  className="px-8 py-3 bg-blue-600 text-white font-bold rounded-xl shadow-lg hover:bg-blue-700 active:scale-95 transition-all disabled:opacity-50 flex items-center"
                >
                  Next <ChevronRight className="w-4 h-4 ml-2" />
                </button>
              ) : (
                <button 
                  onClick={handleSaveService}
                  disabled={loading}
                  className="px-8 py-3 bg-green-600 text-white font-bold rounded-xl shadow-lg hover:bg-green-700 active:scale-95 transition-all flex items-center"
                >
                  {loading ? <Loader2 className="animate-spin w-5 h-5 mr-2" /> : 'Create Service'}
                </button>
              )}
            </footer>
          </div>
        </div>
      )}
    </div>
  )
}
