/**
 * DatabaseService - Adapter layer for ai-sec database operations.
 *
 * Bridges the gap between ai-sec's withTenantClient(pool) pattern and
 * the DatabaseService interface expected by migrated communications/reminders services.
 *
 * Pattern: Repository with lazy pool initialization.
 */

import { Pool, type PoolClient } from 'pg';
import type {
  ConsentRecord,
  OptOutRecord,
  ReminderSchedule,
  ReminderData,
  AppointmentForReminder,
} from '../types/index.js';

// ── Pool Singleton ───────────────────────────────────────────────────

let _pool: Pool | null = null;

/**
 * Deadlock-prevention session settings applied to every pool connection.
 *
 * Without these a single deadlocked connection can hold locks indefinitely
 * and exhaust the pool (default 10 connections), blocking every other
 * request. Applied via the per-connection `options` parameter so they take
 * effect for every backend pg session this pool spawns — both for the
 * Fastify route surface and the reminder / communications workers.
 *
 *   - statement_timeout: kill queries that run too long
 *   - lock_timeout: fail fast if a row/table lock is contested
 *   - idle_in_transaction_session_timeout: close idle txns holding locks
 */
const POOL_TIMEOUT_OPTIONS =
  '-c statement_timeout=30000 -c lock_timeout=10000 -c idle_in_transaction_session_timeout=60000';

/**
 * Get or create the database pool. Lazy singleton; the same instance is
 * shared by Fastify routes, the reminder scheduler, and the communications
 * service so they all benefit from the same safety timeouts.
 */
export function getPool(): Pool {
  if (!_pool) {
    const isLocal = process.env.DATABASE_URL?.includes('localhost') || !process.env.DATABASE_URL;
    _pool = isLocal
      ? new Pool({
          user: 'postgres',
          host: 'localhost',
          database: 'postgres',
          password: 'postgres',
          port: 5433,
          max: 10,
          options: POOL_TIMEOUT_OPTIONS,
        })
      : new Pool({
          connectionString: process.env.DATABASE_URL,
          ssl: { rejectUnauthorized: false },
          max: 10,
          options: POOL_TIMEOUT_OPTIONS,
        });
  }
  return _pool;
}

/**
 * Close the pool (for graceful shutdown).
 */
export async function closePool(): Promise<void> {
  if (_pool) {
    await _pool.end();
    _pool = null;
  }
}

/**
 * Set tenant context for RLS.
 */
async function setTenantContext(client: PoolClient, tenantId: string | number): Promise<void> {
  await client.query('SELECT set_tenant_context($1::UUID)', [tenantId.toString()]);
}

/**
 * Clear tenant context after operation.
 */
async function clearTenantContext(client: PoolClient): Promise<void> {
  await client.query("SELECT set_config('app.current_tenant_id', '', false)").catch(() => {});
}

// ── withTenantClient Factory ─────────────────────────────────────────

/**
 * Per-request RLS scope. The shape route handlers consume.
 */
export type WithTenantClient = <T>(
  tenantId: string,
  fn: (client: PoolClient) => Promise<T>
) => Promise<T>;

/**
 * Build the `withTenantClient` helper that every Fastify route uses to
 * acquire a tenant-scoped DB client. Verifies the tenant exists, sets the
 * `app.current_tenant_id` GUC for the duration of the callback, and clears
 * it on the way out.
 *
 * Curried over the pool so tests can inject a fixture pool while production
 * binds against `getPool()`. Routes treat the returned function as opaque.
 *
 * Throws an error tagged `code: 'TENANT_NOT_FOUND'` / `statusCode: 404` for
 * an unknown tenant — the global error handler in src/index.ts maps that
 * to a 404 response.
 */
export function createWithTenantClient(pool: Pool): WithTenantClient {
  return async function withTenantClient<T>(
    tenantId: string,
    fn: (client: PoolClient) => Promise<T>
  ): Promise<T> {
    const client = await pool.connect();
    try {
      // Validate tenant exists (before setting context, so RLS doesn't block the check)
      const tenantCheck = await client.query('SELECT tenant_id FROM tenants WHERE tenant_id = $1', [tenantId]);
      if (tenantCheck.rows.length === 0) {
        const err = new Error(`Tenant ${tenantId} not found`);
        (err as unknown as { statusCode: number }).statusCode = 404;
        (err as unknown as { code: string }).code = 'TENANT_NOT_FOUND';
        throw err;
      }
      await setTenantContext(client, tenantId);
      return await fn(client);
    } finally {
      await clearTenantContext(client);
      client.release();
    }
  };
}

