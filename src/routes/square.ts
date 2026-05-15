import type { Pool, PoolClient } from 'pg';
import type { FastifyRequest, FastifyReply } from 'fastify';
import type { AppFastifyInstance } from '../types/fastify';
import { withHandler, logEvent, requireTenantId, type AppRequest } from '../middleware';
import * as squareClient from '../services/squareClient';
import * as squareSync from '../services/squareSync';
import { createOAuthCallbackHandler } from '../services/oauthCallbackFactory';
import { getCrmSyncStatus } from '../services/crmSyncStatus';
import { disconnectCrmIntegration } from '../services/crmDisconnect';

export function registerSquareRoutes(
  app: AppFastifyInstance,
  pool: Pool,
  withTenantClient: <T>(tenantId: string, fn: (client: PoolClient) => Promise<T>) => Promise<T>
) {
  // --- Square OAuth: Initiate ---
  app.get('/square/auth', withHandler(async (req: AppRequest, reply) => {
    const tenantId = requireTenantId(req, reply);
    if (!tenantId) return;

    if (!squareClient.isSquareEnabled()) {
      return reply.status(503).send({
        success: false,
        error: 'Square integration is not configured. Set SQUARE_CLIENT_ID, SQUARE_CLIENT_SECRET, and SQUARE_CALLBACK_URL.',
      });
    }

    const url = squareClient.getAuthUrl(tenantId);
    if (!url) {
      return reply.status(500).send({ success: false, error: 'Failed to generate Square auth URL' });
    }

    logEvent(req, 'square_oauth_initiated', {});
    return reply.send({ url });
  }, 'Failed to initiate Square auth'));

  // --- Square OAuth: Callback ---
  app.get('/square/auth/callback', createOAuthCallbackHandler(pool, app, {
    provider: 'square',
    verifyState: squareClient.verifyState,
    exchangeCodeForTokens: squareClient.exchangeCodeForTokens,
  }));

  // --- Get Square settings (strip tokens) ---
  app.get('/square/settings', withHandler(async (req: AppRequest, reply) => {
    const tenantId = requireTenantId(req, reply);
    if (!tenantId) return;

    const res = await withTenantClient(tenantId, async (client) => {
      return client.query(
        `SELECT tenant_id, provider, is_active, last_sync_at, created_at, updated_at
         FROM tenant_integration_settings WHERE tenant_id = $1 AND provider = 'square'`,
        [tenantId]
      );
    });
    return reply.send(res.rows[0] || null);
  }, 'Failed to fetch Square settings'));

  // --- Disconnect Square ---
  app.post('/square/settings/disconnect', withHandler(async (req: AppRequest, reply) => {
    const tenantId = requireTenantId(req, reply);
    if (!tenantId) return;

    await withTenantClient(tenantId, (client) =>
      disconnectCrmIntegration(client, tenantId, 'square')
    );

    logEvent(req, 'square_disconnected', {});
    return reply.send({ success: true });
  }, 'Failed to disconnect Square'));

  // --- Square webhook receiver ---
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
      app.log.error({ event: 'square_webhook_missing_raw_body' }, 'Raw body missing for Square webhook — verification cannot proceed');
      return reply.status(400).send({ success: false, error: 'Raw body unavailable' });
    }

    const signatureKey = process.env.SQUARE_WEBHOOK_SIGNATURE_KEY || '';
    if (!signatureKey) {
      return reply.status(500).send({ success: false, error: 'Square webhook signature key not configured' });
    }

    const notificationUrl = `${req.protocol}://${req.hostname}${req.url}`;
    if (!squareClient.verifyWebhookSignature(rawBody, signature, signatureKey, notificationUrl)) {
      app.log.warn({ event: 'square_webhook_invalid_signature' }, 'Square webhook signature mismatch');
      return reply.status(401).send({ success: false, error: 'Invalid webhook signature' });
    }

    // Respond immediately
    reply.status(200).send({ success: true, message: 'Webhook received' });

    // Process event async
    const event = req.body as { type?: string; merchant_id?: string; data?: { id?: string } } | undefined;
    const eventType = event?.type;
    const merchantId = event?.merchant_id;

    if (!eventType || !merchantId) return;

    try {
      // Look up tenant by merchant ID (stored in settings JSONB)
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
        // Booking events — could pull booking data here
        // For now, log and skip (full sync handles bookings)
        app.log.info({ event: 'square_webhook_booking_event', eventType, merchantId });
      }
    } catch (err) {
      app.log.error({ event: 'square_webhook_processing_failed', eventType, merchantId, error: (err as Error).message });
    }
  });

  // --- Trigger full sync ---
  app.post('/square/sync', withHandler(async (req: AppRequest, reply) => {
    const tenantId = requireTenantId(req, reply);
    if (!tenantId) return;

    const result = await squareSync.fullSync(pool, tenantId);
    return reply.send({ success: true, ...result });
  }, 'Failed to trigger Square sync'));

  // --- Get sync status ---
  app.get('/square/sync/status', withHandler(async (req: AppRequest, reply) => {
    const tenantId = requireTenantId(req, reply);
    if (!tenantId) return;

    const res = await withTenantClient(tenantId, (client) =>
      getCrmSyncStatus(client, tenantId, 'square')
    );
    return reply.send(res);
  }, 'Failed to get Square sync status'));
}
