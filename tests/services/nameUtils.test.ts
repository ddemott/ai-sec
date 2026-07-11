/**
 * Tests for nameUtils — shared name parsing for CRM sync services.
 * Happy + sad paths with 5W diagnostic context.
 */
import { describe, it, expect } from 'vitest';
import { splitName, joinName, slugify, buildDisplayName } from '../../src/services/nameUtils';

describe('nameUtils', () => {
  describe('splitName', () => {
    it('HAPPY: splits "John Smith" into first and last', () => {
      // WHO: CRM sync building API payload
      // WHAT: Should correctly split a simple two-part name
      // WHY: Jobber/HubSpot/Square all need first + last name separately
      expect(splitName('John Smith')).toEqual({ firstName: 'John', lastName: 'Smith' });
    });

    it('HAPPY: handles multi-word last name', () => {
      // WHO: Customer with compound last name
      // WHAT: Everything after first word goes to lastName
      // WHY: "Maria De La Cruz" → first: "Maria", last: "De La Cruz"
      expect(splitName('Maria De La Cruz')).toEqual({ firstName: 'Maria', lastName: 'De La Cruz' });
    });

    it('HAPPY: single name goes to firstName only', () => {
      // WHO: Customer with mononym (e.g. "Prince")
      // WHAT: lastName should be empty string
      expect(splitName('Prince')).toEqual({ firstName: 'Prince', lastName: '' });
    });

    it('HAPPY: trims whitespace', () => {
      // WHO: Name with extra whitespace
      // WHAT: Should trim before splitting
      expect(splitName('  John   Smith  ')).toEqual({ firstName: 'John', lastName: 'Smith' });
    });

    it('SAD: null returns empty strings', () => {
      // WHO: Customer with no name (phone-only record)
      // WHAT: Should return empty strings, not crash
      // WHY: CRM APIs handle empty strings gracefully
      expect(splitName(null)).toEqual({ firstName: '', lastName: '' });
    });

    it('SAD: empty string returns empty strings', () => {
      expect(splitName('')).toEqual({ firstName: '', lastName: '' });
    });
  });

  describe('joinName', () => {
    it('HAPPY: joins first and last name', () => {
      // WHO: CRM sync building local customer record
      // WHAT: Should combine names with a space
      expect(joinName('John', 'Smith')).toBe('John Smith');
    });

    it('HAPPY: first name only', () => {
      expect(joinName('John', null)).toBe('John');
    });

    it('HAPPY: last name only', () => {
      expect(joinName(null, 'Smith')).toBe('Smith');
    });

    it('SAD: both null returns "Customer"', () => {
      // WHO: CRM sync with no name data
      // WHAT: Should return fallback "Customer"
      // WHY: Never store empty name — use sensible default
      expect(joinName(null, null)).toBe('Customer');
    });

    it('SAD: both empty returns "Customer"', () => {
      expect(joinName('', '')).toBe('Customer');
    });
  });

  describe('slugify', () => {
    it('HAPPY: lowercases and replaces spaces with dashes for skill storage', () => {
      // WHO: tenant admin creating a new skill "Oil Change" via the setup wizard
      // WHAT: slugify converts "Oil Change" → "oil-change" for DB storage
      // WHEN: POST /skills/create with name "Oil Change"
      // WHERE: skills.ts line 37 — before INSERT into tenant_skills
      // WHY: skills are matched by slug in the booking RPC. If "Oil Change" and "oil change"
      //      were stored as different skills, the voice AI would fail to match services to employees.
      expect(slugify('Oil Change')).toBe('oil-change');
    });

    it('HAPPY: trims leading/trailing whitespace before slugifying', () => {
      // WHO: admin who copy-pasted a skill name with trailing spaces from a spreadsheet
      // WHAT: "  Tire Rotation  " → "tire-rotation" (no leading/trailing dashes)
      // WHEN: POST /skills/create with whitespace-padded name
      // WHERE: slugify trim() call
      // WHY: without trimming, the slug would be "-tire-rotation-" which breaks URL patterns
      //      and looks wrong in the dashboard skill list
      expect(slugify('  Tire Rotation  ')).toBe('tire-rotation');
    });

    it('HAPPY: collapses multiple internal spaces into a single dash', () => {
      // WHO: admin typing a skill name with inconsistent spacing
      // WHAT: "Full   Body   Wash" → "full-body-wash" (not "full---body---wash")
      // WHEN: POST /skills/create
      // WHERE: slugify \s+ regex replacement
      // WHY: triple dashes in slugs would break visual consistency in the skill map
      //      and could cause duplicate skills if one has single dashes and another triple
      expect(slugify('Full   Body   Wash')).toBe('full-body-wash');
    });

    it('HAPPY: idempotent — already-slugified input passes through unchanged', () => {
      // WHO: code path that re-slugifies a value that was already stored as a slug
      // WHAT: "oil-change" → "oil-change" (no mutation)
      // WHEN: skill update re-normalizes the existing name
      // WHERE: slugify called on already-clean input
      // WHY: confirms slugify is safe to call multiple times without corrupting the value
      expect(slugify('oil-change')).toBe('oil-change');
    });

    it('SAD: empty string returns empty string without crashing', () => {
      // WHO: edge case — Zod should catch empty names, but slugify must not throw if called directly
      // WHAT: slugify('') → '' (not an exception)
      // WHEN: defensive call before INSERT when validation is bypassed in tests
      // WHERE: slugify('')
      // WHY: if slugify threw on empty string, any code path that calls it without pre-validation
      //      would crash the request with an unhandled exception (500) instead of a clean 400
      expect(slugify('')).toBe('');
    });

    it('HAPPY: handles ALL-CAPS input from voice AI transcription', () => {
      // WHO: voice AI booking flow that sends skill names in uppercase from STT
      // WHAT: "BRAKE INSPECTION" → "brake-inspection"
      // WHEN: edge function normalizes a skill name before querying tenant_skills
      // WHERE: slugify toLowerCase()
      // WHY: STT engines sometimes return ALL-CAPS. Without lowercasing, the skill lookup
      //      would fail to match "brake-inspection" in the DB and return NO_SKILLED_EMPLOYEE.
      expect(slugify('BRAKE Inspection')).toBe('brake-inspection');
    });
  });

  describe('buildDisplayName', () => {
    it('HAPPY: combines first and last name with a space', () => {
      // WHO: employee list route building the display name for the dashboard sidebar
      // WHAT: buildDisplayName('John', 'Smith') → 'John Smith'
      // WHEN: GET /employees — each row needs a display name
      // WHERE: employees.ts display name computation before UNION query
      // WHY: before this helper, each route had inline [first, last].filter(Boolean).join(' ')
      //      with subtly different handling of nulls — one route used || '' and another used ?? ''
      expect(buildDisplayName('John', 'Smith')).toBe('John Smith');
    });

    it('HAPPY: returns first name only when last name is null', () => {
      // WHO: employee with only a first name (common in small shops)
      // WHAT: buildDisplayName('John', null) → 'John' (no trailing space)
      // WHEN: GET /employees with a first-name-only employee
      // WHERE: buildDisplayName filter(Boolean) removes null
      // WHY: without filtering, the result would be "John " (trailing space) which looks broken
      //      in the dashboard employee list and causes string comparison issues
      expect(buildDisplayName('John', null)).toBe('John');
    });

    it('HAPPY: returns last name only when first name is null', () => {
      // WHO: employee imported from CRM with only a last name
      // WHAT: buildDisplayName(null, 'Smith') → 'Smith'
      // WHEN: CRM sync creates an employee from a contact with no first name
      // WHERE: buildDisplayName filter(Boolean) removes null
      // WHY: without this, the result would be " Smith" (leading space)
      expect(buildDisplayName(null, 'Smith')).toBe('Smith');
    });

    it('SAD: both null returns empty string — caller decides the fallback', () => {
      // WHO: employee with no name data at all (phone-only record from voice AI)
      // WHAT: buildDisplayName(null, null) → '' (empty, not "Customer")
      // WHEN: voice AI creates a minimal employee record during booking
      // WHERE: buildDisplayName — intentionally different from joinName which returns "Customer"
      // WHY: buildDisplayName is used for employees (where "" means "unnamed staff"),
      //      while joinName is used for customers (where "Customer" is the correct fallback).
      //      If buildDisplayName returned "Customer", the employee list would show "Customer"
      //      entries mixed with real employee names.
      expect(buildDisplayName(null, null)).toBe('');
    });

    it('SAD: both empty strings returns empty string', () => {
      // WHO: employee record with first_name='' and last_name='' after a bad CRM import
      // WHAT: empty strings are falsy → filtered out → returns ''
      // WHEN: GET /employees with a corrupted employee row
      // WHERE: buildDisplayName filter(Boolean) treats '' as falsy
      // WHY: if empty strings weren't filtered, the result would be " " (single space)
      //      which passes truthy checks but looks blank in the UI — a confusing non-bug
      expect(buildDisplayName('', '')).toBe('');
    });

    it('HAPPY: handles undefined inputs (for callers that do not null-check)', () => {
      // WHO: caller that passes req.body.first_name which may be undefined (not null)
      // WHAT: undefined is falsy → filtered out → returns ''
      // WHEN: POST /employees/create where first_name was not in the request body at all
      // WHERE: buildDisplayName with TypeScript optional params
      // WHY: undefined vs null should not matter — both produce the same empty-name result
      expect(buildDisplayName(undefined, undefined)).toBe('');
    });

    it('HAPPY: filters out empty strings when mixed with real values', () => {
      // WHO: employee with first_name='John' but last_name='' (empty, not null)
      // WHAT: buildDisplayName('John', '') → 'John' (not 'John ')
      // WHEN: employee update sets last_name to empty string
      // WHERE: buildDisplayName filter(Boolean) on the parts array
      // WHY: trailing space in display name breaks alphabetical sort in the employee sidebar
      //      and causes "John" and "John " to appear as different employees
      expect(buildDisplayName('John', '')).toBe('John');
    });
  });
});
