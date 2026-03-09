import { Client } from "https://deno.land/x/postgres@v0.17.0/mod.ts";
import { IRepository } from "../core/interfaces.ts";
import { Logger, baseLogger } from "../core/logger.ts";
import type { ResourceCandidate, EmployeeCandidate, ExistingAppointment, TimeWindow } from "../core/scheduling.ts";

const DB_URL = Deno.env.get("DATABASE_URL") || "postgres://postgres:postgres@localhost:5433/postgres";

export class PostgresRepository implements IRepository {
  private client: Client;
  private logger: Logger = baseLogger;

  constructor() {
    this.client = new Client(DB_URL);
  }

  setLogger(logger: Logger) {
    this.logger = logger;
  }

  private async withClient<T>(tenantId: string | null, fn: (client: Client) => Promise<T>): Promise<T> {
    await this.client.connect();
    try {
      if (tenantId) {
        await this.client.queryArray(`SELECT set_tenant_context($1::UUID)`, [tenantId]);
      }
      return await fn(this.client);
    } finally {
      await this.client.end();
    }
  }

  async ping() {
    return this.withClient(null, async (c) => {
      await c.queryArray("SELECT 1");
    });
  }

  async findCustomerByPhone(tenantId: string, phone: string, logger: Logger) {
    logger.info({ phone }, "Finding customer by phone");
    return this.withClient(tenantId, async (c) => {
      const res = await c.queryObject<{ id: string; name: string }>(
        "SELECT id, name FROM customers WHERE tenant_id = $1 AND phone = $2",
        [tenantId, phone]
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

  // NOTE: These selector-oriented primitives are currently stubs.
  // They will be wired to real tables (resources, employees, services)
  // in a later migration. For now, they throw if accidentally invoked
  // from production paths.
  async getSchedulingResources(tenantId: string, logger: Logger): Promise<ResourceCandidate[]> {
    logger.info({ tenantId }, "Loading scheduling resources");
    return this.withClient(tenantId, async (c) => {
      const res = await c.queryObject<{ id: string }>(
        "SELECT id FROM resources WHERE tenant_id = $1 AND is_active = true",
        [tenantId],
      );
      return res.rows.map((row) => ({
        id: row.id,
        capabilities: [],
      }));
    });
  }

  async getSchedulingEmployees(_tenantId: string, _logger: Logger): Promise<EmployeeCandidate[]> {
    // Until we have an employees table, return an empty list so selectors
    // that require employees will find no matches.
    return [];
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
  }, logger: Logger) {
    logger.info(params, "Executing atomic booking RPC");
    return this.withClient(params.tenantId, async (c) => {
      const res = await c.queryObject<{ success: boolean; appointment_id: string; error_message: string }>(
        "SELECT * FROM book_appointment_atomic($1, $2, $3, $4, $5, $6, $7, $8)",
        [
          params.tenantId,
          params.resourceId,
          params.customerId,
          params.startTime,
          params.endTime,
          params.description,
          params.callId,
          params.location || null,
        ]
      );
      return res.rows[0];
    });
  }
}
