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
    id: string;
    type?: string;
    capabilities: string[];
}
export interface EmployeeCandidate {
    id: string;
    skills: string[];
    onShift?: boolean;
}
export interface Shift {
    employee_id: number | string;
    day_of_week: number;
    start_time: string;
    end_time: string;
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
/**
 * Compute valid (resource, employee?) assignments for a requested service and time window.
 * Supports two modes:
 * - Pre-computed: EmployeeCandidate has `onShift: boolean` (shift check done upstream)
 * - Inline shifts: Pass `shifts` array and shift checking is done here
 */
export declare function selectAssignments(args: {
    requirements: ServiceRequirements;
    window: TimeWindow;
    resources: ResourceCandidate[];
    employees?: EmployeeCandidate[];
    shifts?: Shift[];
    existingAppointments?: ExistingAppointment[];
}): SelectAssignmentsResult;
