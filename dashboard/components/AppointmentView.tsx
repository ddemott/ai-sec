'use client'

import React, { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Appointment } from '@/lib/types'
import { MOCK_APPOINTMENTS } from '@/lib/mockData'
import { 
  Calendar, 
  RefreshCw, 
  ChevronRight, 
  ChevronLeft,
  Clock, 
  Phone, 
  User,
  XCircle,
  Search,
  CalendarClock,
  Save,
  X,
  MapPin,
  Navigation,
  Copy
} from 'lucide-react'

export default function AppointmentView() {
  const [appointments, setAppointments] = useState<Appointment[]>([])
  const [selectedAppointment, setSelectedAppointment] = useState<Appointment | null>(null)
  const [loading, setLoading] = useState(true)
  const [showDetailOnMobile, setShowDetailOnMobile] = useState(false)
  
  const [isRescheduling, setIsRescheduling] = useState(false)
  const [newTime, setNewTime] = useState('')

  useEffect(() => {
    fetchAppointments()
  }, [])

  useEffect(() => {
    if (selectedAppointment) {
        setIsRescheduling(false)
        setNewTime(new Date(selectedAppointment.start_time).toISOString().slice(0, 16))
    }
  }, [selectedAppointment])

  async function fetchAppointments() {
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('appointments')
        .select('*, customers (name, phone), resources (name)')
        .order('start_time', { ascending: true })
      
      if (error || !data || data.length === 0) {
        setAppointments(MOCK_APPOINTMENTS)
        if (!selectedAppointment) setSelectedAppointment(MOCK_APPOINTMENTS[0])
      } else {
        setAppointments(data)
        if (!selectedAppointment) setSelectedAppointment(data[0])
      }
    } catch (e) {
      setAppointments(MOCK_APPOINTMENTS)
      if (!selectedAppointment) setSelectedAppointment(MOCK_APPOINTMENTS[0])
    }
    setLoading(false)
  }

  async function handleReschedule() {
    if (!selectedAppointment) return
    const start = new Date(newTime)
    const end = new Date(start.getTime() + 60 * 60 * 1000)
    setAppointments(appointments.map(a => a.id === selectedAppointment.id ? { ...a, start_time: start.toISOString(), end_time: end.toISOString() } : a))
    setSelectedAppointment({ ...selectedAppointment, start_time: start.toISOString(), end_time: end.toISOString() })
    setIsRescheduling(false)
    await supabase.from('appointments').update({ start_time: start.toISOString(), end_time: end.toISOString() }).eq('id', selectedAppointment.id)
  }

  async function cancelAppointment(id: string) {
    setAppointments(appointments.map(a => a.id === id ? { ...a, status: 'canceled' } : a))
    if (selectedAppointment?.id === id) setSelectedAppointment({ ...selectedAppointment, status: 'canceled' })
    await supabase.from('appointments').update({ status: 'canceled' }).eq('id', id)
  }

  return (
    <div className="flex flex-1 overflow-hidden relative text-gray-900">
      
      <section className={`w-full md:w-80 flex flex-col bg-gray-50 border-r border-gray-200 ${showDetailOnMobile ? 'hidden md:flex' : 'flex'}`}>
        <header className="p-4 border-b border-gray-200 bg-white sticky top-0 z-10">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-bold">Appointments</h2>
            <button onClick={fetchAppointments} className="p-1 hover:bg-gray-100 rounded">
              <RefreshCw className={`w-4 h-4 text-gray-500 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-2.5 text-gray-400" />
            <input type="text" placeholder="Search bookings..." className="w-full pl-9 pr-4 py-2 bg-gray-100 border-none rounded-md text-sm outline-none" />
          </div>
        </header>

        <div className="flex-1 overflow-y-auto pb-20 md:pb-0">
          {appointments.map((apt) => (
            <div 
              key={apt.id}
              onClick={() => { setSelectedAppointment(apt); setShowDetailOnMobile(true); }}
              className={`p-4 border-b border-gray-100 cursor-pointer transition flex justify-between items-start
                ${selectedAppointment?.id === apt.id ? 'bg-white border-l-4 border-l-blue-600 shadow-sm' : 'hover:bg-gray-100'}`}
            >
              <div>
                <p className={`text-sm font-semibold ${selectedAppointment?.id === apt.id ? 'text-blue-600' : 'text-gray-900'}`}>
                  {apt.customers?.name || 'Unknown'}
                </p>
                <p className="text-xs text-gray-500 mt-1">
                  {new Date(apt.start_time).toLocaleDateString([], { month: 'short', day: 'numeric' })} at {new Date(apt.start_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </p>
              </div>
              <ChevronRight className="w-4 h-4 text-gray-300 mt-1" />
            </div>
          ))}
        </div>
      </section>

      <section className={`flex-1 flex flex-col bg-white overflow-y-auto fixed inset-0 z-20 md:relative md:z-0 ${showDetailOnMobile ? 'flex' : 'hidden md:flex'}`}>
        {selectedAppointment ? (
          <>
            <header className="p-4 md:p-8 border-b border-gray-100 bg-white sticky top-0 z-10 shadow-sm">
              <div className="flex items-start justify-between">
                <div className="flex items-start">
                    <button onClick={() => setShowDetailOnMobile(false)} className="md:hidden p-2 -ml-2 mr-2 text-blue-600"><ChevronLeft className="w-6 h-6" /></button>
                    <div>
                        <h1 className="text-2xl md:text-3xl font-bold text-gray-900">{selectedAppointment.description}</h1>
                        <div className="mt-4 p-4 bg-blue-50 border border-blue-100 rounded-xl inline-block">
                            <p className="text-xs font-bold text-blue-600 uppercase tracking-widest mb-1">When</p>
                            <p className="text-lg md:text-xl font-bold text-blue-900">
                                {new Date(selectedAppointment.start_time).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}
                            </p>
                            <p className="text-blue-700 font-medium">
                                {new Date(selectedAppointment.start_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} - {new Date(selectedAppointment.end_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </p>
                        </div>
                    </div>
                </div>
                <div className="flex space-x-2">
                    {!isRescheduling && selectedAppointment.status === 'scheduled' && (
                        <button onClick={() => setIsRescheduling(true)} className="flex items-center px-4 py-2 text-blue-600 hover:bg-blue-50 rounded-lg transition font-bold text-sm border border-blue-200">
                            <CalendarClock className="w-4 h-4 mr-2" /> Reschedule
                        </button>
                    )}
                </div>
              </div>
            </header>
            
            <div className="p-4 md:p-8 space-y-8">
                {isRescheduling ? (
                    <div className="bg-gray-50 p-6 rounded-2xl border border-gray-200 max-w-lg">
                        <h3 className="font-bold text-gray-900 mb-4 flex items-center"><CalendarClock className="w-5 h-5 mr-2 text-blue-600" /> Choose New Date & Time</h3>
                        <div className="space-y-4">
                            <input type="datetime-local" value={newTime} onChange={(e) => setNewTime(e.target.value)} className="w-full p-3 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 bg-white" />
                            <div className="flex space-x-3">
                                <button onClick={() => setIsRescheduling(false)} className="flex-1 py-2 text-gray-500 font-medium hover:bg-gray-100 rounded-lg transition">Cancel</button>
                                <button onClick={handleReschedule} className="flex-1 py-2 bg-blue-600 text-white font-bold rounded-lg hover:bg-blue-700 transition shadow-sm">Confirm</button>
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                        <div className="space-y-6">
                            {/* NEW: DRIVE TO CARD */}
                            <div className="bg-green-50 p-6 rounded-2xl border border-green-100 shadow-sm">
                                <h3 className="font-bold text-green-900 mb-4 flex items-center text-sm uppercase tracking-widest">
                                    <Navigation className="w-4 h-4 mr-2" /> Drive To
                                </h3>
                                <div className="flex items-start justify-between">
                                    <div className="flex items-start">
                                        <MapPin className="w-5 h-5 text-green-600 mr-3 mt-1 flex-shrink-0" />
                                        <p className="text-lg font-bold text-green-900 leading-tight">
                                            {selectedAppointment.location || 'No address provided'}
                                        </p>
                                    </div>
                                    <button 
                                        onClick={() => navigator.clipboard.writeText(selectedAppointment.location || '')}
                                        className="p-2 hover:bg-green-100 rounded-lg text-green-700"
                                        title="Copy Address"
                                    >
                                        <Copy className="w-4 h-4" />
                                    </button>
                                </div>
                            </div>

                            <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm">
                                <h3 className="font-bold text-gray-900 mb-4 flex items-center text-sm uppercase tracking-widest text-gray-400">Customer Details</h3>
                                <div className="space-y-4">
                                    <div className="flex justify-between items-center pb-2 border-b border-gray-50">
                                        <span className="text-gray-500 text-sm">Name</span>
                                        <span className="font-bold text-gray-900">{selectedAppointment.customers?.name}</span>
                                    </div>
                                    <div className="flex justify-between items-center pb-2 border-b border-gray-50">
                                        <span className="text-gray-500 text-sm">Phone</span>
                                        <a href={`tel:${selectedAppointment.customers?.phone}`} className="font-bold text-blue-600 underline">{selectedAppointment.customers?.phone}</a>
                                    </div>
                                    <div className="flex justify-between items-center">
                                        <span className="text-gray-500 text-sm">Service Unit</span>
                                        <span className="font-bold text-gray-900">{selectedAppointment.resources?.name}</span>
                                    </div>
                                </div>
                            </div>
                            {selectedAppointment.status === 'scheduled' && (
                                <button onClick={() => cancelAppointment(selectedAppointment.id)} className="w-full py-3 text-red-600 font-bold text-sm uppercase tracking-widest border border-red-100 rounded-xl hover:bg-red-50 transition">
                                    Cancel Appointment
                                </button>
                            )}
                        </div>
                        <div className="bg-blue-900 p-6 rounded-2xl text-white shadow-xl">
                            <h3 className="font-bold mb-4 flex items-center text-blue-200 text-sm uppercase tracking-widest">AI Secretary Summary</h3>
                            <p className="text-lg leading-relaxed font-medium italic">
                                "The customer is a returning client. They mentioned a {selectedAppointment.description.toLowerCase()} and specifically requested a morning slot at their location. I've placed them in the first available opening for Truck 1."
                            </p>
                        </div>
                    </div>
                )}
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-gray-400 italic">Select an appointment to view details</div>
        )}
      </section>
    </div>
  )
}
