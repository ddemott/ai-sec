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
import twilio from 'twilio';
import { withHandler, requireTenantId, type AppRequest } from '../middleware.js';
import { CommunicationService } from '../services/communications/index.js';
import { ConsentService } from '../services/consentService.js';
import { createDatabaseService } from '../database/index.js';
import { createTenantConfigService } from '../services/tenants/index.js';
import { messageDeliveryReceiptsTotal } from '../services/metrics.js';

/**
 * Record a Twilio SMS delivery-status callback.
 *
 * Exported (not inlined) so the unit test can drive the persistence path
 * directly with a mock pool — the handler around it stays a thin HTTP shell.
 * Upsert keyed on message_sid: Twilio fires the callback multiple times as
 * the message advances (queued → sent → delivered), latest status wins.
 */
export async function recordTwilioDeliveryStatus(
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
  limit: z.coerce.number().min(1).max(100).optional().default(50),
  offset: z.coerce.number().min(0).optional().default(0),
});

// ── Route Registration ───────────────────────────────────────────────

export function registerCommunicationRoutes(
  app: AppFastifyInstance,
  pool: Pool,
  _withTenantClient: <T>(tenantId: string, fn: (client: PoolClient) => Promise<T>) => Promise<T>
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
   * GET /communications/history - Get communication history
   * Note: This requires a communications_history table to be implemented.
   * For now, returns an empty placeholder.
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

      // TODO: Implement communications_history table
      // For now, return empty list with a note
      return reply.send({
        success: true,
        history: [],
        total: 0,
        note: 'Communication history tracking not yet implemented',
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
   * POST /communications/twilio/status — Twilio SMS delivery-status webhook.
   *
   * Twilio POSTs the message lifecycle here (form-encoded: MessageSid +
   * MessageStatus, plus optional ErrorCode) when statusCallback is set on
   * messages.create() (see TwilioAdapter.sendSMS). PUBLIC + tenant-exempt:
   * Twilio sends no JWT and no tenant_id in the body — the owning tenant is
   * read back from the ?tenant_id= query param the adapter appended to the
   * callback URL.
   *
   * Verification: if TWILIO_AUTH_TOKEN is set we validate the X-Twilio-Signature
   * against the reconstructed request URL + form params (twilio.validateRequest).
   * A bad signature → 403, nothing recorded. With no auth token configured we
   * accept + log (helper-unavailable branch) so local/dev still works.
   *
   * Always replies 200 quickly on the happy path so Twilio doesn't retry a
   * callback we've already ingested. Writes via the shared `pool` (the route
   * has no RLS tenant context); message_delivery_status is a non-RLS event table.
   */
  app.post('/communications/twilio/status', async (req: AppRequest, reply) => {
    const body = (req.body ?? {}) as Record<string, string | undefined>;
    const messageSid = body.MessageSid;
    const messageStatus = body.MessageStatus;
    const errorCode = body.ErrorCode ?? null;

    // Malformed callback: missing the two fields every Twilio status callback
    // carries. Reject 400 (and record nothing) rather than persist a junk row.
    if (!messageSid || !messageStatus) {
      req.log.warn(
        { event: 'twilio_status_callback_malformed' },
        'Twilio status callback missing MessageSid or MessageStatus'
      );
      return reply
        .status(400)
        .send({ success: false, error: 'Missing MessageSid or MessageStatus' });
    }

    // Signature verification (when the auth token is available).
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    if (authToken) {
      const signature = (req.headers['x-twilio-signature'] as string) || '';
      // Twilio signs the full URL it POSTed to, including the query string,
      // plus the sorted POST params. Reconstruct it the same way the Square
      // webhook does (protocol + host + url).
      const url = `${req.protocol}://${req.hostname}${req.url}`;
      const valid = twilio.validateRequest(
        authToken,
        signature,
        url,
        body as Record<string, string>
      );
      if (!valid) {
        req.log.warn(
          { event: 'twilio_status_callback_invalid_signature', messageSid },
          'Twilio status callback signature mismatch'
        );
        return reply.status(403).send({ success: false, error: 'Invalid Twilio signature' });
      }
    } else {
      req.log.info(
        { event: 'twilio_status_callback_unverified' },
        'TWILIO_AUTH_TOKEN unset — accepting status callback without signature verification'
      );
    }

    const tenantId = (req.query as Record<string, string | undefined>)?.tenant_id ?? null;

    await recordTwilioDeliveryStatus(pool, {
      messageSid,
      messageStatus,
      errorCode,
      tenantId,
    });

    messageDeliveryReceiptsTotal.inc({ status: messageStatus });

    return reply.send({ success: true });
  });
}
