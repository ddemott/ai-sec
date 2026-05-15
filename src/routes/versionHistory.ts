/**
 * Version History Routes
 *
 * Provides endpoints for:
 * - Viewing record history and versions
 * - Restoring fields from historical versions
 * - Managing soft-deleted records
 * - Copying fields between records
 * - Viewing recent changes across all tables
 */

import type { AppFastifyInstance } from '../types/fastify';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import { withHandler, logEvent, requireTenantId, type AppRequest } from '../middleware';
import type {
  RecordVersion,
  RecordHistoryResponse,
  DeletedRecord,
  DeletedRecordsResponse,
  RecentChange,
  RecentChangesResponse,
  VersionComparison,
  VersionedTable,
  ChangeSource,
} from '../types/versionHistory';

/** Row shape returned by get_record_history() RPC */
interface RecordHistoryRow {
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

const VERSIONED_TABLES: VersionedTable[] = [
  'customers',
  'appointments',
  'voice_sessions',
  'employees',
  'services',
  'resources',
];

const TableNameSchema = z.enum(['customers', 'appointments', 'voice_sessions', 'employees', 'services', 'resources']);

// PK column for each versioned table (post-2026-05-12 PK rename sprint —
// CODING_STANDARDS.md ID convention). Used to build dynamic SQL where the
// table name is parameterized but the WHERE/JOIN needs the right PK column.
const PK_COLUMN_BY_TABLE: Record<string, string> = {
  customers: 'customer_id',
  appointments: 'appointment_id',
  voice_sessions: 'voice_session_id',
  employees: 'employee_id',
  services: 'service_id',
  resources: 'resource_id',
};
const ChangeSourceSchema = z.enum(['local', 'hubspot', 'jobber', 'square', 'servicetitan', 'voice_call', 'system', 'api']);

/**
 * Create a standardized error response with the 5 Ws:
 * - Who: tenant_id, user context
 * - What: operation that failed
 * - When: timestamp of the error
 * - Where: endpoint/resource affected
 * - Why: reason for the failure
 */
function createErrorResponse(params: {
  who?: string;
  what: string;
  where: string;
  why: string;
  code: string;
  details?: unknown;
}) {
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

const RestoreFieldsSchema = z.object({
  source_version: z.number().int().min(1),
  fields: z.array(z.string().min(1)).min(1),
  restored_by: z.string().optional(),
  change_source: ChangeSourceSchema.optional(),
});

const CopyFieldsSchema = z.object({
  source_record_id: z.string().uuid(),
  target_record_id: z.string().uuid(),
  fields: z.array(z.string().min(1)).min(1),
  copied_by: z.string().optional(),
  change_source: ChangeSourceSchema.optional(),
});

const SoftDeleteSchema = z.object({
  deleted_by: z.string().optional(),
  change_source: ChangeSourceSchema.optional(),
});

/**
 * Validate table name and return error response if invalid.
 * Returns null if valid, error response object if invalid.
 */
function validateTable(
  table: string,
  tenantId: string,
  operation: string,
  endpoint: string
): ReturnType<typeof createErrorResponse> | null {
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
 * Validate request body against a Zod schema and return error response if invalid.
 */
function validateBody<T>(
  schema: z.ZodSchema<T>,
  body: unknown,
  tenantId: string,
  operation: string,
  endpoint: string,
  hint: string
): { error: ReturnType<typeof createErrorResponse> } | { data: T } {
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

export function registerVersionHistoryRoutes(
  app: AppFastifyInstance,
  pool: Pool,
  withTenantClient: <T>(tenantId: string, fn: (client: PoolClient) => Promise<T>) => Promise<T>
) {
  /**
   * GET /records/:table/:recordId/history
   * Get full version history for a record
   */
  app.get('/records/:table/:recordId/history', withHandler(async (req: AppRequest, reply) => {
    const tenantId = requireTenantId(req, reply);
    if (!tenantId) return;

    const { table, recordId } = req.params as { table: string; recordId: string };
    const endpoint = `/records/${table}/${recordId}/history`;

    const tableError = validateTable(table, tenantId, 'Get record history', endpoint);
    if (tableError) return reply.status(400).send(tableError);

    const history = await withTenantClient(tenantId, async (client) => {
      // Get record info including soft delete status
      const pkColumn = PK_COLUMN_BY_TABLE[table];
      const recordResult = await client.query(
        `SELECT is_deleted, deleted_at, deleted_by FROM ${table}
         WHERE ${pkColumn} = $1 AND tenant_id = $2`,
        [recordId, tenantId]
      );

      const record = recordResult.rows[0];

      // Get all versions
      const versionsResult = await client.query<RecordHistoryRow>(
        `SELECT * FROM get_record_history($1, $2, $3)`,
        [tenantId, table, recordId]
      );

      const versions = versionsResult.rows.map(row => ({
        record_version_id: row.record_version_id,
        tenant_id: tenantId,
        table_name: table as VersionedTable,
        record_id: recordId,
        version_number: row.version_number,
        data: row.data,
        changed_fields: row.changed_fields || [],
        previous_values: row.previous_values || {},
        change_type: row.change_type,
        change_source: row.change_source as ChangeSource,
        changed_by: row.changed_by,
        change_summary: row.change_summary,
        changed_at: row.changed_at,
      }));

      return {
        record_id: recordId,
        table_name: table as VersionedTable,
        current_version: versions.length > 0 ? versions[0].version_number : 0,
        versions,
        is_deleted: record?.is_deleted || false,
        deleted_at: record?.deleted_at || null,
        deleted_by: record?.deleted_by || null,
      } as RecordHistoryResponse;
    });

    return reply.send(history);
  }, 'Failed to get record history'));

  /**
   * GET /records/:table/:recordId/version/:versionNumber
   * Get a specific version of a record
   */
  app.get('/records/:table/:recordId/version/:versionNumber', withHandler(async (req: AppRequest, reply) => {
    const tenantId = requireTenantId(req, reply);
    if (!tenantId) return;

    const { table, recordId, versionNumber } = req.params as {
      table: string;
      recordId: string;
      versionNumber: string;
    };
    const endpoint = `/records/${table}/${recordId}/version/${versionNumber}`;

    const tableError = validateTable(table, tenantId, 'Get specific version', endpoint);
    if (tableError) return reply.status(400).send(tableError);

    const version = await withTenantClient(tenantId, async (client) => {
      const result = await client.query<RecordVersion>(
        `SELECT * FROM record_versions
         WHERE tenant_id = $1 AND table_name = $2 AND record_id = $3 AND version_number = $4`,
        [tenantId, table, recordId, parseInt(versionNumber)]
      );
      return result.rows[0] || null;
    });

    if (!version) {
      return reply.status(404).send(createErrorResponse({
        who: tenantId,
        what: 'Get specific version',
        where: `/records/${table}/${recordId}/version/${versionNumber}`,
        why: `Version ${versionNumber} not found for record ${recordId} in table ${table}`,
        code: 'VERSION_NOT_FOUND',
      }));
    }

    return reply.send(version);
  }, 'Failed to get record version'));

  /**
   * GET /records/:table/:recordId/compare/:versionA/:versionB
   * Compare two versions of a record
   */
  app.get('/records/:table/:recordId/compare/:versionA/:versionB', withHandler(async (req: AppRequest, reply) => {
    const tenantId = requireTenantId(req, reply);
    if (!tenantId) return;

    const { table, recordId, versionA, versionB } = req.params as {
      table: string;
      recordId: string;
      versionA: string;
      versionB: string;
    };
    const endpoint = `/records/${table}/${recordId}/compare/${versionA}/${versionB}`;

    const tableError = validateTable(table, tenantId, 'Compare versions', endpoint);
    if (tableError) return reply.status(400).send(tableError);

    const comparison = await withTenantClient(tenantId, async (client) => {
      const result = await client.query<VersionComparison>(
        `SELECT * FROM compare_versions($1, $2, $3, $4, $5)`,
        [tenantId, table, recordId, parseInt(versionA), parseInt(versionB)]
      );
      return result.rows;
    });

    return reply.send({
      record_id: recordId,
      table_name: table,
      version_a: parseInt(versionA),
      version_b: parseInt(versionB),
      differences: comparison,
    });
  }, 'Failed to compare versions'));

  /**
   * POST /records/:table/:recordId/restore-fields
   * Restore specific fields from a historical version
   */
  app.post('/records/:table/:recordId/restore-fields', withHandler(async (req: AppRequest, reply) => {
    const tenantId = requireTenantId(req, reply);
    if (!tenantId) return;

    const { table, recordId } = req.params as { table: string; recordId: string };
    const endpoint = `/records/${table}/${recordId}/restore-fields`;
    const operation = 'Restore fields from version';

    const tableError = validateTable(table, tenantId, operation, endpoint);
    if (tableError) return reply.status(400).send(tableError);

    const bodyResult = validateBody(
      RestoreFieldsSchema,
      req.body,
      tenantId,
      operation,
      endpoint,
      'source_version (number) and fields (non-empty array) are required'
    );
    if ('error' in bodyResult) return reply.status(400).send(bodyResult.error);

    const { source_version, fields, restored_by, change_source } = bodyResult.data;

    const result = await withTenantClient(tenantId, async (client) => {
      // Set change source for audit trail
      await client.query(`SELECT set_config('app.change_source', $1, true)`, [change_source || 'local']);
      await client.query(`SELECT set_config('app.changed_by', $1, true)`, [restored_by || 'user']);

      const restoreResult = await client.query<{ data: Record<string, unknown> }>(
        `SELECT restore_fields_from_version($1, $2, $3, $4, $5, $6, $7) as data`,
        [tenantId, table, recordId, source_version, fields, restored_by || 'user', change_source || 'local']
      );

      return restoreResult.rows[0]?.data || null;
    });

    if (!result) {
      return reply.status(500).send(createErrorResponse({
        who: tenantId,
        what: 'Restore fields from version',
        where: `/records/${table}/${recordId}/restore-fields`,
        why: `Failed to restore fields from version ${source_version}. The version or record may not exist.`,
        code: 'RESTORE_FAILED',
      }));
    }

    logEvent(req, 'fields_restored', {
      table_name: table,
      record_id: recordId,
      source_version,
      fields,
    });

    return reply.send({
      success: true,
      data: result,
      message: `Restored ${fields.length} field(s) from version ${source_version}`,
    });
  }, 'Failed to restore fields'));

  /**
   * POST /records/:table/:recordId/soft-delete
   * Soft delete a record
   */
  app.post('/records/:table/:recordId/soft-delete', withHandler(async (req: AppRequest, reply) => {
    const tenantId = requireTenantId(req, reply);
    if (!tenantId) return;

    const { table, recordId } = req.params as { table: string; recordId: string };
    const endpoint = `/records/${table}/${recordId}/soft-delete`;

    const tableError = validateTable(table, tenantId, 'Soft delete record', endpoint);
    if (tableError) return reply.status(400).send(tableError);

    const parsed = SoftDeleteSchema.safeParse(req.body || {});
    const { deleted_by, change_source } = parsed.success ? parsed.data : { deleted_by: undefined, change_source: undefined };

    const deleted = await withTenantClient(tenantId, async (client) => {
      const result = await client.query<{ deleted: boolean }>(
        `SELECT soft_delete_record($1, $2, $3, $4, $5) as deleted`,
        [tenantId, table, recordId, deleted_by || 'user', change_source || 'local']
      );
      return result.rows[0]?.deleted || false;
    });

    if (!deleted) {
      return reply.status(404).send(createErrorResponse({
        who: tenantId,
        what: 'Soft delete record',
        where: `/records/${table}/${recordId}/soft-delete`,
        why: `Record ${recordId} not found in table ${table}, or already deleted`,
        code: 'RECORD_NOT_FOUND',
      }));
    }

    logEvent(req, 'record_soft_deleted', {
      table_name: table,
      record_id: recordId,
    });

    return reply.send({ success: true, message: 'Record deleted' });
  }, 'Failed to delete record'));

  /**
   * POST /records/:table/:recordId/restore
   * Restore a soft-deleted record
   */
  app.post('/records/:table/:recordId/restore', withHandler(async (req: AppRequest, reply) => {
    const tenantId = requireTenantId(req, reply);
    if (!tenantId) return;

    const { table, recordId } = req.params as { table: string; recordId: string };
    const endpoint = `/records/${table}/${recordId}/restore`;

    const tableError = validateTable(table, tenantId, 'Restore deleted record', endpoint);
    if (tableError) return reply.status(400).send(tableError);

    const { restored_by, change_source } = (req.body || {}) as {
      restored_by?: string;
      change_source?: ChangeSource;
    };

    const restored = await withTenantClient(tenantId, async (client) => {
      const result = await client.query<{ restored: boolean }>(
        `SELECT restore_deleted_record($1, $2, $3, $4, $5) as restored`,
        [tenantId, table, recordId, restored_by || 'user', change_source || 'local']
      );
      return result.rows[0]?.restored || false;
    });

    if (!restored) {
      return reply.status(404).send(createErrorResponse({
        who: tenantId,
        what: 'Restore deleted record',
        where: `/records/${table}/${recordId}/restore`,
        why: `Record ${recordId} not found in table ${table}, or record is not deleted`,
        code: 'RECORD_NOT_DELETED',
      }));
    }

    logEvent(req, 'record_restored', {
      table_name: table,
      record_id: recordId,
    });

    return reply.send({ success: true, message: 'Record restored' });
  }, 'Failed to restore record'));

  /**
   * GET /records/:table/deleted
   * Get list of soft-deleted records for a table
   */
  app.get('/records/:table/deleted', withHandler(async (req: AppRequest, reply) => {
    const tenantId = requireTenantId(req, reply);
    if (!tenantId) return;

    const { table } = req.params as { table: string };
    const { limit, offset } = req.query as { limit?: string; offset?: string };

    const tableError = validateTable(table, tenantId, 'Get deleted records', `/records/${table}/deleted`);
    if (tableError) return reply.status(400).send(tableError);

    const limitNum = Math.min(parseInt(limit || '50'), 200);
    const offsetNum = parseInt(offset || '0');

    const response = await withTenantClient(tenantId, async (client) => {
      // Get count
      const countResult = await client.query(
        `SELECT COUNT(*) as count FROM ${table} WHERE tenant_id = $1 AND is_deleted = true`,
        [tenantId]
      );
      const total = parseInt(countResult.rows[0]?.count || '0');

      // Each versioned table has its own renamed PK column post-pilot-sprint
      // (customers→customer_id, appointments→appointment_id, etc); voice_sessions
      // uses voice_session_id. Map at SQL build time so the SELECT uses the
      // right column and aliases it back to `id` for the consumer.
      const pkColumn = (
        { customers: 'customer_id', appointments: 'appointment_id', voice_sessions: 'voice_session_id',
          employees: 'employee_id', services: 'service_id', resources: 'resource_id' } as Record<string, string>
      )[table];
      const result = await client.query<DeletedRecord>(
        `SELECT
          t.${pkColumn} AS record_id,
          t.tenant_id,
          '${table}' as table_name,
          t.name,
          t.phone,
          ${table === 'customers' ? 't.email' : 'NULL as email'},
          t.deleted_at,
          t.deleted_by,
          (SELECT COUNT(*) FROM record_versions rv WHERE rv.record_id = t.${pkColumn} AND rv.table_name = '${table}') as version_count,
          (SELECT data FROM record_versions rv WHERE rv.record_id = t.${pkColumn} AND rv.table_name = '${table}'
           ORDER BY version_number DESC LIMIT 1) as last_data
        FROM ${table} t
        WHERE t.tenant_id = $1 AND t.is_deleted = true
        ORDER BY t.deleted_at DESC
        LIMIT $2 OFFSET $3`,
        [tenantId, limitNum, offsetNum]
      );

      return {
        records: result.rows,
        total,
      } as DeletedRecordsResponse;
    });

    return reply.send(response);
  }, 'Failed to get deleted records'));

  /**
   * POST /records/:table/copy-fields
   * Copy fields from one record to another (including from deleted records)
   */
  app.post('/records/:table/copy-fields', withHandler(async (req: AppRequest, reply) => {
    const tenantId = requireTenantId(req, reply);
    if (!tenantId) return;

    const { table } = req.params as { table: string };
    const endpoint = `/records/${table}/copy-fields`;
    const operation = 'Copy fields between records';

    const tableError = validateTable(table, tenantId, operation, endpoint);
    if (tableError) return reply.status(400).send(tableError);

    const bodyResult = validateBody(
      CopyFieldsSchema,
      req.body,
      tenantId,
      operation,
      endpoint,
      'source_record_id, target_record_id (UUIDs), and fields (non-empty array) are required'
    );
    if ('error' in bodyResult) return reply.status(400).send(bodyResult.error);

    const { source_record_id, target_record_id, fields, copied_by, change_source } = bodyResult.data;

    const result = await withTenantClient(tenantId, async (client) => {
      const copyResult = await client.query<{ data: Record<string, unknown> }>(
        `SELECT copy_fields_between_records($1, $2, $3, $4, $5, $6, $7) as data`,
        [tenantId, table, source_record_id, target_record_id, fields, copied_by || 'user', change_source || 'local']
      );
      return copyResult.rows[0]?.data || null;
    });

    if (!result) {
      return reply.status(500).send(createErrorResponse({
        who: tenantId,
        what: 'Copy fields between records',
        where: `/records/${table}/copy-fields`,
        why: `Failed to copy fields from ${source_record_id} to ${target_record_id}. One or both records may not exist.`,
        code: 'COPY_FAILED',
      }));
    }

    logEvent(req, 'fields_copied', {
      table_name: table,
      source_record_id,
      target_record_id,
      fields,
    });

    return reply.send({
      success: true,
      data: result,
      message: `Copied ${fields.length} field(s) from ${source_record_id} to ${target_record_id}`,
    });
  }, 'Failed to copy fields'));

  /**
   * GET /records/recent-changes
   * Get recent changes across all versioned tables
   */
  app.get('/records/recent-changes', withHandler(async (req: AppRequest, reply) => {
    const tenantId = requireTenantId(req, reply);
    if (!tenantId) return;

    const { limit, offset, table, change_type, change_source } = req.query as {
      limit?: string;
      offset?: string;
      table?: string;
      change_type?: string;
      change_source?: string;
    };

    const limitNum = Math.min(parseInt(limit || '50'), 200);
    const offsetNum = parseInt(offset || '0');

    const response = await withTenantClient(tenantId, async (client) => {
      let whereClause = 'WHERE rv.tenant_id = $1';
      const params: (string | number)[] = [tenantId];
      let paramIndex = 2;

      if (table) {
        whereClause += ` AND rv.table_name = $${paramIndex}`;
        params.push(table);
        paramIndex++;
      }

      if (change_type) {
        whereClause += ` AND rv.change_type = $${paramIndex}`;
        params.push(change_type);
        paramIndex++;
      }

      if (change_source) {
        whereClause += ` AND rv.change_source = $${paramIndex}`;
        params.push(change_source);
        paramIndex++;
      }

      // Get count
      const countResult = await client.query(
        `SELECT COUNT(*) as count FROM record_versions rv ${whereClause}`,
        params
      );
      const total = parseInt(countResult.rows[0]?.count || '0');

      // Get changes
      params.push(limitNum, offsetNum);
      const result = await client.query<RecentChange>(
        `SELECT
          rv.record_version_id,
          rv.tenant_id,
          rv.table_name,
          rv.record_id,
          rv.version_number,
          rv.change_type,
          rv.change_source,
          rv.changed_by,
          rv.change_summary,
          rv.changed_at,
          rv.data->>'name' as record_name,
          rv.data->>'phone' as record_phone
        FROM record_versions rv
        ${whereClause}
        ORDER BY rv.changed_at DESC
        LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
        params
      );

      return {
        changes: result.rows,
        total,
      } as RecentChangesResponse;
    });

    return reply.send(response);
  }, 'Failed to get recent changes'));

  /**
   * GET /records/:table/:recordId/restore-preview
   * Get preview of all fields with their historical values for restoration UI
   */
  app.get('/records/:table/:recordId/restore-preview', withHandler(async (req: AppRequest, reply) => {
    const tenantId = requireTenantId(req, reply);
    if (!tenantId) return;

    const { table, recordId } = req.params as { table: string; recordId: string };
    const endpoint = `/records/${table}/${recordId}/restore-preview`;

    const tableError = validateTable(table, tenantId, 'Get restore preview', endpoint);
    if (tableError) return reply.status(400).send(tableError);

    const preview = await withTenantClient(tenantId, async (client) => {
      const pkColumn = PK_COLUMN_BY_TABLE[table];
      // Get current record
      const currentResult = await client.query(
        `SELECT to_jsonb(t.*) as data FROM ${table} t WHERE ${pkColumn} = $1 AND tenant_id = $2`,
        [recordId, tenantId]
      );

      if (currentResult.rows.length === 0) {
        return null;
      }

      const currentData = currentResult.rows[0].data;

      // Get all versions
      const versionsResult = await client.query<RecordVersion>(
        `SELECT version_number, data, changed_at, change_source
         FROM record_versions
         WHERE tenant_id = $1 AND table_name = $2 AND record_id = $3
         ORDER BY version_number DESC`,
        [tenantId, table, recordId]
      );

      // Build field options
      const fields: Record<string, unknown> = {};
      const excludeFields = ['id', 'tenant_id', 'created_at', 'updated_at', 'is_deleted', 'deleted_at', 'deleted_by'];

      // Get all unique fields from current and historical data
      const allFields = new Set<string>();
      Object.keys(currentData).forEach(k => allFields.add(k));
      versionsResult.rows.forEach(v => {
        Object.keys(v.data).forEach(k => allFields.add(k));
      });

      for (const field of allFields) {
        if (excludeFields.includes(field)) continue;

        fields[field] = {
          field,
          current_value: currentData[field],
          versions: versionsResult.rows.map(v => ({
            version_number: v.version_number,
            value: v.data[field],
            changed_at: v.changed_at,
            change_source: v.change_source,
          })),
        };
      }

      return {
        record_id: recordId,
        table_name: table,
        fields: Object.values(fields),
      };
    });

    if (!preview) {
      return reply.status(404).send(createErrorResponse({
        who: tenantId,
        what: 'Get restore preview',
        where: `/records/${table}/${recordId}/restore-preview`,
        why: `Record ${recordId} not found in table ${table}`,
        code: 'RECORD_NOT_FOUND',
      }));
    }

    return reply.send(preview);
  }, 'Failed to get restore preview'));
}
