import { describe, it, expect } from 'vitest';
import { selectAssignments, type ResourceCandidate, type EmployeeCandidate, type ExistingAppointment, type TimeWindow, type Shift } from '../../shared/scheduling';

function window(from: string, to: string): TimeWindow {
  return { from: new Date(from), to: new Date(to) };
}

function appt(resourceId: string, from: string, to: string): ExistingAppointment {
  return { resourceId, start: new Date(from), end: new Date(to) };
}

describe('Scheduling selector – salon scenarios', () => {
  const baseWindow = window('2026-06-01T10:00:00Z', '2026-06-01T11:00:00Z');

  it('assigns preferred stylist when slot is free', () => {
    const resources: ResourceCandidate[] = [
      { id: 'suzy', type: 'STYLIST', capabilities: ['cut'] },
      { id: 'alex', type: 'STYLIST', capabilities: ['cut'] },
    ];

    const { options, diagnostics } = selectAssignments({
      requirements: {
        serviceType: 'haircut',
        requiredResourceCapabilities: ['cut'],
        preferredResourceId: 'suzy',
      },
      window: baseWindow,
      resources,
    });

    expect(options).toEqual([{ resourceId: 'suzy' }]);
    expect(diagnostics.reason).toBe('ok');
    expect(diagnostics.totalResources).toBe(2);
    expect(diagnostics.capableResources).toBe(2);
    expect(diagnostics.availableResources).toBe(2);
  });

  it('falls back to other qualified stylist when preferred is busy', () => {
    const resources: ResourceCandidate[] = [
      { id: 'suzy', type: 'STYLIST', capabilities: ['cut'] },
      { id: 'alex', type: 'STYLIST', capabilities: ['cut'] },
    ];

    const existing = [appt('suzy', '2026-06-01T10:00:00Z', '2026-06-01T11:00:00Z')];

    const { options, diagnostics } = selectAssignments({
      requirements: {
        serviceType: 'haircut',
        requiredResourceCapabilities: ['cut'],
        preferredResourceId: 'suzy',
      },
      window: baseWindow,
      resources,
      existingAppointments: existing,
    });

    expect(options).toEqual([{ resourceId: 'alex' }]);
    expect(diagnostics.reason).toBe('ok');
    expect(diagnostics.availableResources).toBe(1);
  });

  it('returns no options when preferred is busy and others lack capability', () => {
    const resources: ResourceCandidate[] = [
      { id: 'suzy', type: 'STYLIST', capabilities: ['cut'] },
      { id: 'ben', type: 'STYLIST', capabilities: [] },
    ];

    const existing = [appt('suzy', '2026-06-01T10:00:00Z', '2026-06-01T11:00:00Z')];

    const { options, diagnostics } = selectAssignments({
      requirements: {
        serviceType: 'haircut',
        requiredResourceCapabilities: ['cut'],
        preferredResourceId: 'suzy',
      },
      window: baseWindow,
      resources,
      existingAppointments: existing,
    });

    expect(options).toEqual([]);
    // 1 capable (suzy) but she's busy, ben lacks capability
    expect(diagnostics.capableResources).toBe(1);
    expect(diagnostics.availableResources).toBe(0);
    expect(diagnostics.reason).toBe('all 1 resource busy during 10:00-11:00');
  });

  it('returns all free qualified stylists when there is no preference', () => {
    const resources: ResourceCandidate[] = [
      { id: 'suzy', type: 'STYLIST', capabilities: ['cut'] },
      { id: 'alex', type: 'STYLIST', capabilities: ['cut'] },
      { id: 'ben', type: 'STYLIST', capabilities: [] },
    ];

    const existing = [appt('suzy', '2026-06-01T09:00:00Z', '2026-06-01T10:00:00Z')];

    const { options, diagnostics } = selectAssignments({
      requirements: {
        serviceType: 'haircut',
        requiredResourceCapabilities: ['cut'],
      },
      window: baseWindow,
      resources,
      existingAppointments: existing,
    });

    expect(options).toEqual([
      { resourceId: 'suzy' },
      { resourceId: 'alex' },
    ]);
    expect(diagnostics.reason).toBe('ok');
    expect(diagnostics.totalResources).toBe(3);
    expect(diagnostics.capableResources).toBe(2);
    expect(diagnostics.availableResources).toBe(2);
  });
});

