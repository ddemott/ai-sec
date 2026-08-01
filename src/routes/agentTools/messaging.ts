/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument, @typescript-eslint/unbound-method, @typescript-eslint/no-explicit-any */
/**
 * ESLint rules disabled for this file as part of historical full cleanup (REFACTORING_TODO item 10; see RESOLVED.md for details).
 * These are the remaining dynamic/any-heavy areas after previous tranches.
 */

/**
 * Outbound-contact agent tools: everything that reaches a human outside the
 * call — a message for the owner, an urgent page, a job inquiry email, and the
 * consent-gated self-service cancel/reschedule link texted to the caller.
 */
import type { Pool } from 'pg';
import {
  CaptureJobInquirySchema,
  PageOwnerSchema,
  SendSelfServiceLinkSchema,
  TakeMessageSchema,
} from './schemas';
import { ok, fail, toolRoute, pgErrorFields, type AgentToolDeps } from './helpers';
import { JOB_DETAILS_PREFIX, toStampText } from '../../../shared/callContext';
import { normalizePhone, isValidPhone } from '../../services/phoneUtils';
import { sendSms } from '../../services/telnyxSms';
import { errorsTotal } from '../../services/metrics';
import { sendJobInquiryEmail } from '../../services/communications/systemEmail';
import {
  isPlaceholderName,
  getOrCreateCustomerByPhoneOnClient,
} from '../../services/customerLookup';
import { SMSService } from '../../services/communications/smsService';
import { ConsentService } from '../../services/consentService';
import { createDatabaseService } from '../../database/index';
import { createTenantConfigService } from '../../services/tenants/index';
import {
  buildCancelLink,
  buildRescheduleLink,
} from '../../services/communications/appointmentService';

/**
 * Consent-gated SMS path for send-self-service-link. Same construction as
 * registerCommunicationRoutes — the SMSService checks consent (and thus
 * opt-outs, which revoke consent) before every send, so the agent tool can
 * never text an opted-out number. Constructors are lazy (no pool I/O until
 * a query runs), so this is safe to build eagerly at registration time.
 */
function buildSmsStack(pool: Pool) {
  const consentService = new ConsentService(createDatabaseService(pool));
  const smsService = new SMSService(createTenantConfigService(pool), consentService);
  return { consentService, smsService };
}

/**
 * A staffing call has TWO companies: the CALLER'S company (the agency that rang) and the
 * CLIENT company (where the work is). `represents_company` = true means the caller works
 * directly for the client (an in-house recruiter), so the two are the same.
 *
 * DERIVE represents_company from the NAMES, do not trust the model's boolean. The model
 * reliably reports the two company names it heard, but routinely FLIPS the flag — the E2E
 * caught it setting represents_company=true for a caller placing with a *different* client
 * (Northern Trust) than the agency they called from (TEKsystems). When both names are
 * present, whether they are the same company is a fact we can compute, not a judgement the
 * model has to get right: same name → in-house (true); different → agency+client (false).
 *
 * When only one name is present it is the "in-house said once" case (or an incomplete
 * agency call): trust the model's flag, and if it says in-house, fill the missing name from
 * the one we have so neither column is NULL.
 */
export function resolveJobCompanies(input: {
  client_company?: string | null;
  caller_company?: string | null;
  represents_company?: boolean | null;
}): {
  clientCompany: string | null;
  callerCompany: string | null;
  representsCompany: boolean | null;
} {
  const clean = (s?: string | null): string | null =>
    typeof s === 'string' && s.trim() !== '' ? s.trim() : null;
  const cc = clean(input.client_company);
  const ac = clean(input.caller_company);

  // Both named → derive from equality (ignore the model's possibly-flipped boolean).
  if (cc && ac) {
    return {
      clientCompany: cc,
      callerCompany: ac,
      representsCompany: cc.toLowerCase() === ac.toLowerCase(),
    };
  }

  // In-house said once → both columns get the single company we have.
  if (input.represents_company === true) {
    const one = cc ?? ac;
    return { clientCompany: one, callerCompany: one, representsCompany: true };
  }

  // Otherwise keep what we have; represents stays whatever the model reported (or null).
  return {
    clientCompany: cc,
    callerCompany: ac,
    representsCompany: input.represents_company ?? null,
  };
}

