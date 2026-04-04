import { Pool } from "https://deno.land/x/postgres@v0.17.0/mod.ts";
import { IRepository } from "../core/interfaces.ts";
import { Logger, baseLogger } from "../core/logger.ts";
import type { ResourceCandidate, EmployeeCandidate, ExistingAppointment, TimeWindow } from "../core/scheduling.ts";

// Use DATABASE_URL only — SUPABASE_DB_URL is auto-injected and may use internal networking that hangs
const DB_URL = Deno.env.get("DATABASE_URL") || "postgres://postgres:postgres@localhost:5433/postgres?sslmode=disable";

// Lazy pool — created on first use, not at module load time.
// This prevents the edge function from hanging on boot if the DB is unreachable.
// Pool size of 2 is appropriate for serverless (Supabase edge functions).
const POOL_SIZE = 2;
const CONNECT_TIMEOUT_MS = 5_000;

let _pool: Pool | null = null;
function getPool(): Pool {
  if (!_pool) {
    // Log which DB URL we're connecting to (masked password)
    const maskedUrl = DB_URL.replace(/:([^@]+)@/, ':***@');
    console.error(JSON.stringify({
      event: "db_pool_created",
      db_url: maskedUrl,
      pool_size: POOL_SIZE,
      source: Deno.env.get("DATABASE_URL") ? "DATABASE_URL" : "SUPABASE_DB_URL",
      timestamp: new Date().toISOString(),
    }));
    _pool = new Pool(DB_URL, POOL_SIZE, true);
  }
  return _pool;
}

/** Acquire a pool connection with a timeout to prevent hanging on unreachable DB. */
async function connectWithTimeout(pool: Pool): Promise<any> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CONNECT_TIMEOUT_MS);
  try {
    const client = await Promise.race([
      pool.connect(),
      new Promise<never>((_, reject) => {
        controller.signal.addEventListener("abort", () =>
          reject(new Error(`DB connection timed out after ${CONNECT_TIMEOUT_MS}ms`))
        );
      }),
    ]);
    return client;
  } finally {
    clearTimeout(timeout);
  }
}

export class PostgresRepository implements IRepository {
  private logger: Logger = baseLogger;

  private get pool(): Pool {
    return getPool();
  }

  constructor() {
    // Pool is created lazily on first use via the getter
  }

  setLogger(logger: Logger) {
    this.logger = logger;
  }

  async close() {
    if (_pool) {
      await _pool.end();
      _pool = null;
    }
  }

  /** Transient Postgres error codes that are safe to retry */
  private static RETRYABLE_CODES = new Set([
    '08000', // connection_exception
    '08003', // connection_does_not_exist
    '08006', // connection_failure
    '57P01', // admin_shutdown
    '57P03', // cannot_connect_now
    '40001', // serialization_failure
    '40P01', // deadlock_detected
  ]);

  private async withClient<T>(tenantId: string | null, fn: (client: any) => Promise<T>): Promise<T> {
    return this.withClientRetry(tenantId, fn, 2);
  }

  private async withClientRetry<T>(tenantId: string | null, fn: (client: any) => Promise<T>, retriesLeft: number): Promise<T> {
    const client = await connectWithTimeout(this.pool);
    try {
      if (tenantId) {
        // BUG-026: Verify tenant context was set successfully
        await client.queryArray(`SELECT set_tenant_context($1::UUID)`, [tenantId]);
        const verify = await client.queryObject<{ val: string }>(
          "SELECT current_setting('app.current_tenant_id', true) as val"
        );
        if (!verify.rows[0]?.val || verify.rows[0]?.val !== tenantId) {
          throw new Error(`Failed to set tenant context for ${tenantId}`);
        }
      }
      return await fn(client);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      const pgCode = (error as any).code || (error as any).fields?.code;

      // Retry on transient errors (connection dropped, deadlock, etc.)
      if (retriesLeft > 0 && pgCode && PostgresRepository.RETRYABLE_CODES.has(pgCode)) {
        console.error(JSON.stringify({
          event: "db_operation_retrying",
          error_message: error.message,
          pg_code: pgCode,
          retries_left: retriesLeft,
          tenantId,
          timestamp: new Date().toISOString(),
        }));
        client.release();
        await new Promise(r => setTimeout(r, 200)); // brief backoff
        return this.withClientRetry(tenantId, fn, retriesLeft - 1);
      }

      console.error(JSON.stringify({
        event: "db_operation_failed",
        error_message: error.message,
        error_name: error.name,
        pg_code: pgCode || null,
        tenantId,
        retries_left: retriesLeft,
        db_url_source: Deno.env.get("SUPABASE_DB_URL") ? "SUPABASE_DB_URL" : "DATABASE_URL",
        timestamp: new Date().toISOString(),
      }));
      this.logger.error({ err, tenantId }, "Database operation failed");
      throw err;
    } finally {
      client.release();
    }
  }

