/**
 * Shared scheduling logic.
 * Used by both the Node backend (src/) and Deno Edge Functions (supabase/functions/).
 *
 * This is the canonical implementation of the assignment selection algorithm.
 */

export interface TimeWindow {
  from: Date;
  to: Date;
}

export interface ResourceCandidate {
  resource_id: string;
  type?: string;
  capabilities: string[];
}

export interface EmployeeCandidate {
  employee_id: string;
  skills: string[];
  onShift?: boolean;
}

export interface Shift {
  employee_id: number | string;
  day_of_week: number;
  start_time: string; // "HH:MM"
  end_time: string;   // "HH:MM"
}

export interface ShiftOverride {
  employee_id: string;
  shift_date: string;  // "YYYY-MM-DD"
  start_time: string | null;
  end_time: string | null;
  is_off: boolean;
}

export interface ExistingAppointment {
  resourceId: string;
  start: Date;
  end: Date;
}

export interface ServiceRequirements {
  serviceType: string;
  requiredResourceCapabilities?: string[];
  requiredEmployeeSkills?: string[];
  preferredResourceId?: string | null;
}

export interface AssignmentOption {
  resourceId: string;
  employeeId?: string;
}

export interface SchedulingDiagnostics {
  totalResources: number;
  capableResources: number;
  availableResources: number;
  totalEmployees: number;
  skilledEmployees: number;
  onShiftEmployees: number;
  reason: string;
}

export interface SelectAssignmentsResult {
  options: AssignmentOption[];
  diagnostics: SchedulingDiagnostics;
}

function overlaps(a: TimeWindow, b: TimeWindow): boolean {
  return a.from < b.to && b.from < a.to;
}

function hasAll(have: string[], need: string[] | undefined): boolean {
  if (!need || need.length === 0) return true;
  const set = new Set(have);
  return need.every((n) => set.has(n));
}

function isResourceFree(
  resourceId: string,
  window: TimeWindow,
  existing: ExistingAppointment[],
): boolean {
  return !existing.some((appt) => {
    if (appt.resourceId !== resourceId) return false;
    return overlaps(window, { from: appt.start, to: appt.end });
  });
}

function isEmployeeOnShift(
  employeeId: string,
  window: TimeWindow,
  shifts: Shift[],
  overrides?: ShiftOverride[],
): boolean {
  const day = window.from.getUTCDay();
  const startStr = window.from.toISOString().substring(11, 16);
  const endStr = window.to.toISOString().substring(11, 16);
  const dateStr = window.from.toISOString().substring(0, 10);

  // Check overrides first (date-specific)
  if (overrides && overrides.length > 0) {
    const override = overrides.find(
      (o) => o.employee_id.toString() === employeeId && o.shift_date === dateStr
    );
    if (override) {
      // Override exists — if day off, not on shift
      if (override.is_off) return false;
      // If override has times, check them
      if (override.start_time && override.end_time) {
        return override.start_time <= startStr && override.end_time >= endStr;
      }
      return false;
    }
  }

  // Fall back to weekly pattern
  return shifts.some((s) => {
    if (s.employee_id.toString() !== employeeId) return false;
    if (s.day_of_week !== day) return false;
    return s.start_time <= startStr && s.end_time >= endStr;
  });
}

/**
 * Compute valid (resource, employee?) assignments for a requested service and time window.
 * Supports two modes:
 * - Pre-computed: EmployeeCandidate has `onShift: boolean` (shift check done upstream)
 * - Inline shifts: Pass `shifts` array and shift checking is done here
 */
