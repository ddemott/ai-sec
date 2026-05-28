'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { ChevronRight, ChevronLeft, Check, X, Wand2 } from 'lucide-react';
import { Api } from '../../lib/api';
import { useStaticData } from '../../lib/hooks';
import { useActiveTenantId } from '../../lib/SessionContext';
import { useVocabulary } from '@/lib/VocabularyContext';
import { Button } from '../ui/Button';
import { showToast } from '../ui/Toast';
import { WizardStepContent } from './WizardStepContent';
import { useWizardCrud } from './useWizardCrud';
import { markFirstRunTourPending } from '../FirstRunTour';
import type {
  WizardStep,
  WizardService,
  WizardResource,
  WizardEmployee,
  SetupWizardProps,
} from './types';

// Step labels are verbs/outcomes ("What you offer", "Who works here") so the
// chip strip teaches a new owner what each step does without having to enter
// it first. Vocab personalization (Bays / Chairs / Mechanics / Stylists)
// still drives the headings and inputs inside each step's body — moving it
// out of the chip label keeps the strip glanceable and uniformly short.
function getStepLabels(_vocab: {
  resource_plural: string;
  employee_plural: string;
}): Record<WizardStep, string> {
  return {
    1: 'What you offer',
    2: 'Where it happens',
    3: 'Who works here',
    4: 'When they work',
    5: 'Who does what',
    6: 'Look it over',
    7: 'Teach Your AI',
    8: "You're live",
  };
}

