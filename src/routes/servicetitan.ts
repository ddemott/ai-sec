import type { Pool, PoolClient } from 'pg';
import { withHandler, logEvent, requireTenantId, type AppRequest } from '../middleware';
import * as servicetitanClient from '../services/servicetitanClient';
import * as servicetitanSync from '../services/servicetitanSync';

export function registerServiceTitanRoutes(
  app: any,
  pool: Pool,
  withTenantClient: <T>(tenantId: string, fn: (client: PoolClient) => Promise<T>) => Promise<T>
) {
  // --- ServiceTitan OAuth: Initiate ---
  app.get('/servicetitan/auth', withHandler(async (req: AppRequest, reply) => {
    const tenantId = requireTenantId(req, reply);
    if (!tenantId) return;

    if (!servicetitanClient.isServiceTitanEnabled()) {
      return reply.status(503).send({
        success: false,
        error: 'ServiceTitan integration is not configured. Set SERVICETITAN_CLIENT_ID, SERVICETITAN_CLIENT_SECRET, SERVICETITAN_CALLBACK_URL, and SERVICETITAN_APP_KEY.',
      });
    }

    const url = servicetitanClient.getAuthUrl(tenantId);
    if (!url) {
      return reply.status(500).send({ success: false, error: 'Failed to generate ServiceTitan auth URL' });
    }

    logEvent(req, 'servicetitan_oauth_initiated', {});
    return reply.send({ url });
  }, 'Failed to initiate ServiceTitan auth'));

  // --- ServiceTitan OAuth: Callback ---
  app.get('/servicetitan/auth/callback', async (req: any, reply: any) => {
    const { code, state, error: oauthError, tenant_sid } = req.query as Record<string, string>;
    const dashboardUrl = process.env.DASHBOARD_URL || 'https://localhost:3001';

    if (oauthError) {
      return reply.redirect(`${dashboardUrl}/dashboard?servicetitanError=${encodeURIComponent(oauthError)}`);
    }

    if (!code || !state) {
      return reply.redirect(`${dashboardUrl}/dashboard?servicetitanError=missing_params`);
    }

    const tenantId = servicetitanClient.verifyState(state);
    if (!tenantId) {
      return reply.redirect(`${dashboardUrl}/dashboard?servicetitanError=invalid_state`);
    }

    try {
      const tokens = await servicetitanClient.exchangeCodeForTokens(code);

      const client = await pool.connect();
      try {
        await client.query(
          `INSERT INTO tenant_integration_settings
             (tenant_id, provider, access_token, refresh_token, token_expires_at, is_active, settings)
           VALUES ($1, 'servicetitan', $2, $3, $4, true, $5)
           ON CONFLICT (tenant_id, provider) DO UPDATE SET
             access_token = $2, refresh_token = $3, token_expires_at = $4,
             is_active = true, settings = COALESCE($5, tenant_integration_settings.settings), updated_at = NOW()`,
          [tenantId, tokens.access_token, tokens.refresh_token, new Date(tokens.expiry_date).toISOString(), JSON.stringify({ tenant_sid: tenant_sid || null })]
        );
      } finally {
        client.release();
      }

      app.log.info({ event: 'servicetitan_oauth_complete', tenantId }, 'ServiceTitan connected');
      return reply.redirect(`${dashboardUrl}/dashboard?servicetitanConnected=true`);
    } catch (err) {
      app.log.error({ event: 'servicetitan_oauth_failed', tenantId, error: (err as Error).message }, 'ServiceTitan OAuth failed');
      return reply.redirect(`${dashboardUrl}/dashboard?servicetitanError=token_exchange_failed`);
    }
  });

  // --- Get ServiceTitan settings (strip tokens) ---
  app.get('/servicetitan/settings', withHandler(async (req: AppRequest, reply) => {
    const tenantId = requireTenantId(req, reply);
    if (!tenantId) return;

    const res = await withTenantClient(tenantId, async (client) => {
      return client.query(
        `SELECT tenant_id, provider, is_active, last_sync_at, created_at, updated_at
         FROM tenant_integration_settings WHERE tenant_id = $1 AND provider = 'servicetitan'`,
        [tenantId]
      );
    });
    return reply.send(res.rows[0] || null);
  }, 'Failed to fetch ServiceTitan settings'));

  // --- Disconnect ServiceTitan ---
  app.post('/servicetitan/settings/disconnect', withHandler(async (req: AppRequest, reply) => {
    const tenantId = requireTenantId(req, reply);
    if (!tenantId) return;

    await withTenantClient(tenantId, async (client) => {
      await client.query(
        `DELETE FROM tenant_integration_settings WHERE tenant_id = $1 AND provider = 'servicetitan'`,
        [tenantId]
      );
      await client.query(
        `DELETE FROM entity_sync_map WHERE tenant_id = $1 AND provider = 'servicetitan'`,
        [tenantId]
      );
    });

    logEvent(req, 'servicetitan_disconnected', {});
    return reply.send({ success: true });
  }, 'Failed to disconnect ServiceTitan'));

  // --- ServiceTitan webhook receiver (no signature verification — uses IP allowlisting) ---
  app.post('/servicetitan/webhook', async (req: any, reply: any) => {
    // ServiceTitan uses IP allowlisting instead of signature verification
    // Accept the payload directly
    const events = Array.isArray(req.body) ? req.body : [req.body];

    // Respond immediately
    reply.status(200).send({ success: true, message: 'Webhook received' });

    // Process events async
    for (const event of events) {
      const { eventType, data, tenantId: eventTenantSid } = event;
      if (!eventType || !data) continue;

      try {
        // Look up tenant by ServiceTitan tenant SID (stored in settings JSONB)
        const tenantRes = await pool.query(
          `SELECT tenant_id FROM tenant_integration_settings
           WHERE provider = 'servicetitan' AND is_active = true AND (settings->>'tenant_sid')::text = $1`,
          [String(eventTenantSid)]
        );
        const tenantId = tenantRes.rows[0]?.tenant_id;
        if (!tenantId) continue;

        const tokens = await servicetitanSync.getTokensWithRefresh(pool, tenantId);
        if (!tokens) continue;

        if (eventType === 'customer.created' || eventType === 'customer.updated') {
          await servicetitanSync.pullServiceTitanCustomer(pool, tenantId, data);
        } else if (eventType === 'job.created' || eventType === 'job.updated') {
          await servicetitanSync.pullServiceTitanJob(pool, tenantId, data);
        }
      } catch (err) {
        app.log.error({ event: 'servicetitan_webhook_processing_failed', eventType, error: (err as Error).message });
      }
    }
  });

  // --- Trigger full sync ---
  app.post('/servicetitan/sync', withHandler(async (req: AppRequest, reply) => {
    const tenantId = requireTenantId(req, reply);
    if (!tenantId) return;

    const result = await servicetitanSync.fullSync(pool, tenantId);
    return reply.send({ success: true, ...result });
  }, 'Failed to trigger ServiceTitan sync'));

  // --- Get sync status ---
  app.get('/servicetitan/sync/status', withHandler(async (req: AppRequest, reply) => {
    const tenantId = requireTenantId(req, reply);
    if (!tenantId) return;

    const res = await withTenantClient(tenantId, async (client) => {
      const settingsRes = await client.query(
        `SELECT last_sync_at FROM tenant_integration_settings WHERE tenant_id = $1 AND provider = 'servicetitan'`,
        [tenantId]
      );

      const countsRes = await client.query(
        `SELECT entity_type, sync_status, COUNT(*)::int as count
         FROM entity_sync_map WHERE tenant_id = $1 AND provider = 'servicetitan'
         GROUP BY entity_type, sync_status`,
        [tenantId]
      );

      const counts = countsRes.rows;
      return {
        last_sync_at: settingsRes.rows[0]?.last_sync_at || null,
        pending_count: counts.filter((r: any) => r.sync_status === 'pending').reduce((s: number, r: any) => s + r.count, 0),
        error_count: counts.filter((r: any) => r.sync_status === 'error').reduce((s: number, r: any) => s + r.count, 0),
        total_mapped: {
          customers: counts.filter((r: any) => r.entity_type === 'customer').reduce((s: number, r: any) => s + r.count, 0),
          appointments: counts.filter((r: any) => r.entity_type === 'appointment').reduce((s: number, r: any) => s + r.count, 0),
        },
      };
    });

    return reply.send(res);
  }, 'Failed to get ServiceTitan sync status'));
}
