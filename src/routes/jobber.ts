import type { Pool, PoolClient } from 'pg';
import type { FastifyRequest, FastifyReply } from 'fastify';
import type { AppFastifyInstance } from '../types/fastify';
import { withHandler, logEvent, requireTenantId, type AppRequest } from '../middleware';
import * as jobberClient from '../services/jobberClient';
import * as jobberSync from '../services/jobberSync';
import { createOAuthCallbackHandler } from '../services/oauthCallbackFactory';
import { getCrmSyncStatus } from '../services/crmSyncStatus';
import { disconnectCrmIntegration } from '../services/crmDisconnect';

export function registerJobberRoutes(
  app: AppFastifyInstance,
  pool: Pool,
  withTenantClient: <T>(tenantId: string, fn: (client: PoolClient) => Promise<T>) => Promise<T>
) {
  // --- Jobber OAuth: Initiate ---
  app.get('/jobber/auth', withHandler(async (req: AppRequest, reply) => {
    const tenantId = requireTenantId(req, reply);
    if (!tenantId) return;

    if (!jobberClient.isJobberEnabled()) {
      return reply.status(503).send({
        success: false,
        error: 'Jobber integration is not configured. Set JOBBER_CLIENT_ID, JOBBER_CLIENT_SECRET, and JOBBER_CALLBACK_URL.',
      });
    }

    const url = jobberClient.getAuthUrl(tenantId);
    if (!url) {
      return reply.status(500).send({ success: false, error: 'Failed to generate Jobber auth URL' });
    }

    logEvent(req, 'jobber_oauth_initiated', {});
    return reply.send({ url });
  }, 'Failed to initiate Jobber auth'));

  // --- Jobber OAuth: Callback (Jobber redirects here) ---
  app.get('/jobber/auth/callback', createOAuthCallbackHandler(pool, app, {
    provider: 'jobber',
    verifyState: jobberClient.verifyState,
    exchangeCodeForTokens: jobberClient.exchangeCodeForTokens,
  }));

  // --- Get Jobber integration settings (strip tokens) ---
  app.get('/jobber/settings', withHandler(async (req: AppRequest, reply) => {
    const tenantId = requireTenantId(req, reply);
    if (!tenantId) return;

    const res = await withTenantClient(tenantId, async (client) => {
      return client.query(
        `SELECT tenant_id, provider, is_active, last_sync_at, created_at, updated_at
         FROM tenant_integration_settings WHERE tenant_id = $1 AND provider = 'jobber'`,
        [tenantId]
      );
    });
    return reply.send(res.rows[0] || null);
  }, 'Failed to fetch Jobber settings'));

  // --- Disconnect Jobber ---
  app.post('/jobber/settings/disconnect', withHandler(async (req: AppRequest, reply) => {
    const tenantId = requireTenantId(req, reply);
    if (!tenantId) return;

    await withTenantClient(tenantId, (client) =>
      disconnectCrmIntegration(client, tenantId, 'jobber')
    );

    logEvent(req, 'jobber_disconnected', {});
    return reply.send({ success: true });
  }, 'Failed to disconnect Jobber'));

  // --- Jobber webhook receiver ---
  app.post('/jobber/webhook/:tenantId', async (req: FastifyRequest<{ Params: { tenantId: string } }>, reply: FastifyReply) => {
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
      return reply.status(400).send({ success: false, error: 'Missing or invalid tenant ID or signature' });
    }
    if (rawBody === null) {
      app.log.error({ event: 'jobber_webhook_missing_raw_body', tenantId }, 'Raw body missing for Jobber webhook — verification cannot proceed');
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
      return reply.status(404).send({ success: false, error: 'No active Jobber integration for this tenant' });
    }

    // Verify HMAC signature
    if (!jobberClient.verifyWebhookSignature(rawBody, signature, webhookSecret)) {
      app.log.warn({ event: 'jobber_webhook_invalid_signature', tenantId }, 'Jobber webhook signature mismatch');
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
        const result = await jobberClient.graphql(tokens.accessToken, jobberClient.QUERIES.getClient, { id: itemId });
        const clientData = result.data?.client;
        if (clientData) {
          await jobberSync.pullJobberClient(pool, tenantId, clientData);
        }
      }
      // VISIT_CREATE, VISIT_UPDATE would need a getVisit query — add when needed
    } catch (err) {
      app.log.error({ event: 'jobber_webhook_processing_failed', tenantId, topic, itemId, error: (err as Error).message });
    }
  });

  // --- Trigger full sync ---
  app.post('/jobber/sync', withHandler(async (req: AppRequest, reply) => {
    const tenantId = requireTenantId(req, reply);
    if (!tenantId) return;

    const result = await jobberSync.fullSync(pool, tenantId);
    return reply.send({ success: true, ...result });
  }, 'Failed to trigger Jobber sync'));

  // --- Get sync status ---
  app.get('/jobber/sync/status', withHandler(async (req: AppRequest, reply) => {
    const tenantId = requireTenantId(req, reply);
    if (!tenantId) return;

    const res = await withTenantClient(tenantId, (client) =>
      getCrmSyncStatus(client, tenantId, 'jobber')
    );
    return reply.send(res);
  }, 'Failed to get Jobber sync status'));
}
