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
import { timingSafeEqual } from 'crypto';
import { z } from 'zod';
import { withHandler, type AppRequest } from '../middleware';
import { applyTimezone } from '../services/timezoneUtils';
import { validateAppointmentTimeRange } from '../services/appointmentValidation';
import { normalizePhone, isValidPhone } from '../services/phoneUtils';
import { getOrCreateCustomerByPhone } from '../services/customerLookup';
import { findNextAvailableSlots } from '../services/availabilitySearch';
import { findOverlappingAppointment, isOverlapError, type AppointmentConflict } from '../services/conflictLookup';
import { sendSms, generateVerificationCode } from '../services/telnyxSms';
import { getSyncRecorder, clearSyncRecorder } from '../services/syncOrchestrator';
import { toolCallsTotal, bookingAttemptsTotal } from '../services/metrics';
import {
  selectAssignments,
  type ResourceCandidate,
  type EmployeeCandidate,
  type ExistingAppointment,
  type ShiftOverride,
  type Shift,
} from '../../shared/scheduling';

// ── SMS OTP config — decided 2026-04-23 ────────────────────────────────
// 6-digit code (industry-standard), 10-min TTL (don't rush callers who are
// slow with their phones), max 5 verify attempts per code, rate-limit 3
// sends per phone per hour + 100 per tenant per day to prevent spam.
const CODE_DIGITS = 6;
const CODE_TTL_MINUTES = 10;
const MAX_VERIFY_ATTEMPTS = 5;
const RATE_LIMIT_PER_PHONE_PER_HOUR = 3;
const RATE_LIMIT_PER_TENANT_PER_DAY = 100;

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

const GetTenantConfigSchema = z.object({
  tenant_id: z.string().uuid(),
});

const GetAvailableSlotsSchema = z.object({
  tenant_id: z.string().uuid(),
  service_type: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'),
});

const SendVerificationCodeSchema = z.object({
  tenant_id: z.string().uuid(),
  phone: z.string().min(5),
});

const VerifyPhoneCodeSchema = z.object({
  tenant_id: z.string().uuid(),
  phone: z.string().min(5),
  code: z.string().regex(/^\d+$/, 'Code must be numeric'),
});

// ── Helpers ───────────────────────────────────────────────────────────

function ok(reply: FastifyReply, result: unknown) {
  // _toolOutcome is read by toolRoute() after the handler returns to bump
  // tool_calls_total{outcome=...}. Both ok() and fail() send 200 (the
  // agent expects to relay both shapes naturally), so we can't distinguish
  // success vs failure from status alone.
  (reply as unknown as { _toolOutcome?: string })._toolOutcome = 'success';
  return reply.status(200).send({ success: true, result });
}

function fail(reply: FastifyReply, message: string, status = 200) {
  (reply as unknown as { _toolOutcome?: string })._toolOutcome = 'error';
  return reply.status(status).send({ success: false, error: message });
}

/**
 * Map a booking RPC result back to the canonical outcome label used in
 * booking_attempts_total. Prefers the explicit error_code (book-with-
 * scheduling RPC sets one); falls back to keyword-matching the message
 * (book-appointment RPC returns prose only).
 */
