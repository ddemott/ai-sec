/**
 * Agent tool routes — called by the LiveKit voice agent worker during a
 * live call. Replaces the Supabase Edge Function at
 * supabase/functions/vapi-tools/ (Phase 2 of the Vapi → LiveKit migration).
 *
 * Auth: shared secret in the `x-agent-secret` header (not JWT). The agent
 * passes `tenant_id` in each request body; these routes are exempt from
 * `tenantMiddleware` because the worker is not logged in as a tenant user.
 *
 * Response shape: `{ success: true, result: ... }` on success, `{ success:
 * false, error: string }` on failure — with a 200 status in both cases so
 * the LLM can relay the error conversationally rather than having the HTTP
 * client bubble an exception.
 */
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import { withHandler, type AppRequest } from '../middleware';
import { applyTimezone } from '../services/timezoneUtils';
import { normalizePhone } from '../services/phoneUtils';

// ── Zod schemas (ported from supabase/functions/vapi-tools/index.ts) ──

const GetContextSchema = z.object({
  phone: z.string().min(5),
  tenant_id: z.string().uuid(),
});

const CheckAvailabilitySchema = z.object({
  tenant_id: z.string().uuid(),
  resource_id: z.string().uuid(),
  start_time: z.string(),
  end_time: z.string(),
});

const BookAppointmentSchema = z.object({
  tenant_id: z.string().uuid(),
  resource_id: z.string().uuid(),
  phone: z.string().default(''),
  name: z.string().optional(),
  start_time: z.string(),
  end_time: z.string(),
  description: z.string().default('Booking via SecretaryHQ'),
  call_id: z.string().default(''),
  location: z.string().optional(),
  employee_id: z
    .string()
    .or(z.number())
    .optional()
    .transform((v) => v?.toString()),
});

const GetPolicyAnswerSchema = z.object({
  tenant_id: z.string().uuid(),
  question: z.string().min(1),
});

const GetSchedulingOptionsSchema = z.object({
  tenant_id: z.string().uuid(),
  requirements: z.object({
    serviceType: z.string().min(1),
    requiredResourceCapabilities: z.array(z.string()).optional(),
    requiredEmployeeSkills: z.array(z.string()).optional(),
  }),
  window: z.object({ from: z.string(), to: z.string() }),
});

const BookWithSchedulingSchema = z.object({
  tenant_id: z.string().uuid(),
  phone: z.string().default(''),
  name: z.string().optional(),
  description: z.string().default('Booking via SecretaryHQ'),
  call_id: z.string().default(''),
  location: z.string().optional(),
  requirements: z.object({
    serviceType: z.string().min(1),
    requiredResourceCapabilities: z.array(z.string()).optional(),
    requiredEmployeeSkills: z.array(z.string()).optional(),
    preferredResourceId: z.string().optional(),
  }),
  window: z.object({ from: z.string(), to: z.string() }),
});

const GetServiceCatalogSchema = z.object({
  tenant_id: z.string().uuid(),
});

const GetAvailableSlotsSchema = z.object({
  tenant_id: z.string().uuid(),
  service_type: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'),
});

// ── Helpers ───────────────────────────────────────────────────────────

function ok(reply: FastifyReply, result: unknown) {
  return reply.status(200).send({ success: true, result });
}

function fail(reply: FastifyReply, message: string, status = 200) {
  return reply.status(status).send({ success: false, error: message });
}

function parseOrFail<T>(schema: z.ZodType<T>, body: unknown, reply: FastifyReply): T | null {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const msg = parsed.error.issues
      .map((e) => `${e.path.join('.')}: ${e.message}`)
      .join(', ');
    fail(reply, `Validation failed: ${msg}`);
    return null;
  }
  return parsed.data;
}

// ── Route registration ────────────────────────────────────────────────

