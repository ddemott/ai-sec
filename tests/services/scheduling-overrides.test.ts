/**
 * Tests for Fix #18: shared/scheduling.ts employee_schedule support
 * Verifies selectAssignments respects date-specific overrides.
 * Happy + sad paths with 5W diagnostic context.
 */
import { describe, it, expect } from 'vitest';
import {
  selectAssignments,
  type ResourceCandidate,
  type EmployeeCandidate,
  type TimeWindow,
  type Shift,
  type ShiftOverride,
} from '../../shared/scheduling';

// Monday June 1, 2026 is a Monday (getUTCDay() = 1)
const MONDAY_10AM = '2026-06-01T10:00:00Z';
const MONDAY_11AM = '2026-06-01T11:00:00Z';
// Saturday June 6, 2026 (getUTCDay() = 6)
const SATURDAY_10AM = '2026-06-06T10:00:00Z';
const SATURDAY_11AM = '2026-06-06T11:00:00Z';

function win(from: string, to: string): TimeWindow {
  return { from: new Date(from), to: new Date(to) };
}

const resource: ResourceCandidate = { resource_id: 'bay-1', capabilities: ['oil-change'] };
const employee: EmployeeCandidate = { employee_id: 'mike', skills: ['oil-change'] };

// Weekly pattern: Mike works Mon-Fri 8-5
const patternShifts: Shift[] = [1, 2, 3, 4, 5].map((dow) => ({
  employee_id: 'mike',
  day_of_week: dow,
  start_time: '08:00',
  end_time: '17:00',
}));

