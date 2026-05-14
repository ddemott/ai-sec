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

import type { FastifyInstance } from 'fastify';
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

const RecordConsentSchema = z.object({
  customer_email: z.string().email().optional(),
  customer_phone: z.string().min(10).max(20).optional(),
  customer_id: z.string().uuid().optional(),
  consent_type: z.enum(['email', 'sms', 'both']),
  consent_given: z.boolean(),
  consent_method: z.enum(['web_form', 'sms_reply', 'verbal', 'import', 'booking']),
  consent_source: z.string().max(200).optional(),
  ip_address: z.string().max(45).optional(), // IPv4 or IPv6
}).refine(
  (data) => data.customer_email || data.customer_phone,
  { message: 'Either customer_email or customer_phone is required' }
);

const ProcessOptOutSchema = z.object({
  command: z.string().min(1).max(50),
  customer_phone: z.string().min(10).max(20).optional(),
  customer_email: z.string().email().optional(),
  message_body: z.string().max(1000).optional(),
}).refine(
  (data) => data.customer_email || data.customer_phone,
  { message: 'Either customer_email or customer_phone is required' }
);

const HistoryQuerySchema = z.object({
  type: z.enum(['email', 'sms', 'all']).optional().default('all'),
  limit: z.coerce.number().min(1).max(100).optional().default(50),
  offset: z.coerce.number().min(0).optional().default(0),
});

// ── Route Registration ───────────────────────────────────────────────

export function registerCommunicationRoutes(
  app: FastifyInstance<any, any, any>,
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
  app.post('/communications/email', withHandler(async (req: AppRequest, reply) => {
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
  }, 'Failed to send email'));

  /**
   * POST /communications/sms - Send an SMS
   */
  app.post('/communications/sms', withHandler(async (req: AppRequest, reply) => {
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
  }, 'Failed to send SMS'));

  /**
   * GET /communications/history - Get communication history
   * Note: This requires a communications_history table to be implemented.
   * For now, returns an empty placeholder.
   */
  app.get('/communications/history', withHandler(async (req: AppRequest, reply) => {
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
  }, 'Failed to get communication history'));

  /**
   * GET /communications/consent - Get consent records for tenant
   */
  app.get('/communications/consent', withHandler(async (req: AppRequest, reply) => {
    const tenantId = requireTenantId(req, reply);
    if (!tenantId) return;

    const consents = await consentService.getConsentRecords(tenantId);

    return reply.send({
      success: true,
      consents,
    });
  }, 'Failed to get consent records'));

  /**
   * POST /communications/consent - Record customer consent
   */
  app.post('/communications/consent', withHandler(async (req: AppRequest, reply) => {
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
  }, 'Failed to record consent'));

  /**
   * POST /communications/opt-out - Process opt-out request (STOP, UNSUBSCRIBE)
   */
  app.post('/communications/opt-out', withHandler(async (req: AppRequest, reply) => {
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
      parsed.data.message_body,
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
  }, 'Failed to process opt-out'));

  /**
   * GET /communications/opt-outs - Get opt-out records for tenant
   */
  app.get('/communications/opt-outs', withHandler(async (req: AppRequest, reply) => {
    const tenantId = requireTenantId(req, reply);
    if (!tenantId) return;

    const optOuts = await consentService.getOptOutRecords(tenantId);

    return reply.send({
      success: true,
      optOuts,
    });
  }, 'Failed to get opt-out records'));
}
