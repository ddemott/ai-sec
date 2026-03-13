export interface TimeWindow {
  from: Date;
  to: Date;
}

export interface ResourceCandidate {
  id: string;
  type?: string;
  capabilities: string[];
}

export interface EmployeeCandidate {
  id: string;
  skills: string[];
}

export interface Shift {
  employee_id: number;
  day_of_week: number;
  start_time: string; // "HH:MM"
  end_time: string;   // "HH:MM"
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
): boolean {
  const day = window.from.getUTCDay();
  // Format as HH:MM
  const startStr = window.from.toISOString().substring(11, 16);
  const endStr = window.to.toISOString().substring(11, 16);

  return shifts.some((s) => {
    if (s.employee_id.toString() !== employeeId) return false;
    if (s.day_of_week !== day) return false;
    // Window must be entirely within the shift
    return s.start_time <= startStr && s.end_time >= endStr;
  });
}

export function selectAssignments(args: {
  requirements: ServiceRequirements;
  window: TimeWindow;
  resources: ResourceCandidate[];
  employees?: EmployeeCandidate[];
  shifts?: Shift[];
  existingAppointments?: ExistingAppointment[];
}): AssignmentOption[] {
  const { requirements, window } = args;
  const employees = args.employees ?? [];
  const shifts = args.shifts ?? [];
  const existing = args.existingAppointments ?? [];

  const resourceMatches = args.resources.filter((r) => {
    return (
      hasAll(r.capabilities, requirements.requiredResourceCapabilities) &&
      isResourceFree(r.id, window, existing)
    );
  });

  const needEmployee = !!(requirements.requiredEmployeeSkills && requirements.requiredEmployeeSkills.length > 0);

  let options: AssignmentOption[] = [];

  if (needEmployee) {
    for (const r of resourceMatches) {
      for (const e of employees) {
        if (!isEmployeeOnShift(e.id, window, shifts)) continue;
        if (!hasAll(e.skills, requirements.requiredEmployeeSkills)) continue;
        options.push({ resourceId: r.id, employeeId: e.id });
      }
    }
  } else {
    options = resourceMatches.map((r) => ({ resourceId: r.id }));
  }

  if (requirements.preferredResourceId) {
    const preferred = options.filter((o) => o.resourceId === requirements.preferredResourceId);
    if (preferred.length > 0) {
      return preferred;
    }
  }

  return options;
}
