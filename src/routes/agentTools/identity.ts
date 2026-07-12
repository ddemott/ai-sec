/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument, @typescript-eslint/unbound-method, @typescript-eslint/no-explicit-any */
/**
 * ESLint rules disabled for this file as part of historical full cleanup (REFACTORING_TODO item 10; see RESOLVED.md for details).
 * These are the remaining dynamic/any-heavy areas after previous tranches.
 */

/**
 * Caller-identity agent tools: who is on the phone (identify / look up by name),
 * what we already know about them (context, history, preferences), and the
 * consent + OTP phone-verification flows that make a spoken number trustworthy.
 */
import {
  CODE_DIGITS,
  CODE_TTL_MINUTES,
  MAX_VERIFY_ATTEMPTS,
  RATE_LIMIT_PER_PHONE_PER_HOUR,
  RATE_LIMIT_PER_TENANT_PER_DAY,
  CustomerHistorySchema,
  FindByNameSchema,
  GetContextSchema,
  IdentifyCallerSchema,
  RecordSmsConsentSchema,
  SaveCustomerPreferenceSchema,
  SendVerificationCodeSchema,
  VerifyPhoneCodeSchema,
} from './schemas';
import { ok, fail, toolRoute, pgErrorFields, type AgentToolDeps } from './helpers';
import { normalizePhone, isValidPhone } from '../../services/phoneUtils';
import { sendSms, generateVerificationCode } from '../../services/telnyxSms';

export function registerIdentityRoutes({ app, withTenantClient }: AgentToolDeps): void {
  // record-consent — the caller verbally agreed on the call to receive SMS
  // appointment confirmations/reminders. Writes a dated `consent_records` row
  // (method='verbal', source='voice_call:<call_id>') so reminderProcessor's
  // checkConsent lets this number through. Phone is normalized to match how
  // consent is looked up at send time. Informational only — the agent never
  // records marketing consent here. Best-effort success shape (never a 500)
  // so a hiccup can't derail the live call.
  toolRoute(
    app,
    '/agent-tools/record-consent',
    RecordSmsConsentSchema,
    async (args, reply) => {
      const normalized = normalizePhone(args.phone);
      if (!isValidPhone(normalized)) {
        return fail(reply, "That number isn't complete enough to record consent against.");
      }
      try {
        await withTenantClient(args.tenant_id, (client) =>
          client.query(
            `INSERT INTO consent_records
               (tenant_id, customer_phone, consent_type, consent_given, consent_date,
                consent_method, consent_source)
             VALUES ($1, $2, 'sms', true, now(), 'verbal', $3)`,
            [args.tenant_id, normalized, args.call_id ? `voice_call:${args.call_id}` : 'voice_call']
          )
        );
      } catch (err) {
        // Best-effort: a DB hiccup must NOT 500 mid-call. Log the cause (a
        // systematically-failing consent write should be diagnosable — see
        // sad-path-instrumentation) and hand back a soft failure.
        reply.log.error({ err, tenant_id: args.tenant_id }, 'record-consent insert failed');
        return fail(reply, "I couldn't note that just now — your appointment is still all set.");
      }
      return ok(reply, { recorded: true, channel: 'sms', phone: normalized });
    },
    'Failed to record consent'
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

  // customer-history — deeper history than customer-context: last ~10
  // appointments (ANY status — past + upcoming, with service/employee/date/
  // status), the saved preferences map, and the last ~3 post-call summaries
  // from voice_sessions. Phone is server-injected by the agent (session
  // context, same trust model as my-appointments) so the LLM can never
  // enumerate another caller's history.
  toolRoute(
    app,
    '/agent-tools/customer-history',
    CustomerHistorySchema,
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

        const appts = await client.query<{
          start_time: string;
          status: string;
          description: string | null;
          service_name: string | null;
          employee_name: string | null;
        }>(
          `SELECT a.start_time, a.status, a.description,
                  s.name AS service_name,
                  e.name AS employee_name
           FROM appointments a
           LEFT JOIN services s ON a.service_id = s.service_id AND s.tenant_id = a.tenant_id
           LEFT JOIN employees e ON a.employee_id = e.employee_id AND e.tenant_id = a.tenant_id
           WHERE a.tenant_id = $1 AND a.customer_id = $2
             AND (a.is_deleted IS NULL OR a.is_deleted = false)
           ORDER BY a.start_time DESC
           LIMIT 10`,
          [args.tenant_id, customer.customer_id]
        );

        // Post-call summaries live on voice_sessions.summary (written by the
        // agent's callSummary at finalize). Match by customer_id OR the raw
        // phone — forwarded-line calls may have caller_phone backfilled but no
        // customer link (or vice versa).
        const sums = await client.query<{ summary: string; started_at: string }>(
          `SELECT summary, started_at
           FROM voice_sessions
           WHERE tenant_id = $1
             AND (customer_id = $2 OR caller_phone = $3)
             AND summary IS NOT NULL
             AND (is_deleted IS NULL OR is_deleted = false)
           ORDER BY started_at DESC
           LIMIT 3`,
          [args.tenant_id, customer.customer_id, normalized]
        );

        return { customer, appointments: appts.rows, summaries: sums.rows };
      });

      if (!data) return ok(reply, 'New caller - no history found.');
      return ok(reply, {
        name: data.customer.name || 'Unknown',
        preferences: data.customer.preferences ?? {},
        appointments: data.appointments,
        recent_call_summaries: data.summaries,
      });
    },
    'Failed to fetch customer history'
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
}
