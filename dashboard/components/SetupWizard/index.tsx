'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useFocusTrap } from '../../lib/useFocusTrap';
import { ChevronRight, ChevronLeft, Check, X, Wand2 } from 'lucide-react';
import { Api } from '../../lib/api';
import { useActiveTenantId } from '../../lib/SessionContext';
import { useVocabulary } from '@/lib/VocabularyContext';
import { Button } from '../ui/Button';
import { showToast } from '../ui/Toast';
import { WizardStepContent } from './WizardStepContent';
import { useWizardCrud } from './useWizardCrud';
import { markFirstRunTourPending } from '../FirstRunTour';
import type { WizardStep, SetupWizardProps } from './types';

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
    7: 'Import from website',
    8: 'Teach Your AI',
    9: "You're live",
  };
}

export default function SetupWizard({ isOpen, onClose, onBackToPicker }: SetupWizardProps) {
  const tenantId = useActiveTenantId();
  const vocab = useVocabulary();
  const STEP_LABELS = getStepLabels(vocab);
  const [step, setStep] = useState<WizardStep>(1);
  const containerRef = useRef<HTMLDivElement>(null);
  // Focus trap: Escape closes, Tab stays in wizard. lockScroll=false because
  // SetupWizard manages body overflow itself (see useEffect below).
  useFocusTrap(containerRef, isOpen, onClose, false);
  // Surfaced when auto-seeding the starter services/resource fails. Pre-fix
  // the failure was swallowed (console.warn only), leaving setup half-seeded
  // with no signal or recovery. Drives the retry banner in the body.
  const [seedError, setSeedError] = useState<string | null>(null);

  const crud = useWizardCrud(tenantId, step);

  // Wizard Phase B: the entity graph (services/resources/employees/shifts/
  // mappings) commits ONCE, when the owner advances into step 9 ("Go Live") —
  // not on the final Done click. Step 9 is where a REAL phone number gets
  // activated (a real external purchase, independent of the wizard's own
  // Next/Done flow); committing any later would let an owner activate a live,
  // answering phone number backed by a draft that was never actually saved.
  // See docs/superpowers/specs/2026-07-05-wizard-phase-b-design.md §2.
  const [hasCommitted, setHasCommitted] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [commitError, setCommitError] = useState<string | null>(null);

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

  // Reset on open — including the commit flag, so reopening the wizard always
  // starts from a fresh, uncommitted draft.
  useEffect(() => {
    if (isOpen) {
      setStep(1);
      crud.resetAll();
      seedingRef.current = false;
      setSeedError(null);
      setHasCommitted(false);
      setCommitError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // Auto-seed example services + one default resource from the business
  // template when the wizard opens. Phase B: this pushes into LOCAL draft
  // state only (crud.seedServices / crud.seedDefaultResource) — no DB writes,
  // so there is nothing to reconcile on retry (a local push either fully
  // happens or, if the template fetch below fails, doesn't happen at all) and
  // nothing to clean up if the owner picks a different business type (see
  // handleBackToPicker). The only failure mode left is the two read-only
  // fetches themselves — surfaced via seedError + the Retry banner below.
  // Deliberately NOT useCallback: `crud` (from useWizardCrud) is a fresh
  // object every render, so a memoized runSeed with a restricted dep array
  // would permanently close over whatever `crud.seedServices` was on the
  // render that created it — a stale-closure bug (caught by the back-to-
  // picker test below hitting the analogous case in handleBackToPicker).
  // Redefining this plain function every render means the effect + the Retry
  // button always call the CURRENT render's crud.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  async function runSeed() {
    if (!tenantId) return;
    seedingRef.current = true;
    setSeedError(null);
    try {
      const [config, templates] = await Promise.all([
        Api.tenants.getConfig(tenantId),
        Api.templates.listFull(),
      ]);
      const tpl = (templates || []).find((t) => t.business_type === config?.business_type);

      crud.seedServices(tpl?.example_services ?? []);

      const defaultName =
        vocab.resource_label === 'Resource' ? 'Main Location' : `${vocab.resource_label} 1`;
      crud.seedDefaultResource(defaultName, 'Auto-created — rename or add more in this step');
    } catch (err) {
      setSeedError(err instanceof Error ? err.message : 'Failed to set up starter data');
    }
  }

  // Auto-seed once per open. seedingRef gates the automatic run; the Retry
  // button calls runSeed() directly to bypass the gate. runSeed is
  // deliberately NOT memoized (see its definition above) so this effect
  // re-evaluates on every render, but seedingRef.current makes every
  // re-evaluation past the first a no-op — the intended behavior, not a
  // missing dependency.
  //
  // Two extra gates for the re-run case: wait until hydration settles (seeding
  // into a draft that's about to be replaced by the tenant's real graph is
  // wasted work), and never seed at all once we know this is an existing
  // business (crud.isSync) — template starter services must not be injected
  // into a catalog the owner already curated.
  useEffect(() => {
    if (!isOpen || !tenantId || seedingRef.current) return;
    if (crud.hydrating || crud.isSync) return;
    void runSeed();
  }, [isOpen, tenantId, runSeed, crud.hydrating, crud.isSync]);

  const canAdvanceTo = (target: WizardStep): boolean => {
    if (target <= step) return true; // backward always allowed
    if (target >= 2 && crud.draftServices.length === 0) return false;
    if (target >= 4 && crud.draftEmployees.length === 0) return false;
    if (target >= 5 && (crud.draftEmployees.length === 0 || crud.draftServices.length === 0))
      return false;
    return true;
  };

  const goNext = async () => {
    const next = Math.min(step + 1, 9) as WizardStep;
    if (!canAdvanceTo(next)) {
      showToast('Complete this step before continuing', 'warning');
      return;
    }

    // Commit the entity graph on the transition into step 9 — see the
    // hasCommitted doc comment above. Once committed in this session, going
    // back and forward again just re-enters step 9 without re-committing.
    //
    // Mode: 'sync' when the wizard hydrated an existing business (rows carry
    // existing_id → update in place, omitted rows → soft-delete), 'create' for
    // a fresh tenant (insert-only). Before this, EVERY commit was create-mode,
    // so re-running setup on a set-up tenant hit the backend's idempotency 409
    // ("Setup already completed") and there was no way to redo it at all.
    if (next === 9 && tenantId && !hasCommitted) {
      setCommitting(true);
      setCommitError(null);
      try {
        const res = await Api.setup.commit(
          tenantId,
          crud.buildDraftGraph(),
          crud.isSync ? 'sync' : 'create'
        );
        if (!res.success) {
          setCommitError(res.error || 'Failed to complete setup');
          return; // stay on the current step — draft intact, nothing advanced
        }
        setHasCommitted(true);
      } catch (err) {
        setCommitError(err instanceof Error ? err.message : 'Failed to complete setup');
        return;
      } finally {
        setCommitting(false);
      }
    }
    setStep(next);
  };
  const goBack = () => setStep((s) => Math.max(s - 1, 1) as WizardStep);

  // "Change business type" — only meaningful on Step 1 and only when the
  // parent wired an onBackToPicker callback (i.e. the user reached the wizard
  // via the BusinessTypePicker, not the dismissed-banner shortcut). Phase B:
  // drops only the auto-seeded draft rows (crud.clearAutoSeeded) so a re-pick
  // reseeds cleanly from the newly chosen template; user-typed rows survive.
  // No DB calls — nothing was ever written pre-commit, so there is nothing to
  // delete server-side (the old best-effort Api.*.delete cleanup is gone).
  // Deliberately NOT useCallback — see the runSeed comment above; `crud`
  // is fresh every render, and this must always see the CURRENT draft's
  // auto-seeded tmp_ids, not whichever render first created a memoized
  // version of this function.
  async function handleBackToPicker() {
    if (!onBackToPicker) return;
    crud.clearAutoSeeded();
    // NOT resetting seedingRef here (the isOpen effect above already resets
    // it on the wizard's next real reopen for the new business type) — doing
    // so while THIS instance is still mounted would immediately re-trigger
    // the auto-seed effect for the CURRENT (not-yet-changed) business type,
    // reseeding right back what clearAutoSeeded() just removed.
    await onBackToPicker();
  }

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
        ref={containerRef}
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
            {([1, 2, 3, 4, 5, 6, 7, 8, 9] as WizardStep[]).map((s) => (
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
          {hasCommitted && step < 9 && (
            <div
              role="alert"
              className="mb-4 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-3 py-2"
            >
              <span className="text-xs text-amber-800 dark:text-amber-300">
                Your business is already set up. Changes here won&apos;t be saved — edit services,
                staff, and hours from My Business after closing this wizard.
              </span>
            </div>
          )}
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
          {commitError && (
            <div
              role="alert"
              className="mb-4 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 px-3 py-2"
            >
              <span className="text-xs text-red-800 dark:text-red-300">
                Couldn’t finish setting up your business: {commitError}. Nothing was lost — fix the
                issue above and try again.
              </span>
            </div>
          )}
          <WizardStepContent
            step={step}
            tenantId={tenantId}
            services={crud.draftServices}
            editingService={crud.editingService}
            editingServiceId={crud.editingServiceId}
            onAddService={crud.startAddService}
            onEditService={crud.startEditService}
            onDeleteService={crud.deleteService}
            onSaveService={crud.saveService}
            onCancelEditService={crud.cancelEditService}
            onChangeService={crud.setEditingService}
            resources={crud.draftResources}
            editingResource={crud.editingResource}
            editingResourceId={crud.editingResourceId}
            onAddResource={crud.startAddResource}
            onEditResource={crud.startEditResource}
            onDeleteResource={crud.deleteResource}
            onSaveResource={crud.saveResource}
            onCancelEditResource={crud.cancelEditResource}
            onChangeResource={crud.setEditingResource}
            employees={crud.draftEmployees}
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
            loading={false}
            saving={crud.saving}
            error={crud.error}
          />
        </div>

        {/* Footer */}
        <footer className="px-6 py-4 bg-gray-50 dark:bg-[#222] border-t border-gray-100 dark:border-gray-800 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="text-xs text-gray-400">Step {step} of 9</div>
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
            {step < 9 ? (
              <Button
                variant="primary"
                size="sm"
                onClick={() => void goNext()}
                disabled={committing}
                isLoading={committing}
              >
                {step === 8 ? 'Go Live' : 'Next'}
                <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            ) : (
              <Button
                variant="success"
                size="sm"
                onClick={() => {
                  // The entity graph already committed on entering this step
                  // (see goNext) — Done is purely "close + arm the first-run
                  // tour," no further persistence happens here.
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
