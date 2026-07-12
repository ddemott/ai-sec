/**
 * Communications API Routes
 *
 * Endpoints for sending communications (email, SMS) and viewing history.
 * Routes:
 *   POST /communications/email - Send an email
 *   POST /communications/sms   - Send an SMS
 *   GET  /communications/history - Get communication history
 *   GET  /communications/consent - Get consent records
 *   POST /communications/consent - Record consent
 *   POST /communications/opt-out - Process opt-out request
 */

import type { AppFastifyInstance } from '../types/fastify';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import { createHmac, timingSafeEqual } from 'crypto';
import { withHandler, requireTenantId, type AppRequest } from '../middleware.js';
import { CommunicationService } from '../services/communications/index.js';
import { ConsentService } from '../services/consentService.js';
import { createDatabaseService } from '../database/index.js';
import { createTenantConfigService } from '../services/tenants/index.js';
import { messageDeliveryReceiptsTotal, inboundSmsTotal, errorsTotal } from '../services/metrics.js';
import { verifyTelnyxSignature, classifySmsKeyword } from '../services/telnyxWebhookAuth.js';
import { normalizePhone } from '../services/phoneUtils.js';

/**
 * Record an SMS delivery-status callback (from any provider webhook).
 *
 * Exported (not inlined) so the unit test can drive the persistence path
 * directly with a mock pool — the handler around it stays a thin HTTP shell.
 * Upsert keyed on message_sid: providers fire the callback multiple times as
 * the message advances (queued → sent → delivered), latest status wins.
 */
export async function recordDeliveryStatus(
  pool: Pool,
  params: {
    messageSid: string;
    messageStatus: string;
    errorCode?: string | null;
    tenantId?: string | null;
  }
): Promise<void> {
  await pool.query(
    `INSERT INTO message_delivery_status (message_sid, message_status, error_code, tenant_id, updated_at)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (message_sid)
     DO UPDATE SET message_status = EXCLUDED.message_status,
                   error_code = EXCLUDED.error_code,
                   tenant_id = COALESCE(EXCLUDED.tenant_id, message_delivery_status.tenant_id),
                   updated_at = now()`,
    [params.messageSid, params.messageStatus, params.errorCode ?? null, params.tenantId ?? null]
  );
}

// ── Validation Schemas ───────────────────────────────────────────────

const SendEmailSchema = z.object({
  to: z.string().email(),
  subject: z.string().min(1).max(200),
  body: z.string().min(1).max(10000),
  html: z.string().max(50000).optional(),
  template: z.string().optional(),
  templateData: z.record(z.string(), z.unknown()).optional(),
});

const SendSMSSchema = z.object({
  to: z.string().min(10).max(20),
  body: z.string().min(1).max(1600),
  template: z.string().optional(),
  templateData: z.record(z.string(), z.unknown()).optional(),
});

const RecordConsentSchema = z
  .object({
    customer_email: z.string().email().optional(),
    customer_phone: z.string().min(10).max(20).optional(),
    customer_id: z.string().uuid().optional(),
    consent_type: z.enum(['email', 'sms', 'both']),
    consent_given: z.boolean(),
    consent_method: z.enum(['web_form', 'sms_reply', 'verbal', 'import', 'booking']),
    consent_source: z.string().max(200).optional(),
    ip_address: z.string().max(45).optional(), // IPv4 or IPv6
  })
  .refine((data) => data.customer_email || data.customer_phone, {
    message: 'Either customer_email or customer_phone is required',
  });

const ProcessOptOutSchema = z
  .object({
    command: z.string().min(1).max(50),
    customer_phone: z.string().min(10).max(20).optional(),
    customer_email: z.string().email().optional(),
    message_body: z.string().max(1000).optional(),
  })
  .refine((data) => data.customer_email || data.customer_phone, {
    message: 'Either customer_email or customer_phone is required',
  });

const HistoryQuerySchema = z.object({
  type: z.enum(['email', 'sms', 'all']).optional().default('all'),
  // Delivery-status filter. The values mirror the communications_history
  // status CHECK constraint (sent | failed | queued); 'all' (default) skips
  // the filter. Powers the dashboard "Failed only" drill-down.
  status: z.enum(['sent', 'failed', 'queued', 'all']).optional().default('all'),
  limit: z.coerce.number().min(1).max(100).optional().default(50),
  offset: z.coerce.number().min(0).optional().default(0),
});

// ── Route Registration ───────────────────────────────────────────────

