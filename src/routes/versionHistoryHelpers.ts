/**
 * Shared helpers, table config, and request schemas for the version-history
 * routes. Extracted from versionHistory.ts (docs/IMPROVEMENT_IDEAS.md — "split
 * version history routes into focused registrars and shared helpers") so the
 * route file reads as thin composition and the validation / error-shape logic
 * lives in one place instead of being repeated inside route closures.
 */
import { z } from 'zod';
import type { VersionedTable } from '../types/versionHistory';

/** Row shape returned by the get_record_history() RPC. */
export interface RecordHistoryRow {
  record_version_id: string;
  version_number: number;
  data: Record<string, unknown>;
  changed_fields: string[] | null;
  previous_values: Record<string, unknown> | null;
  change_type: string;
  change_source: string;
  changed_by: string | null;
  change_summary: string | null;
  changed_at: string;
}

export const VERSIONED_TABLES = [
  'customers',
  'appointments',
  'voice_sessions',
  'employees',
  'services',
  'resources',
] as const satisfies readonly VersionedTable[];

// Single source of truth: the Zod allow-list is DERIVED from VERSIONED_TABLES so
// the two can't drift (add/remove a table in one place only).
export const TableNameSchema = z.enum(VERSIONED_TABLES);

// PK column for each versioned table (post-2026-05-12 PK rename sprint —
// CODING_STANDARDS.md ID convention). Used to build dynamic SQL where the
// table name is parameterized but the WHERE/JOIN needs the right PK column.
// Keyed by VersionedTable (not bare string) so an unsupported table can't be
// indexed into an undefined PK column when building SQL.
export const PK_COLUMN_BY_TABLE: Record<VersionedTable, string> = {
  customers: 'customer_id',
  appointments: 'appointment_id',
  voice_sessions: 'voice_session_id',
  employees: 'employee_id',
  services: 'service_id',
  resources: 'resource_id',
};

export const ChangeSourceSchema = z.enum(['local', 'square', 'voice_call', 'system', 'api']);

export const RestoreFieldsSchema = z.object({
  source_version: z.number().int().min(1),
  fields: z.array(z.string().min(1)).min(1),
  restored_by: z.string().optional(),
  change_source: ChangeSourceSchema.optional(),
});

export const CopyFieldsSchema = z.object({
  source_record_id: z.string().uuid(),
  target_record_id: z.string().uuid(),
  fields: z.array(z.string().min(1)).min(1),
  copied_by: z.string().optional(),
  change_source: ChangeSourceSchema.optional(),
});

export const SoftDeleteSchema = z.object({
  deleted_by: z.string().optional(),
  change_source: ChangeSourceSchema.optional(),
});

export interface ErrorResponse {
  success: false;
  error: string;
  code: string;
  context: { who: string; what: string; when: string; where: string; why: string };
  details?: unknown;
}

/**
 * Standardized error response carrying the 5 Ws (who/what/when/where/why) so a
 * failure is diagnosable from the response alone.
 */
export function createErrorResponse(params: {
  who?: string;
  what: string;
  where: string;
  why: string;
  code: string;
  details?: unknown;
}): ErrorResponse {
  return {
    success: false,
    error: params.why,
    code: params.code,
    context: {
      who: params.who || 'unknown',
      what: params.what,
      when: new Date().toISOString(),
      where: params.where,
      why: params.why,
    },
    details: params.details,
  };
}

/**
 * Validate a table name against the versioned-table allow-list.
 * Returns null when valid, or an error response object when invalid.
 */
export function validateTable(
  table: string,
  tenantId: string,
  operation: string,
  endpoint: string
): ErrorResponse | null {
  const result = TableNameSchema.safeParse(table);
  if (!result.success) {
    return createErrorResponse({
      who: tenantId,
      what: operation,
      where: endpoint,
      why: `Invalid table name '${table}'. Must be one of: ${VERSIONED_TABLES.join(', ')}`,
      code: 'INVALID_TABLE',
    });
  }
  return null;
}

/**
 * Validate a request body against a Zod schema.
 * Returns `{ data }` on success or `{ error }` (a 5W error response) on failure.
 */
export function validateBody<T>(
  schema: z.ZodSchema<T>,
  body: unknown,
  tenantId: string,
  operation: string,
  endpoint: string,
  hint: string
): { error: ErrorResponse } | { data: T } {
  const result = schema.safeParse(body);
  if (!result.success) {
    return {
      error: createErrorResponse({
        who: tenantId,
        what: operation,
        where: endpoint,
        why: `Request validation failed: ${hint}`,
        code: 'VALIDATION_FAILED',
        details: result.error.issues,
      }),
    };
  }
  return { data: result.data };
}
