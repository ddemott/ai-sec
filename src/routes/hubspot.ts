/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument, @typescript-eslint/unbound-method, @typescript-eslint/no-explicit-any */
/**
 * ESLint rules disabled for this file as part of full cleanup (REFACTORING_TODO.md item 10).
 * These are the remaining dynamic/any-heavy areas after previous tranches.
 */

import type { Pool, PoolClient } from 'pg';
import type { FastifyRequest, FastifyReply } from 'fastify';
import type { AppFastifyInstance } from '../types/fastify';
import * as hubspotClient from '../services/crm/hubspotClient';
import * as hubspotSync from '../services/crm/hubspotSync';
import { registerCrmScaffoldRoutes } from './crmRouteScaffold';

export function registerHubSpotRoutes(
  app: AppFastifyInstance,
  pool: Pool,
  withTenantClient: <T>(tenantId: string, fn: (client: PoolClient) => Promise<T>) => Promise<T>
) {
  registerCrmScaffoldRoutes(app, pool, withTenantClient, {
    provider: 'hubspot',
    displayName: 'HubSpot',
    isEnabled: hubspotClient.isHubSpotEnabled,
    getAuthUrl: hubspotClient.getAuthUrl,
    verifyState: hubspotClient.verifyState,
    exchangeCodeForTokens: hubspotClient.exchangeCodeForTokens,
    fullSync: (pool, tenantId) => hubspotSync.fullSync(pool, tenantId),
  });

  // --- HubSpot webhook receiver (provider-specific: v3 sig + timestamp, batched events) ---
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
      return reply
        .status(400)
        .send({ success: false, error: 'Missing signature or timestamp headers' });
    }
    if (rawBody === null) {
      app.log.error(
        { event: 'hubspot_webhook_missing_raw_body' },
        'Raw body missing for HubSpot webhook — verification cannot proceed'
      );
      return reply.status(400).send({ success: false, error: 'Raw body unavailable' });
    }

    // Check timestamp freshness (5 min window)
    const timestampMs = Number(timestamp);
    if (!Number.isFinite(timestampMs) || timestampMs <= 0) {
      return reply
        .status(400)
        .send({ success: false, error: 'Invalid or missing timestamp header' });
    }
    const requestAge = Date.now() - timestampMs;
    if (requestAge > 5 * 60 * 1000 || requestAge < -30_000) {
      return reply.status(401).send({
        success: false,
        error: 'Request timestamp too old or too far in the future (replay protection)',
      });
    }

    const config = {
      clientSecret: process.env.HUBSPOT_CLIENT_SECRET || '',
    };
    if (!config.clientSecret) {
      return reply
        .status(500)
        .send({ success: false, error: 'HubSpot client secret not configured' });
    }

    const requestMethod = 'POST';
    const requestUri = `${req.protocol}://${req.hostname}${req.url}`;
    if (
      !hubspotClient.verifyWebhookSignature(
        requestMethod,
        requestUri,
        rawBody,
        timestamp,
        signature,
        config.clientSecret
      )
    ) {
      app.log.warn(
        { event: 'hubspot_webhook_invalid_signature' },
        'HubSpot webhook signature mismatch'
      );
      return reply.status(401).send({ success: false, error: 'Invalid webhook signature' });
    }

    // HubSpot sends batched events as an array
    const events = Array.isArray(req.body) ? req.body : [req.body];

    void reply.status(200).send({ success: true, message: 'Webhook received' });

    for (const event of events) {
      const { subscriptionType, objectId, portalId } = event;
      if (!subscriptionType || !objectId) continue;

      try {
        const tenantRes = await pool.query(
          `SELECT tenant_id FROM tenant_integration_settings
           WHERE provider = 'hubspot' AND is_active = true AND (settings->>'portal_id')::text = $1`,
          [String(portalId)]
        );
        const tenantId = tenantRes.rows[0]?.tenant_id;
        if (!tenantId) continue;

        const tokens = await hubspotSync.getTokensWithRefresh(pool, tenantId);
        if (!tokens) continue;

        if (
          subscriptionType === 'contact.creation' ||
          subscriptionType === 'contact.propertyChange'
        ) {
          const contact = await hubspotClient.getContact(tokens.accessToken, String(objectId));
          if (contact) {
            await hubspotSync.pullHubSpotContact(pool, tenantId, contact);
          }
        }
      } catch (err) {
        app.log.error({
          event: 'hubspot_webhook_processing_failed',
          subscriptionType,
          objectId,
          error: (err as Error).message,
        });
      }
    }
  });
}