  async ping() {
    return this.withClient(null, async (c) => {
      await c.queryArray("SELECT 1");
    });
  }

  async findCustomerByPhone(tenantId: string, phone: string, logger: Logger) {
    logger.info({ phone }, "Looking up customer by phone");
    return this.withClient(tenantId, async (c) => {
      const res = await c.queryObject<{ id: string; name: string }>(
        "SELECT id, name FROM customers WHERE tenant_id = $1 AND phone = $2 AND (is_deleted IS NULL OR is_deleted = false)",
        [tenantId, phone]
      );
      return res.rows[0] || null;
    });
  }

  async findTenantByPhone(phone: string, logger: Logger): Promise<{ id: string; name: string } | null> {
    logger.info({ phone }, "Looking up tenant by inbound phone");
    // Special case: for tenant lookup, we use null for tenantId in withClient because we don't have it yet
    return this.withClient(null, async (c) => {
      const res = await c.queryObject<{ id: string; name: string }>(
        "SELECT id, name FROM tenants WHERE inbound_phone = $1",
        [phone]
      );
      return res.rows[0] || null;
    });
  }


  async createCustomer(tenantId: string, phone: string, name: string, logger: Logger) {
    logger.info({ phone, name }, "Creating new customer");
    return this.withClient(tenantId, async (c) => {
      const res = await c.queryObject<{ id: string }>(
        "INSERT INTO customers (tenant_id, phone, name) VALUES ($1, $2, $3) RETURNING id",
        [tenantId, phone, name]
      );
      if (!res.rows[0]) throw new Error("INSERT INTO customers returned no row");
      return res.rows[0].id;
    });
  }

  async getRecentSummaries(customerId: string, tenantId: string, logger: Logger, limit = 3) {
    logger.info({ customerId }, "Fetching recent summaries");
    return this.withClient(tenantId, async (c) => {
      const res = await c.queryObject<{ summary: string; created_at: string }>(
        "SELECT summary, created_at FROM call_summaries WHERE customer_id = $1 ORDER BY created_at DESC LIMIT $2",
        [customerId, limit]
      );
      return res.rows;
    });
  }

  async checkOverlap(resourceId: string, tenantId: string, start: string, end: string, logger: Logger) {
    logger.info({ resourceId, start, end }, "Checking for overlapping appointments");
    return this.withClient(tenantId, async (c) => {
      const res = await c.queryObject<{ count: string }>(
        "SELECT count(*) FROM appointments WHERE resource_id = $1 AND status = 'scheduled' AND (is_deleted IS NULL OR is_deleted = false) AND start_time < $2 AND end_time > $3",
        [resourceId, end, start]
      );
      return parseInt(res.rows[0].count) > 0;
    });
  }

