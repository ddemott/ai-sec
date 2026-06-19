'use client';

/**
 * Hook that owns all SuperAdminDashboard state and mutations.
 * The component keeps sidebar + modal rendering only.
 */

import { useState, useEffect, useCallback } from 'react';
import { Api } from './api';
import { useSessionContext } from './SessionContext';
import { formatPhone, normalizePhone } from './phone';
import type { TenantFull } from './types';

type Tenant = TenantFull;

type Template = {
  business_type: string;
  display_name: string;
};

const EMPTY_NEW_BUSINESS = {
  tenant_name: '',
  business_type: '',
  owner_first_name: '',
  owner_last_name: '',
  owner_email: '',
  owner_pass: '',
};

export function useSuperAdminTenants(
  onSelectTenant?: (id: string, name: string) => void,
  currentTenantId?: string | null
) {
  const { notifyTenantsChanged } = useSessionContext();

  // ── Core data ──────────────────────────────────────────────────────────────
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [selectedTenant, setSelectedTenant] = useState<Tenant | null>(null);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [form, setForm] = useState<Tenant | null>(null);

  // ── Drag-and-drop reorder ─────────────────────────────────────────────────
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [, setOverIndex] = useState<number | null>(null);
  const [originalOrder, setOriginalOrder] = useState<Tenant[]>([]);
  const [hasReordered, setHasReordered] = useState(false);
  const [savingOrder, setSavingOrder] = useState(false);

  // ── Search ────────────────────────────────────────────────────────────────
  const [search, setSearch] = useState('');

  // ── Delete modal ──────────────────────────────────────────────────────────
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);

  // ── Create modal ──────────────────────────────────────────────────────────
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [newBusiness, setNewBusiness] = useState({ ...EMPTY_NEW_BUSINESS });

  // ── Fetch ─────────────────────────────────────────────────────────────────
  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [tData, tempData] = await Promise.all([Api.tenants.list(), Api.templates.list()]);

      const tenantsArray = Array.isArray(tData) ? tData : [];
      const templatesArray = Array.isArray(tempData) ? tempData : [];

      setTenants(tenantsArray);
      setTemplates(templatesArray);

      if (tenantsArray.length > 0 && !selectedTenant) {
        const initial = currentTenantId
          ? tenantsArray.find((t) => t.tenant_id === currentTenantId) || tenantsArray[0]
          : tenantsArray[0];
        setSelectedTenant(initial);
        if (onSelectTenant && !currentTenantId) onSelectTenant(initial.tenant_id, initial.name);
      }
    } catch (e) {
      console.error('Fetch error:', e);
      setError('Failed to load data from backend. Ensure server is reachable.');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync form when selection changes
  useEffect(() => {
    if (selectedTenant) {
      setForm({
        ...selectedTenant,
        owner_phone: formatPhone(selectedTenant.owner_phone),
      });
      setIsEditing(false);
      setSuccess(false);
      setError(null);
    }
  }, [selectedTenant]);

  // ── Drag-and-drop handlers ────────────────────────────────────────────────
  function handleDragStart(index: number) {
    setDragIndex(index);
    if (!hasReordered) setOriginalOrder([...tenants]);
  }

  function handleDragOver(e: React.DragEvent, index: number) {
    e.preventDefault();
    if (dragIndex === null || dragIndex === index) return;
    setOverIndex(index);

    const updated = [...tenants];
    const [moved] = updated.splice(dragIndex, 1);
    updated.splice(index, 0, moved);
    setTenants(updated);
    setDragIndex(index);
    setHasReordered(true);
  }

  function handleDragEnd() {
    setDragIndex(null);
    setOverIndex(null);
  }

  async function handleSaveOrder() {
    setSavingOrder(true);
    try {
      const order = tenants.map((t) => t.tenant_id);
      const res = await Api.tenants.reorder(order);
      if (res.success) {
        setHasReordered(false);
        setOriginalOrder([]);
        notifyTenantsChanged();
      }
    } catch {
      setError('Failed to save order');
    } finally {
      setSavingOrder(false);
    }
  }

  function handleDiscardOrder() {
    setTenants(originalOrder);
    setHasReordered(false);
    setOriginalOrder([]);
  }

  // ── Save (edit) ───────────────────────────────────────────────────────────
  async function handleSave() {
    if (!form) return;
    setSaving(true);
    setError(null);
    setSuccess(false);

    const normalizedForm = {
      ...form,
      owner_phone: form.owner_phone ? normalizePhone(form.owner_phone) : null,
      inbound_phone: form.inbound_phone ? normalizePhone(form.inbound_phone) : null,
    };

    try {
      const res = await Api.tenants.update(form.tenant_id, normalizedForm as unknown as TenantFull);

      if (res.success) {
        setSuccess(true);
        setIsEditing(false);
        setTenants((prev) =>
          prev.map((t) => (t.tenant_id === form.tenant_id ? { ...normalizedForm } : t))
        );
        setSelectedTenant({ ...normalizedForm } as Tenant);
        if (onSelectTenant) onSelectTenant(form.tenant_id, form.name);
      } else {
        setError(res.error || 'Failed to update business attributes');
      }
    } catch {
      setError('Connection error');
    } finally {
      setSaving(false);
    }
  }

  // ── Delete ────────────────────────────────────────────────────────────────
  function handleDelete() {
    if (!selectedTenant) return;
    setDeleteConfirmText('');
    setIsDeleteModalOpen(true);
  }

  async function confirmDelete() {
    if (!selectedTenant) return;
    setDeleting(true);
    try {
      const res = await Api.tenants.delete(selectedTenant.tenant_id);
      if (res.success) {
        setSelectedTenant(null);
        setIsDeleteModalOpen(false);
        setDeleteConfirmText('');
        void fetchData();
        notifyTenantsChanged();
      } else {
        setError(res.error || 'Failed to delete business');
      }
    } catch {
      setError('Failed to delete business');
    } finally {
      setDeleting(false);
    }
  }

  // ── Create ────────────────────────────────────────────────────────────────
  async function handleCreate() {
    setSaving(true);
    setError(null);

    const nameExists = tenants.some(
      (t) => t.name.toLowerCase() === newBusiness.tenant_name.trim().toLowerCase()
    );
    if (nameExists) {
      setError(
        `A business named "${newBusiness.tenant_name.trim()}" already exists. Choose a different name.`
      );
      setSaving(false);
      return;
    }

    try {
      const res = await Api.tenants.create(newBusiness);
      if (res.success) {
        setIsCreateModalOpen(false);
        setNewBusiness({ ...EMPTY_NEW_BUSINESS });
        void fetchData();
        notifyTenantsChanged();
      } else {
        setError(res.error || 'Failed to create new business');
      }
    } catch {
      setError('Connection error');
    } finally {
      setSaving(false);
    }
  }

  return {
    // data
    tenants,
    selectedTenant,
    setSelectedTenant,
    templates,
    loading,
    // edit form
    saving,
    isEditing,
    setIsEditing,
    error,
    success,
    form,
    setForm,
    // drag-reorder
    dragIndex,
    hasReordered,
    savingOrder,
    // search
    search,
    setSearch,
    // delete modal
    isDeleteModalOpen,
    setIsDeleteModalOpen,
    deleteConfirmText,
    setDeleteConfirmText,
    deleting,
    // create modal
    isCreateModalOpen,
    setIsCreateModalOpen,
    newBusiness,
    setNewBusiness,
    // handlers
    fetchData,
    handleDragStart,
    handleDragOver,
    handleDragEnd,
    handleSaveOrder,
    handleDiscardOrder,
    handleSave,
    handleDelete,
    confirmDelete,
    handleCreate,
  };
}
