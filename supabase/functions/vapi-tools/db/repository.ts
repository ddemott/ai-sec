import { Pool } from "https://deno.land/x/postgres@v0.17.0/mod.ts";
import { IRepository } from "../core/interfaces.ts";
import { Logger, baseLogger } from "../core/logger.ts";
import type { ResourceCandidate, EmployeeCandidate, ExistingAppointment, TimeWindow } from "../core/scheduling.ts";

const DB_URL = Deno.env.get("DATABASE_URL") || "postgres://postgres:postgres@localhost:5433/postgres?sslmode=disable";

export class PostgresRepository implements IRepository {
  private pool: Pool;
  private logger: Logger = baseLogger;

  constructor() {
    // Create a pool with a few connections
    this.pool = new Pool(DB_URL, 3, true);
  }

  setLogger(logger: Logger) {
    this.logger = logger;
  }

  async close() {
    await this.pool.end();
  }

  private async withClient<T>(tenantId: string | null, fn: (client: any) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      if (tenantId) {
        await client.queryArray(`SELECT set_tenant_context($1::UUID)`, [tenantId]);
      }
      return await fn(client);
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
        "SELECT id, name FROM customers WHERE tenant_id = $1 AND phone = $2",
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
        "SELECT count(*) FROM appointments WHERE resource_id = $1 AND status = 'scheduled' AND start_time < $2 AND end_time > $3",
        [resourceId, end, start]
      );
      return parseInt(res.rows[0].count) > 0;
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
         WHERE r.tenant_id = $1 AND r.is_active = true
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
        "SELECT id, skills FROM employees WHERE tenant_id = $1 AND is_active = true",
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
      await c.queryArray("DELETE FROM employees WHERE id = $1 AND tenant_id = $2", [id, tenantId]);
      return true;
    });
  }

  async getEmployees(tenantId: string, logger: Logger): Promise<any[]> {
    return this.withClient(tenantId, async (c) => {
      const res = await c.queryObject("SELECT * FROM employees WHERE tenant_id = $1", [tenantId]);
      return res.rows;
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

  // --- Service CRUD ---
  async createService(tenantId: string, data: { name: string; duration_minutes: number; required_skills?: string[]; required_resources?: string[] }): Promise<number> {
    return this.withClient(tenantId, async (c) => {
      const res = await c.queryObject<{ id: number }>(
        "INSERT INTO services (tenant_id, name, duration_minutes, required_skills, required_resources) VALUES ($1, $2, $3, $4, $5) RETURNING id",
        [tenantId, data.name, data.duration_minutes, data.required_skills || [], data.required_resources || []]
      );
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
      const res = await c.queryObject<{ content: string; similarity: number }>(
        "SELECT content, similarity FROM search_tenant_docs($1, $2::vector, $3, $4)",
        [tenantId, JSON.stringify(queryEmbedding), threshold, limit]
      );
      return res.rows;
    });
  }
}
