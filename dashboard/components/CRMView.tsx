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
  X
} from 'lucide-react'

export default function CRMView() {
  const [customers, setCustomers] = useState<Customer[]>([])
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null)
  const [summaries, setSummaries] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [showDetailOnMobile, setShowDetailOnMobile] = useState(false)
  
  // Edit State
  const [isEditing, setIsEditing] = useState(false)
  const [editForm, setEditEditForm] = useState({ name: '', email: '', address: '', notes: '' })

  useEffect(() => {
    fetchCustomers()
  }, [])

  useEffect(() => {
    if (selectedCustomer) {
        fetchHistory(selectedCustomer.id)
        setEditEditForm({
            name: selectedCustomer.name || '',
            email: selectedCustomer.email || '',
            address: selectedCustomer.address || '',
            notes: selectedCustomer.metadata?.notes || ''
        })
        setIsEditing(false)
    }
  }, [selectedCustomer])

  async function fetchCustomers() {
    setLoading(true)
    try {
      const { data, error } = await supabase.from('customers').select('*').order('name', { ascending: true })
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
    
    // Mock save for local dev
    const updatedCustomer: Customer = {
        ...selectedCustomer,
        name: editForm.name,
        email: editForm.email,
        address: editForm.address,
        metadata: { ...selectedCustomer.metadata, notes: editForm.notes }
    }
    setSelectedCustomer(updatedCustomer)
    setCustomers(customers.map(c => c.id === selectedCustomer.id ? updatedCustomer : c))
    setIsEditing(false)

    // Attempt real save
    await supabase
        .from('customers')
        .update({
            name: editForm.name,
            email: editForm.email,
            address: editForm.address,
            metadata: { ...selectedCustomer.metadata, notes: editForm.notes }
        })
        .eq('id', selectedCustomer.id)
  }

  const handleSelect = (c: Customer) => {
    setSelectedCustomer(c)
    setShowDetailOnMobile(true)
  }

  return (
    <div className="flex flex-1 overflow-hidden relative text-gray-900">
      {/* ITEM LIST PANE */}
      <section className={`w-full md:w-80 flex flex-col bg-gray-50 border-r border-gray-200 ${showDetailOnMobile ? 'hidden md:flex' : 'flex'}`}>
        <header className="p-4 border-b border-gray-200 bg-white sticky top-0 z-10">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-bold">People</h2>
            <button onClick={fetchCustomers} className="p-1 hover:bg-gray-100 rounded text-gray-500">
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-2.5 text-gray-400" />
            <input type="text" placeholder="Search customers..." className="w-full pl-9 pr-4 py-2 bg-gray-100 border-none rounded-md text-sm outline-none" />
          </div>
        </header>
        <div className="flex-1 overflow-y-auto pb-20 md:pb-0">
          {customers.map((c) => (
            <div 
              key={c.id}
              onClick={() => handleSelect(c)}
              className={`p-4 border-b border-gray-100 cursor-pointer transition flex justify-between items-center
                ${selectedCustomer?.id === c.id ? 'bg-white border-l-4 border-l-blue-600' : 'hover:bg-gray-100'}`}
            >
              <div>
                <p className={`text-sm font-semibold ${selectedCustomer?.id === c.id ? 'text-blue-600' : 'text-gray-900'}`}>{c.name || 'Unknown'}</p>
                <p className="text-xs text-gray-500 mt-1">{c.phone}</p>
              </div>
              <ChevronRight className="w-4 h-4 text-gray-300" />
            </div>
          ))}
        </div>
      </section>

      {/* DETAIL PANE */}
      <section className={`flex-1 flex flex-col bg-white overflow-y-auto fixed inset-0 z-20 md:relative md:z-0 ${showDetailOnMobile ? 'flex' : 'hidden md:flex'}`}>
        {selectedCustomer ? (
          <>
            <header className="p-4 md:p-8 border-b border-gray-100 bg-gray-50/50 flex items-center justify-between">
              <div className="flex items-center">
                <button 
                    onClick={() => setShowDetailOnMobile(false)}
                    className="md:hidden p-2 -ml-2 mr-2 text-blue-600"
                >
                    <ChevronLeft className="w-6 h-6" />
                </button>
                <div className="flex items-center space-x-4">
                    <div className="w-12 h-12 md:w-16 md:h-16 bg-blue-600 rounded-full flex items-center justify-center text-white text-xl md:text-2xl font-bold">
                    {selectedCustomer.name?.charAt(0) || '?'}
                    </div>
                    <div>
                    <h1 className="text-xl md:text-3xl font-bold">{selectedCustomer.name || 'Unknown'}</h1>
                    <p className="text-gray-500 text-sm md:text-base flex items-center">
                        <Phone className="w-4 h-4 mr-2" /> {selectedCustomer.phone}
                    </p>
                    </div>
                </div>
              </div>
              {!isEditing ? (
                <button 
                    onClick={() => setIsEditing(true)}
                    className="flex items-center px-4 py-2 text-blue-600 hover:bg-blue-50 rounded-md transition font-medium text-sm border border-blue-100"
                >
                    <Edit2 className="w-4 h-4 mr-2" /> Edit Info
                </button>
              ) : (
                <div className="flex space-x-2">
                    <button onClick={() => setIsEditing(false)} className="p-2 text-gray-400 hover:bg-gray-100 rounded-md">
                        <X className="w-5 h-5" />
                    </button>
                    <button onClick={handleSave} className="flex items-center px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition font-medium text-sm shadow-sm">
                        <Save className="w-4 h-4 mr-2" /> Save
                    </button>
                </div>
              )}
            </header>

            <div className="p-4 md:p-8 space-y-8">
              <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm max-w-2xl">
                <h3 className="font-bold mb-4 flex items-center text-sm uppercase tracking-wider text-gray-400">Contact Details & Notes</h3>
                {!isEditing ? (
                    <div className="space-y-4 text-sm">
                        <div className="flex items-start">
                            <Mail className="w-4 h-4 mr-3 text-gray-400 mt-0.5" />
                            <span>{selectedCustomer.email || 'No email provided'}</span>
                        </div>
                        <div className="flex items-start">
                            <MapPin className="w-4 h-4 mr-3 text-gray-400 mt-0.5" />
                            <span>{selectedCustomer.address || 'No address on file'}</span>
                        </div>
                        <div className="mt-6 pt-6 border-t border-gray-100">
                            <p className="text-xs font-bold text-gray-400 uppercase mb-2">Internal Notes</p>
                            <p className="text-gray-700 italic leading-relaxed">
                                {selectedCustomer.metadata?.notes || 'No internal notes added yet.'}
                            </p>
                        </div>
                    </div>
                ) : (
                    <div className="space-y-4">
                        <div>
                            <label className="block text-xs font-bold text-gray-400 uppercase mb-1">Full Name</label>
                            <input 
                                type="text" 
                                value={editForm.name} 
                                onChange={(e) => setEditEditForm({...editForm, name: e.target.value})}
                                className="w-full p-2 border border-gray-200 rounded-md text-sm outline-none focus:ring-2 focus:ring-blue-500"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-gray-400 uppercase mb-1">Email</label>
                            <input 
                                type="email" 
                                value={editForm.email} 
                                onChange={(e) => setEditEditForm({...editForm, email: e.target.value})}
                                className="w-full p-2 border border-gray-200 rounded-md text-sm outline-none focus:ring-2 focus:ring-blue-500"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-gray-400 uppercase mb-1">Address</label>
                            <input 
                                type="text" 
                                value={editForm.address} 
                                onChange={(e) => setEditEditForm({...editForm, address: e.target.value})}
                                className="w-full p-2 border border-gray-200 rounded-md text-sm outline-none focus:ring-2 focus:ring-blue-500"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-gray-400 uppercase mb-1">Internal Notes</label>
                            <textarea 
                                rows={4}
                                value={editForm.notes} 
                                onChange={(e) => setEditEditForm({...editForm, notes: e.target.value})}
                                className="w-full p-2 border border-gray-200 rounded-md text-sm outline-none focus:ring-2 focus:ring-blue-500"
                                placeholder="Add private notes the AI should consider..."
                            />
                        </div>
                    </div>
                )}
              </div>

              <div className="space-y-6">
                <h3 className="font-bold text-gray-900 flex items-center text-lg">
                  <History className="w-5 h-5 mr-2 text-gray-400" />
                  AI Call History
                </h3>
                <div className="space-y-4">
                  {summaries.map((s) => (
                    <div key={s.id} className="p-5 border border-gray-100 rounded-xl bg-white shadow-sm">
                      <div className="flex justify-between text-xs text-gray-400 mb-2">
                        <span className="font-bold text-blue-600 uppercase">AI Summary</span>
                        <span>{new Date(s.created_at).toLocaleDateString()}</span>
                      </div>
                      <p className="text-sm text-gray-700 leading-relaxed italic">"{s.summary}"</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-gray-400 italic">Select a customer</div>
        )}
      </section>
    </div>
  )
}
