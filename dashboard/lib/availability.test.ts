import { describe, test, expect } from 'vitest';
import {
  buildMappingMaps,
  filterEmployeesByService,
  filterResourcesByService,
} from './availability';
import type { ServiceMapping } from './types';

const tenantId = 't-1';

const seRows: ServiceMapping[] = [
  // Tire Mount (svc-1) → Mike + Carlos
  { service_id: 'svc-1', employee_id: 'emp-mike', tenant_id: tenantId },
  { service_id: 'svc-1', employee_id: 'emp-carlos', tenant_id: tenantId },
  // Oil Change (svc-2) → Mike only
  { service_id: 'svc-2', employee_id: 'emp-mike', tenant_id: tenantId },
  // svc-3 (Inspection) has NO mapping rows on purpose
];

const srRows: ServiceMapping[] = [
  // Tire Mount → Bay 1, Bay 2
  { service_id: 'svc-1', resource_id: 'bay-1', tenant_id: tenantId },
  { service_id: 'svc-1', resource_id: 'bay-2', tenant_id: tenantId },
  // Oil Change → Bay 2 only
  { service_id: 'svc-2', resource_id: 'bay-2', tenant_id: tenantId },
];

describe('buildMappingMaps', () => {
  test('builds service_id → Set lookups for both employee and resource mappings', () => {
    const { serviceEmployee, serviceResource } = buildMappingMaps(seRows, srRows);
    expect(Array.from(serviceEmployee.get('svc-1') ?? [])).toEqual(['emp-mike', 'emp-carlos']);
    expect(Array.from(serviceEmployee.get('svc-2') ?? [])).toEqual(['emp-mike']);
    expect(serviceEmployee.has('svc-3')).toBe(false);
    expect(Array.from(serviceResource.get('svc-1') ?? [])).toEqual(['bay-1', 'bay-2']);
    expect(Array.from(serviceResource.get('svc-2') ?? [])).toEqual(['bay-2']);
    // WHO: QuickBookPanel + AppointmentDetailPanel rendering filtered dropdowns | WHAT: O(1) lookup map keyed by service_id | WHEN: panels open and need to know "who can do svc-1" | WHERE: buildMappingMaps fan-out | WHY: doing this as a linear scan on every keystroke would be O(n×m) — n services × m mapping rows; the precomputed Set turns each render into an O(1) `.has()` check, which matters when an operator is typing/clicking through a 500-employee tenant
  });

  test('rows with no employee_id or resource_id are skipped (not added to either map)', () => {
    // Some real DBs return rows with one or the other null when the row was
    // a partial migration artifact. Defensive against that.
    const rows: ServiceMapping[] = [
      { service_id: 'svc-1', tenant_id: tenantId }, // no employee_id, no resource_id
      { service_id: 'svc-1', employee_id: 'emp-1', tenant_id: tenantId },
    ];
    const { serviceEmployee, serviceResource } = buildMappingMaps(rows, rows);
    expect(serviceEmployee.get('svc-1')?.size).toBe(1);
    expect(serviceResource.get('svc-1')?.size ?? 0).toBe(0);
    // WHO: defensive against partial-migration data | WHAT: builder ignores rows lacking either id field | WHEN: data older than the strict-not-null migration | WHERE: buildMappingMaps row guards | WHY: a `.add(undefined)` would corrupt the Set semantics — `.has(undefined)` would return true on every employee/resource lookup, silently letting all combinations pass the filter; the guard keeps the filter honest under bad data
  });
});

