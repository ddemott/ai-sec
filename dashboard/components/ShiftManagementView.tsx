'use client'

import React, { useState, useEffect, useMemo } from 'react'
import {
  Clock,
  Plus,
  Trash2,
  Users,
  Copy,
  AlertCircle,
  Edit2
} from 'lucide-react'
import { Api } from '../lib/api'
import { useStaticData } from '../lib/hooks'
import { useActiveTenantId } from '../lib/SessionContext'
import { useVocabulary } from '@/lib/VocabularyContext'
import { Card } from './ui/Card'
import { Button } from './ui/Button'
import { Modal } from './ui/Modal'

interface ShiftRecord {
  id: string | number;
  employee_id: string | number;
  day_of_week: number;
  start_time: string;
  end_time: string;
}

const DAYS = [
  { id: 0, name: 'Sunday' },
  { id: 1, name: 'Monday' },
  { id: 2, name: 'Tuesday' },
  { id: 3, name: 'Wednesday' },
  { id: 4, name: 'Thursday' },
  { id: 5, name: 'Friday' },
  { id: 6, name: 'Saturday' },
]

export default function ShiftManagementView() {
  const tenantId = useActiveTenantId()
  const { employees, loading: empsLoading } = useStaticData(tenantId)
  const vocab = useVocabulary()
  
  const [shifts, setShifts] = useState<ShiftRecord[]>([])
  const [, setLoadingShifts] = useState(true)
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(null)
  
  const [isAddModalOpen, setIsWizardOpen] = useState(false)
  const [editingShift, setEditingShift] = useState<ShiftRecord | null>(null)
  const [newShift, setNewShift] = useState({
    day_of_week: 1,
    start_time: '09:00',
    end_time: '17:00'
  })

  useEffect(() => {
    fetchShifts()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId])

  async function fetchShifts() {
    if (!tenantId) return
    setLoadingShifts(true)
    try {
      const data = await Api.shifts.list(tenantId)
      setShifts(data)
    } catch (err) {
      console.error("Failed to fetch shifts", err)
    } finally {
      setLoadingShifts(false)
    }
  }

  async function handleAddShift() {
    if (!selectedEmployeeId || !tenantId) return
    
    try {
      const res = await Api.shifts.create(tenantId, {
        employee_id: selectedEmployeeId,
        ...newShift
      })
      if (res.success) {
        setShifts([...shifts, res.shift])
        setIsWizardOpen(false)
      }
    } catch {
      alert("Failed to create shift")
    }
  }

  function startEditShift(shift: ShiftRecord) {
    setEditingShift(shift)
    setNewShift({
      day_of_week: shift.day_of_week,
      start_time: shift.start_time.substring(0, 5),
      end_time: shift.end_time.substring(0, 5),
    })
    setIsWizardOpen(true)
  }

  async function handleUpdateShift() {
    if (!editingShift || !tenantId) return
    try {
      const res = await Api.shifts.update(String(editingShift.id), tenantId, newShift)
      if (res.success) {
        setShifts(shifts.map(s => s.id === editingShift.id ? res.shift : s))
        setIsWizardOpen(false)
        setEditingShift(null)
      }
    } catch {
      alert("Failed to update shift")
    }
  }

  async function handleDeleteShift(id: string | number) {
    try {
      await Api.shifts.delete(String(id), tenantId)
      setShifts(shifts.filter(s => s.id !== id))
    } catch {
      alert("Failed to delete shift")
    }
  }

  async function copyToAllDays(baseShift: ShiftRecord) {
    try {
      const promises = DAYS
        .filter(d => d.id !== baseShift.day_of_week)
        .map(d => Api.shifts.create(tenantId, {
          employee_id: String(baseShift.employee_id),
          day_of_week: d.id,
          start_time: baseShift.start_time,
          end_time: baseShift.end_time
        }))
      
      await Promise.all(promises)
      fetchShifts()
    } catch {
      alert("Failed to copy shifts")
    }
  }

  const activeEmployees = useMemo(() => 
    employees.filter(e => e.type === 'employee'), 
  [employees])

  const employeeShifts = useMemo(() => 
    shifts.filter(s => s.employee_id.toString() === selectedEmployeeId),
  [shifts, selectedEmployeeId])

  if (empsLoading && activeEmployees.length === 0) {
    return <div className="p-8 text-gray-500 italic">Loading {vocab.employee_label.toLowerCase()} shifts...</div>
  }

  return (
    <div className="flex-1 flex flex-col bg-white dark:bg-[#111] overflow-hidden text-gray-900 dark:text-gray-100 p-8 transition-colors duration-200">
      <header className="mb-8 shrink-0">
        <div className="flex items-center mb-6">
          <div className="bg-blue-100 dark:bg-blue-900/30 p-2 rounded-lg mr-4 text-blue-600 dark:text-blue-400">
            <Clock className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-3xl font-display">{vocab.employee_label} Working Hours</h1>
            <p className="text-gray-500 dark:text-gray-400 text-sm">Define when your team is available so the AI never overbooks.</p>
          </div>
        </div>

        <div className="flex flex-col md:flex-row gap-4 items-center">
          <div className="flex-1 w-full">
            <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2 block">Select {vocab.employee_label}</label>
            <div className="flex gap-2 overflow-x-auto pb-2 no-scrollbar">
              {activeEmployees.map(emp => (
                <button
                  key={emp.id}
                  onClick={() => setSelectedEmployeeId(emp.id)}
                  className={`px-4 py-2 rounded-xl text-sm font-bold whitespace-nowrap transition-all ${selectedEmployeeId === emp.id ? 'bg-blue-600 text-white shadow-lg scale-105' : 'bg-gray-100 dark:bg-[#222] text-gray-500 hover:bg-gray-200 dark:hover:bg-[#333]'}`}
                >
                  {emp.name}
                </button>
              ))}
              {activeEmployees.length === 0 && <p className="text-sm text-gray-400 italic">No {vocab.employee_plural.toLowerCase()} found. Add them in {vocab.employee_label} Management first.</p>}
            </div>
          </div>
          
          {selectedEmployeeId && (
            <Button 
              onClick={() => setIsWizardOpen(true)}
              variant="primary"
              icon={Plus}
              className="md:mt-6"
            >
              Add Shift
            </Button>
          )}
        </div>
      </header>

      <div className="flex-1 overflow-auto">
        {!selectedEmployeeId ? (
          <div className="h-full flex flex-col items-center justify-center bg-gray-50/50 dark:bg-black/20 rounded-3xl border-2 border-dashed border-gray-200 dark:border-gray-800">
            <Users className="w-12 h-12 text-gray-200 dark:text-gray-800 mb-4" />
            <p className="text-gray-500 font-medium">Select an {vocab.employee_label.toLowerCase()} to manage their schedule</p>
          </div>
        ) : (
          <div className="space-y-4">
            {DAYS.map(day => {
              const dayShifts = employeeShifts.filter(s => s.day_of_week === day.id)
              return (
                <div key={day.id} className="bg-gray-50 dark:bg-[#1a1a1a] border border-gray-200 dark:border-gray-800 rounded-2xl p-4 flex items-center gap-6">
                  <div className="w-32">
                    <span className="font-bold text-sm">{day.name}</span>
                  </div>
                  
                  <div className="flex-1 flex flex-wrap gap-2">
                    {dayShifts.length > 0 ? (
                      dayShifts.map(s => (
                        <div key={s.id} className="bg-white dark:bg-[#222] border border-gray-200 dark:border-gray-700 px-3 py-1.5 rounded-xl flex items-center gap-3 shadow-sm group">
                          <span className="text-xs font-mono font-bold text-blue-600 dark:text-blue-400">
                            {s.start_time.substring(0, 5)} - {s.end_time.substring(0, 5)}
                          </span>
                          <button
                            onClick={() => startEditShift(s)}
                            className="text-gray-300 hover:text-blue-500 transition-colors opacity-0 group-hover:opacity-100"
                            title="Edit shift"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleDeleteShift(s.id)}
                            className="text-gray-300 hover:text-red-500 transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => copyToAllDays(s)}
                            className="text-gray-300 hover:text-blue-500 transition-colors opacity-0 group-hover:opacity-100"
                            title="Copy to all days"
                          >
                            <Copy className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))
                    ) : (
                      <span className="text-xs text-gray-400 italic">No shifts scheduled</span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <Modal
        isOpen={isAddModalOpen}
        onClose={() => { setIsWizardOpen(false); setEditingShift(null); }}
        title={editingShift ? "Edit Working Shift" : "Add Working Shift"}
        footer={
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => { setIsWizardOpen(false); setEditingShift(null); }}>Cancel</Button>
            <Button variant="primary" onClick={editingShift ? handleUpdateShift : handleAddShift}>
              {editingShift ? 'Update Shift' : 'Create Shift'}
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2 block">Day of Week</label>
            <select 
              className="w-full bg-gray-100 dark:bg-[#222] border-none rounded-xl p-3 text-sm font-bold"
              value={newShift.day_of_week}
              onChange={e => setNewShift({...newShift, day_of_week: parseInt(e.target.value)})}
            >
              {DAYS.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
          
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2 block">Start Time</label>
              <input 
                type="time"
                className="w-full bg-gray-100 dark:bg-[#222] border-none rounded-xl p-3 text-sm font-bold"
                value={newShift.start_time}
                onChange={e => setNewShift({...newShift, start_time: e.target.value})}
              />
            </div>
            <div>
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2 block">End Time</label>
              <input 
                type="time"
                className="w-full bg-gray-100 dark:bg-[#222] border-none rounded-xl p-3 text-sm font-bold"
                value={newShift.end_time}
                onChange={e => setNewShift({...newShift, end_time: e.target.value})}
              />
            </div>
          </div>
          
          <Card variant="info" className="mt-4">
            <div className="flex gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <p className="text-[10px] leading-relaxed">
                The AI will only allow bookings that fall completely within these hours. 
                Ensure you include enough time for prep and cleanup.
              </p>
            </div>
          </Card>
        </div>
      </Modal>
    </div>
  )
}
