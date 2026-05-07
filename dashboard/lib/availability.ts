/**
 * Booking-alignment helpers used by QuickBookPanel + AppointmentDetailPanel
 * to filter dropdowns to (employee, resource) combinations that are valid
 * for the chosen service. The contract mirrors the booking RPC's checks so
 * the operator can never pick a combination the RPC would reject.
 *
 * Convention for the mapping tables (service_employee / service_resource):
 * - If a service has assigned rows, only those (employee/resource) ids are
 *   valid for that service.
 * - If a service has NO rows, the constraint is treated as "open" — any
 *   employee/resource passes. This matches book_with_scheduling_atomic's
 *   behavior when `p_required_skills` / `p_required_capabilities` are
 *   empty arrays: the constraint is skipped.
 */

import type { ServiceMapping } from './types';

export interface ServiceMappingMaps {
  /** service_id → Set of employee_ids that can perform this service */
  serviceEmployee: Map<string, Set<string>>;
  /** service_id → Set of resource_ids permitted for this service */
  serviceResource: Map<string, Set<string>>;
}

export function buildMappingMaps(
  serviceEmployeeRows: ServiceMapping[],
  serviceResourceRows: ServiceMapping[]
): ServiceMappingMaps {
  const serviceEmployee = new Map<string, Set<string>>();
  for (const row of serviceEmployeeRows) {
    if (!row.employee_id) continue;
    const set = serviceEmployee.get(row.service_id) ?? new Set<string>();
    set.add(row.employee_id);
    serviceEmployee.set(row.service_id, set);
  }

  const serviceResource = new Map<string, Set<string>>();
  for (const row of serviceResourceRows) {
    if (!row.resource_id) continue;
    const set = serviceResource.get(row.service_id) ?? new Set<string>();
    set.add(row.resource_id);
    serviceResource.set(row.service_id, set);
  }

  return { serviceEmployee, serviceResource };
}

/**
 * Filter an employee list to those qualified for the given service. Empty
 * `serviceId` (or a service with no mappings) returns the input unchanged.
 */
export function filterEmployeesByService<T extends { id: string | number }>(
  employees: T[],
  serviceId: string | null,
  serviceEmployee: Map<string, Set<string>>
): T[] {
  if (!serviceId) return employees;
  const skilled = serviceEmployee.get(serviceId);
  if (!skilled || skilled.size === 0) return employees;
  return employees.filter((e) => skilled.has(String(e.id)));
}

/**
 * Filter a resource list to those permitted for the given service. Empty
 * `serviceId` (or a service with no mappings) returns the input unchanged.
 */
export function filterResourcesByService<T extends { id: string }>(
  resources: T[],
  serviceId: string | null,
  serviceResource: Map<string, Set<string>>
): T[] {
  if (!serviceId) return resources;
  const allowed = serviceResource.get(serviceId);
  if (!allowed || allowed.size === 0) return resources;
  return resources.filter((r) => allowed.has(r.id));
}
