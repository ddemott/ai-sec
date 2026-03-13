'use client'

import React, { useState, useEffect } from 'react'
import { 
  Users, 
  PlusCircle, 
  Shield, 
  CheckCircle2,
  AlertCircle,
  Tag,
  Trash2
} from 'lucide-react'
import { Api } from '../lib/api'
import { useSession, useStaticData } from '../lib/hooks'
import { Card } from './ui/Card'
import { Button } from './ui/Button'
import { Input } from './ui/Input'
import { Badge } from './ui/Badge'
import { Modal } from './ui/Modal'

type Employee = {
  id: number
  name: string
  is_active: boolean
  type?: string
}

export default function EmployeeManagementView({ overrideTenantId }: { overrideTenantId?: string | null }) {
  const { tenantId } = useSession(overrideTenantId)
  const { employees, services, loading, error, refresh } = useStaticData(tenantId)
  const [mappings, setMappings] = useState<any[]>([])

  // Edit State
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null)
  const [editForm, setEditForm] = useState({ name: '' })
  const [isEditModalOpen, setIsEditModalOpen] = useState(false)
  const [saving, setSaving] = useState(false)

  // Add Employee State
  const [newEmployeeName, setNewEmployeeName] = useState('')

  useEffect(() => {
    if (tenantId) fetchMappings()
  }, [tenantId])

  async function fetchMappings() {
    try {
      const data = await Api.mappings.listServiceEmployee(tenantId)
      setMappings(Array.isArray(data) ? data : [])
    } catch (err) {
      console.error("Failed to fetch mappings")
      setMappings([])
    }
  }

  async function handleAddEmployee(e: React.FormEvent) {
    e.preventDefault()
    if (!newEmployeeName.trim() || !tenantId) return
    setSaving(true)
    try {
      const res = await Api.employees.create(tenantId, { name: newEmployeeName.trim() })
      if (res.success) {
        setNewEmployeeName('')
        refresh()
      }
    } catch (err) {
      console.error("Failed to create employee", err)
    } finally {
      setSaving(false)
    }
  }

  async function handleUpdateEmployee() {
    if (!selectedEmployee || !editForm.name.trim()) return
    setSaving(true)
    try {
      const res = await Api.employees.update(selectedEmployee.id as number, { name: editForm.name.trim() })
      if (res.success) {
        refresh()
        setIsEditModalOpen(false)
      }
    } catch (err) {
      console.error("Update failed")
    } finally {
      setSaving(false)
    }
  }

  async function handleDeleteEmployee(id: number) {
    if (!confirm("Are you sure? This will remove the staff member permanently.")) return
    try {
      const res = await Api.employees.delete(id, tenantId)
      if (res.success) {
        refresh()
        setIsEditModalOpen(false)
      } else {
        alert(res.error || "Delete failed")
      }
    } catch (err) {
      alert("Staff member is still connected to appointments or services.")
    }
  }

  async function toggleService(serviceId: number, employeeId: number) {
    const isMapped = (mappings || []).some(m => m.service_id === serviceId && m.employee_id === employeeId)
    try {
      if (isMapped) {
        await Api.mappings.unassignServiceEmployee(serviceId, employeeId, tenantId)
        setMappings(mappings.filter(m => !(m.service_id === serviceId && m.employee_id === employeeId)))
      } else {
        await Api.mappings.assignServiceEmployee(serviceId, employeeId, tenantId)
        setMappings([...mappings, { service_id: serviceId, employee_id: employeeId }])
      }
    } catch (err) {
      alert("Failed to update services")
    }
  }

  if (loading && employees.length === 0) {
    return <div className="p-8 text-gray-500 italic">Loading staff data...</div>
  }

  return (
    <div className="flex-1 flex flex-col bg-white dark:bg-[#111] overflow-y-auto text-gray-900 dark:text-gray-100 p-8 transition-colors duration-200">
      <header className="mb-8">
        <div className="flex items-center mb-6">
          <div className="bg-green-100 dark:bg-green-900/30 p-2 rounded-lg mr-4 text-green-600 dark:text-green-400">
            <Users className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-3xl font-bold">Staff & Services</h1>
            <p className="text-gray-500 dark:text-gray-400 text-sm">Define which team members provide which services.</p>
          </div>
        </div>

        <form onSubmit={handleAddEmployee} className="max-w-md flex gap-3">
          <Input 
            placeholder="Enter full name..."
            value={newEmployeeName}
            onChange={e => setNewEmployeeName(e.target.value)}
            className="flex-1"
          />
          <Button 
            type="submit"
            disabled={saving || !newEmployeeName.trim()}
            icon={PlusCircle}
            loading={saving}
            className="whitespace-nowrap"
          >
            Add Staff
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
            key={emp.id} 
            onClick={() => { 
              setSelectedEmployee(emp); 
              setEditForm({ name: emp.name });
              setIsEditModalOpen(true); 
            }}
            className="cursor-pointer hover:border-blue-500/50 hover:shadow-xl transition-all group"
          >
            <div className="flex justify-between items-start mb-4">
              <div className="bg-white dark:bg-[#222] p-3 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-800">
                <Users className="w-6 h-6 text-gray-400 group-hover:text-blue-500 transition-colors" />
              </div>
              <Badge variant={emp.is_active ? 'success' : 'secondary'}>
                {emp.is_active ? 'Active' : 'On Leave'}
              </Badge>
            </div>
            
            <h3 className="text-xl font-bold mb-2">{emp.name}</h3>
            
            <div className="flex flex-wrap gap-1">
              {(mappings || []).filter(m => m.employee_id === emp.id).length > 0 ? (
                (mappings || []).filter(m => m.employee_id === emp.id).map(m => {
                  const s = (services || []).find(s => s.id === m.service_id)
                  return s ? <Badge key={s.id} variant="primary">{s.name}</Badge> : null
                })
              ) : (
                <span className="text-xs text-gray-400 italic">No services provided</span>
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
        footer={
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setIsEditModalOpen(false)}>Cancel</Button>
            <Button onClick={handleUpdateEmployee} loading={saving}>Save Changes</Button>
          </div>
        }
      >
        {selectedEmployee && (
          <div className="space-y-8 max-h-[70vh] overflow-y-auto pr-2">
            {/* IDENTIFICATION EDIT */}
            <section className="space-y-4">
              <h4 className="text-xs font-bold text-gray-400 uppercase tracking-widest flex items-center">
                <Users className="w-3 h-3 mr-2" /> Basic Info
              </h4>
              <Input 
                label="Full Name"
                value={editForm.name}
                onChange={e => setEditForm({ ...editForm, name: e.target.value })}
              />
            </section>

            {/* Service Toggle Section */}
            <section>
              <h4 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-4 flex items-center">
                <Tag className="w-3 h-3 mr-2" /> Authorized Services
              </h4>
              <div className="grid grid-cols-1 gap-2">
                {(services || []).map(service => {
                  const isMapped = (mappings || []).some(m => m.service_id === service.id && m.employee_id === selectedEmployee.id)
                  return (
                    <button 
                      key={service.id}
                      onClick={() => toggleService(service.id, selectedEmployee.id)}
                      className={`flex items-center justify-between p-4 rounded-2xl text-sm font-bold transition-all ${isMapped ? 'bg-blue-600 text-white shadow-lg' : 'bg-gray-50 dark:bg-[#222] text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'}`}
                    >
                      {service.name}
                      {isMapped ? <CheckCircle2 className="w-5 h-5 text-white" /> : <PlusCircle className="w-5 h-5 opacity-30" />}
                    </button>
                  )
                })}
                {(services || []).length === 0 && (
                  <div className="text-center p-8 border-2 border-dashed border-gray-100 dark:border-gray-800 rounded-3xl text-gray-400">
                    No services defined in the catalog.
                  </div>
                )}
              </div>
            </section>

            {/* DELETE SECTION */}
            <section className="pt-6 border-t border-gray-100 dark:border-gray-800">
              <Button 
                variant="ghost" 
                className="text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20 w-full justify-center"
                icon={Trash2}
                onClick={() => handleDeleteEmployee(selectedEmployee.id)}
              >
                Remove Staff Member
              </Button>
            </section>
          </div>
        )}
      </Modal>
    </div>
  )
}
