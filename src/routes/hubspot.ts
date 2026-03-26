import type { Pool, PoolClient } from 'pg';
import { withHandler, logEvent, requireTenantId, type AppRequest } from '../middleware';
import * as hubspotClient from '../services/hubspotClient';
import * as hubspotSync from '../services/hubspotSync';

export function registerHubSpotRoutes(
  app: any,
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
  app.get('/hubspot/auth/callback', async (req: any, reply: any) => {
    const { code, state, error: oauthError } = req.query as Record<string, string>;
    const dashboardUrl = process.env.DASHBOARD_URL || 'https://localhost:3001';

    if (oauthError) {
      return reply.redirect(`${dashboardUrl}/dashboard?hubspotError=${encodeURIComponent(oauthError)}`);
    }

    if (!code || !state) {
      return reply.redirect(`${dashboardUrl}/dashboard?hubspotError=missing_params`);
    }

    const tenantId = hubspotClient.verifyState(state);
    if (!tenantId) {
      return reply.redirect(`${dashboardUrl}/dashboard?hubspotError=invalid_state`);
    }

    try {
      const tokens = await hubspotClient.exchangeCodeForTokens(code);

      const client = await pool.connect();
      try {
        await client.query(
          `INSERT INTO tenant_integration_settings
             (tenant_id, provider, access_token, refresh_token, token_expires_at, is_active)
           VALUES ($1, 'hubspot', $2, $3, $4, true)
           ON CONFLICT (tenant_id, provider) DO UPDATE SET
             access_token = $2, refresh_token = $3, token_expires_at = $4,
             is_active = true, updated_at = NOW()`,
          [tenantId, tokens.access_token, tokens.refresh_token, new Date(tokens.expiry_date).toISOString()]
        );
      } finally {
        client.release();
      }

      app.log.info({ event: 'hubspot_oauth_complete', tenantId }, 'HubSpot connected');
      return reply.redirect(`${dashboardUrl}/dashboard?hubspotConnected=true`);
    } catch (err) {
      app.log.error({ event: 'hubspot_oauth_failed', tenantId, error: (err as Error).message }, 'HubSpot OAuth failed');
      return reply.redirect(`${dashboardUrl}/dashboard?hubspotError=token_exchange_failed`);
    }
  });

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

    await withTenantClient(tenantId, async (client) => {
      await client.query(
        `DELETE FROM tenant_integration_settings WHERE tenant_id = $1 AND provider = 'hubspot'`,
        [tenantId]
      );
      await client.query(
        `DELETE FROM entity_sync_map WHERE tenant_id = $1 AND provider = 'hubspot'`,
        [tenantId]
      );
    });

    logEvent(req, 'hubspot_disconnected', {});
    return reply.send({ success: true });
  }, 'Failed to disconnect HubSpot'));

  // --- HubSpot webhook receiver ---
  app.post('/hubspot/webhook', async (req: any, reply: any) => {
    const signature = req.headers['x-hubspot-signature-v3'] as string;
    const timestamp = req.headers['x-hubspot-request-timestamp'] as string;
    const rawBody = JSON.stringify(req.body);

    if (!signature || !timestamp) {
      return reply.status(400).send({ success: false, error: 'Missing signature or timestamp headers' });
    }

    // Check timestamp freshness (5 min window)
    const requestAge = Date.now() - Number(timestamp);
    if (requestAge > 5 * 60 * 1000) {
      return reply.status(401).send({ success: false, error: 'Request timestamp too old (replay protection)' });
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
    reply.status(200).send({ success: true, message: 'Webhook received' });

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

    const res = await withTenantClient(tenantId, async (client) => {
      const settingsRes = await client.query(
        `SELECT last_sync_at FROM tenant_integration_settings WHERE tenant_id = $1 AND provider = 'hubspot'`,
        [tenantId]
      );

      const countsRes = await client.query(
        `SELECT entity_type, sync_status, COUNT(*)::int as count
         FROM entity_sync_map WHERE tenant_id = $1 AND provider = 'hubspot'
         GROUP BY entity_type, sync_status`,
        [tenantId]
      );

      const counts = countsRes.rows;
      return {
        last_sync_at: settingsRes.rows[0]?.last_sync_at || null,
        pending_count: counts.filter(r => r.sync_status === 'pending').reduce((s, r) => s + r.count, 0),
        error_count: counts.filter(r => r.sync_status === 'error').reduce((s, r) => s + r.count, 0),
        total_mapped: {
          customers: counts.filter(r => r.entity_type === 'customer').reduce((s, r) => s + r.count, 0),
          appointments: counts.filter(r => r.entity_type === 'appointment').reduce((s, r) => s + r.count, 0),
        },
      };
    });

    return reply.send(res);
  }, 'Failed to get HubSpot sync status'));
}