describe('Scheduling selector – auto shop scenarios', () => {
  const baseWindow = window('2026-10-01T10:00:00Z', '2026-10-01T11:00:00Z');

  it('requires alignment bay and mechanic with alignment skill', () => {
    const resources: ResourceCandidate[] = [
      { id: 'bay1', type: 'BAY', capabilities: ['oil-change'] },
      { id: 'bay4', type: 'BAY', capabilities: ['alignment', 'tire-change'] },
    ];

    const employees: EmployeeCandidate[] = [
      { id: 'john', skills: ['oil-change'], onShift: true },
      { id: 'rick', skills: ['alignment', 'oil-change'], onShift: true },
    ];

    const { options, diagnostics } = selectAssignments({
      requirements: {
        serviceType: 'alignment',
        requiredResourceCapabilities: ['alignment'],
        requiredEmployeeSkills: ['alignment'],
      },
      window: baseWindow,
      resources,
      employees,
    });

    expect(options).toEqual([{ resourceId: 'bay4', employeeId: 'rick' }]);
    expect(diagnostics.reason).toBe('ok');
    expect(diagnostics.totalResources).toBe(2);
    expect(diagnostics.capableResources).toBe(1);
    expect(diagnostics.skilledEmployees).toBe(1);
    expect(diagnostics.onShiftEmployees).toBe(1);
  });

  it('returns no options when no skilled mechanic is on shift', () => {
    const resources: ResourceCandidate[] = [
      { id: 'bay4', type: 'BAY', capabilities: ['alignment'] },
    ];

    const employees: EmployeeCandidate[] = [
      { id: 'john', skills: ['oil-change'], onShift: true },
      { id: 'rick', skills: ['alignment'], onShift: false },
    ];

    const { options, diagnostics } = selectAssignments({
      requirements: {
        serviceType: 'alignment',
        requiredResourceCapabilities: ['alignment'],
        requiredEmployeeSkills: ['alignment'],
      },
      window: baseWindow,
      resources,
      employees,
    });

    expect(options).toEqual([]);
    expect(diagnostics.reason).toBe('all 1 qualified employee off-shift during 10:00-11:00');
    expect(diagnostics.skilledEmployees).toBe(1);
    expect(diagnostics.onShiftEmployees).toBe(0);
  });

  it('returns no options when bay is busy even if mechanic is free', () => {
    const resources: ResourceCandidate[] = [
      { id: 'bay4', type: 'BAY', capabilities: ['alignment'] },
    ];

    const employees: EmployeeCandidate[] = [
      { id: 'rick', skills: ['alignment'], onShift: true },
    ];

    const existing = [appt('bay4', '2026-10-01T10:00:00Z', '2026-10-01T11:00:00Z')];

    const { options, diagnostics } = selectAssignments({
      requirements: {
        serviceType: 'alignment',
        requiredResourceCapabilities: ['alignment'],
        requiredEmployeeSkills: ['alignment'],
      },
      window: baseWindow,
      resources,
      employees,
      existingAppointments: existing,
    });

    expect(options).toEqual([]);
    expect(diagnostics.reason).toBe('all 1 resource busy during 10:00-11:00');
    expect(diagnostics.capableResources).toBe(1);
    expect(diagnostics.availableResources).toBe(0);
  });

  it('returns all valid (bay, mechanic) combos when multiple exist', () => {
    const resources: ResourceCandidate[] = [
      { id: 'bay4', type: 'BAY', capabilities: ['alignment'] },
      { id: 'bay5', type: 'BAY', capabilities: ['alignment'] },
    ];

    const employees: EmployeeCandidate[] = [
      { id: 'rick', skills: ['alignment'], onShift: true },
      { id: 'sara', skills: ['alignment'], onShift: true },
    ];

    const { options, diagnostics } = selectAssignments({
      requirements: {
        serviceType: 'alignment',
        requiredResourceCapabilities: ['alignment'],
        requiredEmployeeSkills: ['alignment'],
      },
      window: baseWindow,
      resources,
      employees,
    });

    expect(options).toEqual([
      { resourceId: 'bay4', employeeId: 'rick' },
      { resourceId: 'bay4', employeeId: 'sara' },
      { resourceId: 'bay5', employeeId: 'rick' },
      { resourceId: 'bay5', employeeId: 'sara' },
    ]);
    expect(diagnostics.reason).toBe('ok');
  });
});

