/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument, @typescript-eslint/unbound-method, @typescript-eslint/no-explicit-any */
/**
 * ESLint rules disabled for this file as part of historical full cleanup (REFACTORING_TODO item 10; see RESOLVED.md for details).
 * These are the remaining dynamic/any-heavy areas after previous tranches.
 */

import type { Pool, PoolClient } from 'pg';
import type { FastifyRequest, FastifyReply } from 'fastify';
import type { AppFastifyInstance } from '../types/fastify';
import * as squareClient from '../services/crm/squareClient';
import * as squareSync from '../services/crm/squareSync';
import { registerCrmScaffoldRoutes } from './crmRouteScaffold';

export function registerSquareRoutes(
  app: AppFastifyInstance,
  pool: Pool,
  withTenantClient: <T>(tenantId: string, fn: (client: PoolClient) => Promise<T>) => Promise<T>
) {
  registerCrmScaffoldRoutes(app, pool, withTenantClient, {
    provider: 'square',
    displayName: 'Square',
    isEnabled: squareClient.isSquareEnabled,
    getAuthUrl: squareClient.getAuthUrl,
    verifyState: squareClient.verifyState,
    exchangeCodeForTokens: squareClient.exchangeCodeForTokens,
    fullSync: (pool, tenantId) => squareSync.fullSync(pool, tenantId),
  });

  // --- Square webhook receiver (provider-specific: HMAC-SHA256, merchant_id lookup) ---
  app.post('/square/webhook', async (req: FastifyRequest, reply: FastifyReply) => {
    const signature = req.headers['x-square-hmacsha256-signature'] as string;
    // HMAC verification requires the EXACT bytes Square signed. See hubspot.ts
    // for the rationale — same fix.
    const rawBuffer = (req as { rawBody?: Buffer | string }).rawBody;
    const rawBody =
      typeof rawBuffer === 'string'
        ? rawBuffer
        : rawBuffer instanceof Buffer
          ? rawBuffer.toString('utf8')
          : null;

    if (!signature) {
      return reply.status(400).send({ success: false, error: 'Missing signature header' });
    }
    if (rawBody === null) {
      app.log.error(
        { event: 'square_webhook_missing_raw_body' },
        'Raw body missing for Square webhook — verification cannot proceed'
      );
      return reply.status(400).send({ success: false, error: 'Raw body unavailable' });
    }

    const signatureKey = process.env.SQUARE_WEBHOOK_SIGNATURE_KEY || '';
    if (!signatureKey) {
      return reply
        .status(500)
        .send({ success: false, error: 'Square webhook signature key not configured' });
    }

    const notificationUrl = `${req.protocol}://${req.hostname}${req.url}`;
    if (!squareClient.verifyWebhookSignature(rawBody, signature, signatureKey, notificationUrl)) {
      app.log.warn(
        { event: 'square_webhook_invalid_signature' },
        'Square webhook signature mismatch'
      );
      return reply.status(401).send({ success: false, error: 'Invalid webhook signature' });
    }

    void reply.status(200).send({ success: true, message: 'Webhook received' });

    const event = req.body as
      { type?: string; merchant_id?: string; data?: { id?: string } } | undefined;
    const eventType = event?.type;
    const merchantId = event?.merchant_id;

    if (!eventType || !merchantId) return;

    try {
      const tenantRes = await pool.query(
        `SELECT tenant_id FROM tenant_integration_settings
         WHERE provider = 'square' AND is_active = true AND (settings->>'merchant_id')::text = $1`,
        [String(merchantId)]
      );
      const tenantId = tenantRes.rows[0]?.tenant_id;
      if (!tenantId) return;

      const tokens = await squareSync.getTokensWithRefresh(pool, tenantId);
      if (!tokens) return;

      if (eventType === 'customer.created' || eventType === 'customer.updated') {
        const customerId = event?.data?.id;
        if (customerId) {
          const result = await squareClient.getCustomer(tokens.accessToken, customerId);
          if (result?.customer) {
            await squareSync.pullSquareCustomer(pool, tenantId, result.customer);
          }
        }
      } else if (eventType === 'booking.created' || eventType === 'booking.updated') {
        app.log.info({ event: 'square_webhook_booking_event', eventType, merchantId });
      }
    } catch (err) {
      app.log.error({
        event: 'square_webhook_processing_failed',
        eventType,
        merchantId,
        error: (err as Error).message,
      });
    }
  });
}
