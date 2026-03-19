'use client'

import React, { useState, useEffect, useCallback } from 'react'
import {
  ChevronRight,
  ChevronLeft,
  Check,
  X,
  Plus,
  Pencil,
  Trash2,
  Clock,
  DollarSign,
  Wand2,
} from 'lucide-react'
import { Api } from '../lib/api'
import { useSession, useStaticData } from '../lib/hooks'
import { Button } from './ui/Button'
import { Input } from './ui/Input'

type WizardStep = 1 | 2 | 3 | 4 | 5 | 6

const STEP_LABELS: Record<WizardStep, string> = {
  1: 'Services',
  2: 'Resources',
  3: 'Employees',
  4: 'Shifts',
  5: 'Assignments',
  6: 'Review',
}

interface ServiceForm {
  name: string
  description: string
  duration_minutes: number
  price?: number
}

const EMPTY_SERVICE: ServiceForm = { name: '', description: '', duration_minutes: 30 }

interface SetupWizardProps {
  isOpen: boolean
  onClose: () => void
  overrideTenantId?: string | null
}

export default function SetupWizard({ isOpen, onClose, overrideTenantId }: SetupWizardProps) {
  const { tenantId } = useSession(overrideTenantId)
  const { services, loading, refresh } = useStaticData(tenantId)
  const [step, setStep] = useState<WizardStep>(1)

  // Step 1 — Services
  const [editingService, setEditingService] = useState<ServiceForm | null>(null)
  const [editingServiceId, setEditingServiceId] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Lock body scroll when open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = 'unset'
    }
    return () => { document.body.style.overflow = 'unset' }
  }, [isOpen])

  // Reset on open
  useEffect(() => {
    if (isOpen) {
      setStep(1)
      setEditingService(null)
      setEditingServiceId(null)
      setError(null)
    }
  }, [isOpen])

  const goNext = () => setStep(s => Math.min(s + 1, 6) as WizardStep)
  const goBack = () => setStep(s => Math.max(s - 1, 1) as WizardStep)
  const goToStep = (s: WizardStep) => setStep(s)

  // --- Service CRUD ---

  function startAddService() {
    setEditingService({ ...EMPTY_SERVICE })
    setEditingServiceId(null)
    setError(null)
  }

  function startEditService(svc: any) {
    setEditingService({
      name: svc.name || '',
      description: svc.description || '',
      duration_minutes: svc.duration_minutes || 30,
      price: svc.price,
    })
    setEditingServiceId(svc.id)
    setError(null)
  }

  function cancelEditService() {
    setEditingService(null)
    setEditingServiceId(null)
    setError(null)
  }

  async function saveService() {
    if (!editingService || !tenantId) return
    if (!editingService.name.trim()) {
      setError('Service name is required')
      return
    }
    if (editingService.duration_minutes < 1) {
      setError('Duration must be at least 1 minute')
      return
    }

    setSaving(true)
    setError(null)
    try {
      if (editingServiceId) {
        await Api.services.update(editingServiceId, tenantId, {
          name: editingService.name.trim(),
          description: editingService.description.trim(),
          duration_minutes: editingService.duration_minutes,
        })
      } else {
        await Api.services.create(tenantId, {
          name: editingService.name.trim(),
          description: editingService.description.trim(),
          duration_minutes: editingService.duration_minutes,
        })
      }
      await refresh()
      setEditingService(null)
      setEditingServiceId(null)
    } catch (err: any) {
      setError(err.message || 'Failed to save service')
    } finally {
      setSaving(false)
    }
  }

  async function deleteService(id: number) {
    if (!tenantId) return
    setSaving(true)
    try {
      await Api.services.delete(id, tenantId)
      await refresh()
    } catch (err: any) {
      setError(err.message || 'Failed to delete service')
    } finally {
      setSaving(false)
    }
  }

  if (!isOpen) return null

  const activeServices = services.filter((s: any) => !s.is_deleted)

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="wizard-title"
    >
      <div
        className="bg-white dark:bg-[#1a1a1a] rounded-2xl shadow-xl border border-gray-200 dark:border-gray-800 w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <header className="px-6 py-4 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <Wand2 className="w-5 h-5 text-blue-500" />
            <h2 id="wizard-title" className="text-lg font-bold text-gray-900 dark:text-gray-100">
              Setup Assistant
            </h2>
          </div>
          <button
            onClick={onClose}
            aria-label="Close wizard"
            className="p-1 text-gray-400 hover:text-gray-500 dark:text-gray-500 dark:hover:text-gray-400 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </header>

        {/* Progress bar */}
        <div className="px-6 py-3 border-b border-gray-100 dark:border-gray-800 shrink-0">
          <div className="flex items-center gap-1">
            {([1, 2, 3, 4, 5, 6] as WizardStep[]).map(s => (
              <button
                key={s}
                onClick={() => goToStep(s)}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                  s === step
                    ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300'
                    : s < step
                    ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 cursor-pointer'
                    : 'bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500'
                }`}
              >
                {s < step ? (
                  <Check className="w-3 h-3" />
                ) : (
                  <span className="w-3 text-center">{s}</span>
                )}
                <span className="hidden sm:inline">{STEP_LABELS[s]}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6">
          {step === 1 && (
            <Step1Services
              services={activeServices}
              loading={loading}
              editingService={editingService}
              editingServiceId={editingServiceId}
              saving={saving}
              error={error}
              onAdd={startAddService}
              onEdit={startEditService}
              onDelete={deleteService}
              onSave={saveService}
              onCancel={cancelEditService}
              onChange={setEditingService}
            />
          )}
          {step === 2 && <PlaceholderStep label="Resources" />}
          {step === 3 && <PlaceholderStep label="Employees" />}
          {step === 4 && <PlaceholderStep label="Shifts" />}
          {step === 5 && <PlaceholderStep label="Assignments" />}
          {step === 6 && <PlaceholderStep label="Review" />}
        </div>

        {/* Footer */}
        <footer className="px-6 py-4 bg-gray-50 dark:bg-[#222] border-t border-gray-100 dark:border-gray-800 flex items-center justify-between shrink-0">
          <div className="text-xs text-gray-400">
            Step {step} of 6
          </div>
          <div className="flex gap-2">
            {step > 1 && (
              <Button variant="ghost" size="sm" onClick={goBack}>
                <ChevronLeft className="w-4 h-4 mr-1" />
                Back
              </Button>
            )}
            {step < 6 ? (
              <Button variant="primary" size="sm" onClick={goNext}>
                Next
                <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            ) : (
              <Button variant="success" size="sm" onClick={onClose}>
                <Check className="w-4 h-4 mr-1" />
                Done
              </Button>
            )}
          </div>
        </footer>
      </div>
    </div>
  )
}

// --- Step 1: Services ---

interface Step1Props {
  services: any[]
  loading: boolean
  editingService: ServiceForm | null
  editingServiceId: number | null
  saving: boolean
  error: string | null
  onAdd: () => void
  onEdit: (svc: any) => void
  onDelete: (id: number) => void
  onSave: () => void
  onCancel: () => void
  onChange: (form: ServiceForm) => void
}

function Step1Services({
  services, loading, editingService, editingServiceId, saving, error,
  onAdd, onEdit, onDelete, onSave, onCancel, onChange,
}: Step1Props) {
  return (
    <div>
      <div className="mb-4">
        <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">What services do you offer?</h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Add each service your business provides. You'll assign staff and resources to them in later steps.
        </p>
      </div>

      {/* Service list */}
      {loading ? (
        <p className="text-sm text-gray-400">Loading...</p>
      ) : (
        <div className="space-y-2 mb-4">
          {services.map((svc: any) => (
            <div
              key={svc.id}
              className="flex items-center justify-between px-4 py-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-[#222]"
            >
              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm text-gray-900 dark:text-gray-100">{svc.name}</div>
                <div className="flex items-center gap-3 mt-0.5">
                  <span className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
                    <Clock className="w-3 h-3" /> {svc.duration_minutes} min
                  </span>
                  {svc.description && (
                    <span className="text-xs text-gray-400 dark:text-gray-500 truncate max-w-[200px]">
                      {svc.description}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1 ml-2">
                <button
                  onClick={() => onEdit(svc)}
                  className="p-1.5 text-gray-400 hover:text-blue-500 transition-colors"
                  title="Edit"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => onDelete(svc.id)}
                  className="p-1.5 text-gray-400 hover:text-red-500 transition-colors"
                  title="Delete"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
          {services.length === 0 && !editingService && (
            <p className="text-sm text-gray-400 dark:text-gray-500 py-4 text-center">
              No services yet. Add your first service to get started.
            </p>
          )}
        </div>
      )}

      {/* Add/Edit form */}
      {editingService ? (
        <div className="rounded-xl border-2 border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-950/20 p-4 space-y-3">
          <div className="text-sm font-medium text-gray-700 dark:text-gray-300">
            {editingServiceId ? 'Edit Service' : 'New Service'}
          </div>
          <Input
            label="Service Name"
            value={editingService.name}
            onChange={e => onChange({ ...editingService, name: e.target.value })}
            placeholder="e.g. Oil Change, Haircut, Tire Rotation"
          />
          <Input
            label="Description (optional)"
            value={editingService.description}
            onChange={e => onChange({ ...editingService, description: e.target.value })}
            placeholder="Brief description"
          />
          <Input
            label="Duration (minutes)"
            type="number"
            value={String(editingService.duration_minutes)}
            onChange={e => onChange({ ...editingService, duration_minutes: parseInt(e.target.value) || 0 })}
          />
          {error && (
            <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
          )}
          <div className="flex gap-2 pt-1">
            <Button variant="primary" size="sm" onClick={onSave} disabled={saving}>
              {saving ? 'Saving...' : editingServiceId ? 'Update' : 'Add Service'}
            </Button>
            <Button variant="ghost" size="sm" onClick={onCancel}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <button
          onClick={onAdd}
          className="flex items-center gap-2 px-4 py-2.5 w-full rounded-xl border-2 border-dashed border-gray-300 dark:border-gray-600 text-sm text-gray-500 dark:text-gray-400 hover:border-blue-400 hover:text-blue-500 dark:hover:border-blue-500 dark:hover:text-blue-400 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Add a service
        </button>
      )}
    </div>
  )
}

// --- Placeholder for steps 2-6 ---

function PlaceholderStep({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center h-48 text-gray-400 dark:text-gray-500">
      <p className="text-sm">{label} — coming soon</p>
    </div>
  )
}