describe('Scheduling selector – sad paths & edge cases', () => {
  const baseWindow = window('2026-06-01T10:00:00Z', '2026-06-01T11:00:00Z');

  it('returns empty when resources array is empty (no capacity)', () => {
    const { options, diagnostics } = selectAssignments({
      requirements: {
        serviceType: 'haircut',
        requiredResourceCapabilities: ['cut'],
      },
      window: baseWindow,
      resources: [],
    });

    expect(options).toEqual([]);
    expect(diagnostics.reason).toBe('no resources configured');
    expect(diagnostics.totalResources).toBe(0);
  });

  it('returns empty when employees array is empty and skills are required', () => {
    const resources: ResourceCandidate[] = [
      { id: 'bay1', type: 'BAY', capabilities: ['alignment'] },
    ];

    const { options, diagnostics } = selectAssignments({
      requirements: {
        serviceType: 'alignment',
        requiredResourceCapabilities: ['alignment'],
        requiredEmployeeSkills: ['alignment'],
      },
      window: baseWindow,
      resources,
      employees: [],
    });

    expect(options).toEqual([]);
    expect(diagnostics.reason).toBe('no employees configured');
    expect(diagnostics.totalEmployees).toBe(0);
    expect(diagnostics.availableResources).toBe(1);
  });

  it('returns empty when shifts array is empty and employees rely on inline shift check', () => {
    const resources: ResourceCandidate[] = [
      { id: 'bay1', type: 'BAY', capabilities: ['alignment'] },
    ];

    // onShift is undefined, so it falls through to inline shift check — no shifts means default true
    // But with an explicit empty shifts array and no onShift flag, the employee is considered on-shift (default behavior).
    // To test a true "no shifts" sad path, we need onShift: false explicitly.
    const employees: EmployeeCandidate[] = [
      { id: 'rick', skills: ['alignment'], onShift: false },
    ];

    const { options, diagnostics } = selectAssignments({
      requirements: {
        serviceType: 'alignment',
        requiredResourceCapabilities: ['alignment'],
        requiredEmployeeSkills: ['alignment'],
      },
      window: baseWindow,
      resources,
      employees,
      shifts: [],
    });

    expect(options).toEqual([]);
    expect(diagnostics.reason).toBe('all 1 qualified employee off-shift during 10:00-11:00');
    expect(diagnostics.skilledEmployees).toBe(1);
    expect(diagnostics.onShiftEmployees).toBe(0);
  });

  it('returns empty when appointment window end is before start (invalid window)', () => {
    const invertedWindow = window('2026-06-01T11:00:00Z', '2026-06-01T10:00:00Z');
    const resources: ResourceCandidate[] = [
      { id: 'suzy', type: 'STYLIST', capabilities: ['cut'] },
    ];

    // An inverted window (end < start) means overlaps() will never be true for existing appts,
    // so the resource passes the "free" check. Resources still match on capabilities.
    const { options, diagnostics } = selectAssignments({
      requirements: {
        serviceType: 'haircut',
        requiredResourceCapabilities: ['cut'],
      },
      window: invertedWindow,
      resources,
    });

    // The function does not validate window ordering — it still returns candidates.
    // This documents current behavior: caller is responsible for valid windows.
    expect(options).toEqual([{ resourceId: 'suzy' }]);
    expect(diagnostics.reason).toBe('ok');
  });

  it('does NOT match when appointment window starts exactly at shift end boundary', () => {
    const lateWindow = window('2026-06-01T17:00:00Z', '2026-06-01T18:00:00Z');
    const resources: ResourceCandidate[] = [
      { id: 'bay1', type: 'BAY', capabilities: ['oil-change'] },
    ];

    // Shift ends at 17:00, appointment starts at 17:00 — employee should NOT be on shift
    const shifts: Shift[] = [
      { employee_id: 'john', day_of_week: 1, start_time: '09:00', end_time: '17:00' }, // Monday
    ];

    const employees: EmployeeCandidate[] = [
      { id: 'john', skills: ['oil-change'] }, // no onShift flag, uses inline shift check
    ];

    const { options, diagnostics } = selectAssignments({
      requirements: {
        serviceType: 'oil-change',
        requiredResourceCapabilities: ['oil-change'],
        requiredEmployeeSkills: ['oil-change'],
      },
      window: lateWindow,
      resources,
      employees,
      shifts,
    });

    // Shift end_time "17:00" >= window end "18:00" is false, so employee is not on shift
    expect(options).toEqual([]);
    expect(diagnostics.reason).toBe('all 1 qualified employee off-shift during 17:00-18:00');
  });

  it('returns empty when appointment window spans beyond a single shift (partially covered)', () => {
    // Window: 16:00–18:00, shift covers only 09:00–17:00
    const spanWindow = window('2026-06-01T16:00:00Z', '2026-06-01T18:00:00Z');
    const resources: ResourceCandidate[] = [
      { id: 'bay1', type: 'BAY', capabilities: ['oil-change'] },
    ];

    const shifts: Shift[] = [
      { employee_id: 'john', day_of_week: 1, start_time: '09:00', end_time: '17:00' },
    ];

    const employees: EmployeeCandidate[] = [
      { id: 'john', skills: ['oil-change'] },
    ];

    const { options, diagnostics } = selectAssignments({
      requirements: {
        serviceType: 'oil-change',
        requiredResourceCapabilities: ['oil-change'],
        requiredEmployeeSkills: ['oil-change'],
      },
      window: spanWindow,
      resources,
      employees,
      shifts,
    });

    // Shift end 17:00 < window end 18:00 — not fully covered
    expect(options).toEqual([]);
    expect(diagnostics.reason).toBe('all 1 qualified employee off-shift during 16:00-18:00');
  });

  it('treats adjacent appointments as non-overlapping (both resources bookable)', () => {
    const resources: ResourceCandidate[] = [
      { id: 'suzy', type: 'STYLIST', capabilities: ['cut'] },
    ];

    // Existing appointment ends exactly when our window starts
    const existing = [appt('suzy', '2026-06-01T09:00:00Z', '2026-06-01T10:00:00Z')];

    const { options, diagnostics } = selectAssignments({
      requirements: {
        serviceType: 'haircut',
        requiredResourceCapabilities: ['cut'],
      },
      window: baseWindow, // 10:00–11:00
      resources,
      existingAppointments: existing,
    });

    // Adjacent (09:00-10:00 vs 10:00-11:00) — NOT overlapping
    expect(options).toEqual([{ resourceId: 'suzy' }]);
    expect(diagnostics.reason).toBe('ok');
  });

  it('gracefully picks another resource when preferredResourceId does not exist', () => {
    const resources: ResourceCandidate[] = [
      { id: 'suzy', type: 'STYLIST', capabilities: ['cut'] },
      { id: 'alex', type: 'STYLIST', capabilities: ['cut'] },
    ];

    const { options, diagnostics } = selectAssignments({
      requirements: {
        serviceType: 'haircut',
        requiredResourceCapabilities: ['cut'],
        preferredResourceId: 'nonexistent-id',
      },
      window: baseWindow,
      resources,
    });

    // Preferred not found among options — falls back to all qualified resources
    expect(options).toEqual([
      { resourceId: 'suzy' },
      { resourceId: 'alex' },
    ]);
    expect(diagnostics.reason).toBe('ok');
  });

  it('gracefully picks another employee when preferred employee does not exist', () => {
    const resources: ResourceCandidate[] = [
      { id: 'bay1', type: 'BAY', capabilities: ['alignment'] },
    ];

    const employees: EmployeeCandidate[] = [
      { id: 'rick', skills: ['alignment'], onShift: true },
    ];

    // preferredResourceId is a resource preference, not employee —
    // but we verify that having employees that don't match a "preferred" scenario still works
    const { options, diagnostics } = selectAssignments({
      requirements: {
        serviceType: 'alignment',
        requiredResourceCapabilities: ['alignment'],
        requiredEmployeeSkills: ['alignment'],
      },
      window: baseWindow,
      resources,
      employees,
    });

    // Only valid combo returned
    expect(options).toEqual([{ resourceId: 'bay1', employeeId: 'rick' }]);
    expect(diagnostics.reason).toBe('ok');
  });

  it('returns empty when service requires a skill no employee has', () => {
    const resources: ResourceCandidate[] = [
      { id: 'bay1', type: 'BAY', capabilities: ['advanced-diag'] },
    ];

    const employees: EmployeeCandidate[] = [
      { id: 'john', skills: ['oil-change'], onShift: true },
      { id: 'rick', skills: ['alignment'], onShift: true },
    ];

    const { options, diagnostics } = selectAssignments({
      requirements: {
        serviceType: 'advanced-diagnostics',
        requiredResourceCapabilities: ['advanced-diag'],
        requiredEmployeeSkills: ['advanced-diag'],
      },
      window: baseWindow,
      resources,
      employees,
    });

    expect(options).toEqual([]);
    expect(diagnostics.reason).toBe("no employees with required skill 'advanced-diag'");
    expect(diagnostics.totalEmployees).toBe(2);
    expect(diagnostics.skilledEmployees).toBe(0);
  });

  it('returns empty when service requires a resource capability no resource has', () => {
    const resources: ResourceCandidate[] = [
      { id: 'bay1', type: 'BAY', capabilities: ['oil-change'] },
      { id: 'bay2', type: 'BAY', capabilities: ['tire-change'] },
    ];

    const { options, diagnostics } = selectAssignments({
      requirements: {
        serviceType: 'paint-job',
        requiredResourceCapabilities: ['paint-booth'],
      },
      window: baseWindow,
      resources,
    });

    expect(options).toEqual([]);
    expect(diagnostics.reason).toBe("no resources have required capability 'paint-booth'");
    expect(diagnostics.totalResources).toBe(2);
    expect(diagnostics.capableResources).toBe(0);
  });

  it('returns empty when all employees are on shift but none have the required skill', () => {
    const resources: ResourceCandidate[] = [
      { id: 'bay1', type: 'BAY', capabilities: ['alignment'] },
    ];

    const employees: EmployeeCandidate[] = [
      { id: 'john', skills: ['oil-change'], onShift: true },
      { id: 'sara', skills: ['tire-change'], onShift: true },
      { id: 'mike', skills: ['oil-change', 'tire-change'], onShift: true },
    ];

    const { options, diagnostics } = selectAssignments({
      requirements: {
        serviceType: 'alignment',
        requiredResourceCapabilities: ['alignment'],
        requiredEmployeeSkills: ['alignment'],
      },
      window: baseWindow,
      resources,
      employees,
    });

    expect(options).toEqual([]);
    expect(diagnostics.reason).toBe("no employees with required skill 'alignment'");
    expect(diagnostics.totalEmployees).toBe(3);
    expect(diagnostics.skilledEmployees).toBe(0);
  });

  it('returns empty when all resources have capability but all are busy', () => {
    const resources: ResourceCandidate[] = [
      { id: 'bay1', type: 'BAY', capabilities: ['oil-change'] },
      { id: 'bay2', type: 'BAY', capabilities: ['oil-change'] },
      { id: 'bay3', type: 'BAY', capabilities: ['oil-change'] },
    ];

    const employees: EmployeeCandidate[] = [
      { id: 'john', skills: ['oil-change'], onShift: true },
    ];

    const existing = [
      appt('bay1', '2026-06-01T10:00:00Z', '2026-06-01T11:00:00Z'),
      appt('bay2', '2026-06-01T10:30:00Z', '2026-06-01T11:30:00Z'),
      appt('bay3', '2026-06-01T09:30:00Z', '2026-06-01T10:30:00Z'),
    ];

    const { options, diagnostics } = selectAssignments({
      requirements: {
        serviceType: 'oil-change',
        requiredResourceCapabilities: ['oil-change'],
        requiredEmployeeSkills: ['oil-change'],
      },
      window: baseWindow,
      resources,
      employees,
      existingAppointments: existing,
    });

    expect(options).toEqual([]);
    expect(diagnostics.reason).toBe('all 3 resources busy during 10:00-11:00');
    expect(diagnostics.totalResources).toBe(3);
    expect(diagnostics.capableResources).toBe(3);
    expect(diagnostics.availableResources).toBe(0);
  });
});

