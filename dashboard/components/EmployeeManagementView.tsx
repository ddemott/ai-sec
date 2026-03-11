'use client'

import React, { useState } from 'react'
import { 
  Users, 
  PlusCircle, 
  Shield, 
  Tag
} from 'lucide-react'
import { Api } from '../lib/api'
import { useSession, useStaticData } from '../lib/hooks'
import { Card } from './ui/Card'
import { Button } from './ui/Button'
import { Input } from './ui/Input'
import { Badge } from './ui/Badge'
import { Modal } from './ui/Modal'

type Employee = {
  id: string | number
  name: string
  skills: string[]
  is_active: boolean
  type?: string
}

export default function EmployeeManagementView() {
  const { tenantId } = useSession()
  const { employees, loading, error, refresh } = useStaticData(tenantId)

  // Edit State
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null)
  const [isEditModalOpen, setIsEditModalOpen] = useState(false)
  const [newSkill, setNewSkill] = useState('')
  const [saving, setSaving] = useState(false)

  // Add Employee State
  const [newEmployeeName, setNewEmployeeName] = useState('')

  async function handleAddEmployee(e: React.FormEvent) {
    e.preventDefault()
    if (!newEmployeeName.trim() || !tenantId) return
    setSaving(true)
    try {
      const res = await Api.employees.create(tenantId, { name: newEmployeeName.trim(), skills: [] })
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

  async function handleUpdateSkills(employee: Employee, updatedSkills: string[]) {
    setSaving(true)
    try {
      const res = await Api.employees.update(employee.id as number, { skills: updatedSkills })
      if (res.success) {
        refresh()
        if (selectedEmployee?.id === employee.id) {
          setSelectedEmployee({ ...employee, skills: updatedSkills })
        }
      }
    } catch (err) {
      console.error("Failed to update skills", err)
    } finally {
      setSaving(false)
    }
  }

  const removeSkill = (skill: string) => {
    if (!selectedEmployee) return
    const updated = selectedEmployee.skills.filter(s => s !== skill)
    handleUpdateSkills(selectedEmployee, updated)
  }

  const addSkill = (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedEmployee || !newSkill.trim()) return
    const updated = [...new Set([...selectedEmployee.skills, newSkill.trim()])]
    handleUpdateSkills(selectedEmployee, updated)
    setNewSkill('')
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
            <h1 className="text-3xl font-bold">Staff & Expertise</h1>
            <p className="text-gray-500 dark:text-gray-400 text-sm">Manage your team members and their certified skills.</p>
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
          >
            Add
          </Button>
        </form>
      </header>

      {error && (
        <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-2xl text-red-700 dark:text-red-400 flex items-center">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {employees.filter(e => e.type !== 'user').map(emp => (
          <Card 
            key={emp.id} 
            onClick={() => { setSelectedEmployee(emp); setIsEditModalOpen(true); }}
            className="cursor-pointer hover:border-blue-500/50 hover:shadow-xl transition-all group"
          >
            <div className="flex justify-between items-start mb-4">
              <div className="bg-white dark:bg-[#222] p-3 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-800">
                <Users className="w-6 h-6 text-gray-400 group-hover:text-blue-500 transition-colors" />
              </div>
              <Badge variant={emp.is_active ? 'success' : 'default'}>
                {emp.is_active ? 'Active' : 'On Leave'}
              </Badge>
            </div>
            
            <h3 className="text-xl font-bold mb-2">{emp.name}</h3>
            
            <div className="flex flex-wrap gap-1">
              {emp.skills && emp.skills.length > 0 ? (
                emp.skills.slice(0, 3).map(skill => (
                  <Badge key={skill} variant="info" className="text-[10px] uppercase">
                    {skill}
                  </Badge>
                ))
              ) : (
                <span className="text-xs text-gray-400 italic">No skills assigned</span>
              )}
              {emp.skills && emp.skills.length > 3 && (
                <span className="text-[10px] font-bold text-gray-400 px-2 py-0.5">+{emp.skills.length - 3} more</span>
              )}
            </div>
          </Card>
        ))}
      </div>

      {/* QUICK-EDIT MODAL */}
      <Modal
        isOpen={isEditModalOpen}
        onClose={() => setIsEditModalOpen(false)}
        title={selectedEmployee?.name || ''}
        subtitle="Expertise Profile"
        footer={
          <Button onClick={() => setIsEditModalOpen(false)} className="w-32">
            Done
          </Button>
        }
      >
        {selectedEmployee && (
          <div className="space-y-8">
            {/* Skills Management */}
            <section>
              <h4 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-4 flex items-center">
                <Tag className="w-3 h-3 mr-2" /> Certified Skills
              </h4>
              <div className="flex flex-wrap gap-2 mb-4">
                {selectedEmployee.skills?.map(skill => (
                  <Badge key={skill} variant="info" className="flex items-center py-1.5 px-3">
                    {skill}
                    <button onClick={(e) => { e.stopPropagation(); removeSkill(skill); }} className="ml-2 hover:text-red-500">
                      ×
                    </button>
                  </Badge>
                ))}
              </div>
              <form onSubmit={addSkill} className="flex gap-2">
                <Input 
                  placeholder="Add skill (e.g. alignment)"
                  value={newSkill}
                  onChange={e => setNewSkill(e.target.value)}
                  className="flex-1"
                />
                <Button type="submit" variant="secondary">
                  Add
                </Button>
              </form>
            </section>

            {/* Service Associations Info */}
            <div className="bg-blue-50 dark:bg-blue-900/10 p-6 rounded-3xl border border-blue-100 dark:border-blue-800/30">
              <h4 className="text-sm font-bold text-blue-800 dark:text-blue-400 mb-2 flex items-center">
                <Shield className="w-4 h-4 mr-2" /> Scheduling Role
              </h4>
              <p className="text-xs text-blue-700 dark:text-blue-300 leading-relaxed">
                The AI uses these skills to match {selectedEmployee.name.split(' ')[0]} with service requirements. 
                Adding a skill makes them eligible for any service that requires it.
              </p>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
