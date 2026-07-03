/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument, @typescript-eslint/unbound-method, @typescript-eslint/no-explicit-any */
/**
 * ESLint rules disabled for this file as part of historical full cleanup (REFACTORING_TODO item 10; see RESOLVED.md for details).
 * These are the remaining dynamic/any-heavy areas after previous tranches.
 */

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
import type { FastifyReply } from 'fastify';
import type { AppFastifyInstance } from '../types/fastify';
import type { Pool, PoolClient } from 'pg';
import { timingSafeEqual } from 'crypto';
import { z } from 'zod';
import { withHandler, type AppRequest } from '../middleware';
import { applyTimezone, toLocalWallClock } from '../services/timezoneUtils';
import { validateAppointmentTimeRange } from '../services/appointmentValidation';
import { normalizePhone, isValidPhone } from '../services/phoneUtils';
import { getOrCreateCustomerByPhone } from '../services/customerLookup';
import { findNextAvailableSlots } from '../services/availabilitySearch';
import { resolveServiceForBooking } from '../services/serviceResolver';
import { recordAiCostEvent } from '../services/aiCost';
import { getTenantBufferMinutes } from '../services/tenantBuffer';
import {
  findOverlappingAppointment,
  isOverlapError,
  type AppointmentConflict,
} from '../services/conflictLookup';
import { sendSms, generateVerificationCode } from '../services/telnyxSms';
import {
  getSyncRecorder,
  clearSyncRecorder,
  syncAppointmentToAll,
} from '../services/syncOrchestrator';
import { toolCallsTotal, bookingAttemptsTotal, errorsTotal } from '../services/metrics';
import { sendJobInquiryEmail } from '../services/communications/systemEmail';
import {
  selectAssignments,
  type ResourceCandidate,
  type EmployeeCandidate,
  type ExistingAppointment,
  type ShiftOverride,
  type Shift,
} from '../../shared/scheduling';
import {
  scheduleRemindersForAppointment,
  rescheduleRemindersForAppointment,
} from '../services/reminders/scheduleForAppointment';

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