  async checkAvailabilityWithTz(
    tenantId: string,
    resourceId: string,
    startTime: string,
    endTime: string,
    logger: Logger,
  ): Promise<{ available: boolean; tenant_timezone: string; local_start: string; local_end: string }> {
    logger.info({ tenantId, resourceId, startTime, endTime }, "Checking availability with timezone via RPC");
    return this.withClient(tenantId, async (c) => {
      const res = await c.queryObject<{
        available: boolean;
        tenant_timezone: string;
        local_start: string;
        local_end: string;
      }>(
        "SELECT * FROM check_availability_with_tz($1, $2, $3::timestamptz, $4::timestamptz)",
        [tenantId, resourceId, startTime, endTime]
      );
      if (!res.rows[0]) {
        throw new Error("check_availability_with_tz returned no result");
      }
      return res.rows[0];
    });
  }

  async getSchedulingResources(tenant_id: string, logger: Logger): Promise<ResourceCandidate[]> {
    logger.info({ tenantId: tenant_id }, "Loading scheduling resources");
    return this.withClient(tenant_id, async (c) => {
      // We combine explicit 'capabilities' from the resource table
      // with capabilities derived from service-resource mappings
      const res = await c.queryObject<{ id: string; capabilities: string[] }>(
        `SELECT r.id, 
                ARRAY(
                  SELECT DISTINCT unnest(
                    r.capabilities || 
                    COALESCE(array_agg(DISTINCT cap) FILTER (WHERE cap IS NOT NULL), '{}')
                  )
                ) as capabilities
         FROM resources r
         LEFT JOIN service_resource sr ON r.id = sr.resource_id
         LEFT JOIN services s ON sr.service_id = s.id
         LEFT JOIN LATERAL unnest(s.required_resources) cap ON true
         WHERE r.tenant_id = $1 AND r.is_active = true AND (r.is_deleted IS NULL OR r.is_deleted = false)
         GROUP BY r.id, r.capabilities`,
        [tenant_id],
      );
      return res.rows.map((row) => ({
        id: row.id,
        capabilities: row.capabilities,
      }));
    });
  }

  async getSchedulingEmployees(tenantId: string, logger: Logger): Promise<EmployeeCandidate[]> {
    logger.info({ tenantId }, "Loading scheduling employees");
    return this.withClient(tenantId, async (c) => {
      const res = await c.queryObject<{ id: string; skills: string[] }>(
        "SELECT id, skills FROM employees WHERE tenant_id = $1 AND is_active = true AND (is_deleted IS NULL OR is_deleted = false)",
        [tenantId],
      );
      return res.rows.map((row) => ({
        id: row.id.toString(), // id is SERIAL (integer) in migrations
        skills: row.skills || [],
        onShift: true, // For now, everyone active is on shift
      }));
    });
  }

  async getExistingAppointments(tenantId: string, window: TimeWindow, logger: Logger): Promise<ExistingAppointment[]> {
    logger.info({ tenantId, window }, "Loading existing appointments for scheduling window");
    return this.withClient(tenantId, async (c) => {
      const res = await c.queryObject<{
        resource_id: string;
        start_time: string;
        end_time: string;
      }>(
        `SELECT resource_id, start_time, end_time
         FROM appointments
         WHERE tenant_id = $1
           AND status = 'scheduled'
           AND (is_deleted IS NULL OR is_deleted = false)
           AND start_time < $2
           AND end_time > $3`,
        [tenantId, window.to.toISOString(), window.from.toISOString()],
      );

      return res.rows.map((row) => ({
        resourceId: row.resource_id,
        start: new Date(row.start_time),
        end: new Date(row.end_time),
      }));
    });
  }

  async bookAtomic(params: {
    tenantId: string;
    resourceId: string;
    customerId: string;
    startTime: string;
    endTime: string;
    description: string;
    callId: string;
    location?: string;
    employeeId?: string;
  }, logger: Logger) {
    logger.info(params, "Executing atomic booking RPC");
    return this.withClient(params.tenantId, async (c) => {
      const res = await c.queryObject<{ success: boolean; appointment_id: string; error_message: string }>(
        "SELECT * FROM book_appointment_atomic($1, $2, $3, $4, $5, $6, $7, $8, $9)",
        [
          params.tenantId,
          params.resourceId,
          params.customerId,
          params.startTime,
          params.endTime,
          params.description,
          params.callId,
          params.location || null,
          params.employeeId ? parseInt(params.employeeId) : null,
        ]
      );
      return res.rows[0];
    });
  }

