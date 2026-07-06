'use client';

import { useState, useEffect, useCallback } from 'react';
import { Api } from '../../lib/api';
import { roundUpTo15 } from '../../lib/duration';
import type { WizardDraftGraph } from '../../lib/types';
import { newTmpId } from './draftIds';
import type {
  WizardStep,
  ServiceForm,
  ResourceForm,
  EmployeeForm,
  WizardShift,
  WizardMapping,
  CoverageItem,
  WizardService,
  WizardResource,
  WizardEmployee,
} from './types';
import { EMPTY_SERVICE, EMPTY_RESOURCE, EMPTY_EMPLOYEE } from './types';

/**
 * Wizard Phase B: draft-commit state. Everything the owner enters — services,
 * resources, employees, shifts, mappings — lives ONLY in this hook's React
 * state until the wizard commits the whole graph in one call
 * (Api.setup.commit, fired by index.tsx on the transition into step 9 — see
 * docs/superpowers/specs/2026-07-05-wizard-phase-b-design.md). Nothing here
 * makes a mutating API call; dismissing the wizard before commit leaves zero
 * DB rows. Shifts were already local-state before Phase B (the precedent this
 * hook now extends to every other entity type).
 *
 * Entities are keyed by a client-generated tmp_id (draftIds.ts) stored in the
 * same *_id field the committed version will eventually have — so every
 * Step*.tsx component renders unchanged, indifferent to whether the string
 * it's holding is a tmp id or a real UUID.
 */