// ── DatabaseService Interface ────────────────────────────────────────

/**
 * Interface expected by ReminderService and ConsentService.
 * Abstracts database operations for testability and migration compatibility.
 */
export interface DatabaseService {
  // Reminder operations
  createReminderSchedule(data: ReminderData): Promise<ReminderSchedule>;
  getReminderSchedule(id: string): Promise<ReminderSchedule | null>;
  updateReminderSchedule(id: string, data: Partial<ReminderSchedule>): Promise<ReminderSchedule | null>;
  getReminderSchedulesByTenant(tenantId: string, status?: string): Promise<ReminderSchedule[]>;
  getReminderSchedulesByAppointment(appointmentId: string, tenantId: string): Promise<ReminderSchedule[]>;
  getDueReminders(): Promise<ReminderSchedule[]>;

  // Appointment operations
  getAppointmentById(id: string): Promise<AppointmentForReminder | null>;

  // Consent operations
  createConsentRecord(data: Omit<ConsentRecord, 'consent_record_id'>): Promise<ConsentRecord>;
  getConsentRecordsByCustomer(
    tenantId: string,
    customerEmail?: string,
    customerPhone?: string
  ): Promise<ConsentRecord[]>;
  getConsentRecordsByTenant(tenantId: string): Promise<ConsentRecord[]>;
  updateConsentRecord(id: number, data: Partial<ConsentRecord>): Promise<ConsentRecord | null>;

  // Opt-out operations
  createOptOutRecord(data: Omit<OptOutRecord, 'optOutRecordId'>): Promise<OptOutRecord>;
  getOptOutRecordsByTenant(tenantId: string): Promise<OptOutRecord[]>;
}

// ── PostgresDatabaseService Implementation ───────────────────────────

/**
 * PostgreSQL implementation of DatabaseService.
 * Uses ai-sec's pool and RLS patterns.
 */
export class PostgresDatabaseService implements DatabaseService {
  private pool: Pool;

  constructor(pool?: Pool) {
    this.pool = pool || getPool();
  }

  // ── Helper ─────────────────────────────────────────────────────────

