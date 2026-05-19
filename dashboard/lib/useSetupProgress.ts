'use client';

import { useCallback, useEffect, useState } from 'react';
import { Api } from './api';

/**
 * useSetupProgress — counts a tenant's setup completion against the six
 * wizard steps (D4 spec, 2026-05-17). Powers the persistent
 * SetupProgressPill in OutlookLayout's top utility row.
 *
 * Step model (matches SetupWizard/index.tsx getStepLabels):
 *   1. What you offer      → services.length > 0
 *   2. Where it happens    → resources.length > 0
 *   3. Who works here      → employees.length > 0  (active only)
 *   4. When they work      → ≥ 1 row in employee_schedule in the
 *                            next 30 days (proxy for "wizard finalize
 *                            ran expandWeekly")
 *   5. Who does what       → ≥ 1 row in service_employee mapping
 *   6. Look it over        → auto-credit when 1-5 are done. No
 *                            persistence to check; the review step
 *                            produces no DB rows of its own. Auto-
 *                            crediting means the pill never gets
 *                            stranded at 5/6 — it flips 0/6 → 5/6 →
 *                            6/6 (vanished) atomically.
 *
 * Refresh model: refetches on tenant change + on the
 * `setup-progress-changed` window event (dispatched by DashboardHome
 * after the wizard closes), so the pill vanishes the moment the user
 * finishes setup instead of waiting for a manual reload.
 *
 * Network cost: 5 parallel fetches via Promise.allSettled. Failures
 * silently treat that step as "incomplete" — the worst case is the
 * pill stays visible after setup actually completed, which is a
 * recoverable nuisance, not a destructive bug.
 */
export interface SetupProgressItem {
  step: 1 | 2 | 3 | 4 | 5 | 6;
  label: string;
  done: boolean;
}

export interface SetupProgress {
  done: number;
  total: number;
  complete: boolean;
  items: SetupProgressItem[];
  loading: boolean;
  /** Manually trigger a refetch. Same effect as the window event. */
  refresh: () => void;
}

export function useSetupProgress(tenantId: string | null): SetupProgress {
  const [items, setItems] = useState<SetupProgressItem[]>(() =>
    buildItems(false, false, false, false, false)
  );
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!tenantId) {
      setItems(buildItems(false, false, false, false, false));
      setLoading(false);
      return;
    }
    setLoading(true);

    const today = new Date().toISOString().split('T')[0];
    const horizon = new Date(Date.now() + 30 * 86_400_000).toISOString().split('T')[0];

    const [svc, res, emp, shf, map] = await Promise.allSettled([
      Api.services.list(tenantId),
      Api.resources.list(tenantId),
      Api.employees.list(tenantId),
      Api.shifts.schedule.bulkForDate(tenantId, today, horizon),
      Api.mappings.listServiceEmployee(tenantId),
    ]);

    const hasServices =
      svc.status === 'fulfilled' && Array.isArray(svc.value) && svc.value.length > 0;
    const hasResources =
      res.status === 'fulfilled' && Array.isArray(res.value) && res.value.length > 0;
    // Match DashboardHome's count: active employees only, not invited-or-archived ghosts.
    const hasEmployees =
      emp.status === 'fulfilled' &&
      Array.isArray(emp.value) &&
      emp.value.filter(
        (e) =>
          (e as { type?: string; is_active?: boolean }).type === 'employee' &&
          (e as { is_active?: boolean }).is_active
      ).length > 0;
    const hasShifts =
      shf.status === 'fulfilled' && Array.isArray(shf.value) && shf.value.length > 0;
    const hasMappings =
      map.status === 'fulfilled' && Array.isArray(map.value) && map.value.length > 0;

    setItems(buildItems(hasServices, hasResources, hasEmployees, hasShifts, hasMappings));
    setLoading(false);
  }, [tenantId]);

  useEffect(() => {
    void load();
    function handleChange() {
      void load();
    }
    window.addEventListener('setup-progress-changed', handleChange);
    return () => window.removeEventListener('setup-progress-changed', handleChange);
  }, [load]);

  const doneCount = items.filter((i) => i.done).length;
  return {
    done: doneCount,
    total: 6,
    complete: doneCount === 6,
    items,
    loading,
    refresh: load,
  };
}

function buildItems(
  hasServices: boolean,
  hasResources: boolean,
  hasEmployees: boolean,
  hasShifts: boolean,
  hasMappings: boolean
): SetupProgressItem[] {
  const reviewDone = hasServices && hasResources && hasEmployees && hasShifts && hasMappings;
  return [
    { step: 1, label: 'What you offer', done: hasServices },
    { step: 2, label: 'Where it happens', done: hasResources },
    { step: 3, label: 'Who works here', done: hasEmployees },
    { step: 4, label: 'When they work', done: hasShifts },
    { step: 5, label: 'Who does what', done: hasMappings },
    { step: 6, label: 'Look it over', done: reviewDone },
  ];
}

/**
 * Dispatch the window event that signals the pill to refetch. Call this
 * from anywhere the user has just finished a setup step (most importantly,
 * from the wizard's onClose) so the pill reflects new state immediately.
 */
export function notifySetupProgressChanged() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('setup-progress-changed'));
  }
}
