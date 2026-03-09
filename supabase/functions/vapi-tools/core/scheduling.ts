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
  onShift: boolean;
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

export function selectAssignments(args: {
  requirements: ServiceRequirements;
  window: TimeWindow;
  resources: ResourceCandidate[];
  employees?: EmployeeCandidate[];
  existingAppointments?: ExistingAppointment[];
}): AssignmentOption[] {
  const { requirements, window } = args;
  const employees = args.employees ?? [];
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
        if (!e.onShift) continue;
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