/**
 * The one-line job summary stamped into the linked appointment's description, so the
 * owner opens the calendar entry and sees what the meeting is ABOUT without hunting
 * down the inquiry row. Skips whatever the caller never gave — a partial line beats a
 * row of blanks read as facts.
 */
export function jobSummaryLine(
  companies: {
    clientCompany: string | null;
    callerCompany: string | null;
    representsCompany: boolean | null;
  },
  args: {
    employment_type?: string;
    role_description?: string;
    rate_range?: string;
    duration?: string;
    location_type?: string;
    address?: string;
    timezone?: string;
  }
): string {
  const bits: string[] = [];
  // The role leads — it is WHAT the meeting is about; everything else qualifies it.
  if (args.role_description) bits.push(args.role_description);
  if (args.employment_type)
    bits.push(
      args.employment_type === 'contract'
        ? 'contract'
        : args.employment_type === 'contract_to_hire'
          ? 'contract to hire'
          : 'full time'
    );
  if (args.rate_range) bits.push(args.rate_range);
  if (args.duration) bits.push(args.duration);
  if (args.location_type) {
    bits.push(
      args.location_type === 'remote'
        ? `remote${args.timezone ? ` (${args.timezone})` : ''}`
        : `${args.location_type}${args.address ? ` at ${args.address}` : ''}`
    );
  }
  // The two companies, kept apart exactly as the intake keeps them: where the work is,
  // and who rang about it.
  const company =
    companies.representsCompany === false && companies.clientCompany
      ? `work at ${companies.clientCompany}${companies.callerCompany ? ` via ${companies.callerCompany}` : ''}`
      : companies.callerCompany
        ? `with ${companies.callerCompany}`
        : '';
  const detail = [bits.join(', '), company].filter(Boolean).join(' — ');
  return `${JOB_DETAILS_PREFIX}${toStampText(detail) || 'see the job inquiry record'}.`;
}

