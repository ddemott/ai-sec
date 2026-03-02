'use client'

import React, { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Customer } from '@/lib/types'
import { MOCK_CUSTOMERS, MOCK_SUMMARIES } from '@/lib/mockData'
import { 
  Users, 
  Search, 
  RefreshCw, 
  ChevronRight, 
  ChevronLeft,
  Phone, 
  Mail,
  MapPin,
  History,
  MessageSquare,
  Edit2,
  Save,
  X,
  Trash2,
  UserPlus,
  Loader2
} from 'lucide-react'

export default function CRMView() {
  const [customers, setCustomers] = useState<Customer[]>([])
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null)
  const [summaries, setSummaries] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [showDetailOnMobile, setShowDetailOnMobile] = useState(false)
  
  // States
  const [isEditing, setIsEditing] = useState(false)
  const [isCreating, setIsCreating] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editForm, setEditForm] = useState({ name: '', phone: '', email: '', address: '', notes: '' })

  useEffect(() => {
    fetchCustomers()
  }, [])

  useEffect(() => {
    if (selectedCustomer) {
        fetchHistory(selectedCustomer.id)
        setEditForm({
            name: selectedCustomer.name || '',
            phone: selectedCustomer.phone || '',
            email: selectedCustomer.email || '',
            address: selectedCustomer.address || '',
            notes: selectedCustomer.metadata?.notes || ''
        })
        setIsEditing(false)
        setIsCreating(false)
    }
  }, [selectedCustomer])

  async function fetchCustomers() {
    setLoading(true)
    const tenantId = localStorage.getItem('tenantId')
    try {
      const { data, error } = await supabase
        .from('customers')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('name', { ascending: true })
      if (error || !data || data.length === 0) {
        setCustomers(MOCK_CUSTOMERS)
        if (!selectedCustomer) setSelectedCustomer(MOCK_CUSTOMERS[0])
      } else {
        setCustomers(data)
        if (!selectedCustomer) setSelectedCustomer(data[0])
      }
    } catch (e) {
      setCustomers(MOCK_CUSTOMERS)
      if (!selectedCustomer) setSelectedCustomer(MOCK_CUSTOMERS[0])
    }
    setLoading(false)
  }

  async function fetchHistory(customerId: string) {
    try {
      const { data, error } = await supabase
        .from('call_summaries')
        .select('*')
        .eq('customer_id', customerId)
        .order('created_at', { ascending: false })
      
      if (error || !data || data.length === 0) {
        setSummaries(MOCK_SUMMARIES.filter(s => s.customer_id === customerId))
      } else {
        setSummaries(data)
      }
    } catch (e) {
      setSummaries(MOCK_SUMMARIES.filter(s => s.customer_id === customerId))
    }
  }

  async function handleSave() {
    if (!selectedCustomer) return
    setSaving(true)
    const tenantId = localStorage.getItem('tenantId')

    const { error } = await supabase
        .from('customers')
        .update({
            name: editForm.name,
            phone: editForm.phone,
            email: editForm.email,
            address: editForm.address,
            metadata: { ...selectedCustomer.metadata, notes: editForm.notes }
        })
        .eq('id', selectedCustomer.id)
    
    if (!error) {
        setIsEditing(false)
        fetchCustomers()
    }
    setSaving(false)
  }

  async function handleCreate() {
    setSaving(true)
    const tenantId = localStorage.getItem('tenantId')
    
    try {
        const res = await fetch('http://localhost:3000/customers/create', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                tenant_id: tenantId,
                name: editForm.name,
                phone: editForm.phone,
                email: editForm.email,
                address: editForm.address,
                metadata: { notes: editForm.notes }
            })
        })
        if (res.ok) {
            setIsCreating(false)
            fetchCustomers()
        }
    } catch (e) {
        console.error(e)
    }
    setSaving(false)
  }

  async function handleDelete() {
    if (!selectedCustomer) return
    if (!confirm(`Are you sure you want to delete ${selectedCustomer.name}? This cannot be undone.`)) return
    
    try {
        const res = await fetch(`http://localhost:3000/customers/${selectedCustomer.id}`, {
            method: 'DELETE'
        })
        if (res.ok) {
            setSelectedCustomer(null)
            fetchCustomers()
        }
    } catch (e) {
        console.error(e)
    }
  }

  const startNewCustomer = () => {
    setIsCreating(true)
    setIsEditing(false)
    setSelectedCustomer(null)
    setEditForm({ name: '', phone: '', email: '', address: '', notes: '' })
  }

  return (
    <div className="flex flex-1 overflow-hidden relative text-gray-900 dark:text-gray-100 transition-colors duration-200">
      {/* ITEM LIST PANE */}
      <section className={`w-full md:w-80 flex flex-col bg-gray-50 dark:bg-[#1a1a1a] border-r border-gray-200 dark:border-gray-800 ${showDetailOnMobile ? 'hidden md:flex' : 'flex'}`}>
        <header className="p-4 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-[#1a1a1a] sticky top-0 z-10">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-bold">People</h2>
            <div className="flex space-x-1">
                <button onClick={startNewCustomer} title="Add Customer" className="p-1.5 bg-blue-600 text-white rounded-md hover:bg-blue-700">
                    <UserPlus className="w-4 h-4" />
                </button>
                <button onClick={fetchCustomers} className="p-1.5 hover:bg-gray-100 dark:hover:bg-[#333] rounded text-gray-500 dark:text-gray-400">
                    <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                </button>
            </div>
          </div>
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-2.5 text-gray-400 dark:text-gray-500" />
            <input type="text" placeholder="Search customers..." className="w-full pl-9 pr-4 py-2 bg-gray-100 dark:bg-[#222] border-none rounded-md text-sm outline-none dark:text-gray-200" />
          </div>
        </header>
        <div className="flex-1 overflow-y-auto pb-20 md:pb-0">
          {customers.map((c) => (
            <div 
              key={c.id}
              onClick={() => { setSelectedCustomer(c); setIsCreating(false); setShowDetailOnMobile(true); }}
              className={`p-4 border-b border-gray-100 dark:border-gray-800 cursor-pointer transition flex justify-between items-center
                ${selectedCustomer?.id === c.id ? 'bg-white dark:bg-[#2a2a2a] border-l-4 border-l-blue-600 dark:border-l-blue-400' : 'hover:bg-gray-100 dark:hover:bg-[#222]'}`}
            >
              <div>
                <p className={`text-sm font-semibold ${selectedCustomer?.id === c.id ? 'text-blue-600 dark:text-blue-400' : 'text-gray-900 dark:text-gray-100'}`}>{c.name || 'Unknown'}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{c.phone}</p>
              </div>
              <ChevronRight className="w-4 h-4 text-gray-300 dark:text-gray-600" />
            </div>
          ))}
        </div>
      </section>

      {/* DETAIL PANE */}
      <section className={`flex-1 flex flex-col bg-white dark:bg-[#111] overflow-y-auto fixed inset-0 z-20 md:relative md:z-0 ${(showDetailOnMobile || isCreating) ? 'flex' : 'hidden md:flex'}`}>
        {(selectedCustomer || isCreating) ? (
          <>
            <header className="p-4 md:p-8 border-b border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-[#1a1a1a] flex items-center justify-between">
              <div className="flex items-center">
                <button 
                    onClick={() => { setShowDetailOnMobile(false); setIsCreating(false); }}
                    className="md:hidden p-2 -ml-2 mr-2 text-blue-600 dark:text-blue-400"
                >
                    <ChevronLeft className="w-6 h-6" />
                </button>
                <div className="flex items-center space-x-4">
                    <div className="w-12 h-12 md:w-16 md:h-16 bg-blue-600 dark:bg-blue-700 rounded-full flex items-center justify-center text-white text-xl md:text-2xl font-bold">
                    {isCreating ? '+' : (selectedCustomer?.name?.charAt(0) || '?')}
                    </div>
                    <div>
                    <h1 className="text-xl md:text-3xl font-bold dark:text-white">{isCreating ? 'New Customer' : (selectedCustomer?.name || 'Unknown')}</h1>
                    {!isCreating && (
                        <p className="text-gray-500 dark:text-gray-400 text-sm md:text-base flex items-center">
                            <Phone className="w-4 h-4 mr-2" /> {selectedCustomer?.phone}
                        </p>
                    )}
                    </div>
                </div>
              </div>
              
              <div className="flex items-center space-x-2">
                {!isEditing && !isCreating ? (
                    <>
                        <button 
                            onClick={handleDelete}
                            className="p-2 text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20 rounded-md transition"
                            title="Delete Customer"
                        >
                            <Trash2 className="w-5 h-5" />
                        </button>
                        <button 
                            onClick={() => setIsEditing(true)}
                            className="flex items-center px-4 py-2 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-md transition font-medium text-sm border border-blue-100 dark:border-blue-800"
                        >
                            <Edit2 className="w-4 h-4 mr-2" /> Edit Info
                        </button>
                    </>
                ) : (
                    <div className="flex space-x-2">
                        <button onClick={() => { setIsEditing(false); setIsCreating(false); }} className="p-2 text-gray-400 hover:bg-gray-100 dark:hover:bg-[#333] rounded-md">
                            <X className="w-5 h-5" />
                        </button>
                        <button 
                            onClick={isCreating ? handleCreate : handleSave} 
                            disabled={saving}
                            className="flex items-center px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition font-medium text-sm shadow-sm disabled:opacity-50"
                        >
                            {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
                            {isCreating ? 'Create Customer' : 'Save Changes'}
                        </button>
                    </div>
                )}
              </div>
            </header>

            <div className="p-4 md:p-8 space-y-8">
              <div className="bg-white dark:bg-[#1a1a1a] p-6 rounded-xl border border-gray-200 dark:border-gray-800 shadow-sm max-w-2xl">
                <h3 className="font-bold mb-4 flex items-center text-sm uppercase tracking-wider text-gray-400 dark:text-gray-500">Contact Details & Notes</h3>
                {(!isEditing && !isCreating) ? (
                    <div className="space-y-4 text-sm">
                        <div className="flex items-start">
                            <Mail className="w-4 h-4 mr-3 text-gray-400 dark:text-gray-500 mt-0.5" />
                            <span className="dark:text-gray-300">{selectedCustomer?.email || 'No email provided'}</span>
                        </div>
                        <div className="flex items-start">
                            <MapPin className="w-4 h-4 mr-3 text-gray-400 dark:text-gray-500 mt-0.5" />
                            <span className="dark:text-gray-300">{selectedCustomer?.address || 'No address on file'}</span>
                        </div>
                        <div className="mt-6 pt-6 border-t border-gray-100 dark:border-gray-800">
                            <p className="text-xs font-bold text-gray-400 dark:text-gray-500 uppercase mb-2">Internal Notes</p>
                            <p className="text-gray-700 dark:text-gray-400 italic leading-relaxed">
                                {selectedCustomer?.metadata?.notes || 'No internal notes added yet.'}
                            </p>
                        </div>
                    </div>
                ) : (
                    <div className="space-y-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label className="block text-xs font-bold text-gray-400 dark:text-gray-500 uppercase mb-1">Full Name</label>
                                <input 
                                    type="text" 
                                    value={editForm.name} 
                                    onChange={(e) => setEditForm({...editForm, name: e.target.value})}
                                    className="w-full p-2.5 bg-gray-50 dark:bg-[#222] border border-gray-200 dark:border-gray-800 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500 dark:text-gray-100"
                                    placeholder="Customer Name"
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-gray-400 dark:text-gray-500 uppercase mb-1">Phone Number</label>
                                <input 
                                    type="text" 
                                    value={editForm.phone} 
                                    onChange={(e) => setEditForm({...editForm, phone: e.target.value})}
                                    className="w-full p-2.5 bg-gray-50 dark:bg-[#222] border border-gray-200 dark:border-gray-800 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500 dark:text-gray-100"
                                    placeholder="+15550000000"
                                />
                            </div>
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-gray-400 dark:text-gray-500 uppercase mb-1">Email</label>
                            <input 
                                type="email" 
                                value={editForm.email} 
                                onChange={(e) => setEditForm({...editForm, email: e.target.value})}
                                className="w-full p-2.5 bg-gray-50 dark:bg-[#222] border border-gray-200 dark:border-gray-800 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500 dark:text-gray-100"
                                placeholder="customer@email.com"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-gray-400 dark:text-gray-500 uppercase mb-1">Address</label>
                            <input 
                                type="text" 
                                value={editForm.address} 
                                onChange={(e) => setEditForm({...editForm, address: e.target.value})}
                                className="w-full p-2.5 bg-gray-50 dark:bg-[#222] border border-gray-200 dark:border-gray-800 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500 dark:text-gray-100"
                                placeholder="123 Street St, City, ST"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-gray-400 dark:text-gray-500 uppercase mb-1">Internal Notes</label>
                            <textarea 
                                rows={4}
                                value={editForm.notes} 
                                onChange={(e) => setEditForm({...editForm, notes: e.target.value})}
                                className="w-full p-2.5 bg-gray-50 dark:bg-[#222] border border-gray-200 dark:border-gray-800 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500 dark:text-gray-100"
                                placeholder="Add private notes the AI should consider..."
                            />
                        </div>
                    </div>
                )}
              </div>

              {!isCreating && (
                <div className="space-y-6">
                    <h3 className="font-bold text-gray-900 dark:text-white flex items-center text-lg">
                    <History className="w-5 h-5 mr-2 text-gray-400 dark:text-gray-500" />
                    AI Call History
                    </h3>
                    <div className="space-y-4">
                    {summaries.length > 0 ? summaries.map((s) => (
                        <div key={s.id} className="p-5 border border-gray-100 dark:border-gray-800 rounded-xl bg-white dark:bg-[#1a1a1a] shadow-sm">
                        <div className="flex justify-between text-xs text-gray-400 dark:text-gray-500 mb-2">
                            <span className="font-bold text-blue-600 dark:text-blue-400 uppercase">AI Summary</span>
                            <span>{new Date(s.created_at).toLocaleDateString()}</span>
                        </div>
                        <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed italic">"{s.summary}"</p>
                        </div>
                    )) : (
                        <p className="text-gray-400 dark:text-gray-600 italic text-sm">No call history available.</p>
                    )}
                    </div>
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-gray-400 dark:text-gray-600 italic text-center px-4 flex-col">
            <Users className="w-12 h-12 mb-4 opacity-20" />
            Select a customer or click the "+" button to add one.
          </div>
        )}
      </section>
    </div>
  )
}
