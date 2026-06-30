'use client';

import React, { useState, useEffect } from 'react';
import {
  PlusCircle,
  Settings,
  Users,
  Wrench,
  CheckCircle2,
  ChevronRight,
  Info,
  Trash2,
  Tag,
  AlertCircle,
} from 'lucide-react';
import { Api } from '../lib/api';
import { roundUpTo15 } from '../lib/duration';
import { useStaticData } from '../lib/hooks';
import { useActiveTenantId } from '../lib/SessionContext';
import { useVocabulary } from '@/lib/VocabularyContext';
import { Button } from './ui/Button';
import { Card } from './ui/Card';
import { Input } from './ui/Input';
import { Modal } from './ui/Modal';
import { Badge } from './ui/Badge';
import { ConfirmModal } from './ui/ConfirmModal';
import { useConfirm } from '../lib/useConfirm';
import { showToast } from './ui/Toast';
import { LoadingState } from './ui/LoadingState';

type Service = {
  service_id: string;
  name: string;
  description?: string;
  duration_minutes: number;
  price?: number | null;
};

export default function ServiceAssignmentView() {
  const tenantId = useActiveTenantId();
  const vocab = useVocabulary();
  const {
    services,
    resources,
    employees,
    loading,
    error: staticError,
    refresh,
  } = useStaticData(tenantId);

  const [resMappings, setResMappings] = useState<{ service_id: string; resource_id?: string }[]>(
    []
  );
  const [empMappings, setEmpMappings] = useState<{ service_id: string; employee_id?: string }[]>(
    []
  );
  const [actionError, setActionError] = useState<string | null>(null);

  // Wizard State (Creation)
  const [isWizardOpen, setIsWizardOpen] = useState(false);
  const [wizardStep, setWizardStep] = useState(1);
  const [wizardData, setWizardData] = useState<Partial<Service>>({
    name: '',
    description: '',
    duration_minutes: 30,
  });
  const [selectedResourceIds, setSelectedResourceIds] = useState<string[]>([]);
  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState<string[]>([]);

  // Edit State
  const [selectedService, setSelectedService] = useState<Service | null>(null);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editForm, setEditForm] = useState<Partial<Service>>({});
  const [saving, setSaving] = useState(false);

  // Default service — the one a call books when the caller doesn't name a
  // matchable service. One default per business (radio behavior).
  const [defaultServiceId, setDefaultServiceId] = useState<string | null>(null);
  const [settingDefaultId, setSettingDefaultId] = useState<string | null>(null);

  async function setAsDefault(serviceId: string) {
    if (!tenantId) return;
    setSettingDefaultId(serviceId);
    try {
      await Api.tenants.updateConfig(tenantId, { default_service_id: serviceId });
      setDefaultServiceId(serviceId);
      showToast('Set as the default when a caller doesn’t name a service.', 'success');
    } catch {
      showToast('Could not set the default service. Please try again.', 'error');
    } finally {
      setSettingDefaultId(null);
    }
  }

  const { state: confirmState, confirm: confirmAction, close: closeConfirm } = useConfirm();

  useEffect(() => {
    if (tenantId) void fetchMappings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  async function fetchMappings() {
    try {
      const [rMap, eMap, config] = await Promise.all([
        Api.mappings.listServiceResource(tenantId),
        Api.mappings.listServiceEmployee(tenantId),
        Api.tenants.getConfig(tenantId),
      ]);
      setResMappings(rMap);
      setEmpMappings(eMap);
      setDefaultServiceId(config.default_service_id ?? null);
    } catch {
      console.error('Failed to fetch mappings');
    }
  }

  const nextStep = () => setWizardStep((s) => s + 1);
  const prevStep = () => setWizardStep((s) => s - 1);

  async function handleCreateService() {
    setActionError(null);
    try {
      // 15-min snap — see lib/duration.ts. Same rationale as the wizard's
      // saveService: align stored duration with what the grid allocates.
      const res = await Api.services.create(tenantId, {
        ...wizardData,
        duration_minutes: roundUpTo15(wizardData.duration_minutes),
      });
      if (!res.success) throw new Error(res.error || 'Failed to save service');

      const serviceId = res.service.service_id;

      // Save Mappings
      await Promise.all([
        ...selectedResourceIds.map((rid) =>
          Api.mappings.assignServiceResource(serviceId, rid, tenantId)
        ),
        ...selectedEmployeeIds.map((eid) =>
          Api.mappings.assignServiceEmployee(serviceId, eid, tenantId)
        ),
      ]);

      setIsWizardOpen(false);
      setWizardStep(1);
      setWizardData({ name: '', description: '', duration_minutes: 30 });
      setSelectedResourceIds([]);
      setSelectedEmployeeIds([]);
      void refresh();
      void fetchMappings();
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleUpdateService() {
    if (!selectedService || !editForm.name?.trim()) return;
    setSaving(true);
    setActionError(null);
    try {
      const duration = roundUpTo15(editForm.duration_minutes);
      const price =
        editForm.price === undefined || editForm.price === null || !Number.isFinite(editForm.price)
          ? undefined
          : editForm.price;
      const res = await Api.services.update(selectedService.service_id, tenantId, {
        name: editForm.name,
        description: editForm.description,
        ...(duration >= 5 ? { duration_minutes: duration } : {}),
        ...(price !== undefined ? { price } : {}),
      });
      if (res.success) {
        void refresh();
        setIsEditModalOpen(false);
      } else {
        const details = (res as Record<string, unknown>).details;
        const extra = Array.isArray(details)
          ? ` (${(details as Array<{ message: string }>).map((d) => d.message).join(', ')})`
          : '';
        setActionError((res.error || 'Update failed') + extra);
      }
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  function handleDeleteService(id: string) {
    confirmAction({
      title: 'Remove service?',
      message:
        "This will remove the service definition permanently. Existing appointments keep their record but the service won't be bookable.",
      confirmLabel: 'Remove service',
      confirmVariant: 'danger',
      onConfirm: async () => {
        closeConfirm();
        setActionError(null);
        try {
          const res = await Api.services.delete(id, tenantId);
          if (res.success) {
            void refresh();
            setIsEditModalOpen(false);
            showToast('Service removed', 'success');
          } else {
            setActionError(res.error || 'Delete failed');
            showToast(res.error || 'Delete failed', 'error');
          }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          setActionError(msg);
          showToast(msg, 'error');
        }
      },
    });
  }

  async function toggleResourceMapping(serviceId: string, resourceId: string) {
    const isMapped = resMappings.some(
      (m) => m.service_id === serviceId && m.resource_id === resourceId
    );
    try {
      if (isMapped) {
        await Api.mappings.unassignServiceResource(serviceId, resourceId, tenantId);
        setResMappings(
          resMappings.filter((m) => !(m.service_id === serviceId && m.resource_id === resourceId))
        );
      } else {
        await Api.mappings.assignServiceResource(serviceId, resourceId, tenantId);
        setResMappings([...resMappings, { service_id: serviceId, resource_id: resourceId }]);
      }
    } catch {
      showToast('Mapping update failed', 'error');
    }
  }

  async function toggleEmployeeMapping(serviceId: string, employeeId: string) {
    const isMapped = empMappings.some(
      (m) => m.service_id === serviceId && m.employee_id === employeeId
    );
    try {
      if (isMapped) {
        await Api.mappings.unassignServiceEmployee(serviceId, employeeId, tenantId);
        setEmpMappings(
          empMappings.filter((m) => !(m.service_id === serviceId && m.employee_id === employeeId))
        );
      } else {
        await Api.mappings.assignServiceEmployee(serviceId, employeeId, tenantId);
        setEmpMappings([...empMappings, { service_id: serviceId, employee_id: employeeId }]);
      }
    } catch {
      showToast('Mapping update failed', 'error');
    }
  }

  if (loading && services.length === 0) {
    return <LoadingState message="Loading catalog…" />;
  }

  if (!loading && services.length === 0) {
    return (
      <div
        className="flex-1 flex flex-col overflow-y-auto p-8 transition-colors duration-200"
        style={{ backgroundColor: 'var(--bg-surface)', color: 'var(--text-primary)' }}
      >
        <header className="mb-8 flex items-center justify-between">
          <div className="flex items-center">
            <div
              className="p-2 rounded-lg mr-4"
              style={{ backgroundColor: 'var(--accent-muted)', color: 'var(--accent-soft)' }}
            >
              <Settings className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-3xl font-display">Service Catalog</h1>
              <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                Manage your business offerings and operational logic.
              </p>
            </div>
          </div>
          <Button onClick={() => setIsWizardOpen(true)} icon={PlusCircle}>
            New Service Wizard
          </Button>
        </header>
        <Card
          className="p-10 text-center border-dashed"
          style={{ borderColor: 'var(--border-soft)', backgroundColor: 'var(--bg-raised)' }}
        >
          <div
            className="mx-auto mb-4 w-12 h-12 rounded-full flex items-center justify-center"
            style={{ backgroundColor: 'var(--accent-muted)', color: 'var(--accent-soft)' }}
          >
            <Wrench className="w-6 h-6" />
          </div>
          <h2 className="text-2xl font-bold mb-2">No services yet</h2>
          <p className="text-sm mb-6" style={{ color: 'var(--text-secondary)' }}>
            Create your first service so staff can start booking appointments.
          </p>
          <Button onClick={() => setIsWizardOpen(true)} icon={PlusCircle}>
            New Service Wizard
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div
      className="flex-1 flex flex-col overflow-y-auto p-8 transition-colors duration-200"
      style={{ backgroundColor: 'var(--bg-surface)', color: 'var(--text-primary)' }}
    >
      <header className="mb-8 flex items-center justify-between">
        <div className="flex items-center">
          <div
            className="p-2 rounded-lg mr-4"
            style={{ backgroundColor: 'var(--accent-muted)', color: 'var(--accent-soft)' }}
          >
            <Settings className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-3xl font-display">Service Catalog</h1>
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              Manage your business offerings and operational logic.
            </p>
          </div>
        </div>
        <Button onClick={() => setIsWizardOpen(true)} icon={PlusCircle}>
          New Service Wizard
        </Button>
      </header>

      {(staticError || actionError) && (
        <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-2xl text-red-700 dark:text-red-400 flex items-center gap-3">
          <AlertCircle className="w-5 h-5" />
          <span className="font-bold">{actionError || staticError}</span>
        </div>
      )}

      {/* Service List */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {services.map((service) => (
          <Card
            key={service.service_id}
            className="relative group cursor-pointer transition-all"
            onClick={() => {
              setSelectedService(service);
              setEditForm({
                name: service.name,
                description: service.description,
                duration_minutes: service.duration_minutes,
                price: service.price ?? undefined,
              });
              setIsEditModalOpen(true);
            }}
          >
            <h3 className="text-xl font-bold mb-1">{service.name}</h3>
            <p
              className="text-sm mb-4 h-10 overflow-hidden line-clamp-2"
              style={{ color: 'var(--text-secondary)' }}
            >
              {service.description}
            </p>

            <div className="flex items-center gap-2 mb-4">
              <Badge variant="secondary">{service.duration_minutes} MIN</Badge>
              {(service.price ?? 0) > 0 && <Badge variant="primary">${service.price}</Badge>}
            </div>

            {/* Default-when-nothing-matches selector. Radio behavior: one
                default per business. Clicking sets tenants.default_service_id;
                stopPropagation so it doesn't open the edit modal. */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                if (service.service_id !== defaultServiceId) void setAsDefault(service.service_id);
              }}
              disabled={settingDefaultId === service.service_id}
              aria-pressed={service.service_id === defaultServiceId}
              title="The service a call books when the caller doesn't name a matchable one"
              className="flex items-center gap-2 mb-4 text-left disabled:opacity-60"
            >
              <span
                className="w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0"
                style={{
                  borderColor:
                    service.service_id === defaultServiceId
                      ? 'var(--accent)'
                      : 'var(--border-soft)',
                }}
              >
                {service.service_id === defaultServiceId && (
                  <span
                    className="w-2 h-2 rounded-full"
                    style={{ backgroundColor: 'var(--accent)' }}
                  />
                )}
              </span>
              <span
                className="text-xs"
                style={{
                  color:
                    service.service_id === defaultServiceId
                      ? 'var(--accent)'
                      : 'var(--text-secondary)',
                }}
              >
                {service.service_id === defaultServiceId
                  ? 'Default when nothing matches'
                  : 'Set as default'}
              </span>
            </button>

            <div className="space-y-3 pt-4 border-t" style={{ borderColor: 'var(--border-soft)' }}>
              <div className="flex items-center text-xs font-bold uppercase tracking-tighter">
                <Wrench className="w-3 h-3 mr-2" style={{ color: 'var(--accent-soft)' }} />
                <span style={{ color: 'var(--text-muted)' }}>{vocab.resource_plural}: </span>
                <span className="ml-1" style={{ color: 'var(--text-secondary)' }}>
                  {resMappings.filter((m) => m.service_id === service.service_id).length} assigned
                </span>
              </div>
              <div className="flex items-center text-xs font-bold uppercase tracking-tighter">
                <Users className="w-3 h-3 mr-2" style={{ color: 'var(--success)' }} />
                <span style={{ color: 'var(--text-muted)' }}>{vocab.employee_plural}: </span>
                <span className="ml-1" style={{ color: 'var(--text-secondary)' }}>
                  {empMappings.filter((m) => m.service_id === service.service_id).length} authorized
                </span>
              </div>
            </div>
          </Card>
        ))}
      </div>

      {/* EDIT MODAL */}
      <Modal
        isOpen={isEditModalOpen && !!selectedService}
        onClose={() => setIsEditModalOpen(false)}
        title={selectedService?.name || 'Edit Service'}
        disableBackdropClose
        footer={
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setIsEditModalOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleUpdateService} isLoading={saving}>
              Save Changes
            </Button>
          </div>
        }
      >
        <div className="space-y-8 max-h-[70vh] overflow-y-auto pr-2">
          {/* BASIC INFO */}
          <section className="space-y-4">
            <h4
              className="text-xs font-bold uppercase tracking-widest flex items-center"
              style={{ color: 'var(--text-muted)' }}
            >
              <Tag className="w-3 h-3 mr-2" /> Service Details
            </h4>
            <div className="grid grid-cols-1 gap-4">
              <Input
                label="Name"
                value={editForm.name}
                onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
              />
              <div>
                <label
                  className="block text-xs font-bold uppercase mb-1 ml-1 tracking-widest"
                  style={{ color: 'var(--text-muted)' }}
                >
                  Description
                </label>
                <textarea
                  className="w-full p-3 border rounded-xl text-sm h-20 outline-none focus:ring-2"
                  style={{ backgroundColor: 'var(--bg-raised)', borderColor: 'var(--border-soft)' }}
                  value={editForm.description}
                  onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <Input
                  label="Duration (Min)"
                  type="number"
                  step={15}
                  min={15}
                  value={editForm.duration_minutes}
                  onChange={(e) => {
                    const v = parseInt(e.target.value);
                    setEditForm({ ...editForm, duration_minutes: Number.isFinite(v) ? v : undefined });
                  }}
                />
                <Input
                  label="Price ($)"
                  type="number"
                  value={editForm.price ?? ''}
                  onChange={(e) => {
                    const v = parseFloat(e.target.value);
                    setEditForm({ ...editForm, price: Number.isFinite(v) ? v : undefined });
                  }}
                />
              </div>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                Scheduled in 15-minute slots — non-multiples are rounded up on save.
              </p>
            </div>
          </section>

          {/* MAPPINGS WITHIN EDIT */}
          <section className="space-y-4">
            <h4
              className="text-xs font-bold uppercase tracking-widest flex items-center"
              style={{ color: 'var(--text-muted)' }}
            >
              <Wrench className="w-3 h-3 mr-2" /> {vocab.resource_plural} & {vocab.employee_plural}
            </h4>
            <div className="space-y-6">
              <div>
                <p
                  className="text-xs font-bold uppercase mb-3 ml-1"
                  style={{ color: 'var(--text-muted)' }}
                >
                  Authorized {vocab.resource_plural}
                </p>
                <div className="flex flex-wrap gap-2">
                  {resources.map((res) => {
                    const isMapped = resMappings.some(
                      (m) =>
                        m.service_id === selectedService?.service_id &&
                        m.resource_id === res.resource_id
                    );
                    return (
                      <button
                        key={res.resource_id}
                        onClick={() =>
                          selectedService &&
                          toggleResourceMapping(selectedService.service_id, res.resource_id)
                        }
                        className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition-all`}
                        style={
                          isMapped
                            ? {
                                backgroundColor: 'var(--accent)',
                                color: 'var(--primary-text)',
                                borderColor: 'var(--accent)',
                              }
                            : {
                                backgroundColor: 'var(--bg-raised)',
                                borderColor: 'var(--border-soft)',
                                color: 'var(--text-secondary)',
                              }
                        }
                      >
                        {res.name}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div>
                <p
                  className="text-xs font-bold uppercase mb-3 ml-1"
                  style={{ color: 'var(--text-muted)' }}
                >
                  Qualified {vocab.employee_plural}
                </p>
                <div className="flex flex-wrap gap-2">
                  {employees
                    .filter((e) => e.type !== 'user')
                    .map((emp) => {
                      const isMapped = empMappings.some(
                        (m) =>
                          m.service_id === selectedService?.service_id &&
                          m.employee_id === emp.employee_id
                      );
                      return (
                        <button
                          key={emp.employee_id}
                          onClick={() =>
                            selectedService &&
                            toggleEmployeeMapping(selectedService.service_id, emp.employee_id)
                          }
                          className="px-3 py-1.5 rounded-xl text-xs font-bold border transition-all"
                          style={
                            isMapped
                              ? {
                                  backgroundColor: 'var(--success)',
                                  borderColor: 'var(--success)',
                                  color: '#ffffff',
                                }
                              : {
                                  backgroundColor: 'var(--bg-raised)',
                                  borderColor: 'var(--border-soft)',
                                  color: 'var(--text-secondary)',
                                }
                          }
                        >
                          {emp.name}
                        </button>
                      );
                    })}
                </div>
              </div>
            </div>
          </section>

          <section className="pt-6 border-t" style={{ borderColor: 'var(--border-soft)' }}>
            <Button
              variant="ghost"
              className="text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20 w-full justify-center"
              icon={Trash2}
              onClick={() => selectedService && handleDeleteService(selectedService.service_id)}
            >
              Delete Service Permanently
            </Button>
          </section>
        </div>
      </Modal>

      {/* WIZARD MODAL (CREATION) */}
      <Modal
        isOpen={isWizardOpen}
        onClose={() => setIsWizardOpen(false)}
        title={`New Service Wizard - Step ${wizardStep} of 3`}
        disableBackdropClose
        footer={
          <div className="flex items-center justify-between w-full">
            <Button
              variant="ghost"
              onClick={() => (wizardStep === 1 ? setIsWizardOpen(false) : prevStep())}
            >
              {wizardStep === 1 ? 'Cancel' : 'Back'}
            </Button>

            {wizardStep < 3 ? (
              <Button onClick={nextStep} disabled={wizardStep === 1 && !wizardData.name}>
                Next <ChevronRight className="w-4 h-4 ml-2" />
              </Button>
            ) : (
              <Button onClick={handleCreateService} variant="success">
                Create Service
              </Button>
            )}
          </div>
        }
      >
        <div className="min-h-[300px]">
          {wizardStep === 1 && (
            <div className="space-y-6">
              <header>
                <h2 className="text-2xl font-display mb-2">Service Details</h2>
                <p style={{ color: 'var(--text-secondary)' }}>
                  Tell us what this service is called and how long it takes.
                </p>
              </header>
              <div className="space-y-4">
                <Input
                  label="Service Name"
                  placeholder="e.g. Front End Alignment"
                  value={wizardData.name}
                  onChange={(e) => setWizardData({ ...wizardData, name: e.target.value })}
                />
                <div>
                  <label
                    className="block text-xs font-bold uppercase mb-1 ml-1"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    Description
                  </label>
                  <textarea
                    className="w-full p-3 border rounded-xl focus:ring-2 outline-none h-24 text-sm"
                    style={{
                      backgroundColor: 'var(--bg-raised)',
                      borderColor: 'var(--border-soft)',
                    }}
                    placeholder="What is included in this service?"
                    value={wizardData.description}
                    onChange={(e) => setWizardData({ ...wizardData, description: e.target.value })}
                  />
                </div>
                <Input
                  label="Base Duration (Minutes)"
                  type="number"
                  step={15}
                  min={15}
                  value={wizardData.duration_minutes}
                  onChange={(e) =>
                    setWizardData({ ...wizardData, duration_minutes: parseInt(e.target.value) })
                  }
                />
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  Scheduled in 15-minute slots — non-multiples are rounded up on save.
                </p>
              </div>
            </div>
          )}

          {wizardStep === 2 && (
            <div className="space-y-6">
              <header>
                <h2 className="text-2xl font-display mb-2">{vocab.resource_plural} & Equipment</h2>
                <p style={{ color: 'var(--text-secondary)' }}>
                  Which {vocab.resource_plural.toLowerCase()} can this service be performed at?
                </p>
              </header>
              <div className="grid grid-cols-2 gap-3 max-h-60 overflow-y-auto pr-2">
                {resources.map((res) => (
                  <Card
                    key={res.resource_id}
                    onClick={() =>
                      setSelectedResourceIds((prev) =>
                        prev.includes(res.resource_id)
                          ? prev.filter((id) => id !== res.resource_id)
                          : [...prev, res.resource_id]
                      )
                    }
                    className={`p-4 cursor-pointer border-2 transition-all ${selectedResourceIds.includes(res.resource_id) ? '' : 'border-transparent hover:brightness-110'}`}
                    style={
                      selectedResourceIds.includes(res.resource_id)
                        ? { borderColor: 'var(--accent)', backgroundColor: 'var(--accent-muted)' }
                        : undefined
                    }
                  >
                    <div className="font-bold">{res.name}</div>
                    <div className="text-xs line-clamp-1" style={{ color: 'var(--text-muted)' }}>
                      {res.description || 'No description'}
                    </div>
                  </Card>
                ))}
              </div>
              <div
                className="p-4 rounded-2xl flex items-start"
                style={{ backgroundColor: 'var(--accent-muted)' }}
              >
                <Info
                  className="w-5 h-5 mr-3 shrink-0 mt-0.5"
                  style={{ color: 'var(--accent-soft)' }}
                />
                <p className="text-xs leading-relaxed" style={{ color: 'var(--accent-soft)' }}>
                  Selecting specific {vocab.resource_plural.toLowerCase()} ensures the AI only books
                  this service where the necessary tools or space are available.
                </p>
              </div>
            </div>
          )}

          {wizardStep === 3 && (
            <div className="space-y-6">
              <header>
                <h2 className="text-2xl font-display mb-2">Qualified {vocab.employee_plural}</h2>
                <p style={{ color: 'var(--text-secondary)' }}>
                  Which {vocab.employee_plural.toLowerCase()} are qualified to perform this service?
                </p>
              </header>
              <div className="grid grid-cols-2 gap-3 max-h-60 overflow-y-auto pr-2">
                {employees
                  .filter((e) => e.type !== 'user')
                  .map((emp) => (
                    <Card
                      key={emp.employee_id}
                      onClick={() =>
                        setSelectedEmployeeIds((prev) =>
                          prev.includes(emp.employee_id.toString())
                            ? prev.filter((id) => id !== emp.employee_id.toString())
                            : [...prev, emp.employee_id.toString()]
                        )
                      }
                      className={`p-4 cursor-pointer border-2 transition-all ${selectedEmployeeIds.includes(emp.employee_id.toString()) ? '' : 'border-transparent hover:brightness-110'}`}
                      style={
                        selectedEmployeeIds.includes(emp.employee_id.toString())
                          ? { borderColor: 'var(--accent)', backgroundColor: 'var(--accent-muted)' }
                          : undefined
                      }
                    >
                      <div className="font-bold">{emp.name}</div>
                      <div className="text-xs line-clamp-1" style={{ color: 'var(--text-muted)' }}>
                        Qualified for mapped services
                      </div>
                    </Card>
                  ))}
              </div>
              <div className="p-6 bg-green-50 dark:bg-green-900/10 rounded-[2rem] border border-green-100 dark:border-green-800/30">
                <h4 className="text-sm font-bold text-green-800 dark:text-green-400 mb-2 flex items-center">
                  <CheckCircle2 className="w-4 h-4 mr-2" /> Ready to Finalize
                </h4>
                <p className="text-xs text-green-700 dark:text-green-500 leading-relaxed">
                  You&apos;ve selected {selectedEmployeeIds.length}{' '}
                  {vocab.employee_plural.toLowerCase()} and {selectedResourceIds.length}{' '}
                  {vocab.resource_plural.toLowerCase()}. Click <strong>Create Service</strong> to
                  update your catalog and sync the AI&apos;s scheduling logic.
                </p>
              </div>
            </div>
          )}
        </div>
      </Modal>

      <ConfirmModal {...confirmState} onClose={closeConfirm} />
    </div>
  );
}