function bookingOutcomeFromAgentError(
  errMessage: string | null | undefined,
  errCode?: string | null
): string {
  if (errCode) {
    const c = errCode.toLowerCase();
    if (c === 'timeslot_occupied') return 'timeslot_occupied';
    if (c === 'employee_not_scheduled') return 'employee_not_scheduled';
    if (c === 'no_skilled_employee') return 'no_skilled_employee';
    if (c === 'no_availability') return 'no_availability';
    if (c === 'invalid_params') return 'validation_error';
  }
  if (!errMessage) return 'other_error';
  const m = errMessage.toLowerCase();
  if (m.includes('timeslot') || m.includes('overlap')) return 'timeslot_occupied';
  if (m.includes('not on shift') || m.includes('not_scheduled')) return 'employee_not_scheduled';
  if (m.includes('skill')) return 'no_skilled_employee';
  if (m.includes('availability')) return 'no_availability';
  if (m.includes('past')) return 'past_time';
  return 'other_error';
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

/**
 * Register a POST /agent-tools/* route with schema validation.
 * Collapses the repeated `app.post + withHandler + parseOrFail` boilerplate.
 * Handler receives already-parsed args; return value is ignored (respond
 * via `ok()` / `fail()`).
 */
function toolRoute<T>(
  app: FastifyInstance<any, any, any>,
  path: string,
  schema: z.ZodType<T>,
  handler: (args: T, reply: FastifyReply) => Promise<unknown>,
  errorMessage: string
): void {
  // Strip the "/agent-tools/" prefix so the metric label matches the tool
  // name the LLM uses in its prompt (e.g. "book-with-scheduling"). Cardinality
  // is bounded by the number of registered tools (10 today).
  const toolName = path.replace(/^\/agent-tools\//, '');
  app.post(
    path,
    withHandler(async (req: AppRequest, reply) => {
      const args = parseOrFail(schema, req.body, reply);
      if (!args) {
        toolCallsTotal.inc({ tool: toolName, outcome: 'validation_error' });
        return;
      }
      const result = await handler(args, reply);
      const outcome = (reply as unknown as { _toolOutcome?: string })._toolOutcome ?? 'success';
      toolCallsTotal.inc({ tool: toolName, outcome });
      return result;
    }, errorMessage)
  );
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
  // AGENT_SECRET_OLD is the rotation pivot: when rotating, set AGENT_SECRET
  // to the new value AND keep the previous value in AGENT_SECRET_OLD until
  // every agent worker has been redeployed with the new secret. Both values
  // are accepted during the rotation window. After all workers are on the
  // new secret, drop AGENT_SECRET_OLD.
  const AGENT_SECRET_OLD = process.env.AGENT_SECRET_OLD || '';
  if (!AGENT_SECRET) {
    app.log.warn('AGENT_SECRET not set — /agent-tools/* routes will reject all requests');
  }

  // Constant-time string comparison. Returns false if lengths differ
  // (length itself leaks but is negligible vs per-character timing) or
  // if the bytes don't match. Wrapped so callers don't need to remember
  // the Buffer.from + length-check + timingSafeEqual trio.
  function safeEquals(provided: string, expected: string): boolean {
    if (!expected) return false;
    const a = Buffer.from(provided, 'utf8');
    const b = Buffer.from(expected, 'utf8');
    if (a.length !== b.length) return false;
    // timingSafeEqual throws if lengths differ — guarded above.
    return timingSafeEqual(a, b);
  }

  // Shared auth gate for every /agent-tools/ route. If AGENT_SECRET is
  // unset we still register the routes, but every request fails auth —
  // never "unlocked by default". Accepts AGENT_SECRET or (during rotation)
  // AGENT_SECRET_OLD.
  app.addHook('preHandler', async (req: AppRequest, reply) => {
    if (!req.url.startsWith('/agent-tools/')) return;
    const providedRaw = req.headers['x-agent-secret'];
    const provided = typeof providedRaw === 'string' ? providedRaw : '';
    if (!provided) {
      return reply.status(401).send({ success: false, error: 'Unauthorized' });
    }
    const matchesPrimary = safeEquals(provided, AGENT_SECRET);
    const matchesOld = AGENT_SECRET_OLD ? safeEquals(provided, AGENT_SECRET_OLD) : false;
    if (!matchesPrimary && !matchesOld) {
      return reply.status(401).send({ success: false, error: 'Unauthorized' });
    }
  });

  // tenant-config — minimal display info the agent worker needs at the
  // start of every call (business name + IANA timezone). Read on connect
  // before the system prompt is built so the LLM greets with the real
  // business name and reasons about "today" in the tenant's local zone.
  toolRoute(app, '/agent-tools/tenant-config', GetTenantConfigSchema, async (args, reply) => {
    const row = await withTenantClient(args.tenant_id, async (client) => {
      const res = await client.query<{ name: string; timezone: string | null }>(
        `SELECT name, timezone FROM tenants WHERE id = $1`,
        [args.tenant_id]
      );
      return res.rows[0] ?? null;
    });
    if (!row) {
      return fail(reply, 'Tenant not found');
    }
    return ok(reply, {
      name: row.name,
      timezone: row.timezone || 'America/Chicago',
    });
  }, 'Failed to fetch tenant config');

  // get_service_catalog — list public services for the tenant.
  toolRoute(app, '/agent-tools/service-catalog', GetServiceCatalogSchema, async (args, reply) => {
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
  }, 'Failed to fetch service catalog');

  // get_customer_context — look up caller by phone, return name + recent
  // call summaries so the agent can greet returning customers with context.
  toolRoute(app, '/agent-tools/customer-context', GetContextSchema, async (args, reply) => {
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
  }, 'Failed to fetch customer context');

  // check_availability — wraps check_availability_with_tz() RPC. The agent
  // sends naive datetimes; we apply the tenant's timezone before the RPC
  // since Postgres can't know which zone "2026-05-01 14:00" is meant in.
  toolRoute(app, '/agent-tools/check-availability', CheckAvailabilitySchema, async (args, reply) => {
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
  }, 'Failed to check availability');

  // get_company_policy_answer — normalize question, embed it, cosine
  // similarity over pgvector, return joined matches. Falls back to a
  // conversational no-match message and logs the gap for the owner.
  toolRoute(app, '/agent-tools/policy-answer', GetPolicyAnswerSchema, async (args, reply) => {
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
  }, 'Failed to answer policy question');

  // book_appointment — upsert customer by phone, then call
  // book_appointment_atomic RPC. The RPC does all the conflict / shift /
  // skill validation server-side; we just translate the (success, err)
  // tuple into the conversational response shape.
  toolRoute(app, '/agent-tools/book-appointment', BookAppointmentSchema, async (args, reply) => {
    // Gate: without a valid phone we can't confirm, reschedule, or follow
    // up with the caller. The agent's system prompt hears this message
    // and kicks into the /send-verification-code OTP flow to collect one.
    if (!isValidPhone(args.phone)) {
      return fail(
        reply,
        "Before I book, I'll need a good phone number so we can confirm your appointment and reach you if anything changes. What's the best number to text or call?"
      );
    }
    const normalized = normalizePhone(args.phone)!;
    const timeValidationError = validateAppointmentTimeRange(args.start_time, args.end_time);
    if (timeValidationError) {
      // Hand-rolled response (not fail()) so the agent sees error_code —
      // its prompt branches differently for INVALID_INCREMENT (re-snap to
      // grid) vs INVALID_RANGE (re-ask for end time) vs INVALID_PARAMS
      // (re-ask for both). Same outcome label as the dashboard route.
      bookingAttemptsTotal.inc({ outcome: 'validation_error', source: 'agent' });
      (reply as unknown as { _toolOutcome?: string })._toolOutcome = 'error';
      return reply.status(200).send({
        success: false,
        error: timeValidationError.error,
        error_code: timeValidationError.code,
      });
    }

    // Step 1 — get-or-create the customer in its own transaction so the row
    // persists even if the booking RPC below returns failure. See
    // services/customerLookup.ts for the rationale.
    const customerId = await getOrCreateCustomerByPhone(
      withTenantClient,
      args.tenant_id,
      normalized,
      args.name || 'Valued Customer'
    );

    // Step 2 — booking RPC in a fresh transaction. On overlap, do a follow-up
    // SELECT in the same connection to find the conflicting appointment so
    // the response can carry conflict details (matches /appointments/create
    // contract — Slice 1 of the booking enforcement hardening 2026-05-09).
    const outcome = await withTenantClient(args.tenant_id, async (client) => {
      // p_assignment_id is TEXT in the current RPC (holds UUID post-Phase 9).
      const rpc = await client.query<{
        success: boolean;
        appointment_id: string | null;
        error_message: string | null;
      }>(
        `SELECT * FROM book_appointment_atomic(
           $1, $2, $3, $4::timestamptz, $5::timestamptz, $6, $7, $8, $9
         )`,
        [
          args.tenant_id,
          args.resource_id,
          customerId,
          args.start_time,
          args.end_time,
          args.description,
          args.call_id,
          args.location || null,
          args.employee_id || null,
        ]
      );
      const result = rpc.rows[0];
      let conflict: AppointmentConflict | null = null;
      if (result && !result.success && isOverlapError(result.error_message)) {
        conflict = await findOverlappingAppointment(client, {
          tenantId: args.tenant_id,
          resourceId: args.resource_id,
          employeeId: args.employee_id || null,
          startTime: args.start_time,
          endTime: args.end_time,
        });
      }
      return { result, conflict };
    });
    const { result, conflict } = outcome;

    if (!result || !result.success) {
      bookingAttemptsTotal.inc({ outcome: bookingOutcomeFromAgentError(result?.error_message), source: 'agent' });
      // Hand-rolled response (not fail()) when conflict info is present so
      // the agent + dashboard can read structured fields. Mirrors the
      // book-with-scheduling shape so consumers see one error contract.
      if (conflict) {
        (reply as unknown as { _toolOutcome?: string })._toolOutcome = 'error';
        return reply.status(200).send({
          success: false,
          error: result?.error_message || 'That time is already booked.',
          error_code: 'TIMESLOT_OCCUPIED',
          conflict,
        });
      }
      return fail(
        reply,
        result?.error_message || 'Booking failed due to a scheduling conflict.'
      );
    }
    bookingAttemptsTotal.inc({ outcome: 'success', source: 'agent' });
    return ok(reply, {
      success: true,
      appointment_id: result.appointment_id,
      error_message: null,
    });
  }, 'Failed to book appointment');

  // get_scheduling_options — pure-selector scheduling helper. Loads the
  // tenant's resources/employees/shifts/appointments for the day of the
  // window and runs the shared selectAssignments() algorithm. Diagnostics
  // explain *why* nothing matched when options is empty — the agent uses
  // the reason string to ask a better follow-up question.
  toolRoute(app, '/agent-tools/scheduling-options', GetSchedulingOptionsSchema, async (args, reply) => {
    if (isNaN(Date.parse(args.window.from)) || isNaN(Date.parse(args.window.to))) {
      return fail(reply, 'Invalid date format in scheduling window.');
    }
    const windowFrom = new Date(args.window.from);
    const windowTo = new Date(args.window.to);
    if (windowTo <= windowFrom) {
      return fail(reply, 'Window end must be after window start.');
    }
    const dateStr = windowFrom.toISOString().substring(0, 10);

    const data = await withTenantClient(args.tenant_id, async (client) => {
      // Resources with union of explicit caps + derived from services.
      const resRes = await client.query<{ resource_id: string; capabilities: string[] }>(
        `SELECT r.resource_id,
                ARRAY(
                  SELECT DISTINCT unnest(
                    r.capabilities ||
                    COALESCE(array_agg(DISTINCT cap) FILTER (WHERE cap IS NOT NULL), '{}')
                  )
                ) AS capabilities
           FROM resources r
           LEFT JOIN service_resource sr ON r.resource_id = sr.resource_id
           LEFT JOIN services s ON sr.service_id = s.service_id
           LEFT JOIN LATERAL unnest(s.required_resources) cap ON true
          WHERE r.tenant_id = $1
            AND r.is_active = true
            AND (r.is_deleted IS NULL OR r.is_deleted = false)
          GROUP BY r.resource_id, r.capabilities`,
        [args.tenant_id]
      );

      const empRes = await client.query<{ id: string; skills: string[] }>(
        `SELECT employee_id::text AS id, skills
           FROM employees
          WHERE tenant_id = $1 AND is_active = true
            AND (is_deleted IS NULL OR is_deleted = false)`,
        [args.tenant_id]
      );

      const apptRes = await client.query<{
        resource_id: string;
        start_time: string;
        end_time: string;
      }>(
        `SELECT resource_id, start_time, end_time
           FROM appointments
          WHERE tenant_id = $1
            AND status = 'scheduled'
            AND (is_deleted IS NULL OR is_deleted = false)
            AND start_time < $2::timestamptz
            AND end_time > $3::timestamptz`,
        [args.tenant_id, windowTo.toISOString(), windowFrom.toISOString()]
      );

      // Effective shifts for the date via bulk RPC (single call rather
      // than the N+1 per-employee loop the Deno repo still uses).
      const shiftRes = await client.query<{
        employee_id: string;
        start_time: string | null;
        end_time: string | null;
        is_off: boolean;
      }>(
        `SELECT employee_id::text AS employee_id,
                start_time::text AS start_time,
                end_time::text AS end_time,
                is_off
           FROM get_effective_shifts_bulk($1, $2::date, $2::date)`,
        [args.tenant_id, dateStr]
      );

      return { resRes, empRes, apptRes, shiftRes };
    });

    const resources: ResourceCandidate[] = data.resRes.rows.map((r) => ({
      id: r.resource_id,
      capabilities: r.capabilities || [],
    }));
    const employees: EmployeeCandidate[] = data.empRes.rows.map((e) => ({
      id: e.id,
      skills: e.skills || [],
    }));
    const existingAppointments: ExistingAppointment[] = data.apptRes.rows.map((a) => ({
      resourceId: a.resource_id,
      start: new Date(a.start_time),
      end: new Date(a.end_time),
    }));
    const shiftOverrides: ShiftOverride[] = data.shiftRes.rows
      .filter((s) => s.is_off || (s.start_time && s.end_time))
      .map((s) => ({
        employee_id: s.employee_id,
        shift_date: dateStr,
        start_time: s.start_time,
        end_time: s.end_time,
        is_off: s.is_off,
      }));

    const { options, diagnostics } = selectAssignments({
      requirements: args.requirements,
      window: { from: windowFrom, to: windowTo },
      resources,
      employees,
      shifts: [] as Shift[], // date-based scheduling only; no weekly patterns
      shiftOverrides,
      existingAppointments,
    });

    return ok(reply, { options, diagnostics });
  }, 'Failed to compute scheduling options');

  // book_with_scheduling — single-query booking via RPC that does customer
  // upsert + skill/shift matching + conflict check + insert in one tx.
  // Surfaces the RPC's error_code (TIMESLOT_OCCUPIED / NO_SKILLED_EMPLOYEE
  // / EMPLOYEE_NOT_SCHEDULED / NO_AVAILABILITY) so the agent can explain
  // the failure specifically rather than "something went wrong".
  toolRoute(app, '/agent-tools/book-with-scheduling', BookWithSchedulingSchema, async (args, reply) => {
    if (isNaN(Date.parse(args.window.from)) || isNaN(Date.parse(args.window.to))) {
      return fail(reply, 'Invalid date format in scheduling window.');
    }
    // Gate: see book-appointment above — same rationale, same message.
    if (!isValidPhone(args.phone)) {
      return fail(
        reply,
        "Before I book, I'll need a good phone number so we can confirm your appointment and reach you if anything changes. What's the best number to text or call?"
      );
    }
    const normalized = normalizePhone(args.phone)!;

    // Step 1 — get-or-create the customer in its own transaction. The RPC
    // would otherwise do this inside its own plpgsql function execution;
    // pulling it out guarantees the customer persists even when the RPC
    // returns NO_AVAILABILITY / TIMESLOT_OCCUPIED / etc., so the next
    // attempt doesn't re-collect the caller's identity. The RPC still
    // receives phone+name in step 2 — its lookup-by-phone will find the
    // customer we just inserted and skip its own INSERT branch.
    await getOrCreateCustomerByPhone(
      withTenantClient,
      args.tenant_id,
      normalized,
      args.name || 'Caller'
    );

    const result = await withTenantClient(args.tenant_id, async (client) => {
      const rpc = await client.query<{
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
          args.tenant_id,
          normalized,
          args.name || null,
          args.description,
          args.call_id || null,
          args.location || null,
          null, // p_start_time — unused when window provided
          null, // p_end_time
          new Date(args.window.from).toISOString(),
          new Date(args.window.to).toISOString(),
          args.requirements.requiredEmployeeSkills || [],
          args.requirements.requiredResourceCapabilities || [],
          args.requirements.preferredResourceId || null,
          null, // p_preferred_employee_id
          args.requirements.serviceType,
          30, // p_duration_minutes — RPC derives actual duration from service
        ]
      );
      return rpc.rows[0];
    });

    if (!result || !result.success) {
      // Fetch next-available alternatives so the agent can propose them
      // verbally instead of saying "no availability." Same skill +
      // capability filters as the booking attempt, searches forward up
      // to 24h. Failure to find alternatives leaves next_available
      // empty; the agent prompt handles both shapes.
      const nextAvailable = await withTenantClient(args.tenant_id, (client) =>
        findNextAvailableSlots(client, {
          tenantId: args.tenant_id,
          fromTime: new Date(args.window.from).toISOString(),
          durationMinutes: 30,
          requiredSkills: args.requirements.requiredEmployeeSkills || [],
          requiredCapabilities: args.requirements.requiredResourceCapabilities || [],
          count: 5,
        })
      ).catch(() => []);
      bookingAttemptsTotal.inc({
        outcome: bookingOutcomeFromAgentError(result?.error_message, result?.error_code),
        source: 'agent',
      });
      // Hand-rolled response (not ok/fail) so the agent can read
      // error_code + next_available; mirror the success-flag for the
      // tool-call counter so the validation-error branch isn't double-bumped.
      (reply as unknown as { _toolOutcome?: string })._toolOutcome = 'error';
      return reply.status(200).send({
        success: false,
        error: result?.error_message || 'No available scheduling options',
        error_code: result?.error_code || 'NO_AVAILABILITY',
        next_available: nextAvailable,
      });
    }

    bookingAttemptsTotal.inc({ outcome: 'success', source: 'agent' });
    return ok(reply, {
      success: true,
      appointment_id: result.appointment_id,
      resource_name: result.resource_name,
      employee_name: result.employee_name,
      booked_start: result.booked_start,
      booked_end: result.booked_end,
      error_message: null,
    });
  }, 'Failed to book with scheduling');

  // get_available_slots — computes open windows for a service on a given
  // date. Single SQL union-all pulls service + shifts + appointments in
  // one round trip; interval math then merges shift coverage and subtracts
  // bookings. Returns a *spoken* string because the agent relays it
  // verbatim to the caller.
  toolRoute(app, '/agent-tools/available-slots', GetAvailableSlotsSchema, async (args, reply) => {
    const data = await withTenantClient(args.tenant_id, async (client) => {
      const res = await client.query<{
        source: 'service' | 'shift' | 'appointment';
        name: string | null;
        duration_minutes: number | null;
        price: string | number | null;
        start_time: string | null;
        end_time: string | null;
      }>(
        `WITH svc AS (
           SELECT name, duration_minutes, price
             FROM services
            WHERE tenant_id = $1 AND name ILIKE '%' || $2 || '%'
              AND (is_deleted IS NULL OR is_deleted = false)
            LIMIT 1
         ),
         active_employees AS (
           SELECT employee_id FROM employees
            WHERE tenant_id = $1 AND is_active = true
              AND (is_deleted IS NULL OR is_deleted = false)
         ),
         effective_shifts AS (
           SELECT DISTINCT
                  es.start_time::text AS start_time,
                  es.end_time::text AS end_time
             FROM active_employees ae
             JOIN employee_schedule es
               ON es.employee_id = ae.employee_id
              AND es.tenant_id = $1
              AND es.shift_date = $3::date
              AND es.is_off = false
              AND es.start_time IS NOT NULL
         ),
         day_appointments AS (
           SELECT start_time::text, end_time::text
             FROM appointments
            WHERE tenant_id = $1 AND status = 'scheduled'
              AND (is_deleted IS NULL OR is_deleted = false)
              AND start_time::date = $3::date
         )
         SELECT 'service'::text AS source, name, duration_minutes::int, price, NULL::text AS start_time, NULL::text AS end_time FROM svc
         UNION ALL
         SELECT 'shift'::text, NULL, NULL, NULL, start_time, end_time FROM effective_shifts
         UNION ALL
         SELECT 'appointment'::text, NULL, NULL, NULL, start_time, end_time FROM day_appointments
         ORDER BY source, start_time`,
        [args.tenant_id, args.service_type, args.date]
      );

      let service: { name: string; duration_minutes: number; price: number | null } | null = null;
      const shifts: Array<{ start_time: string; end_time: string }> = [];
      const appointments: Array<{ start_time: string; end_time: string }> = [];
      for (const row of res.rows) {
        if (row.source === 'service' && row.name) {
          service = {
            name: row.name,
            duration_minutes: row.duration_minutes as number,
            price: row.price !== null ? Number(row.price) : null,
          };
        } else if (row.source === 'shift' && row.start_time && row.end_time) {
          shifts.push({ start_time: row.start_time, end_time: row.end_time });
        } else if (row.source === 'appointment' && row.start_time && row.end_time) {
          appointments.push({ start_time: row.start_time, end_time: row.end_time });
        }
      }
      return { service, shifts, appointments };
    });

    // Format date for speech ("Wednesday, April 2")
    const dateObj = new Date(args.date + 'T12:00:00');
    const dayName = dateObj.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    });

    if (!data.service) {
      return ok(
        reply,
        `I couldn't find a service matching "${args.service_type}" in our catalog. Would you like to hear our list of services?`
      );
    }

    const { name: serviceName, duration_minutes, price } = data.service;
    const serviceInfo =
      price && price > 0
        ? `${serviceName} takes about ${duration_minutes} minutes and costs $${price.toFixed(0)}.`
        : `${serviceName} takes about ${duration_minutes} minutes.`;

    if (data.shifts.length === 0) {
      return ok(
        reply,
        `${serviceInfo} Unfortunately, we don't have anyone scheduled to work on ${dayName}. Would you like to try a different day?`
      );
    }

    const coverage = mergeIntervals(
      data.shifts.map((s) => ({
        start: timeToMinutes(s.start_time),
        end: timeToMinutes(s.end_time),
      }))
    );
    const booked = data.appointments.map((a) => ({
      start: dateTimeToMinutes(a.start_time),
      end: dateTimeToMinutes(a.end_time),
    }));
    const open = subtractIntervals(coverage, booked);
    const usable = open.filter((slot) => slot.end - slot.start >= duration_minutes);

    // If today, filter out past times.
    const now = new Date();
    const isToday = args.date === now.toLocaleDateString('en-CA');
    const currentMinutes = isToday ? now.getHours() * 60 + now.getMinutes() : 0;
    const futureSlots = isToday
      ? usable
          .filter((s) => s.end > currentMinutes)
          .map((s) => ({ start: Math.max(s.start, currentMinutes), end: s.end }))
          .filter((s) => s.end - s.start >= duration_minutes)
      : usable;

    if (futureSlots.length === 0) {
      return ok(
        reply,
        `${serviceInfo} Unfortunately, we're fully booked on ${dayName}. Would you like to try a different day?`
      );
    }

    const slotStrings = futureSlots.map((s) => {
      if (
        s.start === coverage[0]?.start &&
        s.end === coverage[coverage.length - 1]?.end
      ) {
        return `all day from ${minutesToTime(s.start)} to ${minutesToTime(s.end)}`;
      }
      return `${minutesToTime(s.start)} to ${minutesToTime(s.end)}`;
    });
    const openHours = `${minutesToTime(coverage[0].start)} to ${minutesToTime(
      coverage[coverage.length - 1].end
    )}`;
    const slotsText =
      slotStrings.length === 1
        ? slotStrings[0]
        : slotStrings.slice(0, -1).join(', ') +
          ', and ' +
          slotStrings[slotStrings.length - 1];

    return ok(
      reply,
      `${serviceInfo} On ${dayName}, our hours are ${openHours}. We have openings ${slotsText}. What time works best for you?`
    );
  }, 'Failed to compute available slots');

  // send_verification_code — used when caller-ID is blocked/garbled/missing
  // and the caller has verbally provided a phone. Generate a 6-digit code,
  // bcrypt-hash it, store with 10-min TTL, SMS it via Telnyx. Rate-limited
  // to prevent this becoming a free SMS-spam relay.
  toolRoute(app, '/agent-tools/send-verification-code', SendVerificationCodeSchema, async (args, reply) => {
    if (!isValidPhone(args.phone)) {
      return fail(
        reply,
        "I couldn't quite catch that number — could you say it again, starting with the area code?"
      );
    }
    const normalized = normalizePhone(args.phone)!;

    // Load tenant's SMS sender phone (inbound_phone doubles as outbound
    // sender since Telnyx numbers are bidirectional).
    const smsOutcome = await withTenantClient(args.tenant_id, async (client) => {
      const tz = await client.query<{ inbound_phone: string | null }>(
        `SELECT inbound_phone FROM tenants WHERE id = $1`,
        [args.tenant_id]
      );
      const fromPhone = tz.rows[0]?.inbound_phone;
      if (!fromPhone) {
        return { kind: 'no_sender' as const };
      }

      // Rate limit: sends to this phone in the last hour.
      const perPhone = await client.query<{ c: string }>(
        `SELECT COUNT(*)::text AS c
           FROM phone_verifications
          WHERE tenant_id = $1 AND phone = $2
            AND created_at > now() - interval '1 hour'`,
        [args.tenant_id, normalized]
      );
      if (parseInt(perPhone.rows[0].c, 10) >= RATE_LIMIT_PER_PHONE_PER_HOUR) {
        return { kind: 'rate_limited_phone' as const };
      }

      // Rate limit: sends from this tenant in the last 24h.
      const perTenant = await client.query<{ c: string }>(
        `SELECT COUNT(*)::text AS c
           FROM phone_verifications
          WHERE tenant_id = $1
            AND created_at > now() - interval '24 hours'`,
        [args.tenant_id]
      );
      if (parseInt(perTenant.rows[0].c, 10) >= RATE_LIMIT_PER_TENANT_PER_DAY) {
        return { kind: 'rate_limited_tenant' as const };
      }

      // Generate + hash + insert. bcrypt cost 10 matches auth routes.
      const code = generateVerificationCode(CODE_DIGITS);
      const bcrypt = await import('bcrypt');
      const codeHash = await bcrypt.hash(code, 10);
      await client.query(
        `INSERT INTO phone_verifications (tenant_id, phone, code_hash, expires_at)
           VALUES ($1, $2, $3, now() + ($4 || ' minutes')::interval)`,
        [args.tenant_id, normalized, codeHash, String(CODE_TTL_MINUTES)]
      );
      return { kind: 'inserted' as const, code, fromPhone };
    });

    if (smsOutcome.kind === 'no_sender') {
      return fail(
        reply,
        "I'm sorry — I can't send a text from this line right now. Let me take your information another way."
      );
    }
    if (smsOutcome.kind === 'rate_limited_phone') {
      return fail(
        reply,
        "I've already sent a few codes to that number recently. Let me take a message instead and have someone call you back."
      );
    }
    if (smsOutcome.kind === 'rate_limited_tenant') {
      return fail(
        reply,
        "I can't send another verification text right now. Let me take a message instead."
      );
    }

    const sms = await sendSms({
      from: smsOutcome.fromPhone,
      to: normalized,
      body: `Your SecretaryHQ verification code is: ${smsOutcome.code}. Reply STOP to opt out.`,
    });
    if (!sms.ok) {
      app.log.warn({ event: 'otp_sms_send_failed', error: sms.error, status: sms.status }, 'Telnyx SMS send failed');
      return fail(
        reply,
        "I had trouble sending that text. Could you try saying the number again, or we can take a message instead."
      );
    }

    return ok(reply, {
      sent: true,
      phone: normalized,
      message: "I just sent you a text with a short code. When it comes through, just read it back to me.",
    });
  }, 'Failed to send verification code');

  // verify_phone_code — compare caller-spoken code against the stored hash.
  // On success, marks the row verified. On failure, increments attempt
  // count and refuses further tries once we hit MAX_VERIFY_ATTEMPTS so a
  // stolen phone number can't be brute-forced over a long call.
  toolRoute(app, '/agent-tools/verify-phone-code', VerifyPhoneCodeSchema, async (args, reply) => {
    if (!isValidPhone(args.phone)) {
      return fail(reply, "That doesn't look like a valid number — could you say it again?");
    }
    const normalized = normalizePhone(args.phone)!;

    const result = await withTenantClient(args.tenant_id, async (client) => {
      // Most recent unverified row for this phone.
      const row = await client.query<{
        id: string;
        code_hash: string;
        expires_at: string;
        attempt_count: number;
      }>(
        `SELECT id, code_hash, expires_at, attempt_count
           FROM phone_verifications
          WHERE tenant_id = $1 AND phone = $2 AND verified_at IS NULL
          ORDER BY created_at DESC
          LIMIT 1`,
        [args.tenant_id, normalized]
      );
      if (row.rows.length === 0) {
        return { kind: 'no_pending' as const };
      }
      const v = row.rows[0];
      if (new Date(v.expires_at).getTime() < Date.now()) {
        return { kind: 'expired' as const };
      }
      if (v.attempt_count >= MAX_VERIFY_ATTEMPTS) {
        return { kind: 'too_many_attempts' as const };
      }

      const bcrypt = await import('bcrypt');
      const match = await bcrypt.compare(args.code, v.code_hash);
      if (match) {
        await client.query(
          `UPDATE phone_verifications SET verified_at = now() WHERE id = $1`,
          [v.id]
        );
        return { kind: 'verified' as const };
      }

      await client.query(
        `UPDATE phone_verifications SET attempt_count = attempt_count + 1 WHERE id = $1`,
        [v.id]
      );
      const remaining = MAX_VERIFY_ATTEMPTS - (v.attempt_count + 1);
      return { kind: 'wrong' as const, remaining };
    });

    if (result.kind === 'verified') {
      return ok(reply, { verified: true, phone: normalized });
    }
    if (result.kind === 'no_pending') {
      return fail(
        reply,
        "I don't have a pending code for that number. Would you like me to send a new one?"
      );
    }
    if (result.kind === 'expired') {
      return fail(
        reply,
        "That code has expired. I can send you a new one if you'd like."
      );
    }
    if (result.kind === 'too_many_attempts') {
      return fail(
        reply,
        "We've tried that a few times without luck. Let me take a message and have someone follow up with you."
      );
    }
    // wrong
    if (result.remaining <= 0) {
      return fail(
        reply,
        "That didn't match, and we've used our tries. Let me take a message instead."
      );
    }
    return fail(
      reply,
      `That didn't quite match — could you read the code again? You have ${result.remaining} ${result.remaining === 1 ? 'try' : 'tries'} left.`
    );
  }, 'Failed to verify phone code');

  // ── Test-only sync recorder readout ───────────────────────────────
  // Exposes the in-memory dispatch log captured by syncOrchestrator
  // when SYNC_TEST_RECORDER=1 is set. Used by Playwright e2e to assert
  // that fire-and-forget sync calls actually fired, without needing
  // real Google/Outlook/CRM credentials. Gated by both the env var AND
  // the existing x-agent-secret auth hook — refuses to respond outside
  // test mode so a stray prod request can't enumerate sync activity.
  app.get('/agent-tools/_test/sync-events', async (_req, reply) => {
    if (process.env.SYNC_TEST_RECORDER !== '1') {
      return reply.status(404).send({ success: false, error: 'Recorder disabled' });
    }
    return reply.send({ success: true, result: { events: getSyncRecorder() } });
  });
  app.delete('/agent-tools/_test/sync-events', async (_req, reply) => {
    if (process.env.SYNC_TEST_RECORDER !== '1') {
      return reply.status(404).send({ success: false, error: 'Recorder disabled' });
    }
    clearSyncRecorder();
    return reply.send({ success: true, result: { cleared: true } });
  });
}

