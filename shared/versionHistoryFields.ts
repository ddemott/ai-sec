/**
 * Canonical version-history table metadata + the one field-exclusion rule the
 * whole recovery stack shares. Cross-runtime (backend + dashboard) — no Node /
 * Next / framework deps.
 *
 * Before this module, the restore-preview builder (backend) and BOTH recovery
 * surfaces (DeletedRecordsPanel, RecordHistoryModal) each kept their own
 * exclusion array that only knew about a bare `id` column — none excluded the
 * table's REAL primary key (customer_id, appointment_id, …) after the 2026-05
 * PK rename. That let a table's PK leak into the list of restorable/copyable
 * fields. One helper, keyed by table, fixes all three (docs/IMPROVEMENT_IDEAS.md).
 */

export const VERSIONED_TABLES = [
  'customers',
  'appointments',
  'voice_sessions',
  'employees',
  'services',
  'resources',
] as const;

export type VersionedTable = (typeof VERSIONED_TABLES)[number];

/**
 * The single-column primary key for each versioned table (post-2026-05 PK
 * rename — CODING_STANDARDS.md ID convention). Keyed by VersionedTable so an
 * unsupported table can't index into an undefined PK column.
 */
export const PK_COLUMN_BY_TABLE: Record<VersionedTable, string> = {
  customers: 'customer_id',
  appointments: 'appointment_id',
  voice_sessions: 'voice_session_id',
  employees: 'employee_id',
  services: 'service_id',
  resources: 'resource_id',
};

/**
 * Audit / system columns that are never a valid restore, copy, or display
 * choice, independent of table. `id` stays for safety even though the schema
 * renamed PKs — a stray legacy column shouldn't surface either.
 */
export const COMMON_SYSTEM_FIELDS: readonly string[] = [
  'id',
  'tenant_id',
  'created_at',
  'updated_at',
  'is_deleted',
  'deleted_at',
  'deleted_by',
];

/**
 * The complete set of fields to EXCLUDE from restore/copy/display for a given
 * versioned table: the common audit/system columns PLUS that table's real
 * primary key. Unknown table names fall back to just the common set.
 */
export function excludedSystemFields(table: string): Set<string> {
  const pk = (PK_COLUMN_BY_TABLE as Record<string, string | undefined>)[table];
  return new Set(pk ? [...COMMON_SYSTEM_FIELDS, pk] : COMMON_SYSTEM_FIELDS);
}
