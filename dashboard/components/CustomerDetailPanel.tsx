'use client'

import React from 'react'
import {
  Users,
  Phone,
  Mail,
  MapPin,
  History,
  Edit2,
  Save,
  X,
  Trash2,
  Calendar,
  Clock,
  XCircle,
  ChevronLeft,
  RefreshCw,
} from 'lucide-react'
import { US_STATES, US_TIMEZONES } from '../lib/constants'
import { formatPhone } from '../lib/phone'
import { Button } from './ui/Button'
import { Input } from './ui/Input'
import { PhoneInput } from './ui/PhoneInput'
import { Select } from './ui/Select'
import { Card } from './ui/Card'
import { Badge } from './ui/Badge'
import { Customer } from '@/lib/types'

interface EditForm {
  first_name: string
  last_name: string
  phone: string
  email: string
  address: string
  address_line2: string
  city: string
  state: string
  postal_code: string
  timezone: string
  notes: string
}

interface CallSummary {
  id: string
  customer_id: string
  summary: string
  call_timestamp?: string
  created_at?: string
  has_transcript?: boolean
}

interface CustomerAppointment {
  id: string
  start_time: string
  end_time: string
  status: string
  description: string
  resource_name?: string
  employee_name?: string
  location?: string
}

interface CustomerDetailPanelProps {
  selectedCustomer: Customer | null
  isCreating: boolean
  isEditing: boolean
  saving: boolean
  showDetailOnMobile: boolean
  editForm: EditForm
  summaries: CallSummary[]
  upcomingAppointments: CustomerAppointment[]
  pastAppointments: CustomerAppointment[]
  onEditFormChange: (field: string, value: string) => void
  onEdit: () => void
  onCancelEdit: () => void
  onSave: () => void
  onCreate: () => void
  onDelete: () => void
  onCancelAppointment: (appointmentId: string) => void
  onCloseMobile: () => void
}

