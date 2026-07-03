/**
 * Tests for the shared version-history field-exclusion helper.
 *
 * WHO: the restore-preview builder (backend) + DeletedRecordsPanel /
 *      RecordHistoryModal (dashboard) — all three now share this.
 * WHAT: excludedSystemFields(table) returns the audit/system columns PLUS the
 *       table's real primary key.
 * WHERE: shared/versionHistoryFields.ts
 * WHY: three duplicated exclusion lists only knew about a bare `id` and leaked
 *      the renamed PK (customer_id, …) into restore/copy field options.
 */
import { describe, it, expect } from 'vitest';
import {
  excludedSystemFields,
  PK_COLUMN_BY_TABLE,
  VERSIONED_TABLES,
  COMMON_SYSTEM_FIELDS,
} from './versionHistoryFields';

describe('excludedSystemFields', () => {
  it('excludes the table-specific PK for every versioned table', () => {
    for (const table of VERSIONED_TABLES) {
      const excluded = excludedSystemFields(table);
      expect(excluded.has(PK_COLUMN_BY_TABLE[table])).toBe(true);
    }
  });

  it('always excludes the common audit/system columns', () => {
    const excluded = excludedSystemFields('customers');
    for (const f of COMMON_SYSTEM_FIELDS) expect(excluded.has(f)).toBe(true);
  });

  it('does NOT exclude a genuine data field', () => {
    const excluded = excludedSystemFields('customers');
    expect(excluded.has('name')).toBe(false);
    expect(excluded.has('phone')).toBe(false);
    expect(excluded.has('email')).toBe(false);
  });

  it('customers → excludes customer_id (not a bare id), so the renamed PK cannot leak', () => {
    const excluded = excludedSystemFields('customers');
    expect(excluded.has('customer_id')).toBe(true);
  });

  it('an unknown table falls back to just the common set (no PK added)', () => {
    const excluded = excludedSystemFields('not_a_table');
    expect(excluded.size).toBe(COMMON_SYSTEM_FIELDS.length);
    for (const f of COMMON_SYSTEM_FIELDS) expect(excluded.has(f)).toBe(true);
  });
});