  // --- Employee CRUD ---
  async createEmployee(tenantId: string, data: { name: string; skills: string[] }): Promise<number> {
    return this.withClient(tenantId, async (c) => {
      const res = await c.queryObject<{ id: number }>(
        "INSERT INTO employees (tenant_id, name, skills) VALUES ($1, $2, $3) RETURNING id",
        [tenantId, data.name, data.skills]
      );
      if (!res.rows[0]) throw new Error("INSERT INTO employees returned no row");
      return res.rows[0].id;
    });
  }

  async updateEmployee(tenantId: string, id: number, data: { name?: string; skills?: string[]; is_active?: boolean }): Promise<boolean> {
    const fields: string[] = [];
    const vals: any[] = [];
    let i = 1;
    if (data.name !== undefined) { fields.push(`name = $${i++}`); vals.push(data.name); }
    if (data.skills !== undefined) { fields.push(`skills = $${i++}`); vals.push(data.skills); }
    if (data.is_active !== undefined) { fields.push(`is_active = $${i++}`); vals.push(data.is_active); }
    
    if (fields.length === 0) return true;
    vals.push(id);
    vals.push(tenantId);

    return this.withClient(tenantId, async (c) => {
      await c.queryObject(
        `UPDATE employees SET ${fields.join(", ")} WHERE id = $${i} AND tenant_id = $${i+1}`,
        vals
      );
      return true;
    });
  }

  async deleteEmployee(tenantId: string, id: number): Promise<boolean> {
    return this.withClient(tenantId, async (c) => {
      await c.queryArray(
        "UPDATE employees SET is_deleted = true, deleted_at = now() WHERE id = $1 AND tenant_id = $2",
        [id, tenantId]
      );
      return true;
    });
  }

  async getEmployees(tenantId: string, logger: Logger): Promise<any[]> {
    return this.withClient(tenantId, async (c) => {
      const res = await c.queryObject("SELECT * FROM employees WHERE tenant_id = $1 AND (is_deleted IS NULL OR is_deleted = false)", [tenantId]);
      return res.rows;
    });
  }

  async getTenantTimezone(tenantId: string, logger: Logger): Promise<string> {
    return this.withClient(tenantId, async (c) => {
      const res = await c.queryObject<{ timezone: string }>(
        "SELECT COALESCE(timezone, 'America/Chicago') AS timezone FROM tenants WHERE id = $1",
        [tenantId]
      );
      const tz = res.rows[0]?.timezone || "America/Chicago";
      logger.info({ tenantId, timezone: tz }, "Resolved tenant timezone");
      return tz;
    });
  }

  async getEmployeeShifts(tenantId: string, logger: Logger): Promise<Array<{ employee_id: number; day_of_week: number; start_time: string; end_time: string }>> {
    return this.withClient(tenantId, async (c) => {
      const res = await c.queryObject<{ employee_id: number; day_of_week: number; start_time: string; end_time: string }>(
        "SELECT employee_id, day_of_week, start_time::text, end_time::text FROM employee_shifts WHERE tenant_id = $1 AND is_active = true",
        [tenantId]
      );
      return res.rows;
    });
  }

