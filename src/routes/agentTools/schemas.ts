/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument, @typescript-eslint/unbound-method, @typescript-eslint/no-explicit-any */
/**
 * ESLint rules disabled for this file as part of historical full cleanup (REFACTORING_TODO item 10; see RESOLVED.md for details).
 * These are the remaining dynamic/any-heavy areas after previous tranches.
 */
/**
 * Zod schemas and related constants for /agent-tools/* routes.
 * Extracted from agentTools.ts to keep each concern in its own file.
 */
import { z } from 'zod';

// ── SMS OTP config — decided 2026-04-23 ────────────────────────────────
// 6-digit code (industry-standard), 10-min TTL (don't rush callers who are
// slow with their phones), max 5 verify attempts per code, rate-limit 3
// sends per phone per hour + 100 per tenant per day to prevent spam.
export const CODE_DIGITS = 6;
export const CODE_TTL_MINUTES = 10;
export const MAX_VERIFY_ATTEMPTS = 5;
export const RATE_LIMIT_PER_PHONE_PER_HOUR = 3;
export const RATE_LIMIT_PER_TENANT_PER_DAY = 100;

// ── AI cost pricing constants ─────────────────────────────────────────
export const COST_PER_INPUT_TOKEN: Record<string, number> = {
  'gpt-4o-mini': 0.15e-6,
  'text-embedding-3-small': 0.02e-6,
};
export const COST_PER_OUTPUT_TOKEN: Record<string, number> = {
  'gpt-4o-mini': 0.6e-6,
};
export const DEEPGRAM_COST_PER_MS = 0.0043 / 60000; // $0.0043/min

// ── Zod schemas (ported from supabase/functions/vapi-tools/index.ts) ──

export const GetContextSchema = z.object({
  phone: z.string().min(5),
  tenant_id: z.string().uuid(),
});

export const FindByNameSchema = z.object({
  name: z.string().min(1),
  tenant_id: z.string().uuid(),
});

export const CheckAvailabilitySchema = z.object({
  tenant_id: z.string().uuid(),
  resource_id: z.string().uuid(),
  start_time: z.string(),
  end_time: z.string(),
});

