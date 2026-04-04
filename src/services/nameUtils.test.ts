/**
 * Tests for nameUtils — shared name parsing for CRM sync services.
 * Happy + sad paths with 5W diagnostic context.
 */
import { describe, it, expect } from 'vitest';
import { splitName, joinName } from './nameUtils';

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

  describe('CRM sync files use shared nameUtils', () => {
    it('HAPPY: jobberSync imports from nameUtils (not local definition)', () => {
      const fs = require('fs');
      const src = fs.readFileSync('src/services/jobberSync.ts', 'utf8');
      expect(src).toContain("from './nameUtils'");
      expect(src).not.toMatch(/function splitName\(/);
    });

    it('HAPPY: hubspotSync imports from nameUtils', () => {
      const fs = require('fs');
      const src = fs.readFileSync('src/services/hubspotSync.ts', 'utf8');
      expect(src).toContain("from './nameUtils'");
      expect(src).not.toMatch(/function splitName\(/);
    });

    it('HAPPY: squareSync imports from nameUtils', () => {
      const fs = require('fs');
      const src = fs.readFileSync('src/services/squareSync.ts', 'utf8');
      expect(src).toContain("from './nameUtils'");
      expect(src).not.toMatch(/function splitName\(/);
    });
  });
});