export function registerCommunicationRoutes(
  app: AppFastifyInstance,
  pool: Pool,
  withTenantClient: <T>(tenantId: string, fn: (client: PoolClient) => Promise<T>) => Promise<T>
) {
  const db = createDatabaseService(pool);
  const configService = createTenantConfigService(pool);
  const consentService = new ConsentService(db);
  const communicationService = new CommunicationService(configService, consentService);

  /**
   * POST /communications/email - Send an email
   */
  app.post(
    '/communications/email',
    withHandler(async (req: AppRequest, reply) => {
      const tenantId = requireTenantId(req, reply);
      if (!tenantId) return;

      const parsed = SendEmailSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          error: 'Validation failed',
          details: parsed.error.issues,
        });
      }

      const { to, subject, body, html, template, templateData } = parsed.data;

      const result = await communicationService.sendEmail(tenantId, {
        to,
        subject,
        text: body,
        html,
        template,
        templateData,
      });

      if (result.success) {
        return reply.send({
          success: true,
          messageId: result.messageId,
        });
      } else {
        return reply.status(400).send({
          success: false,
          error: result.error || 'Failed to send email',
        });
      }
    }, 'Failed to send email')
  );

  /**
   * POST /communications/sms - Send an SMS
   */
  app.post(
    '/communications/sms',
    withHandler(async (req: AppRequest, reply) => {
      const tenantId = requireTenantId(req, reply);
      if (!tenantId) return;

      const parsed = SendSMSSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          error: 'Validation failed',
          details: parsed.error.issues,
        });
      }

      const { to, body, template, templateData } = parsed.data;

      const result = await communicationService.sendSMS(tenantId, {
        to,
        body,
        template,
        templateData,
      });

      if (result.success) {
        return reply.send({
          success: true,
          messageId: result.messageId,
        });
      } else {
        return reply.status(400).send({
          success: false,
          error: result.error || 'Failed to send SMS',
        });
      }
    }, 'Failed to send SMS')
  );

  /**
   * GET /communications/history - Get communication history (paginated)
   *
   * Tenant-scoped read of the communications_history table. EmailService/
   * SMSService write a status='sent' row on the send success path, and a
   * best-effort status='failed' row (carrying the provider error) on the
   * send-failure catch path — so the ?status=failed drill-down below has real
   * rows. Filterable by channel via ?type=email|sms|all (default all) and by
   * delivery status via ?status=sent|failed|queued|all (default all — the
   * failed-delivery drill-down); paginated via ?limit (1-100, default 50) +
   * ?offset. `total` is the full filtered count, independent of the page
   * window, so the dashboard can render pagination controls. Rows carry the
   * `error` column (provider failure detail recorded at send time) for failed
   * sends.
   */
  app.get(
    '/communications/history',
    withHandler(async (req: AppRequest, reply) => {
      const tenantId = requireTenantId(req, reply);
      if (!tenantId) return;

      const parsed = HistoryQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          error: 'Invalid query parameters',
          details: parsed.error.issues,
        });
      }

      const { type, status, limit, offset } = parsed.data;

      const { history, total } = await withTenantClient(tenantId, async (client) => {
        // COUNT(*) OVER() gives the full filtered count alongside the paged
        // rows in a single round-trip; it is NULL only when zero rows match,
        // which we coalesce to 0 below. Newest-first ordering matches the
        // idx_communications_history_tenant_created index.
        const result = await client.query(
          `SELECT communications_history_id,
                  tenant_id,
                  customer_id,
                  channel,
                  direction,
                  recipient,
                  subject,
                  body,
                  status,
                  provider_message_id,
                  error,
                  created_at,
                  COUNT(*) OVER() AS total_count
             FROM communications_history
            WHERE tenant_id = $1
              AND ($2 = 'all' OR channel = $2)
              AND ($3 = 'all' OR status = $3)
            ORDER BY created_at DESC, communications_history_id DESC
            LIMIT $4 OFFSET $5`,
          [tenantId, type, status, limit, offset]
        );

        const rows = result.rows as Array<Record<string, unknown> & { total_count: string }>;
        const totalCount = rows.length > 0 ? parseInt(rows[0].total_count, 10) : 0;
        // Drop the window-function helper column from each returned row.
        const history = rows.map(({ total_count: _ignored, ...rest }) => rest);
        return { history, total: totalCount };
      });

      return reply.send({
        success: true,
        history,
        total,
      });
    }, 'Failed to get communication history')
  );

  /**
   * GET /communications/consent - Get consent records for tenant
   */
  app.get(
    '/communications/consent',
    withHandler(async (req: AppRequest, reply) => {
      const tenantId = requireTenantId(req, reply);
      if (!tenantId) return;

      const consents = await consentService.getConsentRecords(tenantId);

      return reply.send({
        success: true,
        consents,
      });
    }, 'Failed to get consent records')
  );

  /**
   * POST /communications/consent - Record customer consent
   */
  app.post(
    '/communications/consent',
    withHandler(async (req: AppRequest, reply) => {
      const tenantId = requireTenantId(req, reply);
      if (!tenantId) return;

      const parsed = RecordConsentSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          error: 'Validation failed',
          details: parsed.error.issues,
        });
      }

      const consent = await consentService.recordConsent({
        tenant_id: tenantId,
        customer_id: parsed.data.customer_id || undefined,
        customer_email: parsed.data.customer_email,
        customer_phone: parsed.data.customer_phone,
        consent_type: parsed.data.consent_type,
        consent_given: parsed.data.consent_given,
        consent_date: new Date().toISOString(),
        consent_method: parsed.data.consent_method,
        consent_source: parsed.data.consent_source,
        ip_address: parsed.data.ip_address,
      });

      return reply.send({
        success: true,
        consent,
      });
    }, 'Failed to record consent')
  );

  /**
   * POST /communications/opt-out - Process opt-out request (STOP, UNSUBSCRIBE)
   */
  app.post(
    '/communications/opt-out',
    withHandler(async (req: AppRequest, reply) => {
      const tenantId = requireTenantId(req, reply);
      if (!tenantId) return;

      const parsed = ProcessOptOutSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          error: 'Validation failed',
          details: parsed.error.issues,
        });
      }

      const optOut = await consentService.processOptOutCommand(
        tenantId,
        parsed.data.command,
        parsed.data.customer_phone,
        parsed.data.customer_email,
        parsed.data.message_body
      );

      if (optOut) {
        return reply.send({
          success: true,
          optOut,
          message: 'Opt-out processed successfully',
        });
      } else {
        return reply.status(400).send({
          success: false,
          error: 'Failed to process opt-out',
        });
      }
    }, 'Failed to process opt-out')
  );

  /**
   * GET /communications/opt-outs - Get opt-out records for tenant
   */
  app.get(
    '/communications/opt-outs',
    withHandler(async (req: AppRequest, reply) => {
      const tenantId = requireTenantId(req, reply);
      if (!tenantId) return;

      const optOuts = await consentService.getOptOutRecords(tenantId);

      return reply.send({
        success: true,
        optOuts,
      });
    }, 'Failed to get opt-out records')
  );

  /**
   * POST /communications/telnyx/status — Telnyx SMS delivery-status webhook.
   *
   * Telnyx POSTs JSON here when webhook_url is set on the message (see
   * TelnyxSmsAdapter.sendSMS). PUBLIC + tenant-exempt: no JWT; tenant_id
   * is read from ?tenant_id= on the URL the adapter appended.
   *
   * Verification: if TELNYX_WEBHOOK_SECRET is set we validate the
   * telnyx-signature header (HMAC-SHA256 of `timestamp|rawBody`) against the
   * exact bytes received — never a re-stringified `req.body`, whose key order
   * and whitespace need not match what Telnyx signed. A bad signature → 403.
   * Without the secret configured we accept + log (dev/staging).
   *
   * Payload shape (Telnyx v2):
   *   data.event_type  — "message.finalized" | "message.sent" | "message.failed"
   *   data.payload.id  — message ID (our messageSid)
   *   data.payload.to[0].status — per-recipient delivery status
   *   data.payload.errors[]    — error objects (optional)
   */
  app.post('/communications/telnyx/status', async (req: AppRequest, reply) => {
    // Signature verification runs BEFORE the payload is read: an unsigned
    // caller must never reach the parsing/DB path.
    const webhookSecret = process.env.TELNYX_WEBHOOK_SECRET;
    if (webhookSecret) {
      const rawBuffer = (req as { rawBody?: Buffer | string }).rawBody;
      const rawBody =
        typeof rawBuffer === 'string'
          ? rawBuffer
          : rawBuffer instanceof Buffer
            ? rawBuffer.toString('utf8')
            : null;

      if (rawBody === null) {
        req.log.error(
          { event: 'telnyx_status_callback_missing_raw_body' },
          'Raw body missing for Telnyx status callback — verification cannot proceed'
        );
        return reply.status(400).send({ success: false, error: 'Raw body unavailable' });
      }

      const sigHeader = (req.headers['telnyx-signature'] as string) || '';
      const parts = Object.fromEntries(
        sigHeader.split(',').map((p) => p.split('=') as [string, string])
      );
      const timestamp = parts['t'] ?? '';
      const receivedSig = parts['v1'] ?? '';
      const expected = createHmac('sha256', webhookSecret)
        .update(`${timestamp}|${rawBody}`)
        .digest('hex');
      const received = Buffer.from(receivedSig, 'hex');
      const expectedBuf = Buffer.from(expected, 'hex');
      const signatureValid =
        received.length === expectedBuf.length && timingSafeEqual(received, expectedBuf);
      if (!signatureValid) {
        req.log.warn(
          { event: 'telnyx_status_callback_invalid_signature' },
          'Telnyx status callback signature mismatch'
        );
        return reply.status(403).send({ success: false, error: 'Invalid Telnyx signature' });
      }
    } else {
      req.log.info(
        { event: 'telnyx_status_callback_unverified' },
        'TELNYX_WEBHOOK_SECRET unset — accepting Telnyx status callback without signature verification'
      );
    }

    const payload = (req.body ?? {}) as Record<string, unknown>;
    const data = payload.data as Record<string, unknown> | undefined;
    const innerPayload = data?.payload as Record<string, unknown> | undefined;
    const messageSid = innerPayload?.id as string | undefined;
    const toArray = innerPayload?.to as Array<{ status?: string }> | undefined;
    const messageStatus = toArray?.[0]?.status ?? (data?.event_type as string | undefined);
    const errors = innerPayload?.errors as Array<{ code?: string | number }> | undefined;
    const errorCode = errors?.[0]?.code ? String(errors[0].code) : null;

    if (!messageSid || !messageStatus) {
      req.log.warn(
        { event: 'telnyx_status_callback_malformed' },
        'Telnyx status callback missing message id or status'
      );
      return reply
        .status(400)
        .send({ success: false, error: 'Missing message id or status in Telnyx payload' });
    }

    const tenantId = (req.query as Record<string, string | undefined>)?.tenant_id ?? null;

    await recordDeliveryStatus(pool, {
      messageSid,
      messageStatus,
      errorCode,
      tenantId,
    });

    messageDeliveryReceiptsTotal.inc({ status: messageStatus });

    return reply.send({ success: true });
  });

  /**
   * POST /communications/telnyx/inbound — inbound SMS (customer → us).
   *
   * Phase 1 of the SMS-confirmation design (docs/superpowers/specs/
   * 2026-07-11-sms-appointment-confirmation-design.md). It handles the carrier
   * keywords ONLY — STOP/UNSUBSCRIBE and START — and takes no action on anything
   * else. The Y/N appointment-confirmation branches land in phases 2–3.
   *
   * Shipping this alone closes a live compliance gap: until now NOTHING in the
   * app received an inbound text, so a customer who replied STOP to one of our
   * messages was never recorded in `opt_out_records`. The opt-out machinery
   * (ConsentService.processOptOutCommand) already existed — it just had no
   * inbound path to reach it.
   *
   * SECURITY — fail CLOSED. Unlike /telnyx/status (a read-only receipt sink that
   * accepts unsigned callbacks in dev), this route MUTATES consent state, and
   * later cancels appointments. It is a public endpoint, so without a signature
   * check the `from` number is just an attacker-supplied string and this becomes
   * an unauthenticated "opt any number out / cancel any booking" API. So:
   * TELNYX_WEBHOOK_SECRET unset → reject everything (503), never run unguarded.
   * Same "never unlocked by default" rule as AGENT_SECRET.
   *
   * Payload shape (Telnyx v2 message.received):
   *   data.payload.from.phone_number  — the customer
   *   data.payload.to[0].phone_number — OUR number (→ resolves the tenant)
   *   data.payload.text               — the body
   */
  app.post('/communications/telnyx/inbound', async (req: AppRequest, reply) => {
    const webhookSecret = process.env.TELNYX_WEBHOOK_SECRET;
    if (!webhookSecret) {
      // Fail closed. An unconfigured secret must not silently degrade a mutating
      // endpoint into an open one — that is the exact failure mode this guard
      // exists to prevent, and it would be invisible in prod.
      errorsTotal.inc({ event: 'telnyx_inbound_secret_unset' });
      req.log.error(
        { event: 'telnyx_inbound_secret_unset' },
        'TELNYX_WEBHOOK_SECRET unset — refusing inbound SMS webhook (fail closed; set the secret to enable)'
      );
      return reply.status(503).send({ success: false, error: 'Webhook not configured' });
    }

    // Verify BEFORE touching the payload: an unsigned caller must never reach
    // the parse/DB path. Verified against the exact received bytes (req.rawBody,
    // preserved by jsonContentTypeParser), never a re-stringified req.body.
    const verdict = verifyTelnyxSignature({
      rawBody: (req as { rawBody?: Buffer | string }).rawBody,
      signatureHeader: req.headers['telnyx-signature'] as string | undefined,
      secret: webhookSecret,
    });
    if (!verdict.valid) {
      inboundSmsTotal.inc({ outcome: 'rejected' });
      errorsTotal.inc({ event: 'telnyx_inbound_invalid_signature' });
      // 5W: WHAT a forged/unsigned inbound webhook, WHY the specific failure.
      // This is the line that tells you someone is POSTing at the endpoint
      // directly — the attack the signature check exists to stop.
      req.log.warn(
        { event: 'telnyx_inbound_invalid_signature', reason: verdict.reason },
        'Inbound SMS webhook REJECTED — signature invalid (forged or unsigned request)'
      );
      const status = verdict.reason === 'missing_raw_body' ? 400 : 403;
      return reply.status(status).send({ success: false, error: 'Invalid Telnyx signature' });
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const data = body.data as Record<string, unknown> | undefined;
    const payload = data?.payload as Record<string, unknown> | undefined;
    const from = (payload?.from as { phone_number?: string } | undefined)?.phone_number;
    const toArr = payload?.to as Array<{ phone_number?: string }> | undefined;
    const ourNumber = toArr?.[0]?.phone_number;
    const text = payload?.text as string | undefined;

    if (!from || !ourNumber) {
      req.log.warn(
        { event: 'telnyx_inbound_malformed' },
        'Inbound SMS webhook missing from/to phone number'
      );
      return reply.status(400).send({ success: false, error: 'Missing from/to in Telnyx payload' });
    }

    const fromPhone = normalizePhone(from);
    const toPhone = normalizePhone(ourNumber);

    // Resolve the tenant from OUR number (the message's destination). Cross-tenant
    // by nature — the sender isn't authenticated and no tenant context exists yet —
    // so this reads `tenants` on the raw pool, relying on the admin-bypass policy.
    const tenantRes = await pool.query<{ tenant_id: string }>(
      `SELECT tenant_id FROM tenants WHERE inbound_phone = $1 LIMIT 1`,
      [toPhone]
    );
    const tenantId = tenantRes.rows[0]?.tenant_id ?? null;
    if (!tenantId) {
      // 200, not an error: Telnyx RETRIES non-2xx, and a text to a number we
      // don't own is not a failure we can fix by being retried.
      inboundSmsTotal.inc({ outcome: 'unknown_tenant' });
      req.log.warn(
        { event: 'telnyx_inbound_unknown_tenant', to_last4: toPhone?.slice(-4) },
        'Inbound SMS for a number matching no tenant — ignored'
      );
      return reply.send({ success: true, result: { handled: false, reason: 'unknown_tenant' } });
    }

    const keyword = classifySmsKeyword(text);

    // Opt-out FIRST: a STOP must never be interpreted as anything else. (When the
    // Y/N flow lands, its branches go AFTER this one for the same reason.)
    if (keyword === 'opt_out' || keyword === 'opt_in') {
      try {
        await consentService.processOptOutCommand(
          tenantId,
          keyword === 'opt_out' ? 'STOP' : 'START',
          fromPhone ?? undefined,
          undefined,
          text
        );
      } catch (err) {
        // Instrumented, not swallowed: a failing opt-out is a COMPLIANCE failure,
        // and it is invisible without this (the customer just keeps getting texts).
        errorsTotal.inc({ event: 'telnyx_inbound_optout_failed' });
        req.log.error(
          { event: 'telnyx_inbound_optout_failed', tenant_id: tenantId, err },
          'Inbound SMS opt-out/opt-in FAILED to record — customer may keep receiving messages'
        );
        // Non-2xx so Telnyx retries: unlike an unknown tenant, this IS fixable
        // by being retried, and silently dropping an opt-out is not acceptable.
        return reply.status(500).send({ success: false, error: 'Failed to process opt-out' });
      }

      inboundSmsTotal.inc({ outcome: keyword === 'opt_out' ? 'opted_out' : 'opted_in' });
      req.log.info(
        { event: 'telnyx_inbound_keyword', tenant_id: tenantId, keyword },
        `Inbound SMS keyword handled: ${keyword}`
      );
      return reply.send({ success: true, result: { handled: true, keyword } });
    }

    // Phase 1 takes no action on anything else. The Y/N appointment-confirmation
    // branches attach here (phases 2–3). Acked so Telnyx doesn't retry.
    inboundSmsTotal.inc({ outcome: 'ignored' });
    return reply.send({ success: true, result: { handled: false, reason: 'no_keyword' } });
  });
}