  async getEffectiveShiftsForDate(tenantId: string, date: string, logger: Logger): Promise<Array<{ employee_id: string; start_time: string; end_time: string; is_off: boolean }>> {
    logger.info({ tenantId, date }, "Fetching effective shifts for date (overrides + patterns)");
    return this.withClient(tenantId, async (c) => {
      // Use get_effective_shifts RPC for each active employee on this date
      // Query all employees, then get their effective shift for the single date
      const empRes = await c.queryObject<{ id: string }>(
        "SELECT id::text FROM employees WHERE tenant_id = $1 AND is_active = true AND (is_deleted IS NULL OR is_deleted = false)",
        [tenantId]
      );

      const results: Array<{ employee_id: string; start_time: string; end_time: string; is_off: boolean }> = [];
      for (const emp of empRes.rows) {
        const shiftRes = await c.queryObject<{ start_time: string; end_time: string; is_off: boolean }>(
          "SELECT start_time::text, end_time::text, is_off FROM get_effective_shifts($1, $2::UUID, $3::DATE, $3::DATE)",
          [tenantId, emp.id, date]
        );
        for (const row of shiftRes.rows) {
          results.push({
            employee_id: emp.id,
            start_time: row.start_time,
            end_time: row.end_time,
            is_off: row.is_off,
          });
        }
      }
      return results;
    });
  }

  // --- Service CRUD ---
  async createService(tenantId: string, data: { name: string; duration_minutes: number; required_skills?: string[]; required_resources?: string[] }): Promise<number> {
    return this.withClient(tenantId, async (c) => {
      const res = await c.queryObject<{ id: number }>(
        "INSERT INTO services (tenant_id, name, duration_minutes, required_skills, required_resources) VALUES ($1, $2, $3, $4, $5) RETURNING id",
        [tenantId, data.name, data.duration_minutes, data.required_skills || [], data.required_resources || []]
      );
      if (!res.rows[0]) throw new Error("INSERT INTO services returned no row");
      return res.rows[0].id;
    });
  }

  async updateService(tenantId: string, id: number, data: { name?: string; duration_minutes?: number; required_skills?: string[]; required_resources?: string[] }): Promise<boolean> {
    const fields: string[] = [];
    const vals: any[] = [];
    let i = 1;
    if (data.name !== undefined) { fields.push(`name = $${i++}`); vals.push(data.name); }
    if (data.duration_minutes !== undefined) { fields.push(`duration_minutes = $${i++}`); vals.push(data.duration_minutes); }
    if (data.required_skills !== undefined) { fields.push(`required_skills = $${i++}`); vals.push(data.required_skills); }
    if (data.required_resources !== undefined) { fields.push(`required_resources = $${i++}`); vals.push(data.required_resources); }
    
    if (fields.length === 0) return true;
    vals.push(id);
    vals.push(tenantId);

    return this.withClient(tenantId, async (c) => {
      await c.queryObject(`UPDATE services SET ${fields.join(", ")} WHERE id = $${i} AND tenant_id = $${i+1}`, vals);
      return true;
    });
  }

  async deleteService(tenantId: string, id: number): Promise<boolean> {
    return this.withClient(tenantId, async (c) => {
      await c.queryArray("DELETE FROM services WHERE id = $1 AND tenant_id = $2", [id, tenantId]);
      return true;
    });
  }

  async getServices(tenantId: string, logger: Logger): Promise<any[]> {
    return this.withClient(tenantId, async (c) => {
      const res = await c.queryObject("SELECT * FROM services WHERE tenant_id = $1", [tenantId]);
      return res.rows;
    });
  }

  // --- Assignment Mappings ---
  async assignEmployeeToService(serviceId: number, employeeId: number, tenantId: string, logger: Logger): Promise<boolean> {
    return this.withClient(tenantId, async (c) => {
      await c.queryArray(
        "INSERT INTO service_employee (service_id, employee_id, tenant_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
        [serviceId, employeeId, tenantId]
      );
      return true;
    });
  }

  async assignResourceToService(serviceId: number, resourceId: string, tenantId: string, logger: Logger): Promise<boolean> {
    return this.withClient(tenantId, async (c) => {
      await c.queryArray(
        "INSERT INTO service_resource (service_id, resource_id, tenant_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
        [serviceId, resourceId, tenantId]
      );
      return true;
    });
  }

  async removeEmployeeFromService(serviceId: number, employeeId: number, logger: Logger): Promise<boolean> {
    return this.withClient(null, async (c) => {
      await c.queryArray(
        "DELETE FROM service_employee WHERE service_id = $1 AND employee_id = $2",
        [serviceId, employeeId]
      );
      return true;
    });
  }