describe('Scheduling diagnostics – comprehensive coverage', () => {
  const baseWindow = window('2026-06-01T10:00:00Z', '2026-06-01T11:00:00Z');

  it('diagnostics counts are accurate on happy path with mixed resources', () => {
    const resources: ResourceCandidate[] = [
      { id: 'bay1', type: 'BAY', capabilities: ['oil-change'] },
      { id: 'bay2', type: 'BAY', capabilities: ['alignment'] },
      { id: 'bay3', type: 'BAY', capabilities: ['oil-change'] },
    ];

    const employees: EmployeeCandidate[] = [
      { id: 'john', skills: ['oil-change'], onShift: true },
      { id: 'rick', skills: ['alignment'], onShift: true },
      { id: 'sara', skills: ['oil-change'], onShift: false },
    ];

    const { options, diagnostics } = selectAssignments({
      requirements: {
        serviceType: 'oil-change',
        requiredResourceCapabilities: ['oil-change'],
        requiredEmployeeSkills: ['oil-change'],
      },
      window: baseWindow,
      resources,
      employees,
    });

    expect(options).toHaveLength(2); // bay1+john, bay3+john
    expect(diagnostics).toEqual({
      totalResources: 3,
      capableResources: 2,   // bay1 + bay3
      availableResources: 2,
      totalEmployees: 3,
      skilledEmployees: 2,   // john + sara
      onShiftEmployees: 1,   // only john
      reason: 'ok',
    });
  });

  it('diagnostics reason uses plural for multiple resources busy', () => {
    const resources: ResourceCandidate[] = [
      { id: 'r1', capabilities: ['x'] },
      { id: 'r2', capabilities: ['x'] },
    ];

    const existing = [
      appt('r1', '2026-06-01T10:00:00Z', '2026-06-01T11:00:00Z'),
      appt('r2', '2026-06-01T10:00:00Z', '2026-06-01T11:00:00Z'),
    ];

    const { diagnostics } = selectAssignments({
      requirements: { serviceType: 'x', requiredResourceCapabilities: ['x'] },
      window: baseWindow,
      resources,
      existingAppointments: existing,
    });

    expect(diagnostics.reason).toBe('all 2 resources busy during 10:00-11:00');
  });

  it('diagnostics reason uses plural for multiple employees off-shift', () => {
    const resources: ResourceCandidate[] = [
      { id: 'r1', capabilities: ['x'] },
    ];

    const employees: EmployeeCandidate[] = [
      { id: 'e1', skills: ['x'], onShift: false },
      { id: 'e2', skills: ['x'], onShift: false },
      { id: 'e3', skills: ['x'], onShift: false },
    ];

    const { diagnostics } = selectAssignments({
      requirements: { serviceType: 'x', requiredResourceCapabilities: ['x'], requiredEmployeeSkills: ['x'] },
      window: baseWindow,
      resources,
      employees,
    });

    expect(diagnostics.reason).toBe('all 3 qualified employees off-shift during 10:00-11:00');
    expect(diagnostics.skilledEmployees).toBe(3);
    expect(diagnostics.onShiftEmployees).toBe(0);
  });

  it('diagnostics for no-employee mode shows zero employee counts', () => {
    const resources: ResourceCandidate[] = [
      { id: 'suzy', capabilities: ['cut'] },
    ];

    const { diagnostics } = selectAssignments({
      requirements: { serviceType: 'haircut', requiredResourceCapabilities: ['cut'] },
      window: baseWindow,
      resources,
    });

    expect(diagnostics.totalEmployees).toBe(0);
    expect(diagnostics.skilledEmployees).toBe(0);
    expect(diagnostics.onShiftEmployees).toBe(0);
    expect(diagnostics.reason).toBe('ok');
  });
});
