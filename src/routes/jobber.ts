/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument, @typescript-eslint/unbound-method, @typescript-eslint/no-explicit-any */
/**
 * ESLint rules disabled for this file as part of full cleanup (REFACTORING_TODO.md item 10).
 * These are the remaining dynamic/any-heavy areas after previous tranches.
 */

import type { Pool, PoolClient } from 'pg';
import type { FastifyRequest, FastifyReply } from 'fastify';
import type { AppFastifyInstance } from '../types/fastify';
import * as jobberClient from '../services/crm/jobberClient';
import * as jobberSync from '../services/crm/jobberSync';
import { registerCrmScaffoldRoutes } from './crmRouteScaffold';

export function registerJobberRoutes(
  app: AppFastifyInstance,
  pool: Pool,
  withTenantClient: <T>(tenantId: string, fn: (client: PoolClient) => Promise<T>) => Promise<T>
) {
  registerCrmScaffoldRoutes(app, pool, withTenantClient, {
    provider: 'jobber',
    displayName: 'Jobber',
    isEnabled: jobberClient.isJobberEnabled,
    getAuthUrl: jobberClient.getAuthUrl,
    verifyState: jobberClient.verifyState,
    exchangeCodeForTokens: jobberClient.exchangeCodeForTokens,
    fullSync: (pool, tenantId) => jobberSync.fullSync(pool, tenantId),
  });

  // --- Jobber webhook receiver (provider-specific: HMAC-SHA256, :tenantId URL param) ---
  app.post(
    '/jobber/webhook/:tenantId',
    async (req: FastifyRequest<{ Params: { tenantId: string } }>, reply: FastifyReply) => {
      const tenantId = req.params.tenantId;
      const signature = req.headers['x-jobber-hmac-sha256'] as string;
      // HMAC verification requires the EXACT bytes Jobber signed. See hubspot.ts
      // for the rationale — same fix.
      const rawBuffer = (req as { rawBody?: Buffer | string }).rawBody;
      const rawBody =
        typeof rawBuffer === 'string'
          ? rawBuffer
          : rawBuffer instanceof Buffer
            ? rawBuffer.toString('utf8')
            : null;

      // Validate tenantId is a UUID to prevent injection via URL param
      const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!tenantId || !UUID_RE.test(tenantId) || !signature) {
        return reply
          .status(400)
          .send({ success: false, error: 'Missing or invalid tenant ID or signature' });
      }
      if (rawBody === null) {
        app.log.error(
          { event: 'jobber_webhook_missing_raw_body', tenantId },
          'Raw body missing for Jobber webhook — verification cannot proceed'
        );
        return reply.status(400).send({ success: false, error: 'Raw body unavailable' });
      }

      // Look up webhook secret for this tenant
      const client = await pool.connect();
      let webhookSecret: string | null = null;
      try {
        const res = await client.query(
          `SELECT webhook_secret FROM tenant_integration_settings WHERE tenant_id = $1 AND provider = 'jobber' AND is_active = true`,
          [tenantId]
        );
        webhookSecret = res.rows[0]?.webhook_secret;
      } finally {
        client.release();
      }

      if (!webhookSecret) {
        return reply
          .status(404)
          .send({ success: false, error: 'No active Jobber integration for this tenant' });
      }

      // Verify HMAC signature
      if (!jobberClient.verifyWebhookSignature(rawBody, signature, webhookSecret)) {
        app.log.warn(
          { event: 'jobber_webhook_invalid_signature', tenantId },
          'Jobber webhook signature mismatch'
        );
        return reply.status(401).send({ success: false, error: 'Invalid webhook signature' });
      }

      // Process webhook event
      const body = req.body as { topic?: string; webHookEvent?: { itemId?: string } };
      const topic = body.topic;
      const itemId = body.webHookEvent?.itemId;

      if (!topic || !itemId) {
        return reply.status(200).send({ success: true, message: 'No actionable event' });
      }

      // Fire-and-forget — respond immediately, process async
      void reply.status(200).send({ success: true, message: 'Webhook received' });

      // Fetch full record from Jobber and sync
      try {
        const tokens = await jobberSync.getTokensWithRefresh(pool, tenantId);
        if (!tokens) return;

        if (topic === 'CLIENT_CREATE' || topic === 'CLIENT_UPDATE') {
          const result = await jobberClient.graphql(
            tokens.accessToken,
            jobberClient.QUERIES.getClient,
            { id: itemId }
          );
          const clientData = result.data?.client;
          if (clientData) {
            await jobberSync.pullJobberClient(pool, tenantId, clientData);
          }
        }
      } catch (err) {
        app.log.error({
          event: 'jobber_webhook_processing_failed',
          tenantId,
          topic,
          itemId,
          error: (err as Error).message,
        });
      }
    }
  );
}