export function registerAgentToolRoutes(
  app: FastifyInstance<any, any, any>,
  _pool: Pool,
  withTenantClient: <T>(tenantId: string, fn: (client: PoolClient) => Promise<T>) => Promise<T>,
  getEmbedding: (text: string) => Promise<number[]>,
  normalizeForEmbedding?: (text: string, options?: { context?: string }) => Promise<string>
) {
  const AGENT_SECRET = process.env.AGENT_SECRET || '';
  if (!AGENT_SECRET) {
    app.log.warn('AGENT_SECRET not set — /agent-tools/* routes will reject all requests');
  }

  // Shared auth gate for every /agent-tools/ route. If AGENT_SECRET is
  // unset we still register the routes, but every request fails auth —
  // never "unlocked by default".
  app.addHook('preHandler', async (req: AppRequest, reply) => {
    if (!req.url.startsWith('/agent-tools/')) return;
    const provided = req.headers['x-agent-secret'];
    if (!AGENT_SECRET || provided !== AGENT_SECRET) {
      return reply.status(401).send({ success: false, error: 'Unauthorized' });
    }
  });

  // get_service_catalog — list public services for the tenant.
  app.post(
    '/agent-tools/service-catalog',
    withHandler(async (req: AppRequest, reply) => {
      const args = parseOrFail(GetServiceCatalogSchema, req.body, reply);
      if (!args) return;
      const res = await withTenantClient(args.tenant_id, (client) =>
        client.query(
          `SELECT id, name, subtitle, description, duration_minutes, price
             FROM services
            WHERE tenant_id = $1 AND is_deleted = false
            ORDER BY name ASC`,
          [args.tenant_id]
        )
      );
      return ok(reply, { services: res.rows });
    }, 'Failed to fetch service catalog')
  );

  // get_customer_context — look up caller by phone, return name + recent
  // call summaries so the agent can greet returning customers with context.
  app.post(
    '/agent-tools/customer-context',
    withHandler(async (req: AppRequest, reply) => {
      const args = parseOrFail(GetContextSchema, req.body, reply);
      if (!args) return;
      const normalized = normalizePhone(args.phone);
      if (!normalized) {
        return ok(reply, 'New caller - no history found.');
      }

      const data = await withTenantClient(args.tenant_id, async (client) => {
        const cust = await client.query<{ id: string; name: string }>(
          `SELECT id, name FROM customers
            WHERE tenant_id = $1 AND phone = $2
              AND (is_deleted IS NULL OR is_deleted = false)`,
          [args.tenant_id, normalized]
        );
        if (cust.rows.length === 0) return null;
        const customer = cust.rows[0];
        const sums = await client.query<{ summary: string }>(
          `SELECT summary FROM call_summaries
            WHERE customer_id = $1
            ORDER BY created_at DESC
            LIMIT 3`,
          [customer.id]
        );
        return { customer, summaries: sums.rows };
      });

      if (!data) return ok(reply, 'New caller - no history found.');
      return ok(reply, {
        name: data.customer.name || 'Unknown',
        history: data.summaries.map((s) => s.summary).join('; ') || 'No history',
      });
    }, 'Failed to fetch customer context')
  );

  // check_availability — wraps check_availability_with_tz() RPC. The agent
  // sends naive datetimes; we apply the tenant's timezone before the RPC
  // since Postgres can't know which zone "2026-05-01 14:00" is meant in.
  app.post(
    '/agent-tools/check-availability',
    withHandler(async (req: AppRequest, reply) => {
      const args = parseOrFail(CheckAvailabilitySchema, req.body, reply);
      if (!args) return;
      if (isNaN(Date.parse(args.start_time)) || isNaN(Date.parse(args.end_time))) {
        return fail(reply, 'Invalid date format provided for availability check.');
      }
      if (new Date(args.end_time) <= new Date(args.start_time)) {
        return fail(reply, 'End time must be after start time.');
      }

      const result = await withTenantClient(args.tenant_id, async (client) => {
        const tz = await client.query<{ timezone: string }>(
          `SELECT COALESCE(timezone, 'America/Chicago') AS timezone FROM tenants WHERE id = $1`,
          [args.tenant_id]
        );
        const ianaTimezone = tz.rows[0]?.timezone || 'America/Chicago';
        const start = applyTimezone(args.start_time, ianaTimezone);
        const end = applyTimezone(args.end_time, ianaTimezone);
        const rpc = await client.query(
          'SELECT * FROM check_availability_with_tz($1, $2, $3::timestamptz, $4::timestamptz)',
          [args.tenant_id, args.resource_id, start, end]
        );
        if (rpc.rows.length === 0) {
          throw new Error('check_availability_with_tz returned no result');
        }
        return rpc.rows[0];
      });

      return ok(reply, {
        available: result.available,
        tenant_timezone: result.tenant_timezone,
        local_start: result.local_start,
        local_end: result.local_end,
      });
    }, 'Failed to check availability')
  );

  // get_company_policy_answer — normalize question, embed it, cosine
  // similarity over pgvector, return joined matches. Falls back to a
  // conversational no-match message and logs the gap for the owner.
  app.post(
    '/agent-tools/policy-answer',
    withHandler(async (req: AppRequest, reply) => {
      const args = parseOrFail(GetPolicyAnswerSchema, req.body, reply);
      if (!args) return;

      let queryText = args.question;
      if (normalizeForEmbedding) {
        try {
          queryText = await normalizeForEmbedding(args.question, {
            context: 'customer phone inquiry',
          });
        } catch {
          // fall back to the raw question
        }
      }
      const embedding = await getEmbedding(queryText);

      const matches = await withTenantClient(args.tenant_id, (client) =>
        client.query<{ content: string; similarity: number }>(
          'SELECT content, similarity FROM search_tenant_docs_normalized($1, $2::vector, $3, $4)',
          [args.tenant_id, JSON.stringify(embedding), 0.5, 3]
        )
      );

      if (matches.rows.length === 0) {
        // Log the gap so the owner can see what callers are asking about.
        // Fire-and-forget; don't fail the call on logging errors.
        withTenantClient(args.tenant_id, (client) =>
          client.query(
            `INSERT INTO unanswered_questions (tenant_id, question)
             VALUES ($1, $2)`,
            [args.tenant_id, args.question]
          )
        ).catch(() => undefined);
        return ok(
          reply,
          "I don't have specific information on that topic right now. I'd be happy to take a message so the owner can get back to you, or if there's anything else I can help with — like booking an appointment or answering questions about our services — I'm here for you."
        );
      }

      const context = matches.rows.map((m) => m.content).join('\n\n---\n\n');
      return ok(reply, context);
    }, 'Failed to answer policy question')
  );

  // Stubs for the remaining 4 tools — each validates input and returns a
  // not-implemented error so the LiveKit agent gets a predictable error
  // shape until the port lands.
  const pendingRoutes: Array<[string, z.ZodTypeAny]> = [
    ['/agent-tools/book-appointment', BookAppointmentSchema],
    ['/agent-tools/scheduling-options', GetSchedulingOptionsSchema],
    ['/agent-tools/book-with-scheduling', BookWithSchedulingSchema],
    ['/agent-tools/available-slots', GetAvailableSlotsSchema],
  ];

  for (const [path, schema] of pendingRoutes) {
    app.post(
      path,
      withHandler(async (req: AppRequest, reply) => {
        // Validate first so the agent gets consistent error messages, even
        // though the route isn't implemented yet.
        const args = parseOrFail(schema, req.body, reply);
        if (!args) return;
        return fail(reply, `Not yet implemented: ${path}`, 200);
      }, `Agent tool ${path} failed`)
    );
  }
}
