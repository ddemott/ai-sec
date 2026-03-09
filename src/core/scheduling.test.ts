import { describe, it, expect } from 'vitest';
import { selectAssignments, type ResourceCandidate, type EmployeeCandidate, type ExistingAppointment } from './scheduling';
import type { TimeWindow } from './models';

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

    const result = selectAssignments({
      requirements: {
        serviceType: 'haircut',
        requiredResourceCapabilities: ['cut'],
        preferredResourceId: 'suzy',
      },
      window: baseWindow,
      resources,
    });

    expect(result).toEqual([{ resourceId: 'suzy' }]);
  });

  it('falls back to other qualified stylist when preferred is busy', () => {
    const resources: ResourceCandidate[] = [
      { id: 'suzy', type: 'STYLIST', capabilities: ['cut'] },
      { id: 'alex', type: 'STYLIST', capabilities: ['cut'] },
    ];

    const existing = [appt('suzy', '2026-06-01T10:00:00Z', '2026-06-01T11:00:00Z')];

    const result = selectAssignments({
      requirements: {
        serviceType: 'haircut',
        requiredResourceCapabilities: ['cut'],
        preferredResourceId: 'suzy',
      },
      window: baseWindow,
      resources,
      existingAppointments: existing,
    });

    expect(result).toEqual([{ resourceId: 'alex' }]);
  });

  it('returns no options when preferred is busy and others lack capability', () => {
    const resources: ResourceCandidate[] = [
      { id: 'suzy', type: 'STYLIST', capabilities: ['cut'] },
      { id: 'ben', type: 'STYLIST', capabilities: [] },
    ];

    const existing = [appt('suzy', '2026-06-01T10:00:00Z', '2026-06-01T11:00:00Z')];

    const result = selectAssignments({
      requirements: {
        serviceType: 'haircut',
        requiredResourceCapabilities: ['cut'],
        preferredResourceId: 'suzy',
      },
      window: baseWindow,
      resources,
      existingAppointments: existing,
    });

    expect(result).toEqual([]);
  });

  it('returns all free qualified stylists when there is no preference', () => {
    const resources: ResourceCandidate[] = [
      { id: 'suzy', type: 'STYLIST', capabilities: ['cut'] },
      { id: 'alex', type: 'STYLIST', capabilities: ['cut'] },
      { id: 'ben', type: 'STYLIST', capabilities: [] },
    ];

    const existing = [appt('suzy', '2026-06-01T09:00:00Z', '2026-06-01T10:00:00Z')];

    const result = selectAssignments({
      requirements: {
        serviceType: 'haircut',
        requiredResourceCapabilities: ['cut'],
      },
      window: baseWindow,
      resources,
      existingAppointments: existing,
    });

    expect(result).toEqual([
      { resourceId: 'suzy' },
      { resourceId: 'alex' },
    ]);
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

    const result = selectAssignments({
      requirements: {
        serviceType: 'alignment',
        requiredResourceCapabilities: ['alignment'],
        requiredEmployeeSkills: ['alignment'],
      },
      window: baseWindow,
      resources,
      employees,
    });

    expect(result).toEqual([{ resourceId: 'bay4', employeeId: 'rick' }]);
  });

  it('returns no options when no skilled mechanic is on shift', () => {
    const resources: ResourceCandidate[] = [
      { id: 'bay4', type: 'BAY', capabilities: ['alignment'] },
    ];

    const employees: EmployeeCandidate[] = [
      { id: 'john', skills: ['oil-change'], onShift: true },
      { id: 'rick', skills: ['alignment'], onShift: false },
    ];

    const result = selectAssignments({
      requirements: {
        serviceType: 'alignment',
        requiredResourceCapabilities: ['alignment'],
        requiredEmployeeSkills: ['alignment'],
      },
      window: baseWindow,
      resources,
      employees,
    });

    expect(result).toEqual([]);
  });

  it('returns no options when bay is busy even if mechanic is free', () => {
    const resources: ResourceCandidate[] = [
      { id: 'bay4', type: 'BAY', capabilities: ['alignment'] },
    ];

    const employees: EmployeeCandidate[] = [
      { id: 'rick', skills: ['alignment'], onShift: true },
    ];

    const existing = [appt('bay4', '2026-10-01T10:00:00Z', '2026-10-01T11:00:00Z')];

    const result = selectAssignments({
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

    expect(result).toEqual([]);
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

    const result = selectAssignments({
      requirements: {
        serviceType: 'alignment',
        requiredResourceCapabilities: ['alignment'],
        requiredEmployeeSkills: ['alignment'],
      },
      window: baseWindow,
      resources,
      employees,
    });

    expect(result).toEqual([
      { resourceId: 'bay4', employeeId: 'rick' },
      { resourceId: 'bay4', employeeId: 'sara' },
      { resourceId: 'bay5', employeeId: 'rick' },
      { resourceId: 'bay5', employeeId: 'sara' },
    ]);
  });
});
