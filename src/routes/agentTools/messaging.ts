/* eslint-disable @typescript-eslint/no-unsafe-member-access */
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
  CaptureCaseInquirySchema,
  CaptureJobInquirySchema,
  PageOwnerSchema,
  SendSelfServiceLinkSchema,
  TakeMessageSchema,
} from './schemas';
import { ok, fail, toolRoute, pgErrorFields, type AgentToolDeps } from './helpers';
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
import { persistJobInquiryCapture, resolveJobCompanies } from '../../services/jobInquiryCapture';

export { resolveJobCompanies } from '../../services/jobInquiryCapture';

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

async function resolveJobInquiryRecipient(
  client: {
    query: (
      text: string,
      params?: unknown[]
    ) => Promise<{ rows: Array<{ email: string | null; owner_name: string | null }> }>;
  },
  tenantId: string
): Promise<{ recipient: string | null; ownerName: string | null }> {
  const recip = await client.query(
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
    [tenantId]
  );
  return {
    recipient: recip.rows[0]?.email ?? null,
    ownerName: recip.rows[0]?.owner_name ?? null,
  };
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
        // correction lands and a retry cannot duplicate. updated_at is bumped by
        // trg_customer_messages_updated_at (the house fn_set_updated_at pattern),
        // not by hand here — a column maintained in one call site is a column
        // that lies everywhere else, which is what the review caught on #312.
        // Dashboard-created messages carry no call_id and are untouched by this.
        const res = await client.query<{ message_id: string }>(
          `INSERT INTO customer_messages
             (tenant_id, customer_id, caller_phone, caller_name, callback_phone, message,
              call_id, is_urgent)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (tenant_id, call_id) WHERE call_id IS NOT NULL
           DO UPDATE SET
             -- Urgency can only ever be RAISED by a later correction: a caller
             -- who escalates mid-call ("actually, this is urgent") must not be
             -- un-escalated by a re-fire that omits the flag.
             is_urgent      = customer_messages.is_urgent OR EXCLUDED.is_urgent,
             caller_name    = EXCLUDED.caller_name,
             callback_phone = EXCLUDED.callback_phone,
             message        = EXCLUDED.message,
             caller_phone   = COALESCE(EXCLUDED.caller_phone, customer_messages.caller_phone),
             customer_id    = COALESCE(EXCLUDED.customer_id, customer_messages.customer_id)
           RETURNING message_id`,
          [
            args.tenant_id,
            customerId,
            callerPhone,
            args.caller_name,
            callbackPhone,
            args.message,
            args.call_id ?? null,
            args.is_urgent === true,
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

      const row = await persistJobInquiryCapture({
        args,
        callbackPhone,
        companies,
        withTenantClient,
        getOrCreateCustomerByPhoneOnClient: (client, tenantId, phone, name) =>
          getOrCreateCustomerByPhoneOnClient(
            client as Parameters<typeof getOrCreateCustomerByPhoneOnClient>[0],
            tenantId,
            phone,
            name
          ),
        resolveRecipient: resolveJobInquiryRecipient,
      });

      if (row.appointmentLinkMiss) {
        errorsTotal.inc({ event: 'job_inquiry_appointment_link_miss' });
        app.log.warn(
          { tenantId: args.tenant_id, appointmentId: args.appointment_id },
          'capture_job_inquiry: appointment_id does not match a live appointment for this tenant — inquiry saved unlinked'
        );
      }
      if (row.appointmentStampMiss) {
        errorsTotal.inc({ event: 'job_inquiry_appointment_stamp_miss' });
        app.log.warn(
          { tenantId: args.tenant_id, appointmentId: args.appointment_id },
          'capture_job_inquiry: appointment disappeared before the job summary stamp — inquiry saved, calendar entry not stamped'
        );
      }

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

  // capture-case-inquiry — persist a prospective client's legal matter for an
  // attorney's take-or-decline review.
  //
  // WRITES TO `intake_submissions`, NOT A NEW TABLE. That envelope was built
  // (migration 20260811160000) for exactly this: "the next vertical's structured
  // capture does not need a brand-new top-level table." A case inquiry is a
  // type-tagged payload, and the row is durable the moment it lands. A
  // specialized projection can be forked out later from payload_json without
  // re-capturing anything, because the envelope preserves the whole payload.
  toolRoute(
    app,
    '/agent-tools/capture-case-inquiry',
    CaptureCaseInquirySchema,
    async (args, reply) => {
      const callbackPhone = args.callback_phone ? normalizePhone(args.callback_phone) : null;

      // THE SAME REFUSAL capture_job_inquiry LEARNED, AND IT MATTERS MORE HERE.
      //
      // A job lead the owner cannot answer is a lost opportunity. A LEGAL matter
      // the firm cannot answer can be a lost claim: the caller believes they have
      // handed their case to someone, they stop looking for a lawyer, and the
      // limitation period keeps running. A hollow row that reports success is the
      // worst possible outcome on this route, so it fails loudly and tells the
      // agent exactly what to go and collect.
      if (isPlaceholderName(args.caller_name)) {
        return fail(
          reply,
          "I still need the caller's name before I can pass this to the attorney. Ask them for their name, then call this again."
        );
      }
      if (!callbackPhone || !isValidPhone(callbackPhone)) {
        return fail(
          reply,
          'I still need a callback number before I can pass this to the attorney — there is no way to reach them about the matter without one. Ask for the best number to reach them, confirm it, then call this again.'
        );
      }

      const payload = {
        matter_type: args.matter_type ?? null,
        incident_date: args.incident_date ?? null,
        incident_state: args.incident_state ?? null,
        has_existing_counsel: args.has_existing_counsel ?? null,
        counsel_situation: args.counsel_situation ?? null,
        opposing_parties: args.opposing_parties ?? null,
        matter_description: args.matter_description ?? null,
        insurer_name: args.insurer_name ?? null,
        policy_type: args.policy_type ?? null,
        claim_outcome: args.claim_outcome ?? null,
        stated_reason: args.stated_reason ?? null,
        amount_in_dispute: args.amount_in_dispute ?? null,
        appeal_status: args.appeal_status ?? null,
        injuries_sustained: args.injuries_sustained ?? null,
        medical_treatment: args.medical_treatment ?? null,
        at_fault_party: args.at_fault_party ?? null,
        gave_recorded_statement: args.gave_recorded_statement ?? null,
        lost_income: args.lost_income ?? null,
        police_report: args.police_report ?? null,
        deadline_pressure: args.deadline_pressure ?? null,
        documents_available: args.documents_available ?? null,
        desired_outcome: args.desired_outcome ?? null,
      };

      const result = await withTenantClient(args.tenant_id, async (client) => {
        const customerId = await getOrCreateCustomerByPhoneOnClient(
          client,
          args.tenant_id,
          callbackPhone,
          args.caller_name
        );

        // ONE ROW PER CALL. An action tool is retried until it returns its
        // success id, so concurrent retries of a single call must converge on
        // one row — the lesson that cost four identical job_inquiries behind a
        // hung SMTP send on 2026-07-17. The partial unique index on
        // (tenant_id, submission_type, call_id) makes the DB the arbiter; the
        // winner lookup below returns the row that actually landed.
        const inserted = await client.query(
          `INSERT INTO intake_submissions
             (tenant_id, customer_id, appointment_id, submission_type, call_id,
              caller_name, callback_phone, payload_json)
           VALUES ($1, $2, $3, 'case_inquiry', $4, $5, $6, $7::jsonb)
           ON CONFLICT (tenant_id, submission_type, call_id) WHERE call_id IS NOT NULL
             DO NOTHING
           RETURNING submission_id`,
          [
            args.tenant_id,
            customerId ?? null,
            args.appointment_id ?? null,
            args.call_id ?? null,
            args.caller_name,
            callbackPhone,
            JSON.stringify(payload),
          ]
        );

        if (inserted.rows[0]?.submission_id) {
          return { submission_id: inserted.rows[0].submission_id as string, duplicate: false };
        }

        // DO NOTHING fired — a retry of a call that already captured. Return the
        // existing row rather than a failure: the action node completes on a real
        // id, and the id of the row that IS there is the honest one.
        const existing = await client.query(
          `SELECT submission_id FROM intake_submissions
            WHERE tenant_id = $1 AND submission_type = 'case_inquiry' AND call_id = $2
            LIMIT 1`,
          [args.tenant_id, args.call_id ?? null]
        );
        return {
          submission_id: (existing.rows[0]?.submission_id as string | undefined) ?? null,
          duplicate: true,
        };
      });

      if (!result.submission_id) {
        return fail(reply, 'Could not save the case details. Please take a message instead.');
      }

      // WHAT THE CALLER HEARS, and the two things it must never say.
      //
      // It must not say the firm will take the case — intake is not acceptance,
      // and no attorney-client relationship is formed on a reception call. It
      // must not estimate when someone will call, because this route does not
      // know the firm's review cadence and a guessed "within 24 hours" is a
      // promise the firm never made.
      return ok(reply, {
        saved: true,
        submission_id: result.submission_id,
        message:
          "Thank you — I've recorded the details of your matter and passed them to the attorney for review. They'll be in touch about whether it's something the firm can take on.",
        next_step:
          'The case details are recorded. This is NOT the end of the call, and it is NOT an acceptance of the case. If the caller ALSO asked to speak with or meet an attorney, do that NOW before saying goodbye. Never tell the caller the firm will take their case, never estimate what it is worth, and never say whether a deadline has passed — the attorney decides all three.',
      });
    },
    'Failed to capture case inquiry'
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
