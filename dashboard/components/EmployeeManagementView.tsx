'use client'

import React, { useState, useEffect } from 'react'
import { 
  Users, 
  PlusCircle,
  CheckCircle2,
  AlertCircle,
  Tag,
  Trash2
} from 'lucide-react'
import { Api } from '../lib/api'
import { formatPhone } from '../lib/phone'
import { useStaticData } from '../lib/hooks'
import { useActiveTenantId } from '../lib/SessionContext'
import { useVocabulary } from '@/lib/VocabularyContext'
import { Card } from './ui/Card'
import { Button } from './ui/Button'
import { Input } from './ui/Input'
import { PhoneInput } from './ui/PhoneInput'
import { Badge } from './ui/Badge'
import { Modal } from './ui/Modal'
import { ConfirmModal } from './ui/ConfirmModal'
import { LoadingState } from './ui/LoadingState'
import { useConfirm } from '../lib/useConfirm'
import { showToast } from './ui/Toast'

type Employee = {
  employee_id: string
  name: string
  first_name?: string | null
  last_name?: string | null
  email?: string | null
  phone?: string | null
  is_active: boolean
  type?: string
}

export default function EmployeeManagementView() {
  const tenantId = useActiveTenantId()
  const vocab = useVocabulary()
  const { employees, services, loading, error, refresh } = useStaticData(tenantId)
  const [mappings, setMappings] = useState<{ service_id: string; employee_id?: string }[]>([])

  // Edit State
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null)
  const [editForm, setEditForm] = useState({ first_name: '', last_name: '', email: '', phone: '', is_active: true })
  const [isEditModalOpen, setIsEditModalOpen] = useState(false)
  const [saving, setSaving] = useState(false)

  // Add Employee State
  const [newEmployee, setNewEmployee] = useState({ first_name: '', last_name: '' })

  const { state: confirmState, confirm: confirmAction, close: closeConfirm } = useConfirm()

  useEffect(() => {
    if (tenantId) void fetchMappings()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId])

  async function fetchMappings() {
    try {
      const data = await Api.mappings.listServiceEmployee(tenantId)
      setMappings(Array.isArray(data) ? data : [])
    } catch {
      console.error("Failed to fetch mappings")
      setMappings([])
    }
  }

  async function handleAddEmployee(e: React.FormEvent) {
    e.preventDefault()
    if (!newEmployee.first_name.trim() || !tenantId) return
    setSaving(true)
    try {
      const res = await Api.employees.create(tenantId, {
        first_name: newEmployee.first_name.trim(),
        last_name: newEmployee.last_name.trim()
      })
      if (res.success) {
        setNewEmployee({ first_name: '', last_name: '' })
        void refresh()
      }
    } catch (err) {
      console.error("Failed to create employee", err)
    } finally {
      setSaving(false)
    }
  }

  async function handleUpdateEmployee() {
    if (!selectedEmployee || !editForm.first_name.trim()) return
    setSaving(true)
    try {
      const res = await Api.employees.update(selectedEmployee.employee_id, {
        first_name: editForm.first_name.trim(),
        last_name: editForm.last_name.trim(),
        email: editForm.email.trim() || undefined,
        phone: editForm.phone.trim() || undefined,
        is_active: editForm.is_active,
        tenant_id: tenantId || undefined
      })
      if (res.success) {
        void refresh()
        setIsEditModalOpen(false)
      }
    } catch {
      console.error("Update failed")
    } finally {
      setSaving(false)
    }
  }

  function handleDeleteEmployee(id: string) {
    confirmAction({
      title: `Remove ${vocab.employee_label.toLowerCase()}?`,
      message: `This will remove the ${vocab.employee_label.toLowerCase()} permanently. Appointments and service assignments stay attached to the record.`,
      confirmLabel: 'Remove',
      confirmVariant: 'danger',
      onConfirm: async () => {
        closeConfirm()
        try {
          const res = await Api.employees.delete(id, tenantId)
          if (res.success) {
            void refresh()
            setIsEditModalOpen(false)
            showToast(`${vocab.employee_label} removed`, 'success')
          } else {
            showToast(res.error || 'Delete failed', 'error')
          }
        } catch {
          showToast(`${vocab.employee_label} is still connected to appointments or services.`, 'error')
        }
      },
    })
  }

  async function toggleService(serviceId: string, employeeId: string) {
    const isMapped = (mappings || []).some(m => m.service_id === serviceId && m.employee_id === employeeId)
    try {
      if (isMapped) {
        await Api.mappings.unassignServiceEmployee(serviceId, employeeId, tenantId)
        setMappings(mappings.filter(m => !(m.service_id === serviceId && m.employee_id === employeeId)))
      } else {
        await Api.mappings.assignServiceEmployee(serviceId, employeeId, tenantId)
        setMappings([...mappings, { service_id: serviceId, employee_id: employeeId }])
      }
    } catch {
      showToast('Failed to update services', 'error')
    }
  }

  if (loading && employees.length === 0) {
    return <LoadingState message="Loading staff data…" />
  }

  return (
    <div className="flex-1 flex flex-col overflow-y-auto p-8 transition-colors duration-200" style={{ backgroundColor: 'var(--bg-surface)', color: 'var(--text-primary)' }}>
      <header className="mb-8">
        <div className="flex items-center mb-6">
          <div className="bg-green-100 dark:bg-green-900/30 p-2 rounded-lg mr-4 text-green-600 dark:text-green-400">
            <Users className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-3xl font-display">{vocab.employee_plural}</h1>
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>{`Manage ${vocab.employee_plural.toLowerCase()} and assign them to services.`}</p>
          </div>
        </div>

        <form onSubmit={handleAddEmployee} className="max-w-lg flex gap-3">
          <Input
            placeholder="First name"
            value={newEmployee.first_name}
            onChange={e => setNewEmployee({ ...newEmployee, first_name: e.target.value })}
            className="flex-1"
          />
          <Input
            placeholder="Last name"
            value={newEmployee.last_name}
            onChange={e => setNewEmployee({ ...newEmployee, last_name: e.target.value })}
            className="flex-1"
          />
          <Button
            type="submit"
            disabled={saving || !newEmployee.first_name.trim()}
            icon={PlusCircle}
            isLoading={saving}
            className="whitespace-nowrap"
          >
            {`Add ${vocab.employee_label}`}
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
        {(employees || []).filter(e => e.type !== 'user').map(emp => (
          <Card 
            key={emp.employee_id} 
            onClick={() => {
              setSelectedEmployee(emp);
              setEditForm({
                first_name: emp.first_name || emp.name || '',
                last_name: emp.last_name || '',
                email: emp.email || '',
                phone: emp.phone || '',
                is_active: emp.is_active !== false,
              });
              setIsEditModalOpen(true);
            }}
            className="cursor-pointer hover:shadow-xl transition-all group"
          >
            <div className="flex justify-between items-start mb-4">
              <div className="p-3 rounded-2xl shadow-sm border" style={{ backgroundColor: 'var(--bg-raised)', borderColor: 'var(--border-soft)' }}>
                <Users className="w-6 h-6 group-hover:opacity-80 transition-colors" style={{ color: 'var(--text-muted)' }} />
              </div>
              <Badge variant={emp.is_active ? 'success' : 'secondary'}>
                {emp.is_active ? 'Active' : 'On Leave'}
              </Badge>
            </div>
            
            <h3 className="text-xl font-bold mb-1">{emp.name}</h3>
            {(emp.phone || emp.email) && (
              <div className="text-xs mb-2 space-y-0.5" style={{ color: 'var(--text-secondary)' }}>
                {emp.phone && <div>{formatPhone(emp.phone)}</div>}
                {emp.email && <div>{emp.email}</div>}
              </div>
            )}

            <div className="flex flex-wrap gap-1">
              {(mappings || []).filter(m => m.employee_id === emp.employee_id).length > 0 ? (
                (mappings || []).filter(m => m.employee_id === emp.employee_id).map(m => {
                  const s = (services || []).find(s => s.service_id === m.service_id)
                  return s ? <Badge key={s.service_id} variant="primary">{s.name}</Badge> : null
                })
              ) : (
                <span className="text-xs italic" style={{ color: 'var(--text-muted)' }}>No services provided</span>
              )}
            </div>
          </Card>
        ))}
      </div>

      {/* QUICK-EDIT MODAL */}
      <Modal
        isOpen={isEditModalOpen && !!selectedEmployee}
        onClose={() => setIsEditModalOpen(false)}
        title={selectedEmployee?.name || ''}
        disableBackdropClose
        footer={
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setIsEditModalOpen(false)}>Cancel</Button>
            <Button onClick={handleUpdateEmployee} isLoading={saving}>Save Changes</Button>
          </div>
        }
      >
        {selectedEmployee && (
          <div className="space-y-8 max-h-[70vh] overflow-y-auto pr-2">
            {/* IDENTIFICATION EDIT */}
            <section className="space-y-4">
              <h4 className="text-xs font-bold uppercase tracking-widest flex items-center" style={{ color: 'var(--text-muted)' }}>
                <Users className="w-3 h-3 mr-2" /> Basic Info
              </h4>
              <div className="grid grid-cols-2 gap-4">
                <Input
                  label="First Name"
                  value={editForm.first_name}
                  onChange={e => setEditForm({ ...editForm, first_name: e.target.value })}
                />
                <Input
                  label="Last Name"
                  value={editForm.last_name}
                  onChange={e => setEditForm({ ...editForm, last_name: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <Input
                  label="Email"
                  type="email"
                  placeholder="employee@email.com"
                  value={editForm.email}
                  onChange={e => setEditForm({ ...editForm, email: e.target.value })}
                />
                <PhoneInput
                  label="Phone"
                  value={editForm.phone}
                  onChange={(val) => setEditForm({ ...editForm, phone: val })}
                />
              </div>
              <div className="flex items-center justify-between pt-2">
                <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>Active</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={editForm.is_active}
                  onClick={() => setEditForm({ ...editForm, is_active: !editForm.is_active })}
                  className="relative inline-flex h-6 w-11 items-center rounded-full transition-colors"
                  style={editForm.is_active ? { backgroundColor: 'var(--accent)' } : { backgroundColor: 'var(--bg-raised)' }}
                >
                  <span className={`inline-block h-4 w-4 rounded-full bg-white transition-transform ${editForm.is_active ? 'translate-x-6' : 'translate-x-1'}`} />
                </button>
              </div>
            </section>

            {/* Service Toggle Section */}
            <section>
              <h4 className="text-xs font-bold uppercase tracking-widest mb-4 flex items-center" style={{ color: 'var(--text-muted)' }}>
                <Tag className="w-3 h-3 mr-2" /> Authorized Services
              </h4>
              <div className="grid grid-cols-1 gap-2">
                {(services || []).map(service => {
                  const isMapped = (mappings || []).some(m => m.service_id === service.service_id && m.employee_id === selectedEmployee.employee_id)
                  return (
                    <button
                      key={service.service_id}
                      onClick={() => toggleService(service.service_id, selectedEmployee.employee_id)}
                      className={`flex items-center justify-between p-4 rounded-2xl text-sm font-bold transition-all ${isMapped ? 'text-white shadow-lg' : ''}`}
                      style={isMapped ? { backgroundColor: 'var(--accent)' } : { backgroundColor: 'var(--bg-raised)', color: 'var(--text-secondary)' }}
                    >
                      {service.name}
                      {isMapped ? <CheckCircle2 className="w-5 h-5 text-white" /> : <PlusCircle className="w-5 h-5 opacity-30" />}
                    </button>
                  )
                })}
                {(services || []).length === 0 && (
                  <div className="text-center p-8 border-2 border-dashed rounded-3xl" style={{ borderColor: 'var(--border-soft)', color: 'var(--text-muted)' }}>
                    No services defined in the catalog.
                  </div>
                )}
              </div>
            </section>

            {/* DELETE SECTION */}
            <section className="pt-6 border-t" style={{ borderColor: 'var(--border-soft)' }}>
              <Button 
                variant="ghost" 
                className="text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20 w-full justify-center"
                icon={Trash2}
                onClick={() => handleDeleteEmployee(selectedEmployee.employee_id)}
              >
                {`Remove ${vocab.employee_label}`}
              </Button>
            </section>
          </div>
        )}
      </Modal>

      <ConfirmModal {...confirmState} onClose={closeConfirm} />
    </div>
  )
}
