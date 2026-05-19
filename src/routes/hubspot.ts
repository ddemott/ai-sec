import type { Pool, PoolClient } from 'pg';
import type { FastifyRequest, FastifyReply } from 'fastify';
import type { AppFastifyInstance } from '../types/fastify';
import { withHandler, logEvent, requireTenantId, type AppRequest } from '../middleware';
import * as hubspotClient from '../services/hubspotClient';
import * as hubspotSync from '../services/hubspotSync';
import { createOAuthCallbackHandler } from '../services/oauthCallbackFactory';
import { getCrmSyncStatus } from '../services/crmSyncStatus';
import { disconnectCrmIntegration } from '../services/crmDisconnect';

export function registerHubSpotRoutes(
  app: AppFastifyInstance,
  pool: Pool,
  withTenantClient: <T>(tenantId: string, fn: (client: PoolClient) => Promise<T>) => Promise<T>
) {
  // --- HubSpot OAuth: Initiate ---
  app.get('/hubspot/auth', withHandler(async (req: AppRequest, reply) => {
    const tenantId = requireTenantId(req, reply);
    if (!tenantId) return;

    if (!hubspotClient.isHubSpotEnabled()) {
      return reply.status(503).send({
        success: false,
        error: 'HubSpot integration is not configured. Set HUBSPOT_CLIENT_ID, HUBSPOT_CLIENT_SECRET, and HUBSPOT_CALLBACK_URL.',
      });
    }

    const url = hubspotClient.getAuthUrl(tenantId);
    if (!url) {
      return reply.status(500).send({ success: false, error: 'Failed to generate HubSpot auth URL' });
    }

    logEvent(req, 'hubspot_oauth_initiated', {});
    return reply.send({ url });
  }, 'Failed to initiate HubSpot auth'));

  // --- HubSpot OAuth: Callback ---
  app.get('/hubspot/auth/callback', createOAuthCallbackHandler(pool, app, {
    provider: 'hubspot',
    verifyState: hubspotClient.verifyState,
    exchangeCodeForTokens: hubspotClient.exchangeCodeForTokens,
  }));

  // --- Get HubSpot settings (strip tokens) ---
  app.get('/hubspot/settings', withHandler(async (req: AppRequest, reply) => {
    const tenantId = requireTenantId(req, reply);
    if (!tenantId) return;

    const res = await withTenantClient(tenantId, async (client) => {
      return client.query(
        `SELECT tenant_id, provider, is_active, last_sync_at, created_at, updated_at
         FROM tenant_integration_settings WHERE tenant_id = $1 AND provider = 'hubspot'`,
        [tenantId]
      );
    });
    return reply.send(res.rows[0] || null);
  }, 'Failed to fetch HubSpot settings'));

  // --- Disconnect HubSpot ---
  app.post('/hubspot/settings/disconnect', withHandler(async (req: AppRequest, reply) => {
    const tenantId = requireTenantId(req, reply);
    if (!tenantId) return;

    await withTenantClient(tenantId, (client) =>
      disconnectCrmIntegration(client, tenantId, 'hubspot')
    );

    logEvent(req, 'hubspot_disconnected', {});
    return reply.send({ success: true });
  }, 'Failed to disconnect HubSpot'));

  // --- HubSpot webhook receiver ---
  app.post('/hubspot/webhook', async (req: FastifyRequest, reply: FastifyReply) => {
    const signature = req.headers['x-hubspot-signature-v3'] as string;
    const timestamp = req.headers['x-hubspot-request-timestamp'] as string;
    // HMAC verification requires the EXACT bytes HubSpot signed. Re-serializing
    // via JSON.stringify(req.body) drops/changes whitespace + key order vs the
    // original payload, breaking the signature deterministically. The global
    // content-type parser in src/index.ts preserves req.rawBody for this.
    const rawBuffer = (req as { rawBody?: Buffer | string }).rawBody;
    const rawBody =
      typeof rawBuffer === 'string'
        ? rawBuffer
        : rawBuffer instanceof Buffer
          ? rawBuffer.toString('utf8')
          : null;

    if (!signature || !timestamp) {
      return reply.status(400).send({ success: false, error: 'Missing signature or timestamp headers' });
    }
    if (rawBody === null) {
      // Defensive — should never happen given the global content-type parser,
      // but if it does, fail closed rather than verify against wrong bytes.
      app.log.error({ event: 'hubspot_webhook_missing_raw_body' }, 'Raw body missing for HubSpot webhook — verification cannot proceed');
      return reply.status(400).send({ success: false, error: 'Raw body unavailable' });
    }

    // Check timestamp freshness (5 min window)
    const timestampMs = Number(timestamp);
    if (!Number.isFinite(timestampMs) || timestampMs <= 0) {
      return reply.status(400).send({ success: false, error: 'Invalid or missing timestamp header' });
    }
    const requestAge = Date.now() - timestampMs;
    if (requestAge > 5 * 60 * 1000 || requestAge < -30_000) {
      // Reject requests older than 5 minutes or more than 30s in the future (clock skew tolerance)
      return reply.status(401).send({ success: false, error: 'Request timestamp too old or too far in the future (replay protection)' });
    }

    const config = {
      clientSecret: process.env.HUBSPOT_CLIENT_SECRET || '',
    };
    if (!config.clientSecret) {
      return reply.status(500).send({ success: false, error: 'HubSpot client secret not configured' });
    }

    const requestMethod = 'POST';
    const requestUri = `${req.protocol}://${req.hostname}${req.url}`;
    if (!hubspotClient.verifyWebhookSignature(requestMethod, requestUri, rawBody, timestamp, signature, config.clientSecret)) {
      app.log.warn({ event: 'hubspot_webhook_invalid_signature' }, 'HubSpot webhook signature mismatch');
      return reply.status(401).send({ success: false, error: 'Invalid webhook signature' });
    }

    // HubSpot sends batched events as an array
    const events = Array.isArray(req.body) ? req.body : [req.body];

    // Respond immediately
    void reply.status(200).send({ success: true, message: 'Webhook received' });

    // Process events async
    for (const event of events) {
      const { subscriptionType, objectId, portalId } = event;
      if (!subscriptionType || !objectId) continue;

      try {
        // Look up tenant by portal ID (stored in settings JSONB)
        const tenantRes = await pool.query(
          `SELECT tenant_id FROM tenant_integration_settings
           WHERE provider = 'hubspot' AND is_active = true AND (settings->>'portal_id')::text = $1`,
          [String(portalId)]
        );
        const tenantId = tenantRes.rows[0]?.tenant_id;
        if (!tenantId) continue;

        const tokens = await hubspotSync.getTokensWithRefresh(pool, tenantId);
        if (!tokens) continue;

        if (subscriptionType === 'contact.creation' || subscriptionType === 'contact.propertyChange') {
          const contact = await hubspotClient.getContact(tokens.accessToken, String(objectId));
          if (contact) {
            await hubspotSync.pullHubSpotContact(pool, tenantId, contact);
          }
        }
      } catch (err) {
        app.log.error({ event: 'hubspot_webhook_processing_failed', subscriptionType, objectId, error: (err as Error).message });
      }
    }
  });

  // --- Trigger full sync ---
  app.post('/hubspot/sync', withHandler(async (req: AppRequest, reply) => {
    const tenantId = requireTenantId(req, reply);
    if (!tenantId) return;

    const result = await hubspotSync.fullSync(pool, tenantId);
    return reply.send({ success: true, ...result });
  }, 'Failed to trigger HubSpot sync'));

  // --- Get sync status ---
  app.get('/hubspot/sync/status', withHandler(async (req: AppRequest, reply) => {
    const tenantId = requireTenantId(req, reply);
    if (!tenantId) return;

    const res = await withTenantClient(tenantId, (client) =>
      getCrmSyncStatus(client, tenantId, 'hubspot')
    );
    return reply.send(res);
  }, 'Failed to get HubSpot sync status'));
}