describe('filterEmployeesByService', () => {
  const employees = [
    { id: 'emp-mike', name: 'Mike' },
    { id: 'emp-carlos', name: 'Carlos' },
    { id: 'emp-dana', name: 'Dana' },
  ];
  const { serviceEmployee } = buildMappingMaps(seRows, srRows);

  test('returns the input unchanged when serviceId is null (no service picked yet)', () => {
    const out = filterEmployeesByService(employees, null, serviceEmployee);
    expect(out).toEqual(employees);
    // WHO: operator who hasn't picked a service yet | WHAT: all employees stay visible | WHEN: panel opens with empty form, before service is chosen | WHERE: filterEmployeesByService null-guard | WHY: filtering before the service is picked would show an empty list and trap the operator into picking service first; gracefully returning everyone preserves the "any order" UX while still filtering once service IS set
  });

  test('filters to only mapped employees when service has assignments', () => {
    const out = filterEmployeesByService(employees, 'svc-1', serviceEmployee);
    expect(out.map((e) => e.id)).toEqual(['emp-mike', 'emp-carlos']);
    expect(out.find((e) => e.id === 'emp-dana')).toBeUndefined();
    // WHO: front-desk operator picking Mike vs Carlos vs Dana for a Tire Mount | WHAT: Dana drops out of the dropdown because she has no svc-1 row | WHEN: service is selected | WHERE: filterEmployeesByService skill gate | WHY: this is the headline feature — pre-fix, Dana was selectable, the operator booked her, then Mike's customer arrived and Dana didn't know how to mount tires; this filter prevents that operational failure at the UI level
  });

  test('returns the input unchanged when service has NO mapping rows (open service)', () => {
    const out = filterEmployeesByService(employees, 'svc-3', serviceEmployee);
    expect(out).toEqual(employees);
    // WHO: a tenant whose service config is partial — has a service but no skill assignments yet | WHAT: filter falls open, all employees selectable | WHEN: brand-new service that the owner hasn't yet assigned to anyone | WHERE: filterEmployeesByService open-service branch | WHY: matches the booking RPC's behavior — when `p_required_skills` is empty, the RPC accepts any employee. The UI must mirror this so the operator isn't blocked from booking a service that's "configured but not skill-mapped." Tightening this would force every new service to be skill-mapped before the first booking, which doesn't match how shops onboard
  });

  test('also returns input unchanged when the Set exists but is empty (defensive)', () => {
    const map = new Map<string, Set<string>>([['svc-1', new Set()]]);
    const out = filterEmployeesByService(employees, 'svc-1', map);
    expect(out).toEqual(employees);
    // WHO: defensive against a future bug where the map gets seeded with empty Sets | WHAT: empty-Set treated identically to missing key | WHEN: edge case in map construction | WHERE: filterEmployeesByService size-zero guard | WHY: an empty Set with size===0 means "no one is qualified" → if we filtered, the dropdown would be empty and the operator would be stuck with "no eligible staff" — but the data shape implies the service has no constraints; falling open is the safer default and matches the missing-key branch
  });
});

describe('filterResourcesByService', () => {
  const resources = [
    { id: 'bay-1', name: 'Bay 1' },
    { id: 'bay-2', name: 'Bay 2' },
    { id: 'bay-3', name: 'Bay 3' },
  ];
  const { serviceResource } = buildMappingMaps(seRows, srRows);

  test('filters resources to those mapped to the service', () => {
    const out = filterResourcesByService(resources, 'svc-1', serviceResource);
    expect(out.map((r) => r.id)).toEqual(['bay-1', 'bay-2']);
    // WHO: operator who picked Tire Mount (svc-1) | WHAT: Bay 3 hidden because the service can't run there (e.g., Bay 3 is the alignment rack only) | WHEN: service is set | WHERE: filterResourcesByService capability gate | WHY: a tenant that configures resource-capability mapping deserves the same enforcement at the UI level as the RPC provides — operator picking Bay 3 for Tire Mount would land NO_AVAILABILITY at submit; filtering up-front saves that round trip
  });

  test('returns all resources when service has NO mapping rows', () => {
    const out = filterResourcesByService(resources, 'svc-3', serviceResource);
    expect(out).toEqual(resources);
    // WHO: a service configured but not yet resource-mapped | WHAT: any resource is acceptable | WHEN: open service, no resource constraint | WHERE: filterResourcesByService open-service branch | WHY: same rationale as the employee filter's open-service branch — falling open mirrors the RPC's behavior when `p_required_capabilities` is empty, and matches how tenants onboard new services incrementally
  });
});
