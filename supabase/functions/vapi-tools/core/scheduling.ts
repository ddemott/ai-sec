/**
 * Re-exports from the shared scheduling module.
 * See shared/scheduling.ts for the canonical implementation.
 */
export {
  selectAssignments,
  type TimeWindow,
  type ResourceCandidate,
  type EmployeeCandidate,
  type Shift,
  type ExistingAppointment,
  type ServiceRequirements,
  type AssignmentOption,
} from '../../../../shared/scheduling.ts';