// ── Interval math helpers for /available-slots ────────────────────────
// Ported from supabase/functions/vapi-tools/core/service.ts so the voice
// AI flow doesn't change shape when the edge function is retired.

interface Interval {
  start: number;
  end: number;
}

/** "HH:MM" or "HH:MM:SS" → minutes since midnight */
function timeToMinutes(t: string): number {
  const parts = t.split(':');
  return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
}

/** ISO datetime → minutes since midnight (local-date sense) */
function dateTimeToMinutes(dt: string): number {
  const d = new Date(dt);
  return d.getHours() * 60 + d.getMinutes();
}

/** minutes since midnight → spoken time ("1:00 PM") */
function minutesToTime(m: number): string {
  const h = Math.floor(m / 60);
  const min = m % 60;
  const period = h >= 12 ? 'PM' : 'AM';
  const hour12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return min === 0 ? `${hour12} ${period}` : `${hour12}:${String(min).padStart(2, '0')} ${period}`;
}

/** Merge overlapping/adjacent intervals into non-overlapping coverage. */
function mergeIntervals(intervals: Interval[]): Interval[] {
  if (intervals.length === 0) return [];
  const sorted = [...intervals].sort((a, b) => a.start - b.start);
  const merged: Interval[] = [{ ...sorted[0] }];
  for (let i = 1; i < sorted.length; i++) {
    const last = merged[merged.length - 1];
    if (sorted[i].start <= last.end) {
      last.end = Math.max(last.end, sorted[i].end);
    } else {
      merged.push({ ...sorted[i] });
    }
  }
  return merged;
}

/** Subtract booked intervals from coverage. */
function subtractIntervals(coverage: Interval[], booked: Interval[]): Interval[] {
  let open = coverage.map((c) => ({ ...c }));
  for (const b of booked) {
    const next: Interval[] = [];
    for (const o of open) {
      if (b.end <= o.start || b.start >= o.end) {
        next.push(o);
      } else {
        if (b.start > o.start) next.push({ start: o.start, end: b.start });
        if (b.end < o.end) next.push({ start: b.end, end: o.end });
      }
    }
    open = next;
  }
  return open;
}
