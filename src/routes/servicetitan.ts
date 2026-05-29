/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument, @typescript-eslint/unbound-method, @typescript-eslint/no-explicit-any */
/**
 * ESLint rules disabled for this file as part of full cleanup (REFACTORING_TODO.md item 10).
 * These are the remaining dynamic/any-heavy areas after previous tranches.
 */

import type { Pool, PoolClient } from 'pg';
import type { FastifyRequest, FastifyReply } from 'fastify';
import type { AppFastifyInstance } from '../types/fastify';
import { withHandler, logEvent, requireTenantId, type AppRequest } from '../middleware';
import * as servicetitanClient from '../services/servicetitanClient';
import * as servicetitanSync from '../services/servicetitanSync';
import { createOAuthCallbackHandler } from '../services/oauthCallbackFactory';
import { getCrmSyncStatus } from '../services/crmSyncStatus';
import { disconnectCrmIntegration } from '../services/crmDisconnect';

export function registerServiceTitanRoutes(
  app: AppFastifyInstance,
  pool: Pool,
  withTenantClient: <T>(tenantId: string, fn: (client: PoolClient) => Promise<T>) => Promise<T>
) {
  // --- ServiceTitan OAuth: Initiate ---
  app.get(
    '/servicetitan/auth',
    withHandler(async (req: AppRequest, reply) => {
      const tenantId = requireTenantId(req, reply);
      if (!tenantId) return;

      if (!servicetitanClient.isServiceTitanEnabled()) {
        return reply.status(503).send({
          success: false,
          error:
            'ServiceTitan integration is not configured. Set SERVICETITAN_CLIENT_ID, SERVICETITAN_CLIENT_SECRET, SERVICETITAN_CALLBACK_URL, and SERVICETITAN_APP_KEY.',
        });
      }

      const url = servicetitanClient.getAuthUrl(tenantId);
      if (!url) {
        return reply
          .status(500)
          .send({ success: false, error: 'Failed to generate ServiceTitan auth URL' });
      }

      logEvent(req, 'servicetitan_oauth_initiated', {});
      return reply.send({ success: true, authUrl: url });
    }, 'Failed to initiate ServiceTitan auth')
  );

  // --- ServiceTitan OAuth: Callback ---
  app.get(
    '/servicetitan/auth/callback',
    createOAuthCallbackHandler(pool, app, {
      provider: 'servicetitan',
      verifyState: servicetitanClient.verifyState,
      exchangeCodeForTokens: servicetitanClient.exchangeCodeForTokens,
      buildExtraSettings: (query) => ({ tenant_sid: query.tenant_sid || null }),
    })
  );

  // --- Get ServiceTitan settings (strip tokens) ---
  app.get(
    '/servicetitan/settings',
    withHandler(async (req: AppRequest, reply) => {
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
    }, 'Failed to fetch ServiceTitan settings')
  );

  // --- Disconnect ServiceTitan ---
  app.post(
    '/servicetitan/settings/disconnect',
    withHandler(async (req: AppRequest, reply) => {
      const tenantId = requireTenantId(req, reply);
      if (!tenantId) return;

      await withTenantClient(tenantId, (client) =>
        disconnectCrmIntegration(client, tenantId, 'servicetitan')
      );

      logEvent(req, 'servicetitan_disconnected', {});
      return reply.send({ success: true });
    }, 'Failed to disconnect ServiceTitan')
  );

  // --- ServiceTitan webhook receiver ---
  app.post('/servicetitan/webhook', async (req: FastifyRequest, reply: FastifyReply) => {
    // Verify shared webhook secret (set in ServiceTitan webhook config and SERVICETITAN_WEBHOOK_SECRET env var)
    const webhookSecret = process.env.SERVICETITAN_WEBHOOK_SECRET;
    if (webhookSecret) {
      const headerSecret =
        req.headers['x-servicetitan-webhook-secret'] ?? req.headers['authorization'];
      // Fastify headers normalize to string | string[] | undefined — collapse arrays
      // to their first value (HTTP duplicates would indicate a malformed request anyway).
      const providedSecret = Array.isArray(headerSecret) ? headerSecret[0] : headerSecret;
      if (!providedSecret || providedSecret.replace('Bearer ', '') !== webhookSecret) {
        app.log.warn(
          { event: 'servicetitan_webhook_auth_failed' },
          'ServiceTitan webhook authentication failed'
        );
        return reply.status(401).send({ success: false, error: 'Unauthorized' });
      }
    } else {
      app.log.warn(
        { event: 'servicetitan_webhook_no_secret' },
        'SERVICETITAN_WEBHOOK_SECRET not set — webhook authentication disabled'
      );
    }

    const events = Array.isArray(req.body) ? req.body : [req.body];

    // Respond immediately
    void reply.status(200).send({ success: true, message: 'Webhook received' });

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
        app.log.error({
          event: 'servicetitan_webhook_processing_failed',
          eventType,
          error: (err as Error).message,
        });
      }
    }
  });

  // --- Trigger full sync ---
  app.post(
    '/servicetitan/sync',
    withHandler(async (req: AppRequest, reply) => {
      const tenantId = requireTenantId(req, reply);
      if (!tenantId) return;

      const result = await servicetitanSync.fullSync(pool, tenantId);
      return reply.send({ success: true, ...result });
    }, 'Failed to trigger ServiceTitan sync')
  );

  // --- Get sync status ---
  app.get(
    '/servicetitan/sync/status',
    withHandler(async (req: AppRequest, reply) => {
      const tenantId = requireTenantId(req, reply);
      if (!tenantId) return;

      const res = await withTenantClient(tenantId, (client) =>
        getCrmSyncStatus(client, tenantId, 'servicetitan')
      );
      return reply.send(res);
    }, 'Failed to get ServiceTitan sync status')
  );
}