  async removeResourceFromService(serviceId: number, resourceId: string, logger: Logger): Promise<boolean> {
    return this.withClient(null, async (c) => {
      await c.queryArray(
        "DELETE FROM service_resource WHERE service_id = $1 AND resource_id = $2",
        [serviceId, resourceId]
      );
      return true;
    });
  }

  async getServiceEmployees(serviceId: number, logger: Logger): Promise<number[]> {
    return this.withClient(null, async (c) => {
      const res = await c.queryObject<{ employee_id: number }>(
        "SELECT employee_id FROM service_employee WHERE service_id = $1",
        [serviceId]
      );
      return res.rows.map(r => r.employee_id);
    });
  }

  async getServiceResources(serviceId: number, logger: Logger): Promise<string[]> {
    return this.withClient(null, async (c) => {
      const res = await c.queryObject<{ resource_id: string }>(
        "SELECT resource_id FROM service_resource WHERE service_id = $1",
        [serviceId]
      );
      return res.rows.map(r => r.resource_id);
    });
  }

  async getServiceCatalog(tenantId: string, logger: Logger) {
    logger.info({ tenantId }, "Fetching service catalog from database");
    return this.withClient(tenantId, async (c) => {
      const res = await c.queryObject<{
        id: number; name: string; subtitle: string; description: string;
        duration_minutes: number; price: number | null;
      }>(
        "SELECT id, name, subtitle, description, duration_minutes, price FROM services WHERE tenant_id = $1 ORDER BY name ASC",
        [tenantId]
      );
      return res.rows;
    });
  }

  async getAvailableSlots(tenantId: string, serviceType: string, date: string, logger: Logger) {
    logger.info({ tenantId, serviceType, date }, "Fetching available slots data");
    return this.withClient(tenantId, async (c) => {
      // Single consolidated query: service + effective shifts + appointments
      // Replaces 3 separate queries + N+1 per-employee loop with one round trip
      const res = await c.queryObject<{
        source: string;
        name: string | null;
        duration_minutes: number | null;
        price: number | null;
        start_time: string | null;
        end_time: string | null;
      }>(
        `WITH svc AS (
          SELECT name, duration_minutes, price
          FROM services
          WHERE tenant_id = $1 AND name ILIKE '%' || $2 || '%'
          LIMIT 1
        ),
        active_employees AS (
          SELECT id FROM employees
          WHERE tenant_id = $1 AND is_active = true
            AND (is_deleted IS NULL OR is_deleted = false)
        ),
        effective_shifts AS (
          -- Override-aware: check shift_overrides first, fall back to employee_shifts pattern
          SELECT DISTINCT
            COALESCE(so.start_time, es.start_time)::text AS start_time,
            COALESCE(so.end_time, es.end_time)::text AS end_time
          FROM active_employees ae
          LEFT JOIN shift_overrides so
            ON so.employee_id = ae.id
            AND so.tenant_id = $1
            AND so.shift_date = $3::date
          LEFT JOIN employee_shifts es
            ON es.employee_id = ae.id
            AND es.day_of_week = EXTRACT(DOW FROM $3::date)::integer
            AND es.is_active = true
            AND so.id IS NULL
          WHERE (
            (so.id IS NOT NULL AND so.is_off = false AND so.start_time IS NOT NULL)
            OR
            (so.id IS NULL AND es.id IS NOT NULL)
          )
        ),
        day_appointments AS (
          SELECT start_time::text, end_time::text
          FROM appointments
          WHERE tenant_id = $1 AND status = 'scheduled'
            AND (is_deleted IS NULL OR is_deleted = false)
            AND start_time::date = $3::date
        )
        -- Return all three result sets tagged by source
        SELECT 'service' AS source, name, duration_minutes::int, price, NULL AS start_time, NULL AS end_time FROM svc
        UNION ALL
        SELECT 'shift' AS source, NULL, NULL, NULL, start_time, end_time FROM effective_shifts
        UNION ALL
        SELECT 'appointment' AS source, NULL, NULL, NULL, start_time, end_time FROM day_appointments
        ORDER BY source, start_time`,
        [tenantId, serviceType, date]
      );

      // Parse the tagged results
      let service: { name: string; duration_minutes: number; price: number | null } | null = null;
      const shifts: Array<{ start_time: string; end_time: string }> = [];
      const appointments: Array<{ start_time: string; end_time: string }> = [];

      for (const row of res.rows) {
        if (row.source === 'service' && row.name) {
          service = { name: row.name, duration_minutes: row.duration_minutes!, price: row.price };
        } else if (row.source === 'shift' && row.start_time && row.end_time) {
          shifts.push({ start_time: row.start_time, end_time: row.end_time });
        } else if (row.source === 'appointment' && row.start_time && row.end_time) {
          appointments.push({ start_time: row.start_time, end_time: row.end_time });
        }
      }

      return { service, shifts, appointments };
    });
  }

