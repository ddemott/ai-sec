'use client'

import React, { useEffect, useState } from 'react'
import {
  Building2,
  RefreshCw,
  Search,
  Globe,
  ShieldAlert,
} from 'lucide-react'
import { Api } from '../lib/api'
import { useSessionContext } from '@/lib/SessionContext'
import { formatPhone, normalizePhone } from '../lib/phone'
import { Button } from './ui/Button'
import { Input } from './ui/Input'
import { Modal } from './ui/Modal'
import { LoadingState } from './ui/LoadingState'
import { TenantCard } from './TenantCard'
import { TenantCreateForm } from './TenantCreateForm'
import { TenantEditPanel } from './TenantEditPanel'
import type { TenantFull } from '../lib/types'

type Tenant = TenantFull

type Template = {
    business_type: string
    display_name: string
}

interface SuperAdminProps {
  onSelectTenant?: (id: string, name: string) => void;
  currentTenantId?: string | null;
}

export default function SuperAdminDashboard({ onSelectTenant, currentTenantId }: SuperAdminProps) {
    const { notifyTenantsChanged } = useSessionContext()
    const [tenants, setTenants] = useState<Tenant[]>([])
    const [selectedTenant, setSelectedTenant] = useState<Tenant | null>(null)
    const [templates, setTemplates] = useState<Template[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  // Edit form state
    const [form, setForm] = useState<Tenant | null>(null)

  // Drag-and-drop reorder state
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [, setOverIndex] = useState<number | null>(null)
  const [originalOrder, setOriginalOrder] = useState<Tenant[]>([])
  const [hasReordered, setHasReordered] = useState(false)
  const [savingOrder, setSavingOrder] = useState(false)

  // Delete confirmation state
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false)
  const [deleteConfirmText, setDeleteConfirmText] = useState('')
  const [deleting, setDeleting] = useState(false)

  // Create Modal State
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)
  const [newBusiness, setNewBusiness] = useState({
    tenant_name: '',
    business_type: '',
    owner_first_name: '',
    owner_last_name: '',
    owner_email: '',
    owner_pass: ''
  })

    useEffect(() => {
      void fetchData()
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

  useEffect(() => {
    if (selectedTenant) {
      setForm({
        ...selectedTenant,
        owner_phone: formatPhone(selectedTenant.owner_phone)
      })
      setIsEditing(false) // Default to read-only when switching tenants
      setSuccess(false)
      setError(null)
    }
  }, [selectedTenant])

    const fetchData = async () => {
    setLoading(true)
    setError(null)
    try {
      const [tData, tempData] = await Promise.all([
        Api.tenants.list(),
        Api.templates.list()
      ])

      const tenantsArray = Array.isArray(tData) ? tData : []
      const templatesArray = Array.isArray(tempData) ? tempData : []

      setTenants(tenantsArray)
      setTemplates(templatesArray)

      if (tenantsArray.length > 0 && !selectedTenant) {
        const initial = currentTenantId
          ? (tenantsArray.find(t => t.tenant_id === currentTenantId) || tenantsArray[0])
          : tenantsArray[0];
        setSelectedTenant(initial)
        if (onSelectTenant && !currentTenantId) onSelectTenant(initial.tenant_id, initial.name);
      }
    } catch (e) {
      console.error('Fetch error:', e)
      setError('Failed to load data from backend. Ensure server is reachable.')
    } finally {
      setLoading(false)
    }
  }

  // --- Drag-and-drop reorder ---
  function handleDragStart(index: number) {
    setDragIndex(index)
    if (!hasReordered) setOriginalOrder([...tenants])
  }

  function handleDragOver(e: React.DragEvent, index: number) {
    e.preventDefault()
    if (dragIndex === null || dragIndex === index) return
    setOverIndex(index)

    const updated = [...tenants]
    const [moved] = updated.splice(dragIndex, 1)
    updated.splice(index, 0, moved)
    setTenants(updated)
    setDragIndex(index)
    setHasReordered(true)
  }

  function handleDragEnd() {
    setDragIndex(null)
    setOverIndex(null)
  }

  async function handleSaveOrder() {
    setSavingOrder(true)
    try {
      const order = tenants.map(t => t.tenant_id)
      const res = await Api.tenants.reorder(order)
      if (res.success) {
        setHasReordered(false)
        setOriginalOrder([])
        notifyTenantsChanged()
      }
    } catch {
      setError('Failed to save order')
    } finally {
      setSavingOrder(false)
    }
  }

  function handleDiscardOrder() {
    setTenants(originalOrder)
    setHasReordered(false)
    setOriginalOrder([])
  }

  async function handleSave() {
    if (!form) return
    setSaving(true)
    setError(null)
    setSuccess(false)

    const normalizedForm = {
      ...form,
      owner_phone: form.owner_phone ? normalizePhone(form.owner_phone) : null,
      inbound_phone: form.inbound_phone ? normalizePhone(form.inbound_phone) : null
    }

    try {
      const res = await Api.tenants.update(form.tenant_id, normalizedForm as unknown as TenantFull)

      if (res.success) {
        setSuccess(true)
        setIsEditing(false)
        const updatedTenants = tenants.map(t => t.tenant_id === form.tenant_id ? { ...normalizedForm } : t)
        setTenants(updatedTenants)
        setSelectedTenant({ ...normalizedForm } as Tenant)
        if (onSelectTenant) onSelectTenant(form.tenant_id, form.name);
      } else {
        setError(res.error || 'Failed to update business attributes')
      }
    } catch {
      setError('Connection error')
    } finally {
      setSaving(false)
    }
  }

  function handleDelete() {
    if (!selectedTenant) return
    setDeleteConfirmText('')
    setIsDeleteModalOpen(true)
  }

  async function confirmDelete() {
    if (!selectedTenant) return
    setDeleting(true)
    try {
      const res = await Api.tenants.delete(selectedTenant.tenant_id)
      if (res.success) {
        setSelectedTenant(null)
        setIsDeleteModalOpen(false)
        setDeleteConfirmText('')
        void fetchData()
        notifyTenantsChanged()
      } else {
        setError(res.error || 'Failed to delete business')
      }
    } catch {
      setError('Failed to delete business')
    } finally {
      setDeleting(false)
    }
  }

  async function handleCreate() {
    setSaving(true)
    setError(null)

    // Prevent duplicate tenant names
    const nameExists = tenants.some(
      t => t.name.toLowerCase() === newBusiness.tenant_name.trim().toLowerCase()
    )
    if (nameExists) {
      setError(`A business named "${newBusiness.tenant_name.trim()}" already exists. Choose a different name.`)
      setSaving(false)
      return
    }

    try {
      const res = await Api.tenants.create(newBusiness)
        if (res.success) {
            setIsCreateModalOpen(false)
            setNewBusiness({
                tenant_name: '',
                business_type: '',
            owner_first_name: '',
            owner_last_name: '',
                owner_email: '',
                owner_pass: ''
            })
            void fetchData()
            notifyTenantsChanged()
        } else {
            setError(res.error || 'Failed to create new business')
        }
    } catch {
      setError('Connection error')
    } finally {
        setSaving(false)
    }
  }

  if (loading) return <LoadingState message="Loading all businesses…" />

  return (
    <div className="flex flex-1 overflow-hidden relative transition-colors duration-200" style={{ color: 'var(--text-primary)', backgroundColor: 'var(--bg-base)' }}>

      <Modal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        title="Launch New Business"
        disableBackdropClose
        footer={
          <>
            <Button variant="secondary" onClick={() => setIsCreateModalOpen(false)}>Cancel</Button>
            <Button onClick={handleCreate} isLoading={saving} disabled={!newBusiness.tenant_name}>Deploy Business</Button>
          </>
        }
      >
        <TenantCreateForm
          newBusiness={newBusiness}
          templates={templates}
          onChange={setNewBusiness}
        />
      </Modal>

      {/* Sidebar List */}
      <section className="w-full md:w-80 flex flex-col border-r transition-colors duration-200" style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-soft)' }}>
        <header className="p-4 border-b sticky top-0 z-10 transition-colors duration-200" style={{ borderColor: 'var(--border-soft)', backgroundColor: 'var(--bg-surface)' }}>
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-bold flex items-center">
                <Globe className="w-5 h-5 mr-2" style={{ color: 'var(--accent-soft)' }} />
                All Businesses
            </h2>
            <div className="flex items-center space-x-1">
                <Button
                    variant="ghost"
                    onClick={() => setIsCreateModalOpen(true)}
                    size="sm"
                    className="p-1.5"
                    title="Launch New Business"
                >
                    <Building2 className="w-4 h-4" />
                </Button>
                <Button variant="ghost" size="sm" onClick={fetchData} className="p-1.5" style={{ color: 'var(--text-secondary)' }}>
                    <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                </Button>
            </div>
          </div>
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-2.5 text-gray-400 dark:text-gray-500" />
            <input type="text" placeholder="Search businesses..." className="w-full pl-9 pr-4 py-2 border-none rounded-md text-sm outline-none transition-colors duration-200" style={{ backgroundColor: 'var(--bg-raised)', color: 'var(--text-primary)' }} />
          </div>
        </header>

        {/* Save/Discard reorder bar */}
        {hasReordered && (
          <div className="flex items-center justify-between gap-2 px-3 py-2 bg-amber-50 dark:bg-amber-900/20 border-b border-amber-200 dark:border-amber-800">
            <span className="text-xs font-bold text-amber-700 dark:text-amber-300">Order changed</span>
            <div className="flex gap-1.5">
              <button
                onClick={handleDiscardOrder}
                className="text-xs font-bold text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 px-2 py-1 rounded transition-colors"
              >
                Discard
              </button>
              <button
                onClick={handleSaveOrder}
                disabled={savingOrder}
                className="text-xs font-bold px-3 py-1 rounded transition-colors disabled:opacity-50 hover:brightness-110"
                style={{ color: '#ffffff', backgroundColor: 'var(--warning)' }}
              >
                {savingOrder ? 'Saving...' : 'Save Order'}
              </button>
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto">
          {tenants.map((t, idx) => (
            <TenantCard
              key={t.tenant_id}
              tenant={t}
              isSelected={selectedTenant?.tenant_id === t.tenant_id}
              isDragging={dragIndex === idx}
              index={idx}
              onSelect={() => {
                setSelectedTenant(t);
                if (onSelectTenant) onSelectTenant(t.tenant_id, t.name);
              }}
              onDragStart={handleDragStart}
              onDragOver={handleDragOver}
              onDragEnd={handleDragEnd}
            />
          ))}
        </div>
      </section>

      {/* Detail Pane */}
      <section className="flex-1 flex flex-col overflow-y-auto transition-colors duration-200" style={{ backgroundColor: 'var(--bg-base)' }}>
        {selectedTenant && form ? (
          <TenantEditPanel
            selectedTenant={selectedTenant}
            form={form}
            templates={templates}
            isEditing={isEditing}
            saving={saving}
            success={success}
            error={error}
            onFormChange={setForm}
            onEdit={() => setIsEditing(true)}
            onCancelEdit={() => setIsEditing(false)}
            onSave={handleSave}
            onDelete={handleDelete}
            onTenantUpdate={setSelectedTenant}
          />
        ) : (
          <div className="flex-1 flex items-center justify-center text-gray-400 dark:text-gray-600 italic">Select a business to manage its global attributes</div>
        )}
      </section>

      {/* Delete Confirmation Modal */}
      <Modal
        isOpen={isDeleteModalOpen}
        onClose={() => { setIsDeleteModalOpen(false); setDeleteConfirmText(''); }}
        title="Delete Business"
        disableBackdropClose
        footer={
          <div className="flex gap-2 justify-end">
            <Button variant="ghost" onClick={() => { setIsDeleteModalOpen(false); setDeleteConfirmText(''); }}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={confirmDelete}
              disabled={deleteConfirmText !== selectedTenant?.name || deleting}
            >
              {deleting ? 'Deleting...' : 'Permanently Delete'}
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <div className="flex items-start gap-3 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
            <ShieldAlert className="w-5 h-5 shrink-0 mt-0.5" style={{ color: 'var(--danger)' }} />
            <div className="text-sm text-red-700 dark:text-red-300">
              <p className="font-bold mb-1">This action is permanent and cannot be undone.</p>
              <p>Deleting <strong>{selectedTenant?.name}</strong> will permanently remove all associated data including customers, appointments, employees, resources, call history, and knowledge base documents.</p>
            </div>
          </div>
          <div>
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300 block mb-2">
              Type <strong>{selectedTenant?.name}</strong> to confirm:
            </label>
            <Input
              value={deleteConfirmText}
              onChange={(e) => setDeleteConfirmText(e.target.value)}
              placeholder={selectedTenant?.name || ''}
            />
          </div>
        </div>
      </Modal>
    </div>
  )
}