export const BookAppointmentSchema = z.object({
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

export const GetPolicyAnswerSchema = z.object({
  tenant_id: z.string().uuid(),
  question: z.string().min(1),
});

export const GetSchedulingOptionsSchema = z.object({
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

export const BookWithSchedulingSchema = z.object({
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
  // The caller's answer to "would you like a text reminder, and how far ahead?"
  // Absent/null = they weren't asked or declined → no custom reminder is seeded
  // (the seeder falls back to their stored preference, then to the standard
  // bundle). Bounded to match the DB CHECK (0 < lead <= 90 days); an int, since
  // "remind me in 22.5 minutes" is not a thing a person says.
  // 2026-07-12.
  reminder_lead_minutes: z.number().int().positive().max(129600).optional().nullable(),
});

export const GetServiceCatalogSchema = z.object({
  tenant_id: z.string().uuid(),
});

export const GetTenantConfigSchema = z.object({
  tenant_id: z.string().uuid(),
});

// save_customer_preference — the AI persists a durable fact about the caller
// (preferred stylist, last service, likes/dislikes, upsell flags) as a
// key/value pair into the customer_preferences table (one row per customer+key;
// was a jsonb blob on customers.metadata until 2026-07-12). Read back on the
// next call by get_customer_context_for_call. Key is normalized to a short
// stable slug; value is free text the AI heard. Only writes for an existing
// customer (a phone the CRM already knows) — we don't conjure a customer row
// just to hang a preference on, and the agent should have already called
// get_customer_context (or booked) before it has anything worth saving.
export const SaveCustomerPreferenceSchema = z.object({
  tenant_id: z.string().uuid(),
  phone: z.string().min(5),
  key: z.string().min(1).max(60),
  // The column is unbounded TEXT; this cap is a guard, not a storage limit. The
  // value is LLM-authored, so an unbounded field lets a looping/rambling model
  // write arbitrary text into the DB mid-call. 4000 is far past any real
  // preference ("Maria", "no fragrance, allergic to lavender") while still
  // bounding the blast radius. Raised from 500 on 2026-07-12.
  value: z.string().min(1).max(4000),
});

export const IdentifyCallerSchema = z.object({
  tenant_id: z.string().uuid(),
  phone: z.string().min(5),
  name: z.string().min(1).max(200).optional(),
  // When present, link the captured number + customer onto this call's
  // voice_sessions row so the Calls tab shows the verbally-collected number
  // (forwarded-line calls start with caller_phone null).
  call_id: z.string().min(1).optional(),
});

export const GetAvailableSlotsSchema = z.object({
  tenant_id: z.string().uuid(),
  service_type: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'),
  // Optional — see GetSchedulingOptionsSchema.call_id (pure-inquiry attribution).
  call_id: z.string().min(1).optional(),
});

// Verbal SMS-consent capture — the caller said yes to appointment reminders on
// the call. Informational/transactional only (never marketing).
export const RecordSmsConsentSchema = z.object({
  tenant_id: z.string().uuid(),
  // min(1) only — completeness is judged by normalizePhone/isValidPhone in the
  // handler so an incomplete number gets the friendly soft-failure, not a
  // generic schema "Validation failed".
  phone: z.string().min(1),
  call_id: z.string().min(1).optional(),
});

export const SendVerificationCodeSchema = z.object({
  tenant_id: z.string().uuid(),
  phone: z.string().min(5),
});

export const VerifyPhoneCodeSchema = z.object({
  tenant_id: z.string().uuid(),
  phone: z.string().min(5),
  code: z.string().regex(/^\d+$/, 'Code must be numeric').length(CODE_DIGITS),
});

// take-message — record a caller message + SMS-notify the owner.
// "Take a message" was previously pure LLM theater — the agent would say it
// but nothing was stored. Now it lands in customer_messages and the owner's
// forward_phone gets a text so no message is silently lost.
export const TakeMessageSchema = z.object({
  tenant_id: z.string().uuid(),
  caller_name: z.string().min(1).max(200),
  callback_phone: z.string().optional(),
  caller_phone: z.string().optional(),
  message: z.string().min(1).max(2000),
  call_id: z.string().optional(),
});

// page-owner — urgent mid-call SMS page to the business owner. Distinct from
// take-message (no full message intake needed): the agent fires it the moment
// a caller reports something escalation-worthy. Persists a customer_messages
// row (message prefixed "[URGENT PAGE]" — no new table/migration needed) ONLY
// when the owner is actually pageable, so a failed page cleanly falls back to
// take_message without double-recording.
export const PageOwnerSchema = z.object({
  tenant_id: z.string().uuid(),
  caller_name: z.string().min(1).max(200),
  callback_phone: z.string().max(50).optional(),
  caller_phone: z.string().optional(),
  reason: z.string().min(1).max(500),
  call_id: z.string().min(1).optional(),
});

// customer-history — deeper caller history than customer-context: last ~10
// appointments (any status, with service/employee/date/status), saved
// preferences, and the last ~3 post-call summaries from voice_sessions.
// Phone is server-injected by the agent from session context (same trust
// model as my-appointments) — the LLM never supplies it.
export const CustomerHistorySchema = z.object({
  tenant_id: z.string().uuid(),
  phone: z.string().min(5),
});

// send-self-service-link — text the caller a secure cancel/reschedule link for
// one of their own upcoming appointments (default: the next one). Reuses the
// selfServiceToken machinery via appointmentService's exported link builders.
// Ownership is phone-gated exactly like cancel/reschedule; the SMS goes through
// the consent-gated SMSService (opt-outs respected).
export const SendSelfServiceLinkSchema = z.object({
  tenant_id: z.string().uuid(),
  phone: z.string().min(5),
  appointment_id: z.string().uuid().optional(),
});

// capture-job-inquiry — structured intake when a recruiter asks whether the
// owner is available for work. Persists a job_inquiries row + emails the owner.
// All position fields optional: the contract vs full-time branches collect
// different subsets and a caller may bail mid-intake — a partial inquiry is
// still worth saving + notifying on. caller_name is the only required field.
export const CaptureJobInquirySchema = z.object({
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
export const VoiceSessionStartSchema = z.object({
  tenant_id: z.string().uuid(),
  call_id: z.string().min(1),
  caller_phone: z.string().min(1).nullable().optional(),
});

export const VoiceSessionEndSchema = z.object({
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
export const VoiceSessionTranscriptSchema = z.object({
  tenant_id: z.string().uuid(),
  call_id: z.string().min(1),
  // min(1): never accept an empty transcript — it would blank an active row's
  // existing transcript (accidental data loss). The agent only ever sends a
  // non-empty render(), so this is a boundary guard.
  transcript: z.string().min(1).max(100_000),
});

export const MyAppointmentsSchema = z.object({
  tenant_id: z.string().uuid(),
  phone: z.string().min(5),
});

export const CancelAppointmentSchema = z.object({
  tenant_id: z.string().uuid(),
  phone: z.string().min(5),
  appointment_id: z.string().uuid(),
});

export const RescheduleAppointmentSchema = z.object({
  tenant_id: z.string().uuid(),
  phone: z.string().min(5),
  appointment_id: z.string().uuid(),
  new_start_time: z.string().min(1),
  new_end_time: z.string().min(1),
});

// ── AI cost schemas ───────────────────────────────────────────────────
export const ModelUsageItemSchema = z.object({
  type: z.enum(['llm_usage', 'tts_usage', 'stt_usage', 'interruption_usage']),
  provider: z.string(),
  model: z.string(),
  inputTokens: z.number().int().default(0),
  outputTokens: z.number().int().default(0),
  charactersCount: z.number().int().default(0),
  audioDurationMs: z.number().default(0),
});

export const RecordAiCostSchema = z.object({
  tenant_id: z.string().uuid(),
  call_id: z.string().optional(),
  source: z.enum(['voice_call', 'kb_ingestion', 'kb_query', 'call_summary']),
  model_usage: z.array(ModelUsageItemSchema),
});