export function selectAssignments(args: {
  requirements: ServiceRequirements;
  window: TimeWindow;
  resources: ResourceCandidate[];
  employees?: EmployeeCandidate[];
  shifts?: Shift[];
  shiftOverrides?: ShiftOverride[];
  existingAppointments?: ExistingAppointment[];
}): SelectAssignmentsResult {
  const { requirements, window: win } = args;
  const employees = args.employees ?? [];
  const shifts = args.shifts ?? [];
  const overrides = args.shiftOverrides ?? [];
  const existing = args.existingAppointments ?? [];

  const totalResources = args.resources.length;

  // Step 1: Filter resources by capability
  const capableResources = args.resources.filter((r) =>
    hasAll(r.capabilities, requirements.requiredResourceCapabilities)
  );

  // Step 2: Filter capable resources by availability
  const availableResources = capableResources.filter((r) =>
    isResourceFree(r.resource_id, win, existing)
  );

  const needEmployee = !!(requirements.requiredEmployeeSkills && requirements.requiredEmployeeSkills.length > 0);

  // Step 3: Employee filtering (only when skills are required)
  const totalEmployees = employees.length;
  let skilledEmployees = 0;
  let onShiftEmployees = 0;

  if (needEmployee) {
    for (const e of employees) {
      if (hasAll(e.skills, requirements.requiredEmployeeSkills)) {
        skilledEmployees++;
        const onShift = e.onShift !== undefined
          ? e.onShift
          : (shifts.length > 0 || overrides.length > 0 ? isEmployeeOnShift(e.employee_id, win, shifts, overrides) : true);
        if (onShift) {
          onShiftEmployees++;
        }
      }
    }
  }

  // Step 4: Build assignment options
  let options: AssignmentOption[] = [];

  if (needEmployee) {
    // Pre-sort employees by skill count ASC (least-skilled qualified
    // first), then today's existing-appointment count ASC (least busy),
    // then random — mirrors the book_with_scheduling_atomic ORDER BY
    // policy added 2026-05-08. Senior staff stay free for jobs that
    // actually need them.
    const todayBusyCount = (employeeId: string): number => {
      // Count appointments already on this employee's plate during the day
      // of the requested window. existingAppointments doesn't carry
      // employee_id today (only resourceId), so this falls back to 0
      // until the upstream caller threads it through. The RPC has the
      // proper SQL-side count; this helper is best-effort for now.
      return existing.filter(
        (a) => (a as { employeeId?: string }).employeeId === employeeId
      ).length;
    };
    const sortedEmployees = [...employees].sort((a, b) => {
      const skillDiff = (a.skills?.length ?? 0) - (b.skills?.length ?? 0);
      if (skillDiff !== 0) return skillDiff;
      const busyDiff = todayBusyCount(a.employee_id) - todayBusyCount(b.employee_id);
      if (busyDiff !== 0) return busyDiff;
      // Random tiebreaker so equally-skilled and equally-busy employees
      // rotate over time. Manager can override via UI.
      return Math.random() - 0.5;
    });
    for (const r of availableResources) {
      for (const e of sortedEmployees) {
        const onShift = e.onShift !== undefined
          ? e.onShift
          : (shifts.length > 0 || overrides.length > 0 ? isEmployeeOnShift(e.employee_id, win, shifts, overrides) : true);
        if (!onShift) continue;
        if (!hasAll(e.skills, requirements.requiredEmployeeSkills)) continue;
        options.push({ resourceId: r.resource_id, employeeId: e.employee_id });
      }
    }
  } else {
    options = availableResources.map((r) => ({ resourceId: r.resource_id }));
  }

  if (requirements.preferredResourceId) {
    const preferred = options.filter((o) => o.resourceId === requirements.preferredResourceId);
    if (preferred.length > 0) {
      options = preferred;
    }
  }

  // Step 5: Build diagnostics reason
  const timeLabel = formatTimeWindow(win);
  let reason = '';

  if (options.length > 0) {
    reason = 'ok';
  } else if (totalResources === 0) {
    reason = 'no resources configured';
  } else if (capableResources.length === 0) {
    const caps = (requirements.requiredResourceCapabilities ?? []).join(', ');
    reason = `no resources have required capability '${caps}'`;
  } else if (availableResources.length === 0) {
    const busyCount = capableResources.length;
    reason = `all ${busyCount} ${busyCount === 1 ? 'resource' : 'resources'} busy during ${timeLabel}`;
  } else if (!needEmployee) {
    reason = 'ok'; // resources available, no employee needed
  } else if (totalEmployees === 0) {
    reason = 'no employees configured';
  } else if (skilledEmployees === 0) {
    const skills = (requirements.requiredEmployeeSkills ?? []).join(', ');
    reason = `no employees with required skill '${skills}'`;
  } else if (onShiftEmployees === 0) {
    reason = `all ${skilledEmployees} qualified ${skilledEmployees === 1 ? 'employee' : 'employees'} off-shift during ${timeLabel}`;
  } else {
    reason = 'no valid resource-employee combination found';
  }

  return {
    options,
    diagnostics: {
      totalResources,
      capableResources: capableResources.length,
      availableResources: availableResources.length,
      totalEmployees,
      skilledEmployees,
      onShiftEmployees,
      reason,
    },
  };
}

function formatTimeWindow(win: TimeWindow): string {
  const from = win.from.toISOString().substring(11, 16);
  const to = win.to.toISOString().substring(11, 16);
  return `${from}-${to}`;
}