export function CustomerDetailPanel({
  selectedCustomer,
  isCreating,
  isEditing,
  saving,
  showDetailOnMobile,
  editForm,
  summaries,
  upcomingAppointments,
  pastAppointments,
  onEditFormChange,
  onEdit,
  onCancelEdit,
  onSave,
  onCreate,
  onDelete,
  onCancelAppointment,
  onCloseMobile,
}: CustomerDetailPanelProps) {
  return (
    <section className={`flex-1 flex flex-col bg-white dark:bg-[#111] overflow-y-auto fixed inset-0 z-20 md:relative md:z-0 ${(showDetailOnMobile || isCreating) ? 'flex' : 'hidden md:flex'}`}>
      {(selectedCustomer || isCreating) ? (
        <>
          <header className="p-4 md:p-8 border-b border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-[#1a1a1a] flex items-center justify-between">
            <div className="flex items-center">
              <button
                  onClick={onCloseMobile}
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
                      <Phone className="w-4 h-4 mr-2" /> {formatPhone(selectedCustomer?.phone)}
                      </p>
                  )}
                  </div>
              </div>
            </div>

            <div className="flex items-center space-x-2">
              {!isEditing && !isCreating ? (
                  <>
                      <Button variant="danger" size="sm" onClick={onDelete} title="Delete Customer">
                          <Trash2 className="w-5 h-5" />
                      </Button>
                      <Button variant="secondary" onClick={onEdit}>
                          <Edit2 className="w-4 h-4 mr-2" /> Edit Info
                      </Button>
                  </>
              ) : (
                  <div className="flex space-x-2">
                      <Button variant="ghost" onClick={onCancelEdit}>
                          <X className="w-5 h-5" />
                      </Button>
                      <Button
                          onClick={isCreating ? onCreate : onSave}
                          isLoading={saving}
                      >
                          {!saving && <Save className="w-4 h-4 mr-2" />}
                          {isCreating ? 'Create Customer' : 'Save Changes'}
                      </Button>
                  </div>
              )}
            </div>
          </header>

          <div className="p-4 md:p-8 space-y-8">
            <Card title="Contact Details & Notes" className="max-w-2xl">
              {(!isEditing && !isCreating) ? (
                  <div className="space-y-4 text-sm">
                      <div className="flex items-start">
                          <Mail className="w-4 h-4 mr-3 text-gray-400 dark:text-gray-500 mt-0.5" />
                          <span className="dark:text-gray-300">{selectedCustomer?.email || 'No email provided'}</span>
                      </div>
                      <div className="flex items-start">
                          <MapPin className="w-4 h-4 mr-3 text-gray-400 dark:text-gray-500 mt-0.5" />
                          <span className="dark:text-gray-300">
                            {selectedCustomer
                              ? [
                                  selectedCustomer.address,
                                  selectedCustomer.address_line2,
                                  selectedCustomer.city,
                                  [
                                    selectedCustomer.state,
                                    selectedCustomer.postal_code
                                  ].filter(Boolean).join(' ')
                                ]
                                .filter(Boolean)
                                .join(', ') || 'No address on file'
                              : 'No address on file'}
                          </span>
                       </div>
                      <div className="flex items-start">
                          <RefreshCw className="w-4 h-4 mr-3 text-gray-400 dark:text-gray-500 mt-0.5" />
                          <span className="dark:text-gray-300">
                            Timezone: {US_TIMEZONES.find(t => t.value === selectedCustomer?.timezone)?.label || selectedCustomer?.timezone || 'Not set'}
                          </span>
                      </div>
                      <div className="mt-6 pt-6 border-t border-gray-100 dark:border-gray-800">
                          <p className="text-xs font-bold text-gray-400 dark:text-gray-500 uppercase mb-2">Internal Notes</p>
                          <p className="text-gray-700 dark:text-gray-400 italic leading-relaxed">
                              {(selectedCustomer?.metadata?.notes as string) || 'No internal notes added yet.'}
                          </p>
                      </div>
                  </div>
              ) : (
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <Input label="First Name" value={editForm.first_name} onChange={(e) => onEditFormChange('first_name', e.target.value)} placeholder="First Name" />
                      <Input label="Last Name" value={editForm.last_name} onChange={(e) => onEditFormChange('last_name', e.target.value)} placeholder="Last Name" />
                      <PhoneInput label="Phone Number" value={editForm.phone} onChange={(val) => onEditFormChange('phone', val)} />
                    </div>
                    <Input label="Email" type="email" value={editForm.email} onChange={(e) => onEditFormChange('email', e.target.value)} placeholder="customer@email.com" />
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <Input label="Address Line 1" value={editForm.address} onChange={(e) => onEditFormChange('address', e.target.value)} placeholder="123 Street St" />
                      <Input label="Address Line 2" value={editForm.address_line2} onChange={(e) => onEditFormChange('address_line2', e.target.value)} placeholder="Apt / Suite / Unit" />
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <Input label="City" value={editForm.city} onChange={(e) => onEditFormChange('city', e.target.value)} placeholder="New York" />
                      <Select
                      label="State"
                      value={editForm.state}
                      onChange={(e) => onEditFormChange('state', e.target.value)}
                      options={[{ label: 'Select state', value: '' }, ...US_STATES.map(code => ({ label: code, value: code }))]}
                      />
                      <Input label="ZIP" value={editForm.postal_code} onChange={(e) => onEditFormChange('postal_code', e.target.value)} placeholder="10001" />
                    </div>
                    <Select
                      label="Timezone"
                      value={editForm.timezone}
                      onChange={(e) => onEditFormChange('timezone', e.target.value)}
                      options={US_TIMEZONES}
                    />
                    <div>
                      <label className="block text-xs font-bold text-gray-400 dark:text-gray-500 uppercase mb-1">Internal Notes</label>
                      <textarea
                        rows={4}
                        value={editForm.notes}
                        onChange={(e) => onEditFormChange('notes', e.target.value)}
                        className="w-full p-2.5 bg-gray-50 dark:bg-[#222] border border-gray-200 dark:border-gray-800 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500 dark:text-gray-100 transition"
                        placeholder="Add private notes the AI should consider..."
                      />
                    </div>
                  </div>
              )}
            </Card>

            {!isCreating && (
              <>
                {/* UPCOMING APPOINTMENTS */}
                <div className="space-y-4">
                  <h3 className="font-bold text-gray-900 dark:text-white flex items-center text-lg">
                    <Calendar className="w-5 h-5 mr-2 text-gray-400 dark:text-gray-500" />
                    Upcoming Appointments
                  </h3>
                  {upcomingAppointments.length > 0 ? (
                    <div className="space-y-3">
                      {upcomingAppointments.map((a) => (
                        <div key={a.id} className="p-4 border border-gray-100 dark:border-gray-800 rounded-xl bg-white dark:bg-[#1a1a1a] shadow-sm flex justify-between items-start">
                          <div className="space-y-1">
                            <p className="text-sm font-semibold text-gray-900 dark:text-white">{a.description}</p>
                            <p className="text-xs text-gray-500 dark:text-gray-400 flex items-center">
                              <Clock className="w-3 h-3 mr-1" />
                              {new Date(a.start_time).toLocaleDateString()} at {new Date(a.start_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </p>
                            <p className="text-xs text-gray-500 dark:text-gray-400">
                              {a.resource_name}{a.employee_name ? ` / ${a.employee_name}` : ''}
                            </p>
                            {a.location && <p className="text-xs text-gray-400 dark:text-gray-500">{a.location}</p>}
                          </div>
                          <div className="flex items-center space-x-2">
                            <Badge variant="primary">Scheduled</Badge>
                            <Button variant="danger" size="sm" onClick={() => onCancelAppointment(a.id)} aria-label="Cancel appointment">
                              <XCircle className="w-4 h-4" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-gray-400 dark:text-gray-600 italic text-sm">No upcoming appointments.</p>
                  )}
                </div>

                {/* APPOINTMENT HISTORY */}
                <div className="space-y-4">
                  <h3 className="font-bold text-gray-900 dark:text-white flex items-center text-lg">
                    <History className="w-5 h-5 mr-2 text-gray-400 dark:text-gray-500" />
                    Appointment History
                  </h3>
                  {pastAppointments.length > 0 ? (
                    <div className="space-y-3">
                      {pastAppointments.map((a) => (
                        <div key={a.id} className="p-4 border border-gray-100 dark:border-gray-800 rounded-xl bg-white dark:bg-[#1a1a1a] shadow-sm flex justify-between items-start">
                          <div className="space-y-1">
                            <p className="text-sm font-semibold text-gray-900 dark:text-white">{a.description}</p>
                            <p className="text-xs text-gray-500 dark:text-gray-400 flex items-center">
                              <Clock className="w-3 h-3 mr-1" />
                              {new Date(a.start_time).toLocaleDateString()} at {new Date(a.start_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </p>
                            <p className="text-xs text-gray-500 dark:text-gray-400">
                              {a.resource_name}{a.employee_name ? ` / ${a.employee_name}` : ''}
                            </p>
                          </div>
                          <Badge variant={a.status === 'completed' ? 'success' : a.status === 'canceled' ? 'danger' : 'secondary'}>
                            {a.status === 'completed' ? 'Completed' : a.status === 'canceled' ? 'Canceled' : a.status}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-gray-400 dark:text-gray-600 italic text-sm">No past appointments.</p>
                  )}
                </div>

                {/* AI CALL HISTORY */}
                <div className="space-y-4">
                  <h3 className="font-bold text-gray-900 dark:text-white flex items-center text-lg">
                    <Phone className="w-5 h-5 mr-2 text-gray-400 dark:text-gray-500" />
                    AI Call History
                  </h3>
                  <div className="space-y-4">
                    {summaries.length > 0 ? summaries.map((s) => (
                      <div key={s.id} className="p-5 border border-gray-100 dark:border-gray-800 rounded-xl bg-white dark:bg-[#1a1a1a] shadow-sm">
                        <div className="flex justify-between text-xs text-gray-400 dark:text-gray-500 mb-2">
                          <span className="font-bold text-blue-600 dark:text-blue-400 uppercase">AI Summary</span>
                          <span>{new Date(s.call_timestamp || s.created_at || '').toLocaleDateString()}</span>
                        </div>
                        <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed italic">&quot;{s.summary}&quot;</p>
                        {s.has_transcript && (
                          <p className="text-xs text-green-600 dark:text-green-400 mt-2">Transcript available</p>
                        )}
                      </div>
                    )) : (
                      <p className="text-gray-400 dark:text-gray-600 italic text-sm">No call history available.</p>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        </>
      ) : (
        <div className="flex-1 flex items-center justify-center text-gray-400 dark:text-gray-600 italic text-center px-4 flex-col">
          <Users className="w-12 h-12 mb-4 opacity-20" />
          Select a customer or click the &quot;+&quot; button to add one.
        </div>
      )}
    </section>
  )
}