const FindByNameSchema = z.object({
  name: z.string().min(1),
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
  // Optional — lets a pure availability inquiry (no booking attempt) still be
  // attributed to its voice_session for abandonment-by-service analytics.
  call_id: z.string().min(1).optional(),
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

// save_customer_preference — the AI persists a durable fact about the caller
// (preferred stylist, last service, likes/dislikes, upsell flags) as a
// key/value pair into customers.metadata.preferences. Read back on the next
// call by get_customer_context_for_call. Key is normalized to a short stable
// slug; value is free text the AI heard. Only writes for an existing customer
// (a phone the CRM already knows) — we don't conjure a customer row just to
// hang a preference on, and the agent should have already called
// get_customer_context (or booked) before it has anything worth saving.
const SaveCustomerPreferenceSchema = z.object({
  tenant_id: z.string().uuid(),
  phone: z.string().min(5),
  key: z.string().min(1).max(60),
  value: z.string().min(1).max(500),
});

const IdentifyCallerSchema = z.object({
  tenant_id: z.string().uuid(),
  phone: z.string().min(5),
  name: z.string().min(1).max(200).optional(),
  // When present, link the captured number + customer onto this call's
  // voice_sessions row so the Calls tab shows the verbally-collected number
  // (forwarded-line calls start with caller_phone null).
  call_id: z.string().min(1).optional(),
});

const GetAvailableSlotsSchema = z.object({
  tenant_id: z.string().uuid(),
  service_type: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'),
  // Optional — see GetSchedulingOptionsSchema.call_id (pure-inquiry attribution).
  call_id: z.string().min(1).optional(),
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

// take-message — record a caller message + SMS-notify the owner.
// "Take a message" was previously pure LLM theater — the agent would say it
// but nothing was stored. Now it lands in customer_messages and the owner's
// forward_phone gets a text so no message is silently lost.
const TakeMessageSchema = z.object({
  tenant_id: z.string().uuid(),
  caller_name: z.string().min(1).max(200),
  callback_phone: z.string().optional(),
  caller_phone: z.string().optional(),
  message: z.string().min(1).max(2000),
  call_id: z.string().optional(),
});

// capture-job-inquiry — structured intake when a recruiter asks whether the
// owner is available for work. Persists a job_inquiries row + emails the owner.
// All position fields optional: the contract vs full-time branches collect
// different subsets and a caller may bail mid-intake — a partial inquiry is
// still worth saving + notifying on. caller_name is the only required field.
const CaptureJobInquirySchema = z.object({
  tenant_id: z.string().uuid(),
  caller_name: z.string().min(1).max(200),
  callback_phone: z.string().max(50).optional(),
  company: z.string().max(300).optional(),
  represents_company: z.boolean().optional(),
  employment_type: z.enum(['contract', 'full_time']).optional(),
  rate_range: z.string().max(200).optional(),
  duration: z.string().max(200).optional(),
  location_type: z.enum(['onsite', 'remote', 'hybrid']).optional(),
  address: z.string().max(500).optional(),
  timezone: z.string().max(100).optional(),
  call_id: z.string().min(1).optional(),
});

// voice-session-start / -end — the LiveKit agent logs a call so the dashboard
// Calls tab + customer call history populate. These mirror the JWT-gated
// /voice/session/{start,end} routes but use the agent-secret + body-tenant_id
// auth model every other agent-tools call uses (the agent has no JWT). Both
// reuse the existing start_voice_session / end_voice_session DB functions.
const VoiceSessionStartSchema = z.object({
  tenant_id: z.string().uuid(),
  call_id: z.string().min(1),
  caller_phone: z.string().min(1).nullable().optional(),
});

const VoiceSessionEndSchema = z.object({
  tenant_id: z.string().uuid(),
  call_id: z.string().min(1),
  duration_seconds: z.number().int().nonnegative().nullable().optional(),
  outcome: z.string().max(50).nullable().optional(),
  // Rendered plain-text transcript (Caller:/Assistant: lines). Bound mirrors the
  // agent's MAX_TRANSCRIPT_CHARS so a pathological call can't write a huge row.
  transcript: z.string().max(100_000).nullable().optional(),
  // Post-call LLM summary (1–2 sentences). Bounded so a model can't write a huge row.
  summary: z.string().max(2000).nullable().optional(),
  // The appointment booked during the call, if any. UUID-validated so a malformed
  // id can't reach (and 500) the RPC's ::uuid cast — it just stays null.
  appointment_id: z.string().uuid().nullable().optional(),
});

// Incremental transcript save — the agent posts the transcript-so-far after each
// turn so a call that hangs/never finalizes still has its conversation persisted.
const VoiceSessionTranscriptSchema = z.object({
  tenant_id: z.string().uuid(),
  call_id: z.string().min(1),
  // min(1): never accept an empty transcript — it would blank an active row's
  // existing transcript (accidental data loss). The agent only ever sends a
  // non-empty render(), so this is a boundary guard.
  transcript: z.string().min(1).max(100_000),
});

const MyAppointmentsSchema = z.object({
  tenant_id: z.string().uuid(),
  phone: z.string().min(5),
});

const CancelAppointmentSchema = z.object({
  tenant_id: z.string().uuid(),
  phone: z.string().min(5),
  appointment_id: z.string().uuid(),
});

const RescheduleAppointmentSchema = z.object({
  tenant_id: z.string().uuid(),
  phone: z.string().min(5),
  appointment_id: z.string().uuid(),
  new_start_time: z.string().min(1),
  new_end_time: z.string().min(1),
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
    const msg = parsed.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ');
    void fail(reply, `Validation failed: ${msg}`);
    return null;
  }
  return parsed.data;
}

/**
 * Pull the diagnostic fields off a node-postgres error so a call-logging
 * failure names its own cause in ONE structured log line — no guessing from
 * a generic 500. `code` is the Postgres SQLSTATE (e.g. 23502 = not_null_violation,
 * 23503 = foreign_key_violation, 23505 = unique_violation); `constraint`,
 * `column`, `table`, and `detail` pinpoint exactly what the RPC rejected.
 * Origin: 2026-06-24 — the first real __PERSONA_NAME__ call never logged because
 * start_voice_session() threw on a NULL caller_phone, but the fire-and-forget
 * failure left no diagnosable trace (see feedback_sad_path_instrumentation).
 */
function pgErrorFields(err: unknown): {
  error_message: string;
  sqlstate: string | null;
  constraint: string | null;
  column: string | null;
  table: string | null;
  detail: string | null;
} {
  const e = (err ?? {}) as {
    message?: unknown;
    code?: unknown;
    constraint?: unknown;
    column?: unknown;
    table?: unknown;
    detail?: unknown;
  };
  const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
  // Prefer a string `message` field even when the throw isn't an Error instance
  // (some pg/driver layers throw plain objects) — otherwise String(err) yields
  // "[object Object]" and defeats the one-line-diagnosable goal.
  const error_message = err instanceof Error ? err.message : (str(e.message) ?? String(err));
  return {
    error_message,
    sqlstate: str(e.code),
    constraint: str(e.constraint),
    column: str(e.column),
    table: str(e.table),
    detail: str(e.detail),
  };
}

/**
 * Register a POST /agent-tools/* route with schema validation.
 * Collapses the repeated `app.post + withHandler + parseOrFail` boilerplate.
 * Handler receives already-parsed args; return value is ignored (respond
 * via `ok()` / `fail()`).
 */
function toolRoute<T>(
  app: AppFastifyInstance,
  path: string,
  schema: z.ZodType<T>,
  handler: (args: T, reply: FastifyReply) => Promise<unknown>,
  errorMessage: string
): void {
  // Strip the "/agent-tools/" prefix so the metric label matches the tool
  // name the LLM uses in its prompt (e.g. "book-with-scheduling"). Cardinality
  // is bounded by the number of registered tools (11 today).
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

/**
 * Best-effort, fire-and-forget: stamp the service the caller asked about onto
 * this call's `voice_session` (`requested_service_id`). Used by the booking
 * path AND the pure-availability tools, so a call that only inquired about
 * availability — never attempting a booking — still shows which service they
 * came for (powers abandonment-by-service analytics; the reaper/close finalizes
 * the session as abandoned when no appointment was booked).
 *
 * The agent passes a fuzzy service name; map it to a service_id (shortest ILIKE
 * match). COALESCE keeps any already-captured service so a later, differently-
 * worded mention can't erase the signal with NULL. Never blocks or fails the
 * call — a missing voice_session row (call_id not yet started) is a silent no-op.
 */
function captureRequestedService(
  withTenantClient: <T>(tenantId: string, fn: (client: PoolClient) => Promise<T>) => Promise<T>,
  tenantId: string,
  callId: string | undefined,
  serviceType: string | undefined
): void {
  if (!callId || !serviceType) return;
  void withTenantClient(tenantId, (client) =>
    client.query(
      `UPDATE voice_sessions
          SET requested_service_id = COALESCE(
            (
              SELECT service_id FROM services
               WHERE tenant_id = $1 AND name ILIKE '%' || $2 || '%'
                 AND (is_deleted IS NULL OR is_deleted = false)
               ORDER BY length(name) ASC
               LIMIT 1
            ),
            requested_service_id
          )
        WHERE tenant_id = $1 AND call_id = $3`,
      [tenantId, serviceType, callId]
    )
  ).catch(() => undefined);
}

// ── Route registration ────────────────────────────────────────────────

export function registerAgentToolRoutes(
  app: AppFastifyInstance,
  pool: Pool,
  withTenantClient: <T>(tenantId: string, fn: (client: PoolClient) => Promise<T>) => Promise<T>,
  getEmbedding: (text: string) => Promise<number[]>,
  // Retained for signature stability (callers pass it positionally) but no
  // longer used on the policy-answer path — REDUCING a short caller query
  // collapsed its signal below the out-of-scope floor (see expandQueryForEmbedding).
  _normalizeForEmbedding?: (text: string, options?: { context?: string }) => Promise<string>,
  expandQueryForEmbedding?: (text: string, options?: { context?: string }) => Promise<string>
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
  toolRoute(
    app,
    '/agent-tools/tenant-config',
    GetTenantConfigSchema,
    async (args, reply) => {
      const row = await withTenantClient(args.tenant_id, async (client) => {
        const res = await client.query<{
          name: string;
          timezone: string | null;
          system_prompt: string | null;
          persona_name: string | null;
          first_message: string | null;
          save_preferences_enabled: boolean | null;
          preferences_instructions: string | null;
          tts_voice: string | null;
          tts_speed: number | null;
          tts_soft: boolean | null;
          tts_cheerful: boolean | null;
          tts_formal: boolean | null;
          tts_warm: boolean | null;
          tts_concise: boolean | null;
          forward_phone: string | null;
          forwarded_from_phone: string | null;
        }>(
          `SELECT name, timezone, system_prompt, persona_name, first_message, save_preferences_enabled, preferences_instructions, tts_voice, tts_speed, tts_soft, tts_cheerful, tts_formal, tts_warm, tts_concise, forward_phone, forwarded_from_phone FROM tenants WHERE tenant_id = $1`,
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
        // 2026-05-18: surface the tenant's custom prompt template so the agent
        // worker can substitute placeholders and use it as the role/identity
        // section. NULL means "use the agent's hardcoded fallback" — preserves
        // backwards compatibility with tenants that haven't customized.
        system_prompt: row.system_prompt,
        // 2026-06-30: owner-editable assistant name (dashboard "Assistant Name").
        // The agent injects "Your name is X" so it overrides any name baked into
        // the system_prompt text. NULL = keep whatever the prompt already says.
        persona_name: row.persona_name ?? null,
        // 2026-06-11: the owner-editable greeting (dashboard "First Message").
        // NULL means the agent speaks its hardcoded "Thanks for calling…"
        // fallback, so a tenant that never set one is unaffected.
        first_message: row.first_message ?? null,
        // 2026-06-06: customer-preference capture config. When enabled, the
        // agent injects preferences_instructions into the prompt and is told
        // to call save_customer_preference. Default false / null is "off".
        save_preferences_enabled: row.save_preferences_enabled ?? false,
        preferences_instructions: row.preferences_instructions ?? null,
        // 2026-06-10 (Grok era): per-tenant TTS voice + delivery. NULL means the
        // agent uses platform defaults. Post-2026-06-25 these are OpenAI voice/speed
        // (the columns were kept; legacy Grok-only prosody flags tts_soft etc. are inert).
        // env defaults, so tenants who haven't picked a voice are unaffected.
        tts_voice: row.tts_voice ?? null,
        tts_speed: row.tts_speed ?? null,
        tts_soft: row.tts_soft ?? null,
        tts_cheerful: row.tts_cheerful ?? null,
        tts_formal: row.tts_formal ?? null,
        tts_warm: row.tts_warm ?? null,
        tts_concise: row.tts_concise ?? null,
        // 2026-06-11: live-transfer destination (owner cell). NULL means no
        // forwarding configured — the agent's transfer_call tool stays inert
        // and falls back to taking a message.
        forward_phone: row.forward_phone ?? null,
        // The line the tenant forwards INTO the assistant — caller-ID match
        // tells the agent to collect the caller's real number by voice.
        forwarded_from_phone: row.forwarded_from_phone ?? null,
      });
    },
    'Failed to fetch tenant config'
  );

  // voice-session-start — agent calls this on connect to create the
  // voice_sessions row (and resolve customer context). start_voice_session
  // does a plain INSERT (not idempotent) — the agent calls it once per call
  // and treats failure as non-fatal, so a duplicate/transient error can't
  // affect the live call.
  toolRoute(
    app,
    '/agent-tools/voice-session-start',
    VoiceSessionStartSchema,
    async (args, reply) => {
      try {
        await withTenantClient(args.tenant_id, (client) =>
          client.query('SELECT start_voice_session($1, $2, $3) AS context', [
            args.tenant_id,
            args.call_id,
            args.caller_phone ?? null,
          ])
        );
      } catch (err) {
        // 5W sad-path log so a call that fails to log is diagnosable from ONE
        // line. WHO: tenant_id. WHAT: voice_session_start (caller_phone null =
        // forwarded/anonymous line). WHEN: now (call connect). WHERE: this RPC.
        // WHY: the pg SQLSTATE/constraint/column. Plus errors_total{event} so the
        // failure survives log truncation. The agent calls this fire-and-forget,
        // so without this the call simply vanishes (Calls tab empty, no trace).
        errorsTotal.inc({ event: 'voice_session_start_failed' });
        app.log.error(
          {
            event: 'voice_session_start_failed',
            tenant_id: args.tenant_id,
            call_id: args.call_id,
            caller_phone_present: args.caller_phone != null,
            ...pgErrorFields(err),
          },
          'voice-session-start failed — call will NOT appear in the Calls tab'
        );
        return fail(reply, 'Failed to start voice session', 500);
      }
      return ok(reply, { started: true });
    },
    'Failed to start voice session'
  );

  // voice-session-end — agent calls this from its shutdown callback when the
  // call ends, recording duration, outcome, the rendered transcript, a post-call
  // summary, and the appointment_id booked during the call (all optional; the
  // agent fills what it has). Returns ended:false if no open row matched.
  toolRoute(
    app,
    '/agent-tools/voice-session-end',
    VoiceSessionEndSchema,
    async (args, reply) => {
      let sessionEnd: { ended: boolean; forwardPhone: string | null; inboundPhone: string | null };
      try {
        sessionEnd = await withTenantClient(args.tenant_id, async (client) => {
          const res = await client.query<{ ended: boolean }>(
            'SELECT end_voice_session($1, $2, $3, $4, $5, $6, $7) AS ended',
            [
              args.tenant_id,
              args.call_id,
              args.duration_seconds ?? null,
              args.outcome ?? null,
              args.transcript ?? null,
              args.summary ?? null,
              args.appointment_id ?? null,
            ]
          );
          if (!['price', 'no_availability'].includes(args.outcome ?? '')) {
            return { ended: res.rows[0]?.ended ?? false, forwardPhone: null, inboundPhone: null };
          }
          const tenant = await client.query<{
            forward_phone: string | null;
            inbound_phone: string | null;
          }>('SELECT forward_phone, inbound_phone FROM tenants WHERE tenant_id = $1', [
            args.tenant_id,
          ]);
          return {
            ended: res.rows[0]?.ended ?? false,
            forwardPhone: tenant.rows[0]?.forward_phone ?? null,
            inboundPhone: tenant.rows[0]?.inbound_phone ?? null,
          };
        });
      } catch (err) {
        // 5W sad-path log: an end failure means duration/transcript/outcome/
        // summary never persisted and the row is stranded 'active'. WHO tenant,
        // WHAT voice_session_end, WHERE this RPC, WHY the pg SQLSTATE/constraint.
        errorsTotal.inc({ event: 'voice_session_end_failed' });
        app.log.error(
          {
            event: 'voice_session_end_failed',
            tenant_id: args.tenant_id,
            call_id: args.call_id,
            outcome: args.outcome ?? null,
            has_transcript: args.transcript != null,
            ...pgErrorFields(err),
          },
          'voice-session-end failed — transcript/duration/summary NOT saved; row left active'
        );
        return fail(reply, 'Failed to end voice session', 500);
      }
      const { ended, forwardPhone, inboundPhone } = sessionEnd;

      if (ended && forwardPhone && inboundPhone) {
        const normalizedForward = normalizePhone(forwardPhone);
        const normalizedInbound = normalizePhone(inboundPhone);
        if (
          normalizedForward &&
          normalizedInbound &&
          isValidPhone(normalizedForward) &&
          isValidPhone(normalizedInbound)
        ) {
          const outcomeMsg =
            args.outcome === 'price'
              ? 'had concerns about pricing'
              : 'could not find an available time';
          const body = `SecretaryHQ: A recent caller ${outcomeMsg}. They may be worth a follow-up. — via SecretaryHQ`;
          sendSms({ from: normalizedInbound, to: normalizedForward, body }).catch(
            (err: unknown) => {
              app.log.error({ err }, 'Failed to send outcome-follow-up SMS to owner');
            }
          );
        }
      }

      return ok(reply, { ended });
    },
    'Failed to end voice session'
  );

  // voice-session-transcript — incremental transcript save. The agent posts the
  // transcript-so-far after EVERY turn so a call that hangs or never sends
  // voice-session-end still has its conversation persisted up to the last turn.
  // Updates ONLY while the row is still 'active' (a finalized row's transcript is
  // authoritative — don't let a late straggler overwrite it). status is NOT
  // changed here; finalize/reaper own that.
  toolRoute(
    app,
    '/agent-tools/voice-session-transcript',
    VoiceSessionTranscriptSchema,
    async (args, reply) => {
      try {
        const res = await withTenantClient(args.tenant_id, (client) =>
          client.query(
            `UPDATE voice_sessions SET transcript = $3, updated_at = now()
             WHERE tenant_id = $1 AND call_id = $2 AND status = 'active'`,
            [args.tenant_id, args.call_id, args.transcript]
          )
        );
        return ok(reply, { updated: (res.rowCount ?? 0) > 0 });
      } catch (err) {
        // 5W sad-path: a failed incremental save is non-fatal (the next turn or
        // finalize/reaper catches up) but still worth a counter + named cause.
        errorsTotal.inc({ event: 'voice_session_transcript_failed' });
        app.log.error(
          {
            event: 'voice_session_transcript_failed',
            tenant_id: args.tenant_id,
            call_id: args.call_id,
            transcript_len: args.transcript.length,
            ...pgErrorFields(err),
          },
          'voice-session-transcript incremental save failed (non-fatal)'
        );
        return fail(reply, 'Failed to save transcript', 500);
      }
    },
    'Failed to save transcript'
  );

  // save_customer_preference — persist a durable fact about a known caller
  // into customers.metadata.preferences. The same JSON surface
  // get_customer_context_for_call reads back on the next call, so this closes
  // the write half of the preference round-trip. No-ops gracefully (success
  // shape with saved=false) when the phone isn't a known customer yet, so the
  // LLM relays "noted" without a scary error mid-call.
  toolRoute(
    app,
    '/agent-tools/save-customer-preference',
    SaveCustomerPreferenceSchema,
    async (args, reply) => {
      const normalized = normalizePhone(args.phone);
      if (!isValidPhone(normalized)) {
        return fail(
          reply,
          "That phone number doesn't look complete enough to save a note against."
        );
      }
      // Normalize the key to a short stable slug so repeat saves of the same
      // concept ("preferred stylist" / "Preferred Stylist") collapse onto one
      // JSON key instead of accreting near-duplicates.
      const key = args.key
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
      if (!key) {
        return fail(reply, 'Preference name was empty after cleanup — nothing to save.');
      }

      const saved = await withTenantClient(args.tenant_id, async (client) => {
        // jsonb merge: metadata || { preferences: (metadata.preferences || {}) || { key: value } }
        // Updates only a live (non-deleted) customer the CRM already knows.
        const res = await client.query<{ customer_id: string }>(
          `UPDATE customers
             SET metadata = COALESCE(metadata, '{}'::jsonb)
               || jsonb_build_object(
                    'preferences',
                    COALESCE(metadata->'preferences', '{}'::jsonb)
                      || jsonb_build_object($3::text, $4::text)
                  )
           WHERE tenant_id = $1 AND phone = $2
             AND (is_deleted IS NULL OR is_deleted = false)
           RETURNING customer_id`,
          [args.tenant_id, normalized, key, args.value.trim()]
        );
        return (res.rowCount ?? 0) > 0;
      });

      if (!saved) {
        // Not an error — the caller just isn't a known customer yet. Tell the
        // LLM plainly so it doesn't read an alarming failure to the caller.
        return ok(reply, {
          saved: false,
          message: 'No existing customer for that number yet — preference not stored.',
        });
      }
      return ok(reply, { saved: true, key });
    },
    'Failed to save customer preference'
  );

  // identify_caller — upsert caller as a customer by phone. Creates the row
  // if unknown; updates name when the stored name is blank or "Valued Customer".
  // Called by the agent as soon as the caller gives their name, even without booking,
  // so every call leaves a contact record behind.
  toolRoute(
    app,
    '/agent-tools/identify-caller',
    IdentifyCallerSchema,
    async (args, reply) => {
      const normalized = normalizePhone(args.phone);
      if (!isValidPhone(normalized)) {
        return fail(reply, 'Invalid phone number — cannot create contact.');
      }
      await withTenantClient(args.tenant_id, async (client) => {
        const cust = await client.query<{ customer_id: string }>(
          `INSERT INTO customers (tenant_id, phone, name)
           VALUES ($1, $2, $3)
           ON CONFLICT (tenant_id, phone) DO UPDATE
             SET name = CASE
               WHEN customers.name IS NULL OR customers.name = '' OR customers.name = 'Valued Customer'
               THEN EXCLUDED.name
               ELSE customers.name
             END
           RETURNING customer_id`,
          [args.tenant_id, normalized, args.name ?? null]
        );
        // Backfill the verbally-captured number + customer onto the live call row
        // so the Calls tab shows it (forwarded-line calls started caller_phone
        // null). Best-effort: only the active row for this call; never fatal —
        // a backfill failure (RLS/FK/transient) must not fail the contact save,
        // which is the whole point of identify_caller. COALESCE keeps any
        // existing customer_id rather than nulling it if the upsert RETURNING
        // unexpectedly yielded no row.
        if (args.call_id) {
          try {
            await client.query(
              `UPDATE voice_sessions
                 SET caller_phone = $3,
                     customer_id = COALESCE($4, customer_id),
                     updated_at = now()
               WHERE tenant_id = $1 AND call_id = $2 AND status = 'active'`,
              [args.tenant_id, args.call_id, normalized, cust.rows[0]?.customer_id ?? null]
            );
          } catch (err) {
            app.log.warn(
              { tenantId: args.tenant_id, callId: args.call_id, ...pgErrorFields(err) },
              'identify_caller: voice_sessions backfill failed — contact saved, call row not updated'
            );
          }
        }
      });
      return ok(reply, { saved: true });
    },
    'Failed to identify caller'
  );

  // get_service_catalog — list public services for the tenant.
  toolRoute(
    app,
    '/agent-tools/service-catalog',
    GetServiceCatalogSchema,
    async (args, reply) => {
      const res = await withTenantClient(args.tenant_id, (client) =>
        client.query(
          `SELECT service_id, name, subtitle, description, duration_minutes, price
           FROM services
          WHERE tenant_id = $1 AND is_deleted = false
          ORDER BY name ASC`,
          [args.tenant_id]
        )
      );
      return ok(reply, { services: res.rows });
    },
    'Failed to fetch service catalog'
  );

  // get_customer_context — look up caller by phone, return name + recent
  // call summaries so the agent can greet returning customers with context.
  toolRoute(
    app,
    '/agent-tools/customer-context',
    GetContextSchema,
    async (args, reply) => {
      const normalized = normalizePhone(args.phone);
      if (!normalized) {
        return ok(reply, 'New caller - no history found.');
      }

      const data = await withTenantClient(args.tenant_id, async (client) => {
        const cust = await client.query<{
          customer_id: string;
          name: string;
          preferences: Record<string, unknown> | null;
        }>(
          `SELECT customer_id, name,
                  COALESCE(metadata->'preferences', '{}'::jsonb) AS preferences
          FROM customers
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
          [customer.customer_id]
        );
        return { customer, summaries: sums.rows };
      });

      if (!data) return ok(reply, 'New caller - no history found.');
      return ok(reply, {
        name: data.customer.name || 'Unknown',
        history: data.summaries.map((s) => s.summary).join('; ') || 'No history',
        // Saved customer preferences (preferred staff, last service, likes)
        // captured by save_customer_preference. THIS is how they reach the
        // LLM on the next call — the agent's get_customer_context tool reads
        // this route, so preferences must ride along here, not only in the
        // dashboard's get_customer_context_for_call path. Default {} when none.
        preferences: data.customer.preferences ?? {},
      });
    },
    'Failed to fetch customer context'
  );

  // find-customer-by-name — name-first caller identification. The agent asks
  // the caller's name, looks them up by it, and (when found) reads back the
  // stored number to confirm "is this still your number?". Needed because the
  // inbound line is forwarded — caller ID is the forwarding cell, not the
  // caller — so name is the only identifier we can trust on first contact.
  // Returns up to 5 matches (name + phone) so the agent can confirm or, if the
  // number is stale/wrong, collect a new one and create a fresh entry.
  toolRoute(
    app,
    '/agent-tools/find-customer-by-name',
    FindByNameSchema,
    async (args, reply) => {
      const trimmed = args.name.trim();
      if (!trimmed) {
        return ok(reply, { matches: [] });
      }
      // Escape LIKE metacharacters so a spoken/transcribed name containing
      // `%` or `_` matches literally instead of acting as a wildcard — an
      // unescaped `%` would ILIKE-match the tenant's entire address book and
      // over-disclose names+phones (found 2026-07-01 by the real-DB companion
      // test; see docs/TEST_DB_AUDIT.md). Backslash is Postgres's default
      // LIKE escape character.
      const likeTerm = trimmed.replace(/([\\%_])/g, '\\$1');

      const matches = await withTenantClient(args.tenant_id, async (client) => {
        const res = await client.query<{ name: string | null; phone: string | null }>(
          // Derive a display name from first/last when the `name` column is
          // empty (common for imported rows) so a real match never surfaces as
          // "Unknown" to the agent.
          `SELECT COALESCE(
                    NULLIF(name, ''),
                    NULLIF(TRIM(COALESCE(first_name, '') || ' ' || COALESCE(last_name, '')), '')
                  ) AS name,
                  phone
             FROM customers
            WHERE tenant_id = $1
              AND (is_deleted IS NULL OR is_deleted = false)
              AND (
                name ILIKE '%' || $2 || '%'
                OR TRIM(COALESCE(first_name, '') || ' ' || COALESCE(last_name, '')) ILIKE '%' || $2 || '%'
              )
            ORDER BY updated_at DESC NULLS LAST
            LIMIT 5`,
          [args.tenant_id, likeTerm]
        );
        return res.rows;
      });

      // Shape kept LLM-friendly: a plain list of {name, phone}. Empty list =
      // no match → the agent treats them as a new caller.
      return ok(reply, {
        matches: matches.map((m) => ({
          name: m.name || 'Unknown',
          phone: m.phone || null,
        })),
      });
    },
    'Failed to search customers by name'
  );

  // check_availability — wraps check_availability_with_tz() RPC. The agent
  // sends naive datetimes; we apply the tenant's timezone before the RPC
  // since Postgres can't know which zone "2026-05-01 14:00" is meant in.
  toolRoute(
    app,
    '/agent-tools/check-availability',
    CheckAvailabilitySchema,
    async (args, reply) => {
      if (isNaN(Date.parse(args.start_time)) || isNaN(Date.parse(args.end_time))) {
        return fail(reply, 'Invalid date format provided for availability check.');
      }
      if (new Date(args.end_time) <= new Date(args.start_time)) {
        return fail(reply, 'End time must be after start time.');
      }

      const result = await withTenantClient(args.tenant_id, async (client) => {
        const tz = await client.query<{ timezone: string; default_buffer_minutes: number | null }>(
          `SELECT COALESCE(timezone, 'America/Chicago') AS timezone, default_buffer_minutes FROM tenants WHERE tenant_id = $1`,
          [args.tenant_id]
        );
        const ianaTimezone = tz.rows[0]?.timezone || 'America/Chicago';
        // Buffer makes "is this slot free?" agree with what booking will accept,
        // so the agent never reports a within-buffer time as available.
        const bufferMinutes =
          typeof tz.rows[0]?.default_buffer_minutes === 'number' &&
          tz.rows[0].default_buffer_minutes > 0
            ? tz.rows[0].default_buffer_minutes
            : 0;
        const start = applyTimezone(args.start_time, ianaTimezone);
        const end = applyTimezone(args.end_time, ianaTimezone);
        const rpc = await client.query(
          'SELECT * FROM check_availability_with_tz($1, $2, $3::timestamptz, $4::timestamptz, $5, $6)',
          [args.tenant_id, args.resource_id, start, end, null, bufferMinutes]
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
    },
    'Failed to check availability'
  );

  // get_company_policy_answer — normalize question, embed it, cosine
  // similarity over pgvector, return joined matches. Falls back to a
  // conversational no-match message and logs the gap for the owner.
  toolRoute(
    app,
    '/agent-tools/policy-answer',
    GetPolicyAnswerSchema,
    async (args, reply) => {
      // EXPAND the caller's query before embedding (the inverse of the
      // reductive normalization used at ingest). A terse question like
      // "what's your address" shares no vocabulary with a doc that says
      // "located", so under pure cosine it scored 0.31 — below the old 0.5
      // threshold and even below true out-of-scope questions once normalized.
      // Expansion adds synonyms ("address location where located directions")
      // to bridge the gap: measured lift 0.31 → 0.41 on address cases while
      // out-of-scope stays ≤0.25 (see shared/expandQueryForEmbedding.ts).
      let queryText = args.question;
      if (expandQueryForEmbedding) {
        try {
          queryText = await expandQueryForEmbedding(args.question, {
            context: 'customer phone inquiry',
          });
        } catch {
          // fall back to the raw question
        }
      }
      // Graceful "I can't answer that" line, reused for BOTH zero RAG hits and
      // an embedding/lookup failure. A caller must never hear a raw 500/JSON.
      const policyFallback =
        "I don't have specific information on that topic right now. I'd be happy to take a message so the owner can get back to you, or if there's anything else I can help with — like booking an appointment or answering questions about our services — I'm here for you.";

      // getEmbedding hits OpenAI — if it's down/slow/over-quota it THROWS, which
      // (unguarded) becomes an HTTP 500 the agent relays as technical JSON
      // ("Backend returned 500") instead of the warm fallback. Catch it and
      // degrade to the same graceful message the zero-hits path uses.
      let embedding: number[];
      try {
        embedding = await getEmbedding(queryText);
      } catch (err) {
        errorsTotal.inc({ event: 'policy_answer_embedding_failed' });
        app.log.error(
          {
            event: 'policy_answer_embedding_failed',
            tenant_id: args.tenant_id,
            ...pgErrorFields(err),
          },
          'policy-answer: embedding failed — degraded to graceful fallback (caller not left silent)'
        );
        return ok(reply, policyFallback);
      }

      // ~4 chars/token heuristic; embedding billed per input token (price mirrors aiCost PRICING).
      const embTokens = Math.ceil(queryText.length / 4);
      const embCost = embTokens * 0.02e-6;
      withTenantClient(args.tenant_id, (client) =>
        recordAiCostEvent(client, {
          tenantId: args.tenant_id,
          source: 'kb_query',
          provider: 'openai',
          model: 'text-embedding-3-small',
          inputTokens: embTokens,
          estimatedCostUsd: embCost,
        })
      ).catch(() => undefined);

      // Threshold 0.30 (down from 0.5): validated against a widened eval set
      // (8 paraphrased positives + true out-of-scope negatives). text-embedding-3-small
      // cosine clusters tightly (~0.2–0.65 here); 0.5 was unreachable for any
      // vocabulary-gap query. 0.30 sits in the measured ~0.13 gap between the
      // lowest expanded positive (0.377) and the highest true negative (0.248).
      // Also pull tenant_doc_id (the RPC returns it) so we can attribute each
      // chunk to its source document for caller-facing citations.
      const matches = await withTenantClient(args.tenant_id, (client) =>
        client.query<{ tenant_doc_id: string; content: string; similarity: number }>(
          'SELECT tenant_doc_id, content, similarity FROM search_tenant_docs_normalized($1, $2::vector, $3, $4)',
          [args.tenant_id, JSON.stringify(embedding), 0.3, 3]
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
        return ok(reply, policyFallback);
      }

      // Resolve the source title of each matched chunk so the agent can cite it
      // ("according to our cancellation policy…"). Best-effort: a failed/empty
      // lookup just yields un-attributed context, never a failed answer.
      const docIds = matches.rows.map((m) => m.tenant_doc_id).filter(Boolean);
      let titleById = new Map<string, string>();
      if (docIds.length > 0) {
        try {
          const titlesRes = await withTenantClient(args.tenant_id, (client) =>
            client.query<{ tenant_doc_id: string; title: string | null }>(
              // ANY($2::uuid[]) — without the cast Postgres compares uuid against
              // a text[] and errors (operator does not exist: uuid = text), which
              // the catch below would swallow → citations would silently never appear.
              'SELECT tenant_doc_id, title FROM tenant_docs WHERE tenant_id = $1 AND tenant_doc_id = ANY($2::uuid[])',
              [args.tenant_id, docIds]
            )
          );
          titleById = new Map(
            titlesRes.rows.filter((r) => r.title).map((r) => [r.tenant_doc_id, r.title as string])
          );
        } catch {
          // citation lookup is non-critical — fall back to un-attributed context
        }
      }

      // Prefix each chunk with its source so the LLM can attribute the answer.
      const context = matches.rows
        .map((m) => {
          const title = titleById.get(m.tenant_doc_id);
          return title ? `[From "${title}"]\n${m.content}` : m.content;
        })
        .join('\n\n---\n\n');
      return ok(reply, context);
    },
    'Failed to answer policy question'
  );

  // book_appointment — upsert customer by phone, then call
  // book_appointment_atomic RPC. The RPC does all the conflict / shift /
  // skill validation server-side; we just translate the (success, err)
  // tuple into the conversational response shape.
  toolRoute(
    app,
    '/agent-tools/book-appointment',
    BookAppointmentSchema,
    async (args, reply) => {
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
        // Buffer enforced on the agent path only (owner manual booking via
        // /appointments/create passes no buffer → 0 → unrestricted).
        const bufferMinutes = await getTenantBufferMinutes(client, args.tenant_id);
        // The agent supplies the caller's LOCAL wall-clock time (tenant tz), not
        // UTC. Without this, a naive "T15:30:00" is parsed as 15:30 UTC and the
        // appointment lands hours off (10:30 CDT for a 3:30 PM request). Convert
        // via applyTimezone (DST-correct; a no-op if the value already carries a
        // Z/offset) using the tenant's zone — matching check-availability.
        const tzRes = await client.query<{ timezone: string }>(
          `SELECT COALESCE(timezone, 'America/Chicago') AS timezone FROM tenants WHERE tenant_id = $1`,
          [args.tenant_id]
        );
        const ianaTimezone = tzRes.rows[0]?.timezone || 'America/Chicago';
        const startUtc = applyTimezone(args.start_time, ianaTimezone);
        const endUtc = applyTimezone(args.end_time, ianaTimezone);
        // p_assignment_id is TEXT in the current RPC (holds UUID post-Phase 9).
        // Trailing NULLs are p_service_id / p_customer_phone / p_customer_name
        // (unused on this path); the final arg is p_buffer_minutes.
        const rpc = await client.query<{
          success: boolean;
          appointment_id: string | null;
          error_message: string | null;
        }>(
          `SELECT * FROM book_appointment_atomic(
           $1, $2, $3, $4::timestamptz, $5::timestamptz, $6, $7, $8, $9, NULL, NULL, NULL, $10
         )`,
          [
            args.tenant_id,
            args.resource_id,
            customerId,
            startUtc,
            endUtc,
            args.description,
            args.call_id,
            args.location || null,
            args.employee_id || null,
            bufferMinutes,
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
        bookingAttemptsTotal.inc({
          outcome: bookingOutcomeFromAgentError(result?.error_message),
          source: 'agent',
        });
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
        return fail(reply, result?.error_message || 'Booking failed due to a scheduling conflict.');
      }
      bookingAttemptsTotal.inc({ outcome: 'success', source: 'agent' });
      // Fire-and-forget: schedule confirmation SMS + reminders. Errors are
      // swallowed inside scheduleRemindersForAppointment — a reminder failure
      // must never fail the booking response.
      if (result.appointment_id) {
        void scheduleRemindersForAppointment(
          withTenantClient,
          args.tenant_id,
          result.appointment_id,
          app.log
        );
      }
      return ok(reply, {
        success: true,
        appointment_id: result.appointment_id,
        error_message: null,
      });
    },
    'Failed to book appointment'
  );

  // get_scheduling_options — pure-selector scheduling helper. Loads the
  // tenant's resources/employees/shifts/appointments for the day of the
  // window and runs the shared selectAssignments() algorithm. Diagnostics
  // explain *why* nothing matched when options is empty — the agent uses
  // the reason string to ask a better follow-up question.
  toolRoute(
    app,
    '/agent-tools/scheduling-options',
    GetSchedulingOptionsSchema,
    async (args, reply) => {
      if (isNaN(Date.parse(args.window.from)) || isNaN(Date.parse(args.window.to))) {
        return fail(reply, 'Invalid date format in scheduling window.');
      }
      const windowFrom = new Date(args.window.from);
      const windowTo = new Date(args.window.to);
      if (windowTo <= windowFrom) {
        return fail(reply, 'Window end must be after window start.');
      }
      const dateStr = windowFrom.toISOString().substring(0, 10);

      // Pure availability inquiry → attribute the requested service to this
      // call's voice_session so a caller who never attempts a booking still
      // counts toward abandonment-by-service. Fire-and-forget.
      captureRequestedService(
        withTenantClient,
        args.tenant_id,
        args.call_id,
        args.requirements.serviceType
      );

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

        const empRes = await client.query<{ employee_id: string; skills: string[] }>(
          `SELECT employee_id::text AS employee_id, skills
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

        const bufferMinutes = await getTenantBufferMinutes(client, args.tenant_id);
        return { resRes, empRes, apptRes, shiftRes, bufferMinutes };
      });

      const resources: ResourceCandidate[] = data.resRes.rows.map((r) => ({
        resource_id: r.resource_id,
        capabilities: r.capabilities || [],
      }));
      const employees: EmployeeCandidate[] = data.empRes.rows.map((e) => ({
        employee_id: e.employee_id,
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
        bufferMinutes: data.bufferMinutes,
      });

      return ok(reply, { options, diagnostics });
    },
    'Failed to compute scheduling options'
  );

  // book_with_scheduling — single-query booking via RPC that does customer
  // upsert + skill/shift matching + conflict check + insert in one tx.
  // Surfaces the RPC's error_code (TIMESLOT_OCCUPIED / NO_SKILLED_EMPLOYEE
  // / EMPLOYEE_NOT_SCHEDULED / NO_AVAILABILITY) so the agent can explain
  // the failure specifically rather than "something went wrong".
  toolRoute(
    app,
    '/agent-tools/book-with-scheduling',
    BookWithSchedulingSchema,
    async (args, reply) => {
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
        // Resolve the service (falls through to the tenant default when the
        // spoken type doesn't match — so the booking uses a REAL service that
        // carries required_skills, and the RPC can assign a qualified employee
        // instead of failing NO_SKILLED_EMPLOYEE / booking an employee-less slot).
        const resolved = await resolveServiceForBooking(
          client,
          args.tenant_id,
          args.requirements.serviceType
        );
        // Buffer enforced on the agent path; the RPC's internal slot selection
        // skips any resource/employee that would land within the buffer of an
        // existing appointment, so the slot it picks is one booking will accept.
        const bufferMinutes = await getTenantBufferMinutes(client, args.tenant_id);
        // The agent's window is the caller's LOCAL wall-clock (tenant tz), not
        // UTC. `new Date(naive).toISOString()` would read it in the SERVER zone
        // (Railway = UTC) and search the wrong absolute window. Convert via
        // applyTimezone (DST-correct; no-op if already offset-carrying) — same
        // as check-availability + book-appointment.
        const tzRes = await client.query<{ timezone: string }>(
          `SELECT COALESCE(timezone, 'America/Chicago') AS timezone FROM tenants WHERE tenant_id = $1`,
          [args.tenant_id]
        );
        const ianaTimezone = tzRes.rows[0]?.timezone || 'America/Chicago';
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
           $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17
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
            applyTimezone(args.window.from, ianaTimezone),
            applyTimezone(args.window.to, ianaTimezone),
            // Prefer the resolved service's required_skills (so the RPC assigns
            // a skilled employee); fall back to any the agent explicitly supplied.
            (resolved?.required_skills?.length
              ? resolved.required_skills
              : args.requirements.requiredEmployeeSkills) || [],
            args.requirements.requiredResourceCapabilities || [],
            args.requirements.preferredResourceId || null,
            null, // p_preferred_employee_id
            resolved?.name ?? args.requirements.serviceType ?? null,
            resolved?.duration_minutes ?? 30,
            bufferMinutes, // p_buffer_minutes
          ]
        );
        const row = rpc.rows[0];
        // Response symmetry: the RPC returns booked_start/end as UTC. The agent
        // speaks these back to confirm ("booked for 3:30 PM"), so convert them
        // to the tenant-local wall-clock — otherwise it would confirm the UTC
        // instant (8:30 PM for a 3:30 PM Chicago booking), reintroducing the
        // same tz mismatch on the read-back that we just fixed on the write.
        if (row) {
          if (row.booked_start) row.booked_start = toLocalWallClock(row.booked_start, ianaTimezone);
          if (row.booked_end) row.booked_end = toLocalWallClock(row.booked_end, ianaTimezone);
        }
        return row;
      });

      // Best-effort: record the service the caller was trying to book — runs
      // whether the booking SUCCEEDED or FAILED, so an abandoned booking
      // attempt still shows which service they came for.
      captureRequestedService(
        withTenantClient,
        args.tenant_id,
        args.call_id,
        args.requirements.serviceType
      );

      if (!result || !result.success) {
        // Fetch next-available alternatives so the agent can propose them
        // verbally instead of saying "no availability." Same skill +
        // capability filters as the booking attempt, searches forward up
        // to 24h. Failure to find alternatives leaves next_available
        // empty; the agent prompt handles both shapes.
        const nextAvailable = await withTenantClient(args.tenant_id, async (client) => {
          // Same buffer as the booking attempt, so every suggested alternative
          // is one the agent can actually book under this tenant's buffer.
          const bufferMinutes = await getTenantBufferMinutes(client, args.tenant_id);
          return findNextAvailableSlots(client, {
            tenantId: args.tenant_id,
            fromTime: new Date(args.window.from).toISOString(),
            durationMinutes: 30,
            requiredSkills: args.requirements.requiredEmployeeSkills || [],
            requiredCapabilities: args.requirements.requiredResourceCapabilities || [],
            count: 5,
            bufferMinutes,
          });
        }).catch(() => []);
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
      if (result.appointment_id) {
        void scheduleRemindersForAppointment(
          withTenantClient,
          args.tenant_id,
          result.appointment_id,
          app.log
        );
      }
      return ok(reply, {
        success: true,
        appointment_id: result.appointment_id,
        resource_name: result.resource_name,
        employee_name: result.employee_name,
        booked_start: result.booked_start,
        booked_end: result.booked_end,
        error_message: null,
      });
    },
    'Failed to book with scheduling'
  );

  // get_available_slots — computes open windows for a service on a given
  // date. Single SQL union-all pulls service + shifts + appointments in
  // one round trip; interval math then merges shift coverage and subtracts
  // bookings. Returns a *spoken* string because the agent relays it
  // verbatim to the caller.
  toolRoute(
    app,
    '/agent-tools/available-slots',
    GetAvailableSlotsSchema,
    async (args, reply) => {
      // Pure availability inquiry → attribute the requested service to this
      // call's voice_session so a caller who never attempts a booking still
      // counts toward abandonment-by-service. Fire-and-forget.
      captureRequestedService(withTenantClient, args.tenant_id, args.call_id, args.service_type);

      // Resolve the service FIRST — falls through to the tenant default when
      // the caller's spoken type doesn't match a real service, so "a meeting" /
      // "consulting" / anything never dead-ends with "couldn't find a service".
      // Null only when the tenant has no bookable service at all.
      const service = await withTenantClient(args.tenant_id, (client) =>
        resolveServiceForBooking(client, args.tenant_id, args.service_type)
      );

      // Format date for speech ("Wednesday, April 2")
      const dateObj = new Date(args.date + 'T12:00:00');
      const dayName = dateObj.toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
      });

      if (!service) {
        return ok(
          reply,
          `I'm not able to pull up our booking options right now. Would you like to leave a message and I'll have Dale get back to you?`
        );
      }

      const data = await withTenantClient(args.tenant_id, async (client) => {
        const res = await client.query<{
          source: 'shift' | 'appointment';
          start_time: string | null;
          end_time: string | null;
        }>(
          `WITH active_employees AS (
             SELECT employee_id FROM employees
              WHERE tenant_id = $1 AND is_active = true
                AND (is_deleted IS NULL OR is_deleted = false)
           ),
           effective_shifts AS (
             SELECT DISTINCT es.start_time::text AS start_time, es.end_time::text AS end_time
               FROM active_employees ae
               JOIN employee_schedule es
                 ON es.employee_id = ae.employee_id
                AND es.tenant_id = $1
                AND es.shift_date = $2::date
                AND es.is_off = false
                AND es.start_time IS NOT NULL
           ),
           day_appointments AS (
             SELECT start_time::text, end_time::text
               FROM appointments
              WHERE tenant_id = $1 AND status = 'scheduled'
                AND (is_deleted IS NULL OR is_deleted = false)
                AND start_time::date = $2::date
           )
           SELECT 'shift'::text AS source, start_time, end_time FROM effective_shifts
           UNION ALL
           SELECT 'appointment'::text, start_time, end_time FROM day_appointments
           ORDER BY source, start_time`,
          [args.tenant_id, args.date]
        );
        const shifts: Array<{ start_time: string; end_time: string }> = [];
        const appointments: Array<{ start_time: string; end_time: string }> = [];
        for (const row of res.rows) {
          if (row.source === 'shift' && row.start_time && row.end_time) {
            shifts.push({ start_time: row.start_time, end_time: row.end_time });
          } else if (row.source === 'appointment' && row.start_time && row.end_time) {
            appointments.push({ start_time: row.start_time, end_time: row.end_time });
          }
        }
        // Buffer so the openings we read aloud match what booking will accept.
        const bufferMinutes = await getTenantBufferMinutes(client, args.tenant_id);
        return { shifts, appointments, bufferMinutes };
      });

      const { name: serviceName, duration_minutes, price } = service;
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
      // Expand each booking by the tenant's buffer on both sides before
      // subtracting it from shift coverage, so the open windows we offer keep
      // the required gap around existing appointments (matches the booking RPC).
      const booked = data.appointments.map((a) => ({
        start: dateTimeToMinutes(a.start_time) - data.bufferMinutes,
        end: dateTimeToMinutes(a.end_time) + data.bufferMinutes,
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
        if (s.start === coverage[0]?.start && s.end === coverage[coverage.length - 1]?.end) {
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
          : slotStrings.slice(0, -1).join(', ') + ', and ' + slotStrings[slotStrings.length - 1];

      return ok(
        reply,
        `${serviceInfo} On ${dayName}, our hours are ${openHours}. We have openings ${slotsText}. What time works best for you?`
      );
    },
    'Failed to compute available slots'
  );

  // send_verification_code — used when caller-ID is blocked/garbled/missing
  // and the caller has verbally provided a phone. Generate a 6-digit code,
  // bcrypt-hash it, store with 10-min TTL, SMS it via Telnyx. Rate-limited
  // to prevent this becoming a free SMS-spam relay.
  toolRoute(
    app,
    '/agent-tools/send-verification-code',
    SendVerificationCodeSchema,
    async (args, reply) => {
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
          `SELECT inbound_phone FROM tenants WHERE tenant_id = $1`,
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
        app.log.warn(
          { event: 'otp_sms_send_failed', error: sms.error, status: sms.status },
          'Telnyx SMS send failed'
        );
        return fail(
          reply,
          'I had trouble sending that text. Could you try saying the number again, or we can take a message instead.'
        );
      }

      return ok(reply, {
        sent: true,
        phone: normalized,
        message:
          'I just sent you a text with a short code. When it comes through, just read it back to me.',
      });
    },
    'Failed to send verification code'
  );

  // verify_phone_code — compare caller-spoken code against the stored hash.
  // On success, marks the row verified. On failure, increments attempt
  // count and refuses further tries once we hit MAX_VERIFY_ATTEMPTS so a
  // stolen phone number can't be brute-forced over a long call.
  toolRoute(
    app,
    '/agent-tools/verify-phone-code',
    VerifyPhoneCodeSchema,
    async (args, reply) => {
      if (!isValidPhone(args.phone)) {
        return fail(reply, "That doesn't look like a valid number — could you say it again?");
      }
      const normalized = normalizePhone(args.phone)!;

      const result = await withTenantClient(args.tenant_id, async (client) => {
        // Most recent unverified row for this phone.
        const row = await client.query<{
          phone_verification_id: string;
          code_hash: string;
          expires_at: string;
          attempt_count: number;
        }>(
          `SELECT phone_verification_id, code_hash, expires_at, attempt_count
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
            `UPDATE phone_verifications SET verified_at = now() WHERE phone_verification_id = $1`,
            [v.phone_verification_id]
          );
          return { kind: 'verified' as const };
        }

        await client.query(
          `UPDATE phone_verifications SET attempt_count = attempt_count + 1 WHERE phone_verification_id = $1`,
          [v.phone_verification_id]
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
        return fail(reply, "That code has expired. I can send you a new one if you'd like.");
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
    },
    'Failed to verify phone code'
  );

  // take-message — persist caller message + optionally SMS-alert the owner.
  // Up to now "I'll take a message" was pure LLM theater; this makes it real.
  toolRoute(
    app,
    '/agent-tools/take-message',
    TakeMessageSchema,
    async (args, reply) => {
      const callbackPhone = args.callback_phone ? normalizePhone(args.callback_phone) : null;
      const callerPhone = args.caller_phone ? normalizePhone(args.caller_phone) : null;

      const row = await withTenantClient(args.tenant_id, async (client) => {
        // Resolve customer_id if we have a phone. Non-fatal if lookup fails.
        let customerId: string | null = null;
        const lookupPhone = callerPhone ?? callbackPhone;
        if (lookupPhone && isValidPhone(lookupPhone)) {
          const cust = await client.query<{ customer_id: string }>(
            `SELECT customer_id FROM customers
             WHERE tenant_id = $1 AND phone = $2
               AND (is_deleted IS NULL OR is_deleted = false)
             LIMIT 1`,
            [args.tenant_id, lookupPhone]
          );
          customerId = cust.rows[0]?.customer_id ?? null;
        }

        const res = await client.query<{ message_id: string }>(
          `INSERT INTO customer_messages
             (tenant_id, customer_id, caller_phone, caller_name, callback_phone, message, call_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING message_id`,
          [
            args.tenant_id,
            customerId,
            callerPhone,
            args.caller_name,
            callbackPhone,
            args.message,
            args.call_id ?? null,
          ]
        );

        // Fetch the owner-notification number + inbound (from) number.
        // Prefer the dedicated owner_phone (the dashboard "Owner Notification
        // Phone") so message alerts are decoupled from forward_phone (the live
        // call-transfer destination): a tenant can take messages with no live
        // transfer (forward_phone blank) yet still get texted. Fall back to
        // forward_phone for tenants that only set that.
        const tenant = await client.query<{
          owner_phone: string | null;
          forward_phone: string | null;
          inbound_phone: string | null;
        }>(`SELECT owner_phone, forward_phone, inbound_phone FROM tenants WHERE tenant_id = $1`, [
          args.tenant_id,
        ]);

        return {
          message_id: res.rows[0]?.message_id ?? null,
          notifyPhone: tenant.rows[0]?.owner_phone ?? tenant.rows[0]?.forward_phone ?? null,
          inboundPhone: tenant.rows[0]?.inbound_phone ?? null,
        };
      });

      // SMS the owner at the notification number. Fire-and-forget; failure
      // doesn't un-save the message.
      let notified = false;
      const normalizedNotify = row.notifyPhone ? normalizePhone(row.notifyPhone) : null;
      const normalizedInbound = row.inboundPhone ? normalizePhone(row.inboundPhone) : null;
      if (
        normalizedNotify &&
        normalizedInbound &&
        isValidPhone(normalizedNotify) &&
        isValidPhone(normalizedInbound)
      ) {
        const callbackDisplay = callbackPhone ?? callerPhone ?? 'no number left';
        const body =
          `New message from ${args.caller_name} (${callbackDisplay}): ` +
          `${args.message.slice(0, 300)}${args.message.length > 300 ? '…' : ''}` +
          ' — via SecretaryHQ';
        const sms = await sendSms({ from: normalizedInbound, to: normalizedNotify, body });
        notified = sms.ok;
        if (!sms.ok) {
          app.log.warn(
            { tenantId: args.tenant_id, notifyPhone: normalizedNotify, error: sms.error },
            'take_message: owner SMS notification failed — message saved but owner not alerted'
          );
        }
      } else if (row.notifyPhone || row.inboundPhone) {
        app.log.warn(
          {
            tenantId: args.tenant_id,
            notifyPhone: row.notifyPhone,
            inboundPhone: row.inboundPhone,
          },
          'take_message: owner SMS skipped — notify phone or inbound_phone is invalid/unnormalizable'
        );
      }

      return ok(reply, {
        saved: true,
        message_id: row.message_id,
        notified,
        message: notified
          ? 'Message saved and the owner has been notified by text.'
          : 'Message saved. The owner will be able to see it in their dashboard.',
      });
    },
    'Failed to save message'
  );

  // capture-job-inquiry — persist a structured work/job inquiry + email the owner.
  // The agent runs a deterministic intake (company, contract vs full-time, rate,
  // duration, onsite/remote/hybrid, address/timezone) and calls this once it has
  // the answers. Email is best-effort and instrumented; the DB row is the durable
  // record (owner can still see it if email is in simulation mode or fails).
  toolRoute(
    app,
    '/agent-tools/capture-job-inquiry',
    CaptureJobInquirySchema,
    async (args, reply) => {
      const callbackPhone = args.callback_phone ? normalizePhone(args.callback_phone) : null;

      const row = await withTenantClient(args.tenant_id, async (client) => {
        // Link to an existing customer if the callback number matches one. Non-fatal.
        let customerId: string | null = null;
        if (callbackPhone && isValidPhone(callbackPhone)) {
          const cust = await client.query<{ customer_id: string }>(
            `SELECT customer_id FROM customers
             WHERE tenant_id = $1 AND phone = $2
               AND (is_deleted IS NULL OR is_deleted = false)
             LIMIT 1`,
            [args.tenant_id, callbackPhone]
          );
          customerId = cust.rows[0]?.customer_id ?? null;
        }

        const res = await client.query<{ job_inquiry_id: string }>(
          `INSERT INTO job_inquiries
             (tenant_id, customer_id, company, represents_company, employment_type,
              rate_range, duration, location_type, address, timezone,
              caller_name, callback_phone, call_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
           RETURNING job_inquiry_id`,
          [
            args.tenant_id,
            customerId,
            args.company ?? null,
            args.represents_company ?? null,
            args.employment_type ?? null,
            args.rate_range ?? null,
            args.duration ?? null,
            args.location_type ?? null,
            args.address ?? null,
            args.timezone ?? null,
            args.caller_name,
            callbackPhone,
            args.call_id ?? null,
          ]
        );

        // Resolve the notification recipient: the dedicated job_inquiry_email,
        // else the tenant owner's user email.
        const recip = await client.query<{ email: string | null }>(
          `SELECT COALESCE(
                    t.job_inquiry_email,
                    (SELECT u.email FROM users u
                      WHERE u.tenant_id = t.tenant_id AND u.role = 'owner'
                      ORDER BY u.created_at ASC LIMIT 1)
                  ) AS email
             FROM tenants t WHERE t.tenant_id = $1`,
          [args.tenant_id]
        );

        return {
          job_inquiry_id: res.rows[0]?.job_inquiry_id ?? null,
          recipient: recip.rows[0]?.email ?? null,
        };
      });

      // Email the owner. Best-effort: the row is already persisted, so a failure
      // here never un-saves the inquiry — instrument it (metric + 5W log) so a
      // silent simulation-mode / SMTP failure is diagnosable, not invisible.
      let emailed = false;
      if (row.recipient) {
        try {
          await sendJobInquiryEmail(row.recipient, {
            company: args.company,
            representsCompany: args.represents_company,
            employmentType: args.employment_type,
            rateRange: args.rate_range,
            duration: args.duration,
            locationType: args.location_type,
            address: args.address,
            timezone: args.timezone,
            callerName: args.caller_name,
            callbackPhone,
          });
          emailed = true;
        } catch (err) {
          errorsTotal.inc({ event: 'job_inquiry_email_failed' });
          app.log.error(
            { tenantId: args.tenant_id, recipient: row.recipient, ...pgErrorFields(err) },
            'capture_job_inquiry: owner email failed — inquiry saved but owner not emailed'
          );
        }
      } else {
        // No recipient configured at all — surface it; the owner gets nothing.
        errorsTotal.inc({ event: 'job_inquiry_no_recipient' });
        app.log.warn(
          { tenantId: args.tenant_id },
          'capture_job_inquiry: no job_inquiry_email and no owner email — inquiry saved but not emailed'
        );
      }

      return ok(reply, {
        saved: true,
        job_inquiry_id: row.job_inquiry_id,
        emailed,
        message:
          "Thanks — I've passed those details along to Dale and he'll get back to you. " +
          'Please also email a job description to his inbox with your name and company in the subject line.',
      });
    },
    'Failed to capture job inquiry'
  );

  // my-appointments — return upcoming scheduled appointments for the calling phone.
  // Phone is server-injected (never from LLM) to prevent cross-caller enumeration.
  toolRoute(
    app,
    '/agent-tools/my-appointments',
    MyAppointmentsSchema,
    async (args, reply) => {
      const normalized = normalizePhone(args.phone);
      if (!normalized) return fail(reply, 'Invalid phone number');

      const rows = await withTenantClient(args.tenant_id, async (client) => {
        return client.query<{
          appointment_id: string;
          start_time: string;
          end_time: string;
          description: string | null;
          status: string;
          service_name: string | null;
          employee_name: string | null;
        }>(
          `SELECT a.appointment_id, a.start_time, a.end_time, a.description, a.status,
                  s.name AS service_name,
                  e.name AS employee_name
           FROM appointments a
           JOIN customers c ON a.customer_id = c.customer_id
           LEFT JOIN services s ON a.service_id = s.service_id AND s.tenant_id = a.tenant_id
           LEFT JOIN employees e ON a.employee_id = e.employee_id AND e.tenant_id = a.tenant_id
           WHERE c.tenant_id = $1 AND c.phone = $2
             AND a.status = 'scheduled' AND a.start_time > NOW()
             AND (a.is_deleted IS NULL OR a.is_deleted = false)
             AND (c.is_deleted IS NULL OR c.is_deleted = false)
           ORDER BY a.start_time
           LIMIT 5`,
          [args.tenant_id, normalized]
        );
      });

      return ok(reply, { appointments: rows.rows });
    },
    'Failed to fetch appointments'
  );

  // cancel-appointment — soft-cancel a scheduled appointment owned by the caller.
  // Ownership verified by phone match so the LLM can never cancel another caller's
  // appointment even if it hallucinates a UUID.
  toolRoute(
    app,
    '/agent-tools/cancel-appointment',
    CancelAppointmentSchema,
    async (args, reply) => {
      const normalized = normalizePhone(args.phone);
      if (!normalized) return fail(reply, 'Invalid phone number');

      const result = await withTenantClient(args.tenant_id, async (client) => {
        return client.query<{ appointment_id: string }>(
          `UPDATE appointments a SET status = 'canceled'
           FROM customers c
           WHERE a.appointment_id = $1
             AND a.tenant_id = $2
             AND a.customer_id = c.customer_id
             AND c.phone = $3
             AND a.status = 'scheduled'
             AND a.start_time > NOW()
             AND (a.is_deleted IS NULL OR a.is_deleted = false)
           RETURNING a.appointment_id`,
          [args.appointment_id, args.tenant_id, normalized]
        );
      });

      if (result.rows.length === 0) {
        return fail(
          reply,
          "I couldn't find that appointment under your number, or it may already be past or canceled."
        );
      }

      // Fire-and-forget calendar sync so the slot opens up immediately.
      syncAppointmentToAll(pool, args.tenant_id, args.appointment_id, 'delete', app.log);

      return ok(reply, { cancelled: true, appointment_id: args.appointment_id });
    },
    'Failed to cancel appointment'
  );

  // reschedule-appointment — move a scheduled appointment to a new time.
  // Phone ownership verified server-side (LLM can't move another caller's appointment).
  // GiST exclusion constraints reject double-bookings at the DB layer (23P01).
  toolRoute(
    app,
    '/agent-tools/reschedule-appointment',
    RescheduleAppointmentSchema,
    async (args, reply) => {
      const normalized = normalizePhone(args.phone);
      if (!normalized) return fail(reply, 'Invalid phone number');

      const timeError = validateAppointmentTimeRange(args.new_start_time, args.new_end_time);
      if (timeError) return fail(reply, timeError.error);

      if (new Date(args.new_start_time) <= new Date()) {
        return fail(reply, 'New appointment time must be in the future.');
      }

      try {
        const result = await withTenantClient(args.tenant_id, async (client) => {
          return client.query<{ appointment_id: string }>(
            `UPDATE appointments a SET start_time = $4, end_time = $5
             FROM customers c
             WHERE a.appointment_id = $1
               AND a.tenant_id = $2
               AND a.customer_id = c.customer_id
               AND c.tenant_id = $2
               AND c.phone = $3
               AND a.status = 'scheduled'
               AND a.start_time > NOW()
               AND (a.is_deleted IS NULL OR a.is_deleted = false)
             RETURNING a.appointment_id`,
            [
              args.appointment_id,
              args.tenant_id,
              normalized,
              args.new_start_time,
              args.new_end_time,
            ]
          );
        });

        if (result.rows.length === 0) {
          return fail(
            reply,
            "I couldn't find that appointment under your number, or it may already be past or canceled."
          );
        }
      } catch (err) {
        const code = (err as { code?: string }).code;
        if (code === '23P01') {
          return fail(reply, 'That time slot is already booked. Please choose a different time.');
        }
        throw err;
      }

      // Fire-and-forget: update calendar sync + reschedule reminders.
      syncAppointmentToAll(pool, args.tenant_id, args.appointment_id, 'update', app.log);
      void rescheduleRemindersForAppointment(
        withTenantClient,
        args.tenant_id,
        args.appointment_id,
        app.log
      );

      return ok(reply, { rescheduled: true, appointment_id: args.appointment_id });
    },
    'Failed to reschedule appointment'
  );

  // ── AI cost recording ─────────────────────────────────────────────
  // Called by the agent worker at the end of every voice call with the
  // session's model usage (LLM tokens, STT audio, TTS characters).
  // Also callable from backend KB routes for ingestion/query costs.
  // Computes estimated_cost_usd using known published rates; TTS (historical xAI rows may exist)
  // pricing is not public so that row gets 0 (chars stored for later).

  const COST_PER_INPUT_TOKEN: Record<string, number> = {
    'gpt-4o-mini': 0.15e-6,
    'text-embedding-3-small': 0.02e-6,
  };
  const COST_PER_OUTPUT_TOKEN: Record<string, number> = {
    'gpt-4o-mini': 0.6e-6,
  };
  const DEEPGRAM_COST_PER_MS = 0.0043 / 60000; // $0.0043/min

  const ModelUsageItemSchema = z.object({
    type: z.enum(['llm_usage', 'tts_usage', 'stt_usage', 'interruption_usage']),
    provider: z.string(),
    model: z.string(),
    inputTokens: z.number().int().default(0),
    outputTokens: z.number().int().default(0),
    charactersCount: z.number().int().default(0),
    audioDurationMs: z.number().default(0),
  });

  const RecordAiCostSchema = z.object({
    tenant_id: z.string().uuid(),
    call_id: z.string().optional(),
    source: z.enum(['voice_call', 'kb_ingestion', 'kb_query', 'call_summary']),
    model_usage: z.array(ModelUsageItemSchema),
  });

  toolRoute(
    app,
    '/agent-tools/record-ai-cost',
    RecordAiCostSchema,
    async (args, reply) => {
      const rows = args.model_usage.filter((u) => u.type !== 'interruption_usage');
      if (rows.length === 0) return ok(reply, { recorded: 0 });

      const values: unknown[] = [];
      const placeholders: string[] = [];
      let idx = 1;

      for (const u of rows) {
        const inputCost = (COST_PER_INPUT_TOKEN[u.model] ?? 0) * u.inputTokens;
        const outputCost = (COST_PER_OUTPUT_TOKEN[u.model] ?? 0) * u.outputTokens;
        const audioCost = u.type === 'stt_usage' ? DEEPGRAM_COST_PER_MS * u.audioDurationMs : 0;
        const estimatedCost = inputCost + outputCost + audioCost;

        placeholders.push(
          `($${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++})`
        );
        values.push(
          args.tenant_id,
          args.call_id ?? null,
          args.source,
          u.provider,
          u.model,
          u.inputTokens,
          u.outputTokens,
          u.charactersCount,
          Math.round(u.audioDurationMs),
          estimatedCost.toFixed(8)
        );
      }

      await withTenantClient(args.tenant_id, (client) =>
        client.query(
          `INSERT INTO ai_cost_events
             (tenant_id, call_id, source, provider, model,
              input_tokens, output_tokens, characters_count, audio_duration_ms, estimated_cost_usd)
           VALUES ${placeholders.join(', ')}`,
          values
        )
      );

      return ok(reply, { recorded: rows.length });
    },
    'Failed to record AI cost'
  );

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
