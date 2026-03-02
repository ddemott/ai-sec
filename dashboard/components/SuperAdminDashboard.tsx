'use client'

import React, { useEffect, useState } from 'react'
import { 
  Building2, 
  RefreshCw, 
  Search, 
  ChevronRight, 
  Save, 
  Loader2, 
  Globe, 
  MessageSquare, 
  Mic, 
  Phone,
  LayoutTemplate,
  Edit,
  X,
  Clock,
  ShieldAlert,
  Trash2
} from 'lucide-react'

export default function SuperAdminDashboard() {
  const [tenants, setTenants] = useState<any[]>([])
  const [selectedTenant, setSelectedTenant] = useState<any | null>(null)
  const [templates, setTemplates] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  
  // Edit form state
  const [form, setForm] = useState<any>(null)
  
  // Create Modal State
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)
  const [newBusiness, setNewBusiness] = useState({
    tenant_name: '',
    business_type: 'mobile-tire',
    owner_name: '',
    owner_email: '',
    owner_pass: ''
  })

  useEffect(() => {
    fetchData()
  }, [])

  useEffect(() => {
    if (selectedTenant) {
      setForm({ ...selectedTenant })
      setIsEditing(false) // Default to read-only when switching tenants
      setSuccess(false)
      setError(null)
    }
  }, [selectedTenant])

  async function fetchData() {
    setLoading(true)
    try {
      console.log('Fetching from http://localhost:3000/tenants...')
      const [tRes, tempRes] = await Promise.all([
        fetch('http://localhost:3000/tenants'),
        fetch('http://localhost:3000/templates')
      ])
      const tData = await tRes.json()
      const tempData = await tempRes.json()
      console.log('Fetched tenants:', tData)
      
      setTenants(Array.isArray(tData) ? tData : [])
      setTemplates(Array.isArray(tempData) ? tempData : [])
      if (tData.length > 0 && !selectedTenant) {
        setSelectedTenant(tData[0])
      }
    } catch (e) {
      setError('Failed to load data from backend')
    } finally {
      setLoading(false)
    }
  }

  async function handleSave() {
    if (!form) return
    setSaving(true)
    setError(null)
    setSuccess(false)

    try {
      const response = await fetch(`http://localhost:3000/tenants/${form.id}/update-attributes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })

      if (response.ok) {
        setSuccess(true)
        setIsEditing(false)
        const updatedTenants = tenants.map(t => t.id === form.id ? { ...form } : t)
        setTenants(updatedTenants)
        setSelectedTenant({ ...form })
      } else {
        setError('Failed to update business attributes')
      }
    } catch (e) {
      setError('Connection error')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!selectedTenant) return
    if (!confirm(`Permanently delete ${selectedTenant.name}? This will remove all their data.`)) return
    
    try {
        const res = await fetch(`http://localhost:3000/tenants/${selectedTenant.id}`, {
            method: 'DELETE'
        })
        if (res.ok) {
            setSelectedTenant(null)
            fetchData()
        }
    } catch (e) {
        console.error(e)
    }
  }

  async function handleCreate() {
    setSaving(true)
    setError(null)
    try {
        const res = await fetch('http://localhost:3000/tenants/create', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(newBusiness)
        })
        if (res.ok) {
            setIsCreateModalOpen(false)
            setNewBusiness({
                tenant_name: '',
                business_type: 'mobile-tire',
                owner_name: '',
                owner_email: '',
                owner_pass: ''
            })
            fetchData()
        } else {
            setError('Failed to create new business')
        }
    } catch (e) {
        setError('Connection error')
    } finally {
        setSaving(false)
    }
  }

  if (loading) return <div className="p-8 text-gray-500 italic flex items-center"><RefreshCw className="w-4 h-4 mr-2 animate-spin" /> Loading all businesses...</div>

  return (
    <div className="flex flex-1 overflow-hidden relative text-gray-900 dark:text-gray-100 bg-white dark:bg-[#111] transition-colors duration-200">
      
      {/* Create Modal */}
      {isCreateModalOpen && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white dark:bg-[#1a1a1a] rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in duration-200 border dark:border-gray-800">
                <header className="p-6 bg-gray-50 dark:bg-[#222] border-b border-gray-100 dark:border-gray-800 flex justify-between items-center">
                    <h3 className="text-xl font-bold flex items-center">
                        <Building2 className="w-5 h-5 mr-2 text-blue-600 dark:text-blue-400" />
                        Launch New Business
                    </h3>
                    <button onClick={() => setIsCreateModalOpen(false)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
                        <X className="w-6 h-6" />
                    </button>
                </header>
                <div className="p-6 space-y-4">
                    <div className="space-y-1">
                        <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest ml-1">Business Name</label>
                        <input 
                            type="text" 
                            placeholder="e.g. Elite Salon & Spa"
                            value={newBusiness.tenant_name}
                            onChange={e => setNewBusiness({...newBusiness, tenant_name: e.target.value})}
                            className="w-full p-3 bg-gray-50 dark:bg-[#222] border border-gray-100 dark:border-gray-800 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 text-sm dark:text-gray-100"
                        />
                    </div>
                    <div className="space-y-1">
                        <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest ml-1">Template Type</label>
                        <select 
                            value={newBusiness.business_type}
                            onChange={e => setNewBusiness({...newBusiness, business_type: e.target.value})}
                            className="w-full p-3 bg-gray-50 dark:bg-[#222] border border-gray-100 dark:border-gray-800 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 text-sm dark:text-gray-100"
                        >
                            {templates.map(t => (
                                <option key={t.business_type} value={t.business_type}>{t.display_name}</option>
                            ))}
                        </select>
                    </div>
                    <div className="pt-4 border-t border-gray-50 dark:border-gray-800 space-y-4">
                        <h4 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Initial Owner Credentials</h4>
                        <div className="grid grid-cols-2 gap-3">
                            <input 
                                type="text" 
                                placeholder="Full Name"
                                value={newBusiness.owner_name}
                                onChange={e => setNewBusiness({...newBusiness, owner_name: e.target.value})}
                                className="w-full p-3 bg-gray-50 dark:bg-[#222] border border-gray-100 dark:border-gray-800 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 text-sm dark:text-gray-100"
                            />
                            <input 
                                type="email" 
                                placeholder="Email"
                                value={newBusiness.owner_email}
                                onChange={e => setNewBusiness({...newBusiness, owner_email: e.target.value})}
                                className="w-full p-3 bg-gray-50 dark:bg-[#222] border border-gray-100 dark:border-gray-800 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 text-sm dark:text-gray-100"
                            />
                        </div>
                        <input 
                            type="password" 
                            placeholder="Owner Password"
                            value={newBusiness.owner_pass}
                            onChange={e => setNewBusiness({...newBusiness, owner_pass: e.target.value})}
                            className="w-full p-3 bg-gray-50 dark:bg-[#222] border border-gray-100 dark:border-gray-800 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 text-sm dark:text-gray-100"
                        />
                    </div>
                </div>
                <footer className="p-6 bg-gray-50 dark:bg-[#222] border-t border-gray-100 dark:border-gray-800 flex space-x-3">
                    <button 
                        onClick={() => setIsCreateModalOpen(false)}
                        className="flex-1 py-3 text-gray-500 font-bold text-sm hover:bg-gray-100 dark:hover:bg-[#333] rounded-xl transition"
                    >
                        Cancel
                    </button>
                    <button 
                        onClick={handleCreate}
                        disabled={saving || !newBusiness.tenant_name}
                        className="flex-2 px-8 py-3 bg-blue-600 text-white rounded-xl font-bold text-sm hover:bg-blue-700 transition shadow-lg disabled:opacity-50 flex items-center justify-center"
                    >
                        {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
                        Deploy Business
                    </button>
                </footer>
            </div>
        </div>
      )}
      
      {/* Sidebar List */}
      <section className="w-full md:w-80 flex flex-col bg-gray-50 dark:bg-[#1a1a1a] border-r border-gray-200 dark:border-gray-800 transition-colors duration-200">
        <header className="p-4 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-[#1a1a1a] sticky top-0 z-10 transition-colors duration-200">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-bold flex items-center">
                <Globe className="w-5 h-5 mr-2 text-blue-600 dark:text-blue-400" />
                All Businesses
            </h2>
            <div className="flex items-center space-x-1">
                <button 
                    onClick={() => setIsCreateModalOpen(true)} 
                    className="p-1.5 bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900/40 rounded-lg transition"
                    title="Launch New Business"
                >
                    <Building2 className="w-4 h-4" />
                </button>
                <button onClick={fetchData} className="p-1.5 hover:bg-gray-100 dark:hover:bg-[#333] rounded-lg text-gray-500 dark:text-gray-400">
                    <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                </button>
            </div>
          </div>
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-2.5 text-gray-400 dark:text-gray-500" />
            <input type="text" placeholder="Search businesses..." className="w-full pl-9 pr-4 py-2 bg-gray-100 dark:bg-[#222] border-none rounded-md text-sm outline-none dark:text-gray-200 transition-colors duration-200" />
          </div>
        </header>

        <div className="flex-1 overflow-y-auto">
          {tenants.map((t) => (
            <div 
              key={t.id}
              onClick={() => setSelectedTenant(t)}
              className={`p-4 border-b border-gray-100 dark:border-gray-800 cursor-pointer transition flex justify-between items-center
                ${selectedTenant?.id === t.id ? 'bg-white dark:bg-[#2a2a2a] border-l-4 border-l-blue-600 dark:border-l-blue-400 shadow-sm' : 'hover:bg-gray-100 dark:hover:bg-[#222]'}`}
            >
              <div>
                <p className={`text-sm font-semibold ${selectedTenant?.id === t.id ? 'text-blue-600 dark:text-blue-400' : 'text-gray-900 dark:text-gray-100'}`}>{t.name}</p>
                <div className="flex items-center mt-1">
                    <span className="text-[10px] bg-gray-200 dark:bg-[#333] text-gray-600 dark:text-gray-400 px-1.5 py-0.5 rounded font-bold uppercase tracking-tighter mr-2">
                        {t.business_type}
                    </span>
                    <span className="text-[10px] text-gray-400 dark:text-gray-500 font-mono truncate max-w-[100px]">{t.id.slice(0,8)}</span>
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-gray-300 dark:text-gray-600" />
            </div>
          ))}
        </div>
      </section>

      {/* Detail Pane */}
      <section className="flex-1 flex flex-col bg-white dark:bg-[#111] overflow-y-auto transition-colors duration-200">
        {selectedTenant && form ? (
          <>
            <header className="p-4 md:p-8 border-b border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-[#1a1a1a] flex items-center justify-between sticky top-0 bg-white dark:bg-[#111] z-10 transition-colors duration-200">
              <div className="flex items-center">
                <div className="bg-blue-600 dark:bg-blue-700 p-2 rounded-lg mr-4 shadow-md text-white">
                  <Building2 className="w-6 h-6" />
                </div>
                <div>
                  <h1 className="text-xl md:text-3xl font-bold dark:text-white">{selectedTenant.name}</h1>
                  <p className="text-sm text-gray-500 dark:text-gray-400 font-mono italic">
                    {isEditing ? 'Global Attributes Editor' : 'Business Settings Overview'}
                  </p>
                </div>
              </div>
              <div className="flex items-center space-x-3">
                {success && <span className="text-green-600 dark:text-green-400 text-sm font-bold flex items-center mr-2"><Save className="w-4 h-4 mr-1" /> Updated!</span>}
                {!isEditing ? (
                    <>
                        <button onClick={handleDelete} className="p-2 text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20 rounded-lg transition" title="Delete Business"><Trash2 className="w-5 h-5" /></button>
                        <button 
                            onClick={() => setIsEditing(true)}
                            className="flex items-center px-6 py-2.5 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800 bg-white dark:bg-transparent rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/20 transition font-bold text-sm shadow-sm"
                        >
                            <Edit className="w-4 h-4 mr-2" /> Modify Attributes
                        </button>
                    </>
                ) : (
                    <>
                        <button onClick={() => setIsEditing(false)} className="p-2.5 text-gray-400 hover:bg-gray-100 dark:hover:bg-[#333] rounded-lg transition">
                            <X className="w-5 h-5" />
                        </button>
                        <button 
                            onClick={handleSave}
                            disabled={saving}
                            className="flex items-center px-6 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition font-bold text-sm shadow-sm disabled:opacity-50"
                        >
                            {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
                            Save Changes
                        </button>
                    </>
                )}
              </div>
            </header>

            <div className="p-4 md:p-8 space-y-8 max-w-4xl">
              
              {error && (
                <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-900/40 text-red-700 dark:text-red-400 rounded-xl text-sm font-medium">
                  {error}
                </div>
              )}

              {/* Core Identity */}
              <section className="bg-gray-50 dark:bg-[#1a1a1a] p-6 rounded-2xl border border-gray-100 dark:border-gray-800 space-y-6 transition-colors duration-200">
                <div className="flex items-center justify-between border-b dark:border-gray-800 pb-4">
                    <h3 className="text-xs font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest">Business Identity & Operations</h3>
                    {!isEditing && <span className="text-[10px] bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400 px-2 py-0.5 rounded font-bold uppercase">Read Only</span>}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    <div className="space-y-4">
                        <div className="space-y-1">
                            <label className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase ml-1">Display Name</label>
                            {isEditing ? (
                                <input 
                                    type="text" 
                                    value={form.name} 
                                    onChange={e => setForm({...form, name: e.target.value})}
                                    className="w-full p-2.5 bg-white dark:bg-[#222] border border-gray-200 dark:border-gray-800 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 text-sm shadow-inner dark:text-gray-100" 
                                />
                            ) : (
                                <p className="p-2.5 font-bold text-lg text-gray-900 dark:text-white">{selectedTenant.name}</p>
                            )}
                        </div>
                        <div className="space-y-1">
                            <label className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase ml-1 flex items-center">
                                <LayoutTemplate className="w-3 h-3 mr-1" /> Template Type
                            </label>
                            {isEditing ? (
                                <select 
                                    value={form.business_type} 
                                    onChange={e => setForm({...form, business_type: e.target.value})}
                                    className="w-full p-2.5 bg-white dark:bg-[#222] border border-gray-200 dark:border-gray-800 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 text-sm shadow-inner dark:text-gray-100"
                                >
                                    {templates.map(t => (
                                        <option key={t.business_type} value={t.business_type}>{t.display_name}</option>
                                    ))}
                                </select>
                            ) : (
                                <p className="p-2.5 text-blue-700 dark:text-blue-400 font-bold uppercase tracking-tight text-sm">
                                    {templates.find(t => t.business_type === selectedTenant.business_type)?.display_name || selectedTenant.business_type}
                                </p>
                            )}
                        </div>
                    </div>
                    <div className="space-y-4">
                        <div className="space-y-1">
                            <label className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase ml-1 flex items-center">
                                <Clock className="w-3 h-3 mr-1" /> Timezone
                            </label>
                            {isEditing ? (
                                <input 
                                    type="text" 
                                    value={form.timezone} 
                                    onChange={e => setForm({...form, timezone: e.target.value})}
                                    className="w-full p-2.5 bg-white dark:bg-[#222] border border-gray-200 dark:border-gray-800 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 text-sm shadow-inner dark:text-gray-100" 
                                />
                            ) : (
                                <p className="p-2.5 text-gray-700 dark:text-gray-300 font-medium">{selectedTenant.timezone}</p>
                            )}
                        </div>
                        <div className="space-y-1">
                            <label className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase ml-1 flex items-center">
                                <Phone className="w-3 h-3 mr-1" /> Owner Notification Phone
                            </label>
                            {isEditing ? (
                                <input 
                                    type="text" 
                                    value={form.owner_phone || ''} 
                                    onChange={e => setForm({...form, owner_phone: e.target.value})}
                                    className="w-full p-2.5 bg-white dark:bg-[#222] border border-gray-200 dark:border-gray-800 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 text-sm shadow-inner dark:text-gray-100" 
                                    placeholder="+15550000000"
                                />
                            ) : (
                                <p className="p-2.5 text-gray-700 dark:text-gray-300 font-medium font-mono">{selectedTenant.owner_phone || 'Not set'}</p>
                            )}
                        </div>
                    </div>
                </div>
              </section>

              {/* AI Config */}
              <section className="space-y-6">
                <div className="flex items-center space-x-2 text-gray-700 dark:text-gray-200 border-b border-gray-100 dark:border-gray-800 pb-2">
                    <ShieldAlert className="w-5 h-5 text-amber-500" />
                    <h2 className="text-lg font-bold tracking-tight">AI Secretary Core Attributes</h2>
                </div>
                
                <div className="space-y-6">
                    <div className="space-y-1">
                        <label className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase ml-1 flex items-center">
                            <Mic className="w-3 h-3 mr-1" /> Voice ID (Vapi/ElevenLabs)
                        </label>
                        {isEditing ? (
                            <input 
                                type="text" 
                                value={form.voice_id || ''} 
                                onChange={e => setForm({...form, voice_id: e.target.value})}
                                className="w-full p-2.5 bg-white dark:bg-[#222] border border-gray-200 dark:border-gray-800 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 text-sm font-mono shadow-inner dark:text-gray-100" 
                            />
                        ) : (
                            <p className="p-3 bg-gray-50 dark:bg-[#1a1a1a] rounded-xl text-gray-600 dark:text-gray-400 font-mono text-xs border dark:border-gray-800">{selectedTenant.voice_id || 'Not set'}</p>
                        )}
                    </div>

                    <div className="space-y-1">
                        <label className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase ml-1 flex items-center">
                            <MessageSquare className="w-3 h-3 mr-1" /> First Message (Greeting)
                        </label>
                        {isEditing ? (
                            <input 
                                type="text" 
                                value={form.first_message || ''} 
                                onChange={e => setForm({...form, first_message: e.target.value})}
                                className="w-full p-2.5 bg-white dark:bg-[#222] border border-gray-200 dark:border-gray-800 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 text-sm shadow-inner dark:text-gray-100" 
                            />
                        ) : (
                            <p className="p-3 bg-gray-50 dark:bg-[#1a1a1a] rounded-xl text-gray-700 dark:text-gray-300 italic border-l-4 border-blue-200 dark:border-l-blue-900 leading-relaxed">"{selectedTenant.first_message || 'No greeting set'}"</p>
                        )}
                    </div>

                    <div className="space-y-1">
                        <label className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase ml-1 flex items-center">
                            <RefreshCw className="w-3 h-3 mr-1" /> System Prompt (Brain)
                        </label>
                        {isEditing ? (
                            <textarea 
                                rows={10}
                                value={form.system_prompt || ''} 
                                onChange={e => setForm({...form, system_prompt: e.target.value})}
                                className="w-full p-4 bg-white dark:bg-[#222] border border-gray-200 dark:border-gray-800 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 text-sm font-mono shadow-inner dark:text-gray-100" 
                            />
                        ) : (
                            <div className="p-4 bg-gray-50 dark:bg-[#1a1a1a] rounded-xl text-gray-600 dark:text-gray-400 text-sm leading-relaxed font-mono whitespace-pre-wrap max-h-60 overflow-y-auto border border-gray-100 dark:border-gray-800">
                                {selectedTenant.system_prompt || 'No prompt configured.'}
                            </div>
                        )}
                    </div>
                </div>
              </section>

              {isEditing && (
                <div className="pt-8 border-t border-gray-200 dark:border-gray-800 flex flex-col md:flex-row space-y-3 md:space-y-0 md:space-x-4">
                    <button 
                        onClick={handleSave}
                        disabled={saving}
                        className="flex-1 px-12 py-4 bg-blue-600 text-white rounded-2xl font-bold text-lg shadow-xl hover:bg-blue-700 transition flex items-center justify-center disabled:opacity-50"
                    >
                        {saving ? <Loader2 className="w-6 h-6 mr-3 animate-spin" /> : <Save className="w-6 h-6 mr-3" />}
                        Save All Global Attributes
                    </button>
                    <button 
                        onClick={() => setIsEditing(false)}
                        className="px-8 py-4 bg-white dark:bg-transparent text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-800 rounded-2xl font-bold hover:bg-gray-50 dark:hover:bg-[#222] transition"
                    >
                        Cancel
                    </button>
                </div>
              )}

            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-gray-400 dark:text-gray-600 italic">Select a business to manage its global attributes</div>
        )}
      </section>
    </div>
  )
}