  async linkOrphanedTranscripts(tenantId: string, logger: Logger): Promise<number> {
    logger.info({ tenantId }, "Linking orphaned transcripts to customers");
    return this.withClient(tenantId, async (c) => {
      const res = await c.queryObject<{ link_orphaned_transcripts: number }>(
        "SELECT link_orphaned_transcripts($1)",
        [tenantId]
      );
      const count = res.rows[0]?.link_orphaned_transcripts ?? 0;
      logger.info({ tenantId, linkedCount: count }, "Orphaned transcript linking complete");
      return count;
    });
  }

  async searchKnowledgeBase(
    tenantId: string,
    queryEmbedding: number[],
    logger: Logger,
    limit = 3,
    threshold = 0.5
  ) {
    logger.info({ tenantId, limit, threshold }, "Searching knowledge base");
    return this.withClient(tenantId, async (c) => {
      // Use the JSON string and cast it explicitly in SQL
      const res = await c.queryObject<{ content: string; normalized_text: string; similarity: number }>(
        "SELECT content, normalized_text, similarity FROM search_tenant_docs_normalized($1, $2::vector, $3, $4)",
        [tenantId, JSON.stringify(queryEmbedding), threshold, limit]
      );
      return res.rows;
    });
  }

  async bookWithSchedulingAtomic(params: {
    tenantId: string;
    phone: string;
    customerName?: string;
    description: string;
    callId: string;
    location?: string;
    startTime?: string;
    endTime?: string;
    windowFrom?: string;
    windowTo?: string;
    requiredSkills?: string[];
    requiredCapabilities?: string[];
    preferredResourceId?: string;
    preferredEmployeeId?: string;
    serviceType?: string;
    durationMinutes?: number;
  }, logger: Logger) {
    logger.info({ tenantId: params.tenantId, phone: params.phone }, "Calling book_with_scheduling_atomic RPC");
    return this.withClient(params.tenantId, async (c) => {
      const res = await c.queryObject<{
        success: boolean;
        appointment_id: string | null;
        resource_id: string | null;
        resource_name: string | null;
        employee_id: string | null;
        employee_name: string | null;
        booked_start: string | null;
        booked_end: string | null;
        customer_id: string | null;
        error_message: string | null;
        error_code: string | null;
      }>(
        `SELECT * FROM book_with_scheduling_atomic(
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16
        )`,
        [
          params.tenantId,
          params.phone,
          params.customerName || null,
          params.description,
          params.callId || null,
          params.location || null,
          params.startTime || null,
          params.endTime || null,
          params.windowFrom || null,
          params.windowTo || null,
          params.requiredSkills || [],
          params.requiredCapabilities || [],
          params.preferredResourceId || null,
          params.preferredEmployeeId || null,
          params.serviceType || null,
          params.durationMinutes || 30,
        ]
      );
      const result = res.rows[0];
      if (!result) {
        throw new Error("book_with_scheduling_atomic returned no result — check RPC exists and arguments are correct");
      }
      return result;
    });
  }
}
