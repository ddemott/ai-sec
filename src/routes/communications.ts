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
import { withHandler, requireTenantId, type AppRequest } from '../middleware.js';
import { CommunicationService } from '../services/communications/index.js';
import { ConsentService } from '../services/consentService.js';
import { createDatabaseService } from '../database/index.js';
import { createTenantConfigService } from '../services/tenants/index.js';

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
   * Tenant-scoped read of the communications_history table (written on the
   * send success path of EmailService/SMSService). Filterable by channel via
   * ?type=email|sms|all (default all); paginated via ?limit (1-100, default
   * 50) + ?offset. `total` is the full filtered count, independent of the
   * page window, so the dashboard can render pagination controls.
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

      const { type, limit, offset } = parsed.data;

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
            ORDER BY created_at DESC, communications_history_id DESC
            LIMIT $3 OFFSET $4`,
          [tenantId, type, limit, offset]
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
}