export function registerMessagingRoutes({ app, pool, withTenantClient }: AgentToolDeps): void {
  const { consentService, smsService } = buildSmsStack(pool);

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
        // GET-OR-CREATE, not look-up-and-shrug. A caller who leaves a message is
        // a lead: the owner will call them back, and the next time they ring the
        // agent must know them. Until 2026-07-27 this route only SELECTed, so a
        // message-only caller never entered the CRM — prod held one message row
        // and ZERO customers (Camille, 2026-07-25).
        //
        // The helper also carries the name-backfill: every messaging rung is
        // handed a real caller_name, while the customer row was very likely
        // created minutes earlier by a NAMELESS booking — scheduling.ts writes
        // `args.name || 'Caller'` — and would otherwise keep that placeholder
        // forever (Ashutosh, 2026-07-22: booked at turn 3 as "Caller", gave his
        // name at turn 17, stayed "Caller" in the phonebook).
        //
        // Non-fatal: on a NULL id the message is still saved, unlinked, with the
        // phone and name on the row itself.
        let customerId: string | null = null;
        const lookupPhone = callerPhone ?? callbackPhone;
        if (lookupPhone && isValidPhone(lookupPhone)) {
          customerId = await getOrCreateCustomerByPhoneOnClient(
            client,
            args.tenant_id,
            lookupPhone,
            args.caller_name
          );
        }

        // UPSERT, keyed on this CALL (migration 20260801000000).
        //
        // This was INSERT-only, which made two failures inevitable and one of
        // them is live in prod right now: a caller's name was heard as "Jamil",
        // the message was written, she corrected it to "Camille" thirty seconds
        // later — and the row could not be reached, because nothing identified
        // which row belonged to this call. It still says Jamil.
        //
        // Now a second take_message on the same call REWRITES its own row, so a
        // correction lands and a retry cannot duplicate. The updated_at bump is
        // what tells the owner (and a postmortem) that the row was revised.
        // Dashboard-created messages carry no call_id and are untouched by this.
        const res = await client.query<{ message_id: string }>(
          `INSERT INTO customer_messages
             (tenant_id, customer_id, caller_phone, caller_name, callback_phone, message, call_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (tenant_id, call_id) WHERE call_id IS NOT NULL
           DO UPDATE SET
             caller_name    = EXCLUDED.caller_name,
             callback_phone = EXCLUDED.callback_phone,
             message        = EXCLUDED.message,
             caller_phone   = COALESCE(EXCLUDED.caller_phone, customer_messages.caller_phone),
             customer_id    = COALESCE(EXCLUDED.customer_id, customer_messages.customer_id),
             updated_at     = now()
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
          ? 'Message saved — the owner has been alerted.'
          : 'Message saved — the owner will get it.',
      });
    },
    'Failed to save message'
  );

  // page-owner — urgent mid-call SMS page to the business owner. The agent
  // fires this the moment a caller reports something escalation-worthy; it is
  // NOT a full take_message intake (no long message body — a one-line reason).
  // Reuses the take-message owner-notification path (owner_phone ?? forward_phone
  // as destination, inbound_phone as sender). Order of operations matters:
  //   1. Check the owner is pageable FIRST — if not, fail gracefully BEFORE
  //      persisting anything, so the LLM's fallback take_message doesn't
  //      double-record the same content.
  //   2. Persist a customer_messages row ("[URGENT PAGE] ..." — schema is
  //      frozen, so the prefix is the type flag) as the durable trace.
  //   3. Send the SMS. A send failure keeps the row (owner still sees it on
  //      the dashboard) but reports failure so the agent pivots to a message.
  toolRoute(
    app,
    '/agent-tools/page-owner',
    PageOwnerSchema,
    async (args, reply) => {
      const callbackPhone = args.callback_phone ? normalizePhone(args.callback_phone) : null;
      const callerPhone = args.caller_phone ? normalizePhone(args.caller_phone) : null;

      // 1. Pageability check before any write.
      const tenant = await withTenantClient(args.tenant_id, (client) =>
        client.query<{
          owner_phone: string | null;
          forward_phone: string | null;
          inbound_phone: string | null;
        }>(`SELECT owner_phone, forward_phone, inbound_phone FROM tenants WHERE tenant_id = $1`, [
          args.tenant_id,
        ])
      );
      const notifyPhone = tenant.rows[0]?.owner_phone ?? tenant.rows[0]?.forward_phone ?? null;
      const inboundPhone = tenant.rows[0]?.inbound_phone ?? null;
      const normalizedNotify = notifyPhone ? normalizePhone(notifyPhone) : null;
      const normalizedInbound = inboundPhone ? normalizePhone(inboundPhone) : null;
      if (
        !normalizedNotify ||
        !normalizedInbound ||
        !isValidPhone(normalizedNotify) ||
        !isValidPhone(normalizedInbound)
      ) {
        // 5W: WHO tenant, WHAT page_owner unconfigured, WHERE this route,
        // WHY no valid owner/inbound number. Metric so a tenant whose pages
        // silently never work is visible without log spelunking.
        errorsTotal.inc({ event: 'page_owner_not_configured' });
        app.log.warn(
          {
            event: 'page_owner_not_configured',
            tenantId: args.tenant_id,
            notifyPhone,
            inboundPhone,
          },
          'page_owner: no SMS-capable owner number configured — page not sent, agent told to take a message'
        );
        return fail(
          reply,
          "The owner doesn't have a text-capable number set up, so I can't page them right now. Offer to take a message instead."
        );
      }

      // 2. Durable trace — a customer_messages row flagged as an urgent page.
      const row = await withTenantClient(args.tenant_id, async (client) => {
        // Same get-or-create as take-message: a caller urgent enough to page the
        // owner is certainly worth a phonebook row. See that route's note.
        let customerId: string | null = null;
        const lookupPhone = callerPhone ?? callbackPhone;
        if (lookupPhone && isValidPhone(lookupPhone)) {
          customerId = await getOrCreateCustomerByPhoneOnClient(
            client,
            args.tenant_id,
            lookupPhone,
            args.caller_name
          );
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
            `[URGENT PAGE] ${args.reason}`,
            args.call_id ?? null,
          ]
        );
        return { message_id: res.rows[0]?.message_id ?? null };
      });

      // 3. The page itself.
      const callbackDisplay = callbackPhone ?? callerPhone ?? 'no number left';
      const body =
        `URGENT page from ${args.caller_name} (${callbackDisplay}): ` +
        `${args.reason.slice(0, 300)}${args.reason.length > 300 ? '…' : ''}` +
        ' — via SecretaryHQ';
      const sms = await sendSms({ from: normalizedInbound, to: normalizedNotify, body });
      if (!sms.ok) {
        // 5W: page row saved, SMS failed — the whole point of the tool (an
        // IMMEDIATE page) did not happen, so this is a failure to the LLM.
        errorsTotal.inc({ event: 'page_owner_sms_failed' });
        app.log.error(
          {
            event: 'page_owner_sms_failed',
            tenantId: args.tenant_id,
            notifyPhone: normalizedNotify,
            message_id: row.message_id,
            error: sms.error,
          },
          'page_owner: SMS send failed — page recorded on dashboard but owner NOT paged'
        );
        return fail(
          reply,
          "I couldn't reach the owner by text just now. Offer to take a message instead."
        );
      }

      return ok(reply, {
        paged: true,
        message_id: row.message_id,
        message: 'The owner has been paged by text with the caller details.',
      });
    },
    'Failed to page the owner'
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

      // A LEAD YOU CANNOT ANSWER IS NOT A LEAD.
      //
      // 2026-07-14, a real call. The agent walked the whole intake ladder perfectly —
      // Blue Cross Blue Shield, contract, $65-72/hr, six months, hybrid, 300 Randolph
      // Street — and saved it under caller_name "Caller" with an EMPTY phone number.
      // Then it told the caller "I now have all the information I need."
      //
      // It did not. It had a six-month contract lead and no way on earth to reach the
      // person offering it. Every field that makes the row look impressive was
      // captured; the only two that make it USEFUL were not.
      //
      // "Caller" is not a name the model invented — it is our own placeholder
      // (PLACEHOLDER_NAMES), which it had seen elsewhere and helpfully filled in. The
      // prompt says to collect a name "at minimum". The model decided it had one.
      //
      // So the prompt asks, and the ROUTE ENFORCES. A tool that cannot do its job must
      // FAIL and say why — never save a hollow row and report success. The error text
      // is written to be spoken: it tells the agent exactly what to go and get, and
      // the agent will call back with it.
      if (isPlaceholderName(args.caller_name)) {
        return fail(
          reply,
          "I still need the caller's name before I can pass this along. Ask them for their name, then call this again."
        );
      }
      if (!callbackPhone || !isValidPhone(callbackPhone)) {
        return fail(
          reply,
          'I still need a callback number before I can pass this along — the owner has no way to reach them without one. Ask for the best number to reach them, read it back to confirm, then call this again.'
        );
      }

      // Derive the two companies + represents_company from the names (see
      // resolveJobCompanies) — the model flips the boolean but reports the names. Computed
      // out here so both the INSERT and the owner email use the same resolved values.
      const companies = resolveJobCompanies(args);

      const row = await withTenantClient(args.tenant_id, async (client) => {
        // Link to an existing customer if the callback number matches one. Non-fatal.
        // IDEMPOTENT PER CALL. The job-intake rung retries this tool until it
        // sees a job_inquiry_id — that is the rung contract (the completion IS
        // the write). So a slow response is indistinguishable from a failed one
        // to the agent, and on 2026-07-17 a hung owner-email held the response
        // past the agent's 8s tool timeout: the rung retried four times and
        // this route dutifully wrote FOUR identical inquiries and stamped the
        // appointment four times. An ACTION-rung tool MUST be safe to retry:
        // same call already captured an inquiry → hand back the existing id
        // and do nothing else. The retry then completes the rung instead of
        // duplicating the lead.
        if (args.call_id) {
          const existing = await client.query<{ job_inquiry_id: string }>(
            `SELECT job_inquiry_id FROM job_inquiries
              WHERE tenant_id = $1 AND call_id = $2
              ORDER BY created_at ASC LIMIT 1`,
            [args.tenant_id, args.call_id]
          );
          if (existing.rows[0]) {
            const recipDup = await client.query<{
              email: string | null;
              owner_name: string | null;
            }>(
              `SELECT COALESCE(
                        t.job_inquiry_email,
                        (SELECT u.email FROM users u
                          WHERE u.tenant_id = t.tenant_id AND u.role = 'owner'
                          ORDER BY u.created_at ASC LIMIT 1)
                      ) AS email,
                      (SELECT COALESCE(NULLIF(TRIM(u.first_name), ''), NULLIF(TRIM(u.full_name), ''))
                         FROM users u
                        WHERE u.tenant_id = t.tenant_id AND u.role = 'owner'
                        ORDER BY u.created_at ASC LIMIT 1) AS owner_name
                 FROM tenants t WHERE t.tenant_id = $1`,
              [args.tenant_id]
            );
            return {
              job_inquiry_id: existing.rows[0].job_inquiry_id,
              recipient: recipDup.rows[0]?.email ?? null,
              ownerName: recipDup.rows[0]?.owner_name ?? null,
              duplicate: true,
            };
          }
        }

        // Same get-or-create as take-message. A job inquiry IS a lead — the row
        // the owner calls back. Ashutosh (2026-07-22) reached the phonebook only
        // because he also booked; an inquiry without a booking left nothing.
        let customerId: string | null = null;
        if (callbackPhone && isValidPhone(callbackPhone)) {
          customerId = await getOrCreateCustomerByPhoneOnClient(
            client,
            args.tenant_id,
            callbackPhone,
            args.caller_name
          );
        }

        // The meeting this inquiry was booked around. The id arrives from the agent
        // RUNTIME (call-outcome tracker), never the model — so a miss here is a bug,
        // not caller input. On a miss, save the inquiry UNLINKED rather than lose it:
        // the row is the lead, the link is just context.
        let appointmentId: string | null = null;
        if (args.appointment_id) {
          const appt = await client.query<{ appointment_id: string }>(
            `SELECT appointment_id FROM appointments
              WHERE tenant_id = $1 AND appointment_id = $2 AND is_deleted = false`,
            [args.tenant_id, args.appointment_id]
          );
          appointmentId = appt.rows[0]?.appointment_id ?? null;
          if (!appointmentId) {
            errorsTotal.inc({ event: 'job_inquiry_appointment_link_miss' });
            app.log.warn(
              { tenantId: args.tenant_id, appointmentId: args.appointment_id },
              'capture_job_inquiry: appointment_id does not match a live appointment for this tenant — inquiry saved unlinked'
            );
          }
        }

        // ON CONFLICT DO NOTHING against the job_inquiries_one_per_call partial
        // unique index (migration 20260717230000). The fast-path SELECT above
        // catches a retry that arrives AFTER the first insert committed — but
        // on the live call the retries were IN FLIGHT TOGETHER (each request
        // sat 60-120s behind the hung email), so two could pass the SELECT
        // before either INSERT landed. The index is the layer that cannot
        // race; losing it returns zero rows and the winner is looked up below.
        const res = await client.query<{ job_inquiry_id: string }>(
          `INSERT INTO job_inquiries
             (tenant_id, customer_id, client_company, caller_company, represents_company,
              employment_type, role_description, rate_range, duration, location_type,
              address, timezone, caller_name, callback_phone, call_id, appointment_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
           ON CONFLICT (tenant_id, call_id) WHERE call_id IS NOT NULL DO NOTHING
           RETURNING job_inquiry_id`,
          [
            args.tenant_id,
            customerId,
            companies.clientCompany,
            companies.callerCompany,
            companies.representsCompany,
            args.employment_type ?? null,
            args.role_description ?? null,
            args.rate_range ?? null,
            args.duration ?? null,
            args.location_type ?? null,
            args.address ?? null,
            args.timezone ?? null,
            args.caller_name,
            callbackPhone,
            args.call_id ?? null,
            appointmentId,
          ]
        );
        const inserted = Boolean(res.rows[0]);
        let jobInquiryId = res.rows[0]?.job_inquiry_id ?? null;
        if (!inserted && args.call_id) {
          // Lost a concurrent-retry race — the winner's row IS this call's
          // inquiry. Hand its id back so the rung completes.
          const winner = await client.query<{ job_inquiry_id: string }>(
            `SELECT job_inquiry_id FROM job_inquiries
              WHERE tenant_id = $1 AND call_id = $2
              ORDER BY created_at ASC LIMIT 1`,
            [args.tenant_id, args.call_id]
          );
          jobInquiryId = winner.rows[0]?.job_inquiry_id ?? null;
        }

        // Stamp a readable summary onto the meeting itself, so the calendar entry is
        // self-contained: the owner sees WHAT the meeting is about, not just who and
        // when. Appended, never overwritten — the description may already carry the
        // service name or the caller's notes. Only the INSERT WINNER stamps —
        // a race-losing retry stamping too is how one appointment got the same
        // summary four times.
        if (appointmentId && inserted) {
          const stamped = await client.query(
            `UPDATE appointments
                SET description = COALESCE(NULLIF(description, '') || E'\n\n', '') || $3,
                    updated_at = now()
              WHERE tenant_id = $1 AND appointment_id = $2 AND is_deleted = false`,
            [args.tenant_id, appointmentId, jobSummaryLine(companies, args)]
          );
          // The SELECT above proved the appointment live, but nothing holds that true
          // until here — a zero-row UPDATE means it vanished in between. The inquiry
          // row (the lead) is already saved; only the calendar stamp was lost, and
          // that must be observable, not silent.
          if (stamped.rowCount === 0) {
            errorsTotal.inc({ event: 'job_inquiry_appointment_stamp_miss' });
            app.log.warn(
              { tenantId: args.tenant_id, appointmentId },
              'capture_job_inquiry: appointment disappeared before the job summary stamp — inquiry saved, calendar entry not stamped'
            );
          }
        }

        // Resolve the notification recipient: the dedicated job_inquiry_email,
        // else the tenant owner's user email. The owner's NAME comes back too — the
        // spoken reply used to say "Dale" as a hardcoded string, in a route shared by
        // every tenant on the platform, so a salon's assistant would tell its caller
        // it had passed the details to Dale.
        const recip = await client.query<{ email: string | null; owner_name: string | null }>(
          `SELECT COALESCE(
                    t.job_inquiry_email,
                    (SELECT u.email FROM users u
                      WHERE u.tenant_id = t.tenant_id AND u.role = 'owner'
                      ORDER BY u.created_at ASC LIMIT 1)
                  ) AS email,
                  -- FIRST name: this is spoken aloud ("passed those details along to
                  -- <owner>"), and a receptionist uses the first name. full_name is
                  -- the fallback, not the preference. users has full_name/first_name/
                  -- last_name and no bare name column; assuming otherwise 500d this
                  -- route in test.
                  (SELECT COALESCE(NULLIF(TRIM(u.first_name), ''), NULLIF(TRIM(u.full_name), ''))
                     FROM users u
                    WHERE u.tenant_id = t.tenant_id AND u.role = 'owner'
                    ORDER BY u.created_at ASC LIMIT 1) AS owner_name
             FROM tenants t WHERE t.tenant_id = $1`,
          [args.tenant_id]
        );

        return {
          job_inquiry_id: jobInquiryId,
          recipient: recip.rows[0]?.email ?? null,
          ownerName: recip.rows[0]?.owner_name ?? null,
          // A race-losing concurrent retry is a duplicate too: the winner's
          // request emails the owner and stamps the meeting; this one only
          // hands back the id.
          duplicate: !inserted,
        };
      });

      // Email the owner — FIRE-AND-FORGET, and that is load-bearing, not style.
      // "Best-effort" was always the contract (the row is persisted; a mail
      // failure never un-saves it) but the send was AWAITED, so its LATENCY
      // rode on the response — and this is a VOICE TOOL: a caller stood in
      // dead air behind an SMTP handshake. On 2026-07-17 prod's SMTP was
      // unreachable (IPv6 ENETUNREACH to Gmail:465, 60-120s to fail) and every
      // capture blew the agent's 8s tool timeout; the rung retried and wrote
      // duplicates (see the idempotency guard above — the two fixes are a
      // pair). The reply now returns the moment the row is durable; the mail
      // succeeds or fails on its own time, observably (metric + 5W log).
      // Skipped entirely on a duplicate — one inquiry, one email.
      if (row.duplicate) {
        // The retry that finally landed. Nothing to write, nothing to send.
      } else if (row.recipient) {
        const recipient = row.recipient;
        void sendJobInquiryEmail(recipient, {
          clientCompany: companies.clientCompany ?? undefined,
          callerCompany: companies.callerCompany ?? undefined,
          representsCompany: companies.representsCompany ?? undefined,
          employmentType: args.employment_type,
          roleDescription: args.role_description,
          rateRange: args.rate_range,
          duration: args.duration,
          locationType: args.location_type,
          address: args.address,
          timezone: args.timezone,
          callerName: args.caller_name,
          callbackPhone,
        }).catch((err: unknown) => {
          errorsTotal.inc({ event: 'job_inquiry_email_failed' });
          app.log.error(
            { tenantId: args.tenant_id, recipient, ...pgErrorFields(err) },
            'capture_job_inquiry: owner email failed — inquiry saved but owner not emailed'
          );
        });
      } else {
        // No recipient configured at all — surface it; the owner gets nothing.
        errorsTotal.inc({ event: 'job_inquiry_no_recipient' });
        app.log.warn(
          { tenantId: args.tenant_id },
          'capture_job_inquiry: no job_inquiry_email and no owner email — inquiry saved but not emailed'
        );
      }

      // WHAT THE CALLER ACTUALLY HEARS.
      //
      // This string is spoken almost verbatim — the model relays a tool's `message`
      // rather than composing its own. Which means every defect in it is a defect a
      // customer hears, and this one had three.
      //
      // 1. It never said the address. "Please also email a job description to HIS
      //    INBOX" — to which inbox? The route has known the address the whole time
      //    (it is emailing the owner two lines above with it) and simply never put it
      //    in the sentence. We asked a recruiter to send a job description and did
      //    not tell them where. Caught on a real call 2026-07-14.
      // 2. It said "Dale". Hardcoded. In a route every tenant shares.
      // 3. Worst: when NO recipient is configured it STILL asked them to email — into
      //    a void, with no address and no inbox at the other end. An instruction the
      //    caller cannot possibly follow is worse than no instruction; they will go
      //    away and do it, and nothing will arrive. So the email sentence now exists
      //    ONLY when there is somewhere for it to go.
      // First name only — this sentence is SPOKEN. "passed along to Dale", never
      // "to Dale DeMott": a receptionist doesn't full-name her own boss on the
      // phone (caller-reported, 2026-07-21).
      const who = row.ownerName?.trim().split(/\s+/)[0] || 'the owner';
      const passedAlong = `Thanks — I've passed those details along to ${who} and they'll get back to you.`;
      const emailAsk = row.recipient
        ? ` Please also email a job description to ${row.recipient}, and put your name and company in the subject line.`
        : '';

      return ok(reply, {
        saved: true,
        job_inquiry_id: row.job_inquiry_id,
        // The send is fire-and-forget now, so "emailed: true" can no longer be
        // known at reply time — and claiming it would be the promise-what-you-
        // cannot-know bug. This reports what is TRUE at this instant: a send
        // was started (or not). Delivery outcome lives in the logs/metrics.
        email_queued: !row.duplicate && Boolean(row.recipient),
        message: passedAlong + emailAsk,
        // THIS TOOL IS NOT THE END OF THE CALL, AND ITS REPLY MUST NOT SOUND LIKE IT.
        //
        // 2026-07-14. The caller opened with: "I'd like to have a meeting with Dale to
        // talk to him about a job position." That is TWO asks — a meeting, and the
        // details. The agent walked the whole intake ladder perfectly, relayed this
        // message, then said "is there anything else?" and ended the call.
        //
        // Kyle never got his meeting. He rang for one, answered nine questions, and
        // hung up without it.
        //
        // The prompt already told the model to hold the caller's ask. It lost anyway —
        // because the model relays a tool's `message` almost verbatim, and this message
        // READS LIKE A GOODBYE ("passed those along… he'll get back to you"). A rule in
        // the prompt cannot outweigh a closing line handed over at the exact moment of
        // closing. The tool was steering the call, and it steered it out the door.
        //
        // So the tool now says what is actually true: the paperwork is done, and the
        // call may well not be.
        next_step:
          'The job details are recorded. This is NOT the end of the call. If the caller ALSO asked for anything else — most often a MEETING or a callback with the owner — do that NOW, before you say goodbye. Do not ask "is there anything else?" as a way of closing while one of their original requests is still undone.',
      });
    },
    'Failed to capture job inquiry'
  );

  // send-self-service-link — text the caller a secure cancel/reschedule link
  // for ONE of their own upcoming appointments (default: the next one).
  // Ownership is phone-gated exactly like cancel/reschedule (the phone is
  // server-injected by the agent). Token + URL generation reuses the exported
  // appointmentService builders (the same path confirmations and the dashboard
  // "Send self-service links" action use). The SMS goes through the
  // consent-gated SMSService — an opted-out / never-consented number gets a
  // graceful conversational error, never a text.
  toolRoute(
    app,
    '/agent-tools/send-self-service-link',
    SendSelfServiceLinkSchema,
    async (args, reply) => {
      const normalized = normalizePhone(args.phone);
      if (!normalized || !isValidPhone(normalized)) {
        return fail(reply, 'Invalid phone number');
      }

      // Resolve the target appointment under THIS caller's phone only.
      const appt = await withTenantClient(args.tenant_id, async (client) => {
        const res = await client.query<{
          appointment_id: string;
          start_time: string;
          description: string | null;
          tenant_timezone: string | null;
        }>(
          `SELECT a.appointment_id, a.start_time, a.description, t.timezone AS tenant_timezone
           FROM appointments a
           JOIN customers c ON a.customer_id = c.customer_id
           JOIN tenants t ON a.tenant_id = t.tenant_id
           WHERE a.tenant_id = $1 AND c.phone = $2
             AND a.status = 'scheduled' AND a.start_time > NOW()
             AND (a.is_deleted IS NULL OR a.is_deleted = false)
             AND (c.is_deleted IS NULL OR c.is_deleted = false)
             AND ($3::uuid IS NULL OR a.appointment_id = $3::uuid)
           ORDER BY a.start_time ASC
           LIMIT 1`,
          [args.tenant_id, normalized, args.appointment_id ?? null]
        );
        return res.rows[0] ?? null;
      });

      if (!appt) {
        return fail(
          reply,
          "I couldn't find an upcoming appointment under your number to send a link for."
        );
      }

      // Consent gate — same checkConsent the SMSService uses internally, run
      // up front so the LLM gets a specific, relayable reason (opt-outs revoke
      // consent, so STOP'd numbers fail here too). SMSService re-checks on send.
      const canText = await consentService.checkConsent(
        args.tenant_id,
        undefined,
        normalized,
        'sms'
      );
      if (!canText) {
        return fail(
          reply,
          "This number hasn't agreed to receive texts from us, so I can't send the link. Offer to handle the reschedule or cancellation right here on the call instead."
        );
      }

      const cancelLink = buildCancelLink(appt.appointment_id, args.tenant_id);
      const rescheduleLink = buildRescheduleLink(appt.appointment_id, args.tenant_id);
      if (!cancelLink || !rescheduleLink) {
        // 5W: WHO tenant, WHAT link generation failed, WHERE this route, WHY
        // no DASHBOARD_URL/BACKEND_PUBLIC_URL or empty JWT_SECRET. Metric so a
        // misconfigured environment is visible, not a silent per-call shrug.
        errorsTotal.inc({ event: 'self_service_link_unconfigured' });
        app.log.warn(
          {
            event: 'self_service_link_unconfigured',
            tenantId: args.tenant_id,
            appointmentId: appt.appointment_id,
          },
          'send_self_service_link: link generation unavailable (missing public URL or JWT secret) — agent told to handle it live'
        );
        return fail(
          reply,
          "I can't send self-service links right now. Offer to handle the reschedule or cancellation on the call instead."
        );
      }

      // Format the date in the TENANT's IANA timezone (fallback UTC) so the
      // caller sees the correct calendar date — the server default zone can be
      // a day off for a tenant in a different region.
      const dateStr = new Intl.DateTimeFormat('en-US', {
        timeZone: appt.tenant_timezone || 'UTC',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      }).format(new Date(appt.start_time));
      const body =
        `Your ${appt.description ?? 'appointment'} on ${dateStr} — ` +
        `Cancel: ${cancelLink} Reschedule: ${rescheduleLink} ` +
        `Reply STOP to opt out.`;

      // sendSMS re-throws RateLimitedError (per-tenant token bucket) — catch it
      // (and anything else) into the same graceful shape: a 500 to the agent
      // would be read as a technical glitch, but "try again on the call" is the
      // right conversational recovery either way (RULE 5.4).
      let smsResult: { success: boolean; error?: string };
      try {
        smsResult = await smsService.sendSMS(args.tenant_id, { to: normalized, body });
      } catch (err) {
        smsResult = { success: false, error: err instanceof Error ? err.message : 'send threw' };
      }
      if (!smsResult.success) {
        // 5W: consent passed but the send failed (provider error, rate limit,
        // missing tenant config). The caller was PROMISED a text — surface it.
        errorsTotal.inc({ event: 'self_service_link_sms_failed' });
        app.log.error(
          {
            event: 'self_service_link_sms_failed',
            tenantId: args.tenant_id,
            appointmentId: appt.appointment_id,
            error: smsResult.error,
          },
          'send_self_service_link: SMS send failed — caller did not receive the link'
        );
        return fail(
          reply,
          "I couldn't send the text just now. Offer to handle the reschedule or cancellation right here on the call instead."
        );
      }

      return ok(reply, {
        sent: true,
        appointment_id: appt.appointment_id,
        message:
          'Text sent — the caller will receive a link to cancel or reschedule that appointment themselves.',
      });
    },
    'Failed to send self-service link'
  );
}
