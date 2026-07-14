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
import { normalizePhone, isValidPhone } from '../../services/phoneUtils';
import { sendSms } from '../../services/telnyxSms';
import { errorsTotal } from '../../services/metrics';
import { sendJobInquiryEmail } from '../../services/communications/systemEmail';
import { isPlaceholderName } from '../../services/customerLookup';
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
             (tenant_id, customer_id, client_company, caller_company, represents_company,
              employment_type, rate_range, duration, location_type, address, timezone,
              caller_name, callback_phone, call_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
           RETURNING job_inquiry_id`,
          [
            args.tenant_id,
            customerId,
            args.client_company ?? null,
            // An IN-HOUSE recruiter works for the client, so the two companies are the
            // same thing said once. Fill it rather than leaving a hole the owner has to
            // reason about while looking at a lead.
            args.caller_company ?? (args.represents_company ? (args.client_company ?? null) : null),
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
          job_inquiry_id: res.rows[0]?.job_inquiry_id ?? null,
          recipient: recip.rows[0]?.email ?? null,
          ownerName: recip.rows[0]?.owner_name ?? null,
        };
      });

      // Email the owner. Best-effort: the row is already persisted, so a failure
      // here never un-saves the inquiry — instrument it (metric + 5W log) so a
      // silent simulation-mode / SMTP failure is diagnosable, not invisible.
      let emailed = false;
      if (row.recipient) {
        try {
          await sendJobInquiryEmail(row.recipient, {
            clientCompany: args.client_company,
            callerCompany:
              args.caller_company ?? (args.represents_company ? args.client_company : undefined),
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
      const who = row.ownerName ?? 'the owner';
      const passedAlong = `Thanks — I've passed those details along to ${who} and they'll get back to you.`;
      const emailAsk = row.recipient
        ? ` Please also email a job description to ${row.recipient}, and put your name and company in the subject line.`
        : '';

      return ok(reply, {
        saved: true,
        job_inquiry_id: row.job_inquiry_id,
        emailed,
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
