/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument, @typescript-eslint/unbound-method, @typescript-eslint/no-explicit-any */
/**
 * ESLint rules disabled for this file as part of full cleanup (REFACTORING_TODO.md item 10).
 * These are the remaining dynamic/any-heavy areas after previous tranches.
 */

import type { Pool, PoolClient } from 'pg';
import type { FastifyRequest, FastifyReply } from 'fastify';
import type { AppFastifyInstance } from '../types/fastify';
import * as servicetitanClient from '../services/servicetitanClient';
import * as servicetitanSync from '../services/servicetitanSync';
import { registerCrmScaffoldRoutes } from './crmRouteScaffold';

export function registerServiceTitanRoutes(
  app: AppFastifyInstance,
  pool: Pool,
  withTenantClient: <T>(tenantId: string, fn: (client: PoolClient) => Promise<T>) => Promise<T>
) {
  registerCrmScaffoldRoutes(app, pool, withTenantClient, {
    provider: 'servicetitan',
    displayName: 'ServiceTitan',
    isEnabled: servicetitanClient.isServiceTitanEnabled,
    getAuthUrl: servicetitanClient.getAuthUrl,
    verifyState: servicetitanClient.verifyState,
    exchangeCodeForTokens: servicetitanClient.exchangeCodeForTokens,
    fullSync: (pool, tenantId) => servicetitanSync.fullSync(pool, tenantId),
    buildExtraSettings: (query) => ({ tenant_sid: query.tenant_sid || null }),
  });

  // --- ServiceTitan webhook receiver (provider-specific: shared-secret header, tenant_sid lookup) ---
  app.post('/servicetitan/webhook', async (req: FastifyRequest, reply: FastifyReply) => {
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

    void reply.status(200).send({ success: true, message: 'Webhook received' });

    for (const event of events) {
      const { eventType, data, tenantId: eventTenantSid } = event;
      if (!eventType || !data) continue;

      try {
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
}