describe('Fix #18: shared/scheduling.ts employee_schedule support', () => {
  describe('isEmployeeOnShift with overrides', () => {
    it('HAPPY: employee on shift via pattern when no override exists', () => {
      // WHO: Mike with Mon-Fri 8-5 pattern
      // WHAT: Should be available Monday 10-11am
      // WHY: Pattern says he works Mondays
      const result = selectAssignments({
        requirements: { serviceType: 'oil-change', requiredEmployeeSkills: ['oil-change'] },
        window: win(MONDAY_10AM, MONDAY_11AM),
        resources: [resource],
        employees: [employee],
        shifts: patternShifts,
      });

      expect(result.options.length).toBe(1);
      expect(result.options[0].employeeId).toBe('mike');
      expect(result.diagnostics.onShiftEmployees).toBe(1);
    });

    it('HAPPY: override with different hours is respected', () => {
      // WHO: Mike with override on Monday: 10am-2pm instead of 8-5
      // WHAT: Should be available at 10am (within override window)
      // WHY: Override takes precedence over pattern
      const overrides: ShiftOverride[] = [
        {
          employee_id: 'mike',
          shift_date: '2026-06-01',
          start_time: '10:00',
          end_time: '14:00',
          is_off: false,
        },
      ];

      const result = selectAssignments({
        requirements: { serviceType: 'oil-change', requiredEmployeeSkills: ['oil-change'] },
        window: win(MONDAY_10AM, MONDAY_11AM),
        resources: [resource],
        employees: [employee],
        shifts: patternShifts,
        shiftOverrides: overrides,
      });

      expect(result.options.length).toBe(1);
    });

    it('SAD: is_off override blocks employee despite having pattern', () => {
      // WHO: Mike with is_off override on Monday
      // WHAT: Should NOT be available (day off overrides pattern)
      // WHY: is_off=true means employee is not working that day
      const overrides: ShiftOverride[] = [
        {
          employee_id: 'mike',
          shift_date: '2026-06-01',
          start_time: null,
          end_time: null,
          is_off: true,
        },
      ];

      const result = selectAssignments({
        requirements: { serviceType: 'oil-change', requiredEmployeeSkills: ['oil-change'] },
        window: win(MONDAY_10AM, MONDAY_11AM),
        resources: [resource],
        employees: [employee],
        shifts: patternShifts,
        shiftOverrides: overrides,
      });

      expect(result.options.length).toBe(0);
      expect(result.diagnostics.onShiftEmployees).toBe(0);
      expect(result.diagnostics.reason).toContain('off-shift');
    });

    it('SAD: override with narrower hours blocks out-of-range booking', () => {
      // WHO: Mike with override 10am-12pm on Monday
      // WHAT: Booking at 1pm should fail (outside override window)
      // WHY: Override narrows available hours
      const overrides: ShiftOverride[] = [
        {
          employee_id: 'mike',
          shift_date: '2026-06-01',
          start_time: '10:00',
          end_time: '12:00',
          is_off: false,
        },
      ];

      const result = selectAssignments({
        requirements: { serviceType: 'oil-change', requiredEmployeeSkills: ['oil-change'] },
        window: win('2026-06-01T13:00:00Z', '2026-06-01T14:00:00Z'),
        resources: [resource],
        employees: [employee],
        shifts: patternShifts,
        shiftOverrides: overrides,
      });

      expect(result.options.length).toBe(0);
    });

    it('HAPPY: override adds work on normally-off day (Saturday)', () => {
      // WHO: Mike who normally doesn't work Saturday
      // WHAT: Override for Saturday 9am-1pm should make him available
      // WHY: Business needs extra coverage on a specific Saturday
      const overrides: ShiftOverride[] = [
        {
          employee_id: 'mike',
          shift_date: '2026-06-06',
          start_time: '09:00',
          end_time: '13:00',
          is_off: false,
        },
      ];

      const result = selectAssignments({
        requirements: { serviceType: 'oil-change', requiredEmployeeSkills: ['oil-change'] },
        window: win(SATURDAY_10AM, SATURDAY_11AM),
        resources: [resource],
        employees: [employee],
        shifts: patternShifts,
        shiftOverrides: overrides,
      });

      expect(result.options.length).toBe(1);
      expect(result.options[0].employeeId).toBe('mike');
    });

    it('SAD: no override and no pattern for Saturday = not available', () => {
      // WHO: Mike with no Saturday pattern and no override
      // WHAT: Should not be available on Saturday
      // WHY: No pattern + no override = not working
      const result = selectAssignments({
        requirements: { serviceType: 'oil-change', requiredEmployeeSkills: ['oil-change'] },
        window: win(SATURDAY_10AM, SATURDAY_11AM),
        resources: [resource],
        employees: [employee],
        shifts: patternShifts,
      });

      expect(result.options.length).toBe(0);
    });

    it('HAPPY: override for one employee does not affect another', () => {
      // WHO: Mike (off) and Sarah (no override, pattern applies)
      // WHAT: Sarah should still be available even though Mike is off
      // WHY: Overrides are per-employee
      const sarah: EmployeeCandidate = { employee_id: 'sarah', skills: ['oil-change'] };
      const sarahShifts: Shift[] = [1, 2, 3, 4, 5].map((dow) => ({
        employee_id: 'sarah',
        day_of_week: dow,
        start_time: '08:00',
        end_time: '17:00',
      }));

      const overrides: ShiftOverride[] = [
        {
          employee_id: 'mike',
          shift_date: '2026-06-01',
          start_time: null,
          end_time: null,
          is_off: true,
        },
      ];

      const result = selectAssignments({
        requirements: { serviceType: 'oil-change', requiredEmployeeSkills: ['oil-change'] },
        window: win(MONDAY_10AM, MONDAY_11AM),
        resources: [resource],
        employees: [employee, sarah],
        shifts: [...patternShifts, ...sarahShifts],
        shiftOverrides: overrides,
      });

      // Only Sarah should be available (Mike is off)
      expect(result.options.length).toBe(1);
      expect(result.options[0].employeeId).toBe('sarah');
    });

    it('HAPPY: no overrides array behaves like before (backward compatible)', () => {
      // WHO: selectAssignments called without shiftOverrides param
      // WHAT: Should work exactly as before — pattern-only
      // WHY: Backward compatibility — existing callers don't pass overrides
      const result = selectAssignments({
        requirements: { serviceType: 'oil-change', requiredEmployeeSkills: ['oil-change'] },
        window: win(MONDAY_10AM, MONDAY_11AM),
        resources: [resource],
        employees: [employee],
        shifts: patternShifts,
        // no shiftOverrides
      });

      expect(result.options.length).toBe(1);
    });

    it('HAPPY: empty overrides array behaves like no overrides', () => {
      // WHO: selectAssignments with empty overrides
      // WHAT: Should fall back to patterns
      // WHY: No overrides defined = use pattern
      const result = selectAssignments({
        requirements: { serviceType: 'oil-change', requiredEmployeeSkills: ['oil-change'] },
        window: win(MONDAY_10AM, MONDAY_11AM),
        resources: [resource],
        employees: [employee],
        shifts: patternShifts,
        shiftOverrides: [],
      });

      expect(result.options.length).toBe(1);
    });
  });
});