export function useWizardCrud(tenantId: string | null, step: WizardStep) {
  // Shared state. `saving` is always false now — every mutation below is a
  // synchronous local-state update, no network round-trip to show a spinner
  // for. Kept as a literal (not removed) so Step1-3Props' `saving: boolean`
  // contract needs no change.
  const saving = false;
  const [error, setError] = useState<string | null>(null);

  // Draft entities (Phase B — local until commit)
  const [draftServices, setDraftServices] = useState<WizardService[]>([]);
  const [draftResources, setDraftResources] = useState<WizardResource[]>([]);
  const [draftEmployees, setDraftEmployees] = useState<WizardEmployee[]>([]);
  // tmp_ids of entities THIS wizard instance auto-seeded from the business
  // template, so "Change business type" can drop only those (never a
  // user-typed row) before a re-pick reseeds from the new template. Local-only
  // now — nothing was ever written, so there's nothing to delete server-side
  // (the DB-cleanup this used to require is gone entirely).
  const [autoSeededServiceTmpIds, setAutoSeededServiceTmpIds] = useState<Set<string>>(new Set());
  const [autoSeededResourceTmpIds, setAutoSeededResourceTmpIds] = useState<Set<string>>(new Set());

  // Step 1 — Services
  const [editingService, setEditingService] = useState<ServiceForm | null>(null);
  const [editingServiceId, setEditingServiceId] = useState<string | null>(null);

  // Step 2 — Resources
  const [editingResource, setEditingResource] = useState<ResourceForm | null>(null);
  const [editingResourceId, setEditingResourceId] = useState<string | null>(null);

  // Step 3 — Employees
  const [editingEmployee, setEditingEmployee] = useState<EmployeeForm | null>(null);
  const [editingEmployeeId, setEditingEmployeeId] = useState<string | null>(null);

  // Step 4 — Shifts (ephemeral form state, unchanged from pre-Phase-B — this
  // was always the precedent the rest of the hook now follows).
  const [shifts, setShifts] = useState<WizardShift[]>([]);
  const [selectedShiftEmployee, setSelectedShiftEmployee] = useState<string | null>(null);

  // Step 5 — Assignments (draft-local mappings, keyed on tmp_ids)
  const [serviceEmployeeMappings, setServiceEmployeeMappings] = useState<WizardMapping[]>([]);
  const [serviceResourceMappings, setServiceResourceMappings] = useState<WizardMapping[]>([]);

  // Step 6 — Coverage (preview against the draft via POST /coverage/dry-run)
  const [coverageData, setCoverageData] = useState<CoverageItem[]>([]);
  const [coverageLoading, setCoverageLoading] = useState(false);

  /** Serializes the current draft into the shape both /coverage/dry-run and
   *  /setup/commit expect. Only sends fields the wizard actually captures
   *  today (services: name/description/duration; resources: name/description;
   *  employees: name/first_name/last_name/email/phone) — price/subtitle exist
   *  in the backend schema for future use but this UI doesn't collect them. */
  const buildDraftGraph = useCallback((): WizardDraftGraph => {
    return {
      services: draftServices.map((s) => ({
        tmp_id: s.service_id,
        name: s.name,
        description: s.description || undefined,
        duration_minutes: s.duration_minutes,
      })),
      resources: draftResources.map((r) => ({
        tmp_id: r.resource_id,
        name: r.name,
        description: r.description || undefined,
      })),
      employees: draftEmployees.map((e) => ({
        tmp_id: e.employee_id,
        name: e.name,
        first_name: e.first_name || undefined,
        last_name: e.last_name || undefined,
        email: e.email || undefined,
        phone: e.phone || undefined,
      })),
      shifts: shifts
        .filter((s) => s.employee_id)
        .map((s) => ({
          employee_tmp_id: s.employee_id as string,
          day_of_week: s.day_of_week,
          start_time: s.start_time,
          end_time: s.end_time,
        })),
      service_employee: serviceEmployeeMappings
        .filter((m) => m.employee_id)
        .map((m) => ({ service_tmp_id: m.service_id, employee_tmp_id: m.employee_id as string })),
      service_resource: serviceResourceMappings
        .filter((m) => m.resource_id)
        .map((m) => ({ service_tmp_id: m.service_id, resource_tmp_id: m.resource_id as string })),
    };
  }, [
    draftServices,
    draftResources,
    draftEmployees,
    shifts,
    serviceEmployeeMappings,
    serviceResourceMappings,
  ]);

  // Coverage preview: reruns whenever step 6 is active or the draft graph it
  // depends on changes shape, so the coverage view reflects the live draft.
  useEffect(() => {
    if (step !== 6 || !tenantId) return;
    setCoverageLoading(true);
    Api.coverage
      .dryRun(buildDraftGraph())
      .then((data) => setCoverageData(Array.isArray(data) ? data : []))
      .catch(() => setCoverageData([]))
      .finally(() => setCoverageLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, tenantId]);

  const resetAll = useCallback(() => {
    setDraftServices([]);
    setDraftResources([]);
    setDraftEmployees([]);
    setAutoSeededServiceTmpIds(new Set());
    setAutoSeededResourceTmpIds(new Set());
    setEditingService(null);
    setEditingServiceId(null);
    setEditingResource(null);
    setEditingResourceId(null);
    setEditingEmployee(null);
    setEditingEmployeeId(null);
    setShifts([]);
    setSelectedShiftEmployee(null);
    setServiceEmployeeMappings([]);
    setServiceResourceMappings([]);
    setCoverageData([]);
    setError(null);
  }, []);

  // --- Auto-seed (Phase B: pushes into local draft state, no DB writes) ---

  /** Adds a draft service per name not already present (by name — avoids
   *  re-seeding over a user-typed row with the same name). Marks each as
   *  auto-seeded so a later "Change business type" can drop exactly these. */
  const seedServices = useCallback(
    (names: string[]) => {
      const existingNames = new Set(draftServices.map((s) => s.name));
      const toAdd = names.filter((name) => !existingNames.has(name));
      if (toAdd.length === 0) return;
      const newIds = new Set<string>();
      const newServices: WizardService[] = toAdd.map((name) => {
        const id = newTmpId();
        newIds.add(id);
        return { service_id: id, name, duration_minutes: 30 };
      });
      setDraftServices((prev) => [...prev, ...newServices]);
      setAutoSeededServiceTmpIds((prev) => new Set([...prev, ...newIds]));
    },
    [draftServices]
  );

  /** Adds one default resource if the draft has none yet. */
  const seedDefaultResource = useCallback(
    (name: string, description: string) => {
      if (draftResources.length > 0) return;
      const id = newTmpId();
      setDraftResources([{ resource_id: id, name, description }]);
      setAutoSeededResourceTmpIds(new Set([id]));
    },
    [draftResources]
  );

  /** "Change business type": drop only auto-seeded rows so a re-pick reseeds
   *  cleanly from the newly chosen template; anything the owner typed by hand
   *  survives (the exact nicety the old DB-tracked refs provided). */
  const clearAutoSeeded = useCallback(() => {
    setDraftServices((prev) => prev.filter((s) => !autoSeededServiceTmpIds.has(s.service_id)));
    setDraftResources((prev) => prev.filter((r) => !autoSeededResourceTmpIds.has(r.resource_id)));
    setAutoSeededServiceTmpIds(new Set());
    setAutoSeededResourceTmpIds(new Set());
  }, [autoSeededServiceTmpIds, autoSeededResourceTmpIds]);

  // --- Service CRUD (local draft mutations — no API calls) ---
  const startAddService = () => {
    setEditingService({ ...EMPTY_SERVICE });
    setEditingServiceId(null);
    setError(null);
  };
  const startEditService = (svc: WizardService) => {
    setEditingService({
      name: svc.name || '',
      description: svc.description || '',
      duration_minutes: svc.duration_minutes || 30,
      price: svc.price ?? undefined,
    });
    setEditingServiceId(svc.service_id);
    setError(null);
  };
  const cancelEditService = () => {
    setEditingService(null);
    setEditingServiceId(null);
    setError(null);
  };

  function saveService() {
    if (!editingService) return;
    if (!editingService.name.trim()) {
      setError('Service name is required');
      return;
    }
    if (editingService.duration_minutes < 1) {
      setError('Duration must be at least 1 minute');
      return;
    }
    setError(null);
    // 15-minute snap (matches the booking grid). A 22-minute service
    // occupies the same 14:00–14:30 slot anyway; rounding up at save
    // keeps the stored value honest about what the schedule allocates.
    const duration = roundUpTo15(editingService.duration_minutes);
    const name = editingService.name.trim();
    const description = editingService.description.trim();
    if (editingServiceId) {
      setDraftServices((prev) =>
        prev.map((s) =>
          s.service_id === editingServiceId
            ? { ...s, name, description, duration_minutes: duration }
            : s
        )
      );
    } else {
      setDraftServices((prev) => [
        ...prev,
        { service_id: newTmpId(), name, description, duration_minutes: duration },
      ]);
    }
    setEditingService(null);
    setEditingServiceId(null);
  }

  function deleteService(id: string) {
    setDraftServices((prev) => prev.filter((s) => s.service_id !== id));
    // Cascade: a mapping left pointing at a deleted service would make the
    // next coverage preview or commit 400 on a dangling tmp_id.
    setServiceEmployeeMappings((prev) => prev.filter((m) => m.service_id !== id));
    setServiceResourceMappings((prev) => prev.filter((m) => m.service_id !== id));
    setAutoSeededServiceTmpIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }

  // --- Resource CRUD ---
  const startAddResource = () => {
    setEditingResource({ ...EMPTY_RESOURCE });
    setEditingResourceId(null);
    setError(null);
  };
  const startEditResource = (res: WizardResource) => {
    setEditingResource({ name: res.name || '', description: res.description || '' });
    setEditingResourceId(res.resource_id);
    setError(null);
  };
  const cancelEditResource = () => {
    setEditingResource(null);
    setEditingResourceId(null);
    setError(null);
  };

  function saveResource() {
    if (!editingResource) return;
    if (!editingResource.name.trim()) {
      setError('Resource name is required');
      return;
    }
    setError(null);
    const name = editingResource.name.trim();
    const description = editingResource.description.trim();
    if (editingResourceId) {
      setDraftResources((prev) =>
        prev.map((r) => (r.resource_id === editingResourceId ? { ...r, name, description } : r))
      );
    } else {
      setDraftResources((prev) => [...prev, { resource_id: newTmpId(), name, description }]);
    }
    setEditingResource(null);
    setEditingResourceId(null);
  }

  function deleteResource(id: string) {
    setDraftResources((prev) => prev.filter((r) => r.resource_id !== id));
    setServiceResourceMappings((prev) => prev.filter((m) => m.resource_id !== id));
    setAutoSeededResourceTmpIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }

  // --- Employee CRUD ---
  const startAddEmployee = () => {
    setEditingEmployee({ ...EMPTY_EMPLOYEE });
    setEditingEmployeeId(null);
    setError(null);
  };
  const startEditEmployee = (emp: WizardEmployee) => {
    setEditingEmployee({
      first_name: emp.first_name || '',
      last_name: emp.last_name || '',
      email: emp.email || '',
      phone: emp.phone || '',
    });
    setEditingEmployeeId(String(emp.employee_id));
    setError(null);
  };
  const cancelEditEmployee = () => {
    setEditingEmployee(null);
    setEditingEmployeeId(null);
    setError(null);
  };

  function saveEmployee() {
    if (!editingEmployee) return;
    if (!editingEmployee.first_name.trim()) {
      setError('First name is required');
      return;
    }
    setError(null);
    const first_name = editingEmployee.first_name.trim();
    const last_name = editingEmployee.last_name.trim();
    const name = `${first_name} ${last_name}`.trim();
    const email = editingEmployee.email.trim();
    const phone = editingEmployee.phone.trim();
    if (editingEmployeeId) {
      setDraftEmployees((prev) =>
        prev.map((e) =>
          e.employee_id === editingEmployeeId
            ? { ...e, name, first_name, last_name, email, phone }
            : e
        )
      );
    } else {
      setDraftEmployees((prev) => [
        ...prev,
        { employee_id: newTmpId(), name, first_name, last_name, email, phone },
      ]);
    }
    setEditingEmployee(null);
    setEditingEmployeeId(null);
  }

  function deleteEmployee(id: string) {
    setDraftEmployees((prev) => prev.filter((e) => e.employee_id !== id));
    // Cascade: drop this employee's shifts and service_employee mappings so a
    // later coverage preview or commit never references a deleted tmp_id.
    setShifts((prev) => prev.filter((s) => s.employee_id !== id));
    setServiceEmployeeMappings((prev) => prev.filter((m) => m.employee_id !== id));
    if (selectedShiftEmployee === id) setSelectedShiftEmployee(null);
  }

  // --- Shift handlers (unchanged — already local-state pre-Phase-B) ---
  function toggleShift(employeeId: string, dayOfWeek: number, startTime: string, endTime: string) {
    setShifts((prev) => {
      const existingIdx = prev.findIndex(
        (s) => String(s.employee_id) === String(employeeId) && s.day_of_week === dayOfWeek
      );
      if (existingIdx >= 0) {
        return prev.filter((_, i) => i !== existingIdx);
      }
      return [
        ...prev,
        {
          id: `${employeeId}-${dayOfWeek}`,
          employee_id: employeeId,
          day_of_week: dayOfWeek,
          start_time: startTime,
          end_time: endTime,
        },
      ];
    });
  }

  function updateShiftTime(shiftId: string, startTime: string, endTime: string) {
    setShifts((prev) =>
      prev.map((s) =>
        String(s.id) === String(shiftId) ? { ...s, start_time: startTime, end_time: endTime } : s
      )
    );
  }

  // --- Assignment toggle (local draft mappings) ---
  function toggleEmployeeAssignment(serviceId: string, employeeId: string) {
    setServiceEmployeeMappings((prev) => {
      const exists = prev.some(
        (m) => m.service_id === serviceId && String(m.employee_id) === String(employeeId)
      );
      return exists
        ? prev.filter(
            (m) => !(m.service_id === serviceId && String(m.employee_id) === String(employeeId))
          )
        : [...prev, { service_id: serviceId, employee_id: employeeId }];
    });
  }

  function toggleResourceAssignment(serviceId: string, resourceId: string) {
    setServiceResourceMappings((prev) => {
      const exists = prev.some((m) => m.service_id === serviceId && m.resource_id === resourceId);
      return exists
        ? prev.filter((m) => !(m.service_id === serviceId && m.resource_id === resourceId))
        : [...prev, { service_id: serviceId, resource_id: resourceId }];
    });
  }

  return {
    saving,
    error,
    resetAll,
    // Draft entities (replace what index.tsx used to derive from useStaticData)
    draftServices,
    draftResources,
    draftEmployees,
    // Auto-seed
    seedServices,
    seedDefaultResource,
    clearAutoSeeded,
    // Commit
    buildDraftGraph,
    // Services
    editingService,
    editingServiceId,
    setEditingService,
    startAddService,
    startEditService,
    cancelEditService,
    saveService,
    deleteService,
    // Resources
    editingResource,
    editingResourceId,
    setEditingResource,
    startAddResource,
    startEditResource,
    cancelEditResource,
    saveResource,
    deleteResource,
    // Employees
    editingEmployee,
    editingEmployeeId,
    setEditingEmployee,
    startAddEmployee,
    startEditEmployee,
    cancelEditEmployee,
    saveEmployee,
    deleteEmployee,
    // Shifts
    shifts,
    shiftsLoading: false,
    selectedShiftEmployee,
    setSelectedShiftEmployee,
    toggleShift,
    updateShiftTime,
    // Assignments
    serviceEmployeeMappings,
    serviceResourceMappings,
    mappingsLoading: false,
    toggleEmployeeAssignment,
    toggleResourceAssignment,
    // Coverage
    coverageData,
    coverageLoading,
  };
}