  private async withTenantClient<T>(
    tenantId: string | number,
    fn: (client: PoolClient) => Promise<T>
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await setTenantContext(client, tenantId);
      return await fn(client);
    } finally {
      await clearTenantContext(client);
      client.release();
    }
  }

  private async withClient<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      return await fn(client);
    } finally {
      client.release();
    }
  }

  // ── Reminder Operations ────────────────────────────────────────────

  async createReminderSchedule(data: ReminderData): Promise<ReminderSchedule> {
    return this.withTenantClient(data.tenant_id, async (client) => {
      const result = await client.query(
        `INSERT INTO reminder_schedules
         (appointment_id, tenant_id, customer_email, customer_phone, reminder_type, scheduled_for, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [
          data.appointment_id,
          data.tenant_id,
          data.customer_email,
          data.customer_phone || null,
          data.reminder_type,
          data.scheduled_for,
          data.status || 'scheduled',
        ]
      );
      return result.rows[0];
    });
  }

  async getReminderSchedule(id: string): Promise<ReminderSchedule | null> {
    return this.withClient(async (client) => {
      const result = await client.query(
        'SELECT * FROM reminder_schedules WHERE reminder_schedule_id = $1',
        [id]
      );
      return result.rows[0] || null;
    });
  }

  async updateReminderSchedule(
    id: string,
    data: Partial<ReminderSchedule>
  ): Promise<ReminderSchedule | null> {
    const updates: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    if (data.status !== undefined) {
      updates.push(`status = $${paramIndex++}`);
      values.push(data.status);
    }
    if (data.sent_at !== undefined) {
      updates.push(`sent_at = $${paramIndex++}`);
      values.push(data.sent_at);
    }
    if (data.error !== undefined) {
      updates.push(`error = $${paramIndex++}`);
      values.push(data.error);
    }
    // Retry-policy fields (migration 20260514000000). The worker writes
    // these on a transient failure to schedule the next attempt; nothing
    // outside the worker should be touching them, but the SET clause
    // accepts them to keep the API symmetric with the ReminderSchedule
    // type.
    if (data.retry_count !== undefined) {
      updates.push(`retry_count = $${paramIndex++}`);
      values.push(data.retry_count);
    }
    if (data.next_retry_at !== undefined) {
      updates.push(`next_retry_at = $${paramIndex++}`);
      values.push(data.next_retry_at);
    }

    if (updates.length === 0) {
      return this.getReminderSchedule(id);
    }

    updates.push(`updated_at = NOW()`);
    values.push(id);

    return this.withClient(async (client) => {
      const result = await client.query(
        `UPDATE reminder_schedules SET ${updates.join(', ')} WHERE reminder_schedule_id = $${paramIndex} RETURNING *`,
        values
      );
      return result.rows[0] || null;
    });
  }

  async getReminderSchedulesByTenant(
    tenantId: string,
    status?: string
  ): Promise<ReminderSchedule[]> {
    return this.withTenantClient(tenantId, async (client) => {
      if (status) {
        const result = await client.query(
          'SELECT * FROM reminder_schedules WHERE tenant_id = $1 AND status = $2 ORDER BY scheduled_for',
          [tenantId, status]
        );
        return result.rows;
      }
      const result = await client.query(
        'SELECT * FROM reminder_schedules WHERE tenant_id = $1 ORDER BY scheduled_for',
        [tenantId]
      );
      return result.rows;
    });
  }

  async getReminderSchedulesByAppointment(
    appointmentId: string,
    tenantId: string
  ): Promise<ReminderSchedule[]> {
    return this.withTenantClient(tenantId, async (client) => {
      const result = await client.query(
        'SELECT * FROM reminder_schedules WHERE appointment_id = $1 AND tenant_id = $2',
        [appointmentId, tenantId]
      );
      return result.rows;
    });
  }

  async getDueReminders(): Promise<ReminderSchedule[]> {
    // The next_retry_at filter holds back rows that failed a previous
    // attempt and are still in their backoff window. A NULL value means
    // either the original attempt (no prior failure) or — for rows
    // pre-dating migration 20260514000000 — the column didn't exist yet.
    // Either way, NULL is "pick it up if scheduled_for is due."
    return this.withClient(async (client) => {
      const result = await client.query(
        `SELECT * FROM reminder_schedules
         WHERE status = 'scheduled'
           AND scheduled_for <= NOW()
           AND (next_retry_at IS NULL OR next_retry_at <= NOW())
         ORDER BY scheduled_for
         LIMIT 100`
      );
      return result.rows;
    });
  }

  // ── Appointment Operations ─────────────────────────────────────────

  async getAppointmentById(id: string): Promise<AppointmentForReminder | null> {
    return this.withClient(async (client) => {
      const result = await client.query(
        `SELECT
          a.appointment_id as "appointmentId",
          a.tenant_id as "tenantId",
          a.customer_id as "customerId",
          c.email as "customerEmail",
          c.phone as "customerPhone",
          c.name as "customerName",
          s.name as "serviceName",
          e.name as "staffName",
          a.start_time as "dateTime",
          EXTRACT(EPOCH FROM (a.end_time - a.start_time))/60 as "duration",
          a.status,
          a.description as "notes"
        FROM appointments a
        LEFT JOIN customers c ON a.customer_id = c.customer_id
        LEFT JOIN services s ON a.service_id = s.service_id
        LEFT JOIN employees e ON a.employee_id = e.employee_id
        WHERE a.appointment_id = $1 AND a.is_deleted = false`,
        [id]
      );
      return result.rows[0] || null;
    });
  }

  // ── Consent Operations ─────────────────────────────────────────────

  async createConsentRecord(data: Omit<ConsentRecord, 'consent_record_id'>): Promise<ConsentRecord> {
    return this.withTenantClient(data.tenant_id, async (client) => {
      const result = await client.query(
        `INSERT INTO consent_records
         (tenant_id, customer_id, customer_email, customer_phone, consent_type,
          consent_given, consent_date, consent_method, consent_source, ip_address)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING *`,
        [
          data.tenant_id,
          data.customer_id || null,
          data.customer_email || null,
          data.customer_phone || null,
          data.consent_type,
          data.consent_given,
          data.consent_date,
          data.consent_method,
          data.consent_source || null,
          data.ip_address || null,
        ]
      );
      return result.rows[0];
    });
  }

  async getConsentRecordsByCustomer(
    tenantId: string,
    customerEmail?: string,
    customerPhone?: string
  ): Promise<ConsentRecord[]> {
    return this.withTenantClient(tenantId, async (client) => {
      const conditions: string[] = ['tenant_id = $1'];
      const values: unknown[] = [tenantId];
      let paramIndex = 2;

      if (customerEmail) {
        conditions.push(`customer_email = $${paramIndex++}`);
        values.push(customerEmail);
      }
      if (customerPhone) {
        conditions.push(`customer_phone = $${paramIndex++}`);
        values.push(customerPhone);
      }

      const result = await client.query(
        `SELECT * FROM consent_records WHERE ${conditions.join(' AND ')} ORDER BY consent_date DESC`,
        values
      );
      return result.rows;
    });
  }

  async getConsentRecordsByTenant(tenantId: string): Promise<ConsentRecord[]> {
    return this.withTenantClient(tenantId, async (client) => {
      const result = await client.query(
        'SELECT * FROM consent_records WHERE tenant_id = $1 ORDER BY consent_date DESC',
        [tenantId]
      );
      return result.rows;
    });
  }

  async updateConsentRecord(
    id: number,
    data: Partial<ConsentRecord>
  ): Promise<ConsentRecord | null> {
    const updates: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    if (data.revoked_at !== undefined) {
      updates.push(`revoked_at = $${paramIndex++}`);
      values.push(data.revoked_at);
    }
    if (data.revoke_reason !== undefined) {
      updates.push(`revoke_reason = $${paramIndex++}`);
      values.push(data.revoke_reason);
    }
    if (data.consent_given !== undefined) {
      updates.push(`consent_given = $${paramIndex++}`);
      values.push(data.consent_given);
    }

    if (updates.length === 0) {
      return this.withClient(async (client) => {
        const result = await client.query(
          'SELECT * FROM consent_records WHERE consent_record_id = $1',
          [id]
        );
        return result.rows[0] || null;
      });
    }

    updates.push(`updated_at = NOW()`);
    values.push(id);

    return this.withClient(async (client) => {
      const result = await client.query(
        `UPDATE consent_records SET ${updates.join(', ')} WHERE consent_record_id = $${paramIndex} RETURNING *`,
        values
      );
      return result.rows[0] || null;
    });
  }

  // ── Opt-Out Operations ─────────────────────────────────────────────

  async createOptOutRecord(data: Omit<OptOutRecord, 'optOutRecordId'>): Promise<OptOutRecord> {
    return this.withTenantClient(data.tenantId, async (client) => {
      const result = await client.query(
        `INSERT INTO opt_out_records
         (tenant_id, customer_email, customer_phone, opt_out_type, opt_out_date,
          opt_out_method, original_consent_record_id, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING
           opt_out_record_id as "optOutRecordId",
           tenant_id as "tenantId",
           customer_email as "customerEmail",
           customer_phone as "customerPhone",
           opt_out_type as "optOutType",
           opt_out_date as "optOutDate",
           opt_out_method as "optOutMethod",
           original_consent_record_id as "originalConsentRecordId",
           notes,
           created_at as "createdAt"`,
        [
          data.tenantId,
          data.customerEmail || null,
          data.customerPhone || null,
          data.optOutType,
          data.optOutDate,
          data.optOutMethod,
          data.originalConsentRecordId || null,
          data.notes || null,
        ]
      );
      return result.rows[0];
    });
  }

  async getOptOutRecordsByTenant(tenantId: string): Promise<OptOutRecord[]> {
    return this.withTenantClient(tenantId, async (client) => {
      const result = await client.query(
        `SELECT
           opt_out_record_id as "optOutRecordId",
           tenant_id as "tenantId",
           customer_email as "customerEmail",
           customer_phone as "customerPhone",
           opt_out_type as "optOutType",
           opt_out_date as "optOutDate",
           opt_out_method as "optOutMethod",
           original_consent_record_id as "originalConsentRecordId",
           notes,
           created_at as "createdAt"
         FROM opt_out_records WHERE tenant_id = $1 ORDER BY opt_out_date DESC`,
        [tenantId]
      );
      return result.rows;
    });
  }
}

// ── Factory Function ─────────────────────────────────────────────────

/**
 * Create a new DatabaseService instance.
 * Uses the shared pool by default.
 */
export function createDatabaseService(pool?: Pool): DatabaseService {
  return new PostgresDatabaseService(pool);
}

// ── Default Export ───────────────────────────────────────────────────

export default createDatabaseService;