export default function SetupWizard({ isOpen, onClose, onBackToPicker }: SetupWizardProps) {
  const tenantId = useActiveTenantId();
  const { services, resources, employees, loading, refresh } = useStaticData(tenantId);
  const vocab = useVocabulary();
  const STEP_LABELS = getStepLabels(vocab);
  const [step, setStep] = useState<WizardStep>(1);
  // Surfaced when auto-seeding the starter services/resource fails. Pre-fix
  // the failure was swallowed (console.warn only), leaving setup half-seeded
  // with no signal or recovery. Drives the retry banner in the body.
  const [seedError, setSeedError] = useState<string | null>(null);

  const crud = useWizardCrud(tenantId, step, refresh);

  // Lock body scroll when open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [isOpen]);

  const seedingRef = useRef(false);
  // The starter services we committed to seeding, captured ONCE when the
  // catalog was empty. Reconciling against this (not the live `services`)
  // means a retry after a partial failure finishes the original set without
  // topping-up a user who already has their own services.
  const seedTargetRef = useRef<string[]>([]);
  // IDs of services + resources THIS wizard instance created via auto-seed,
  // so "Change business type" can delete them on the way back to the
  // picker (otherwise the next pick's gate `services.length === 0` would
  // stay closed and the user would keep seeing the previous template's
  // services — the exact bug Dale flagged 2026-05-27).
  const autoSeededServiceIdsRef = useRef<Set<string>>(new Set());
  const autoSeededResourceIdsRef = useRef<Set<string>>(new Set());

  // Reset on open. seedTargetRef must reset too — leaving it primed from
  // a prior open would make a re-pick try to recreate the previous
  // template's example_services instead of refilling from the new
  // template (auto-seed bug, 2026-05-27).
  useEffect(() => {
    if (isOpen) {
      setStep(1);
      crud.resetAll();
      seedingRef.current = false;
      seedTargetRef.current = [];
      autoSeededServiceIdsRef.current = new Set();
      autoSeededResourceIdsRef.current = new Set();
      setSeedError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // Auto-seed example services + one default resource from the
  // business template when none exist.
  //
  // Services seed: pulls template.example_services so the owner lands
  // on step 1 with a starter catalog they can edit.
  //
  // Resource seed (D3, 2026-05-17): single-location teams should not
  // have to manually add their first "Bay 1" / "Chair 1" / "Truck 1"
  // before they can advance. Step 2 now lands pre-filled with one
  // default named by the vocabulary ("Main Location" for generic
  // templates, "<vocab.resource_label> 1" otherwise). Owners with
  // multi-station shops keep using "Add a <resource>" as before.
  // Seed missing starter data. Reconcile (not all-or-nothing): creates only
  // the services in seedTargetRef not yet present + a default resource if none
  // exists, then refreshes. Safe to call repeatedly — that's what makes the
  // retry below able to finish a partial seed. On failure it sets seedError
  // (was previously a silent console.warn) so the body can offer a Retry.
  const runSeed = useCallback(async () => {
    if (!tenantId) return;
    seedingRef.current = true;
    setSeedError(null);
    try {
      const [config, templates] = await Promise.all([
        Api.tenants.getConfig(tenantId),
        Api.templates.listFull(),
      ]);
      const tpl = (templates || []).find((t) => t.business_type === config?.business_type);

      // Capture the target set ONCE, only when the catalog is empty — so a
      // user who already has services never gets template ones added.
      if (services.length === 0 && seedTargetRef.current.length === 0) {
        seedTargetRef.current = tpl?.example_services ?? [];
      }
      const missing = seedTargetRef.current.filter((name) => !services.some((s) => s.name === name));
      for (const name of missing) {
        // is_auto_seeded persists the "I am a template default" tag in
        // the DB so a business_type change handled server-side (POST
        // /tenants/:id/update-config) can roll these back even after a
        // page reload. The in-session autoSeededServiceIdsRef below
        // still tracks ids for the same-session re-pick rollback path.
        const result = await Api.services.create(tenantId, {
          name,
          duration_minutes: 30,
          is_auto_seeded: true,
        });
        const newId = result?.service?.service_id;
        if (newId) autoSeededServiceIdsRef.current.add(String(newId));
      }

      if (resources.length === 0) {
        const defaultName =
          vocab.resource_label === 'Resource' ? 'Main Location' : `${vocab.resource_label} 1`;
        const result = await Api.resources.create(tenantId, {
          name: defaultName,
          description: 'Auto-created — rename or add more in this step',
          is_auto_seeded: true,
        });
        const newId = result?.resource?.resource_id;
        if (newId) autoSeededResourceIdsRef.current.add(String(newId));
      }

      await refresh();
    } catch (err) {
      setSeedError(err instanceof Error ? err.message : 'Failed to set up starter data');
    }
  }, [tenantId, services, resources, vocab, refresh]);

  // Auto-seed on open when nothing exists yet. seedingRef gates it to one
  // auto-run; the Retry button calls runSeed() directly to bypass the gate.
  useEffect(() => {
    if (!isOpen || !tenantId || loading || seedingRef.current) return;
    if (services.length > 0 && resources.length > 0) return;
    void runSeed();
  }, [isOpen, tenantId, loading, services.length, resources.length, runSeed]);

  const activeServices: WizardService[] = services
    .filter((s) => !(s as { is_deleted?: boolean }).is_deleted)
    .map((s) => ({
      service_id: s.service_id,
      name: s.name,
      description: s.description,
      duration_minutes: s.duration_minutes,
      price: s.price,
    }));
  const activeResources: WizardResource[] = resources
    .filter((r) => r.is_active !== false)
    .map((r) => ({
      resource_id: r.resource_id,
      name: r.name,
      description: r.description ?? undefined,
      is_active: r.is_active,
    }));
  const activeEmployees: WizardEmployee[] = employees
    .filter((e) => !e.is_deleted && e.is_active !== false)
    .map((e) => ({
      employee_id: e.employee_id,
      name: e.name,
      first_name: e.first_name ?? undefined,
      last_name: e.last_name ?? undefined,
      email: e.email ?? undefined,
      phone: e.phone ?? undefined,
      type: e.type,
      is_active: e.is_active,
    }));

  const canAdvanceTo = (target: WizardStep): boolean => {
    if (target <= step) return true; // backward always allowed
    if (loading) return true; // don't block while data is loading
    if (target >= 2 && activeServices.length === 0) return false;
    if (target >= 4 && activeEmployees.length === 0) return false;
    if (target >= 5 && (activeEmployees.length === 0 || activeServices.length === 0)) return false;
    return true;
  };

  const goNext = async () => {
    const next = Math.min(step + 1, 8) as WizardStep;
    if (!canAdvanceTo(next)) {
      showToast('Complete this step before continuing', 'warning');
      return;
    }
    // On the way into step 8 (Go Live), fan each employee's weekly
    // availability into 4 weeks of date-specific employee_schedule
    // rows. Booking RPCs read only employee_schedule, so without this
    // a tenant could activate the phone and still have every booking
    // attempt return EMPLOYEE_NOT_SCHEDULED. Errors are non-fatal —
    // we log and continue so a flaky network doesn't strand the user.
    if (next === 8 && tenantId) {
      // Group the in-memory shift form-state by employee so each
      // employee's pattern is fanned independently.
      for (const emp of activeEmployees) {
        const empPattern = crud.shifts
          .filter(
            (s) => String(s.employee_id) === String(emp.employee_id) && s.start_time && s.end_time
          )
          .map((s) => ({
            day_of_week: s.day_of_week,
            start_time: s.start_time.slice(0, 5),
            end_time: s.end_time.slice(0, 5),
          }));
        try {
          await Api.shifts.expandWeekly(tenantId, String(emp.employee_id), empPattern);
        } catch (err) {
          console.warn(`Failed to expand weekly schedule for employee ${emp.employee_id}:`, err);
        }
      }
    }
    setStep(next);
  };
  const goBack = () => setStep((s) => Math.max(s - 1, 1) as WizardStep);

  // "Change business type" — only meaningful on Step 1 and only when
  // the parent wired an onBackToPicker callback (i.e. the user reached
  // the wizard via the BusinessTypePicker, not the dismissed-banner
  // shortcut). Wipes auto-seeded rows so the next pick's runSeed sees
  // an empty catalog and reseeds for the freshly chosen template;
  // user-typed rows are left intact because their ids never entered
  // the autoSeeded* sets in the first place.
  const handleBackToPicker = useCallback(async () => {
    if (!onBackToPicker) return;
    if (tenantId) {
      const serviceIds = Array.from(autoSeededServiceIdsRef.current);
      const resourceIds = Array.from(autoSeededResourceIdsRef.current);
      autoSeededServiceIdsRef.current = new Set();
      autoSeededResourceIdsRef.current = new Set();
      seedTargetRef.current = [];
      // Best-effort: a delete that fails (e.g. the user edited the row
      // and the backend now considers it user-owned) is swallowed so we
      // still return the user to the picker. A subsequent reseed will
      // simply skip the name if it still exists.
      await Promise.all([
        ...serviceIds.map((id) =>
          Api.services.delete(id, tenantId).catch(() => undefined)
        ),
        ...resourceIds.map((id) =>
          Api.resources.delete(id, tenantId).catch(() => undefined)
        ),
      ]);
      await refresh();
    }
    await onBackToPicker();
  }, [onBackToPicker, tenantId, refresh]);

  const goToStep = (s: WizardStep) => {
    if (canAdvanceTo(s)) setStep(s);
    else showToast('Complete earlier steps first', 'warning');
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="wizard-title"
    >
      <div
        className="bg-white dark:bg-[#1a1a1a] rounded-2xl shadow-xl border border-gray-200 dark:border-gray-800 w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <header className="px-6 py-4 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <Wand2 className="w-5 h-5" style={{ color: 'var(--accent-soft)' }} />
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
          <div className="flex flex-wrap items-center gap-x-1 gap-y-1.5">
            {([1, 2, 3, 4, 5, 6, 7, 8] as WizardStep[]).map((s) => (
              <button
                key={s}
                onClick={() => goToStep(s)}
                disabled={!canAdvanceTo(s) && s > step}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                  s === step
                    ? ''
                    : s < step
                      ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 cursor-pointer'
                      : !canAdvanceTo(s)
                        ? 'bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-600 opacity-50 cursor-not-allowed'
                        : 'bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500'
                }`}
                style={
                  s === step
                    ? { backgroundColor: 'var(--accent-muted)', color: 'var(--accent-soft)' }
                    : undefined
                }
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
          {seedError && (
            <div
              role="alert"
              className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-3 py-2"
            >
              <span className="text-xs text-amber-800 dark:text-amber-300">
                Couldn’t finish setting up your starter {vocab.resource_plural.toLowerCase()} and
                services. You can add them manually below, or retry.
              </span>
              <Button variant="ghost" size="sm" onClick={() => void runSeed()}>
                Retry
              </Button>
            </div>
          )}
          <WizardStepContent
            step={step}
            tenantId={tenantId}
            services={activeServices}
            editingService={crud.editingService}
            editingServiceId={crud.editingServiceId}
            onAddService={crud.startAddService}
            onEditService={crud.startEditService}
            onDeleteService={crud.deleteService}
            onSaveService={crud.saveService}
            onCancelEditService={crud.cancelEditService}
            onChangeService={crud.setEditingService}
            resources={activeResources}
            editingResource={crud.editingResource}
            editingResourceId={crud.editingResourceId}
            onAddResource={crud.startAddResource}
            onEditResource={crud.startEditResource}
            onDeleteResource={crud.deleteResource}
            onSaveResource={crud.saveResource}
            onCancelEditResource={crud.cancelEditResource}
            onChangeResource={crud.setEditingResource}
            employees={activeEmployees}
            editingEmployee={crud.editingEmployee}
            editingEmployeeId={crud.editingEmployeeId}
            onAddEmployee={crud.startAddEmployee}
            onEditEmployee={crud.startEditEmployee}
            onDeleteEmployee={crud.deleteEmployee}
            onSaveEmployee={crud.saveEmployee}
            onCancelEditEmployee={crud.cancelEditEmployee}
            onChangeEmployee={crud.setEditingEmployee}
            shifts={crud.shifts}
            shiftsLoading={crud.shiftsLoading}
            selectedShiftEmployee={crud.selectedShiftEmployee}
            onSelectShiftEmployee={crud.setSelectedShiftEmployee}
            onToggleShift={crud.toggleShift}
            onUpdateShiftTime={crud.updateShiftTime}
            serviceEmployeeMappings={crud.serviceEmployeeMappings}
            serviceResourceMappings={crud.serviceResourceMappings}
            mappingsLoading={crud.mappingsLoading}
            onToggleEmployeeAssignment={crud.toggleEmployeeAssignment}
            onToggleResourceAssignment={crud.toggleResourceAssignment}
            coverageData={crud.coverageData}
            coverageLoading={crud.coverageLoading}
            phoneStatus={null}
            inboundPhone={null}
            loading={loading}
            saving={crud.saving}
            error={crud.error}
          />
        </div>

        {/* Footer */}
        <footer className="px-6 py-4 bg-gray-50 dark:bg-[#222] border-t border-gray-100 dark:border-gray-800 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="text-xs text-gray-400">Step {step} of 8</div>
            {/* Step 1 owns the "go back to the picker" affordance — any
                later step uses the regular Back button to walk the
                intra-wizard step strip first. Hidden when the parent
                didn't wire onBackToPicker (e.g. wizard opened directly
                without going through the picker). */}
            {step === 1 && onBackToPicker && (
              <button
                type="button"
                onClick={() => void handleBackToPicker()}
                className="text-xs underline-offset-2 hover:underline transition-colors"
                style={{ color: 'var(--text-secondary)' }}
              >
                &larr; Change business type
              </button>
            )}
          </div>
          <div className="flex gap-2">
            {step > 1 && (
              <Button variant="ghost" size="sm" onClick={goBack}>
                <ChevronLeft className="w-4 h-4 mr-1" />
                Back
              </Button>
            )}
            {step < 8 ? (
              <Button variant="primary" size="sm" onClick={goNext}>
                {step === 7 ? 'Go Live' : 'Next'}
                <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            ) : (
              <Button
                variant="success"
                size="sm"
                onClick={() => {
                  // Promote auto-seeded rows to user-owned so a later
                  // business_type change (post-launch, from Settings)
                  // doesn't wipe the catalog the owner just signed off
                  // on. Best-effort: a failure here doesn't block close.
                  if (tenantId) {
                    Api.tenants.finalizeSetup(tenantId).catch(() => undefined);
                  }
                  // Arm the first-run tour for this tenant. DashboardHome
                  // picks up the flag on its next mount and shows the
                  // overview modal. Only fires on the step-7 Done path —
                  // dismissing the wizard mid-flow does not arm the tour.
                  markFirstRunTourPending(tenantId);
                  onClose();
                }}
              >
                <Check className="w-4 h-4 mr-1" />
                Done
              </Button>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
}
