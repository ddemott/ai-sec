import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify from 'fastify';
import crypto from 'crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { createMockClient, createMockPool, createMockWithTenantClient } from './test-utils-mock';

// --- Mock jobberClient and jobberSync modules before importing routes ---
vi.mock('./services/jobberClient', () => ({
  isJobberEnabled: vi.fn(),
  getAuthUrl: vi.fn(),
  verifyState: vi.fn(),
  exchangeCodeForTokens: vi.fn(),
  verifyWebhookSignature: vi.fn(),
  graphql: vi.fn(),
  QUERIES: {
    getClient: 'query GetClient($id: ID!) { client(id: $id) { ... } }',
  },
}));

vi.mock('./services/jobberSync', () => ({
  fullSync: vi.fn(),
  getTokensWithRefresh: vi.fn(),
  pullJobberClient: vi.fn(),
}));

import { registerJobberRoutes } from './routes/jobber';
import * as jobberClient from './services/jobberClient';
import * as jobberSync from './services/jobberSync';

// --- Constants ---
const TENANT_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const DASHBOARD_URL = 'https://localhost:4000';
const WEBHOOK_SECRET = 'whsec_test_secret_123';

// --- Mock helpers ---

function computeHmac(body: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(body, 'utf8').digest('hex');
}

// --- App builder ---

let app: FastifyInstance;
let mockClient: ReturnType<typeof createMockClient>['mockClient'];
let queryResponses: ReturnType<typeof createMockClient>['queryResponses'];

function buildApp() {
  const created = createMockClient();
  mockClient = created.mockClient;
  queryResponses = created.queryResponses;

  const mockPool = createMockPool(mockClient);
  const mockWithTenantClient = createMockWithTenantClient(mockClient);

  const fastify = Fastify({ logger: false });

  // Mirror src/index.ts content-type parser — preserves req.rawBody so the
  // webhook signature path can verify against original bytes (added 2026-05-09
  // when the route switched from JSON.stringify(req.body) to req.rawBody).
  fastify.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer' },
    async (req: unknown, rawBody: Buffer) => {
      (req as { rawBody?: Buffer }).rawBody = rawBody;
      try {
        return JSON.parse(rawBody.toString('utf8'));
      } catch {
        throw new Error('Invalid JSON');
      }
    }
  );

  // Simulate tenant middleware: inject tenantId from query param or header
  fastify.addHook('preHandler', async (request: FastifyRequest & { tenantId?: string }) => {
    const tenantId =
      (request.query as Record<string, string>)?.tenant_id ||
      (request.headers['x-tenant-id'] as string);
    if (tenantId) {
      request.tenantId = tenantId;
    }
  });

  registerJobberRoutes(
    fastify,
    mockPool,
    mockWithTenantClient as unknown as Parameters<typeof registerJobberRoutes>[2]
  );

  return fastify;
}

// --- Setup / teardown ---

beforeAll(async () => {
  process.env.DASHBOARD_URL = DASHBOARD_URL;
  app = buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  vi.clearAllMocks();
  // Reset queryResponses array
  queryResponses.length = 0;
});

// =============================================
// HAPPY PATHS
// =============================================

describe('Jobber Routes — Happy Paths', () => {
  // 1. GET /jobber/auth returns { url } when configured
  it('1. GET /jobber/auth returns OAuth URL when configured', async () => {
    // WHO: Dashboard integration card — user clicks "Connect Jobber" button
    // WHAT: Jobber env vars are set (JOBBER_CLIENT_ID, JOBBER_CLIENT_SECRET); response is { success: true, authUrl }
    // WHEN: GET /jobber/auth with valid tenant_id query param
    // WHERE: src/routes/jobber.ts registerJobberRoutes — GET /jobber/auth handler
    // WHY: Without this, clicking "Connect Jobber" in the CRM integration card would fail silently — user sees no OAuth popup and cannot link their Jobber account
    vi.mocked(jobberClient.isJobberEnabled).mockReturnValue(true);
    vi.mocked(jobberClient.getAuthUrl).mockReturnValue(
      'https://api.getjobber.com/api/oauth/authorize?client_id=test'
    );

    const res = await app.inject({
      method: 'GET',
      url: `/jobber/auth?tenant_id=${TENANT_ID}`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.authUrl).toBe('https://api.getjobber.com/api/oauth/authorize?client_id=test');
    expect(jobberClient.getAuthUrl).toHaveBeenCalledWith(TENANT_ID);
  });

  // 2. GET /jobber/auth/callback exchanges code, stores tokens, redirects
  it('2. GET /jobber/auth/callback exchanges code, stores tokens, redirects to dashboard', async () => {
    // WHO: Jobber OAuth server — redirects user back after granting access
    // WHAT: Callback URL contains valid code + JWT state param, token exchange succeeds, tokens stored in tenant_integration_settings
    // WHEN: GET /jobber/auth/callback?code=...&state=... (OAuth redirect)
    // WHERE: src/routes/jobber.ts registerJobberRoutes — GET /jobber/auth/callback handler via oauthCallbackFactory
    // WHY: Without this, the OAuth flow completes on Jobber's side but tokens never persist — user appears connected but all Jobber API calls fail with 401
    vi.mocked(jobberClient.verifyState).mockReturnValue(TENANT_ID);
    vi.mocked(jobberClient.exchangeCodeForTokens).mockResolvedValue({
      access_token: 'access-123',
      refresh_token: 'refresh-456',
      expiry_date: Date.now() + 3600 * 1000,
    });

    // Pool.connect for INSERT
    queryResponses.push({ rows: [] });

    const res = await app.inject({
      method: 'GET',
      url: '/jobber/auth/callback?code=auth-code-xyz&state=valid-jwt-state',
    });

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe(`${DASHBOARD_URL}/dashboard?jobberConnected=true`);
    expect(jobberClient.verifyState).toHaveBeenCalledWith('valid-jwt-state');
    expect(jobberClient.exchangeCodeForTokens).toHaveBeenCalledWith('auth-code-xyz');
    expect(mockClient.query).toHaveBeenCalled();
    expect(mockClient.release).toHaveBeenCalled();
  });

  // 3. GET /jobber/auth/callback redirects with ?jobberError when OAuth error param present
  it('3. GET /jobber/auth/callback redirects with jobberError when OAuth error param present', async () => {
    // WHO: Jobber OAuth server — user denied access or Jobber returned an OAuth error
    // WHAT: Callback URL contains ?error=access_denied (user clicked "Deny" on Jobber consent screen)
    // WHEN: GET /jobber/auth/callback?error=access_denied
    // WHERE: src/routes/jobber.ts registerJobberRoutes — GET /jobber/auth/callback error branch
    // WHY: Without this, denying Jobber access would show a blank error page instead of redirecting to dashboard with a toast notification explaining the denial
    const res = await app.inject({
      method: 'GET',
      url: '/jobber/auth/callback?error=access_denied',
    });

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe(`${DASHBOARD_URL}/dashboard?jobberError=access_denied`);
  });

  // 4. GET /jobber/auth/callback redirects with ?jobberError=invalid_state for bad state
  it('4. GET /jobber/auth/callback redirects with jobberError=invalid_state for bad state', async () => {
    // WHO: Attacker or expired session — callback arrives with tampered/expired JWT state
    // WHAT: verifyState returns null because the state JWT is invalid, expired, or forged
    // WHEN: GET /jobber/auth/callback?code=...&state=bad-jwt
    // WHERE: src/routes/jobber.ts registerJobberRoutes — GET /jobber/auth/callback state verification
    // WHY: Without this, a CSRF attack could link an attacker's Jobber account to a victim's tenant — state validation prevents OAuth session fixation
    vi.mocked(jobberClient.verifyState).mockReturnValue(null);

    const res = await app.inject({
      method: 'GET',
      url: '/jobber/auth/callback?code=auth-code&state=bad-jwt',
    });

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe(`${DASHBOARD_URL}/dashboard?jobberError=invalid_state`);
  });

  // 5. GET /jobber/settings returns settings without tokens
  it('5. GET /jobber/settings returns settings without tokens', async () => {
    // WHO: Dashboard integration card — polls connection status on CRM settings page load
    // WHAT: tenant_integration_settings row exists for this tenant+provider, response strips access_token/refresh_token
    // WHEN: GET /jobber/settings?tenant_id=...
    // WHERE: src/routes/jobber.ts registerJobberRoutes — GET /jobber/settings handler
    // WHY: Without token stripping, OAuth tokens would leak to the browser — a XSS attack could steal them and impersonate the tenant on Jobber's API
    const settingsRow = {
      tenant_id: TENANT_ID,
      provider: 'jobber',
      is_active: true,
      last_sync_at: '2026-03-25T10:00:00Z',
      created_at: '2026-03-20T08:00:00Z',
      updated_at: '2026-03-25T10:00:00Z',
    };
    queryResponses.push({ rows: [settingsRow] });

    const res = await app.inject({
      method: 'GET',
      url: `/jobber/settings?tenant_id=${TENANT_ID}`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.tenant_id).toBe(TENANT_ID);
    expect(body.provider).toBe('jobber');
    expect(body.is_active).toBe(true);
    // Should NOT contain token fields
    expect(body.access_token).toBeUndefined();
    expect(body.refresh_token).toBeUndefined();
  });

  // 6. GET /jobber/settings returns null when no settings
  it('6. GET /jobber/settings returns null when no settings exist', async () => {
    // WHO: Dashboard integration card — checks if Jobber is connected for a tenant that hasn't set up Jobber yet
    // WHAT: No tenant_integration_settings row exists for this tenant+provider, DB returns empty rows
    // WHEN: GET /jobber/settings?tenant_id=... (tenant has never connected Jobber)
    // WHERE: src/routes/jobber.ts registerJobberRoutes — GET /jobber/settings handler, empty result branch
    // WHY: Without returning null, the dashboard would crash trying to read properties of undefined — the "Connect Jobber" button wouldn't render
    queryResponses.push({ rows: [] });

    const res = await app.inject({
      method: 'GET',
      url: `/jobber/settings?tenant_id=${TENANT_ID}`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toBeNull();
  });

  // 7. POST /jobber/settings/disconnect deletes settings and sync map
  it('7. POST /jobber/settings/disconnect deletes settings and sync map', async () => {
    // WHO: Dashboard user — clicks "Disconnect Jobber" button on CRM integration card
    // WHAT: Deletes tenant_integration_settings row AND all entity_sync_map rows for this tenant+provider
    // WHEN: POST /jobber/settings/disconnect?tenant_id=...
    // WHERE: src/routes/jobber.ts registerJobberRoutes — POST /jobber/settings/disconnect handler
    // WHY: Without deleting sync map entries, reconnecting Jobber later would cause duplicate customers — stale external_id mappings would conflict with fresh Jobber data
    // DELETE from tenant_integration_settings
    queryResponses.push({ rows: [], rowCount: 1 });
    // DELETE from entity_sync_map
    queryResponses.push({ rows: [], rowCount: 3 });

    const res = await app.inject({
      method: 'POST',
      url: `/jobber/settings/disconnect?tenant_id=${TENANT_ID}`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);

    // Verify both DELETE queries were issued
    expect(mockClient.query).toHaveBeenCalledTimes(2);
    const firstCall = mockClient.query.mock.calls[0][0] as string;
    const secondCall = mockClient.query.mock.calls[1][0] as string;
    expect(firstCall).toContain('DELETE FROM tenant_integration_settings');
    expect(secondCall).toContain('DELETE FROM entity_sync_map');
  });

  // 8. POST /jobber/webhook/:tenantId processes valid webhook with correct HMAC
  it('8. POST /jobber/webhook/:tenantId processes valid webhook with correct HMAC', async () => {
    // WHO: Jobber webhook server — fires CLIENT_CREATE event when a client is created in Jobber
    // WHAT: Valid HMAC signature, active integration exists, webhook fetches client via GraphQL and syncs to local DB
    // WHEN: POST /jobber/webhook/:tenantId with x-jobber-hmac-sha256 header
    // WHERE: src/routes/jobber.ts registerJobberRoutes — POST /jobber/webhook/:tenantId handler
    // WHY: Without this, new clients created in Jobber would never appear in SecretaryHQ — bidirectional sync breaks and the receptionist AI has stale customer data
    const webhookBody = { topic: 'CLIENT_CREATE', webHookEvent: { itemId: 'Z2lkOi8v123' } };
    const rawBody = JSON.stringify(webhookBody);
    const signature = computeHmac(rawBody, WEBHOOK_SECRET);

    // Lookup webhook_secret
    queryResponses.push({ rows: [{ webhook_secret: WEBHOOK_SECRET }] });

    vi.mocked(jobberClient.verifyWebhookSignature).mockReturnValue(true);
    vi.mocked(jobberSync.getTokensWithRefresh).mockResolvedValue({
      accessToken: 'access-token-123',
      refreshToken: 'refresh-token-456',
    });
    vi.mocked(jobberClient.graphql).mockResolvedValue({
      data: { client: { id: 'Z2lkOi8v123', firstName: 'John', lastName: 'Doe' } },
    });
    vi.mocked(jobberSync.pullJobberClient).mockResolvedValue(undefined);

    const res = await app.inject({
      method: 'POST',
      url: `/jobber/webhook/${TENANT_ID}`,
      headers: { 'x-jobber-hmac-sha256': signature },
      payload: webhookBody,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.message).toBe('Webhook received');
    expect(mockClient.release).toHaveBeenCalled();
  });

  // 9. POST /jobber/sync triggers fullSync and returns counts
  it('9. POST /jobber/sync triggers fullSync and returns counts', async () => {
    // WHO: Dashboard user — clicks "Sync Now" button on Jobber integration card
    // WHAT: fullSync pulls all customers and appointments from Jobber GraphQL API, returns count of synced entities
    // WHEN: POST /jobber/sync?tenant_id=...
    // WHERE: src/routes/jobber.ts registerJobberRoutes — POST /jobber/sync handler calling jobberSync.fullSync
    // WHY: Without this, users have no way to manually trigger a full data pull — initial setup after connecting Jobber would show zero synced records
    vi.mocked(jobberSync.fullSync).mockResolvedValue({
      customers_synced: 15,
      appointments_synced: 8,
    });

    const res = await app.inject({
      method: 'POST',
      url: `/jobber/sync?tenant_id=${TENANT_ID}`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.customers_synced).toBe(15);
    expect(body.appointments_synced).toBe(8);
    expect(jobberSync.fullSync).toHaveBeenCalledWith(expect.anything(), TENANT_ID);
  });

  // 10. GET /jobber/sync/status returns aggregated counts
  it('10. GET /jobber/sync/status returns aggregated counts', async () => {
    // WHO: Dashboard integration card — polls sync status to show progress badges (synced/pending/error counts)
    // WHAT: Aggregates entity_sync_map rows by entity_type and sync_status, joins with last_sync_at from settings
    // WHEN: GET /jobber/sync/status?tenant_id=...
    // WHERE: src/routes/jobber.ts registerJobberRoutes — GET /jobber/sync/status handler
    // WHY: Without this, the Jobber integration card shows no sync progress — user cannot tell if sync worked, how many records failed, or when the last sync ran
    // settings query
    queryResponses.push({ rows: [{ last_sync_at: '2026-03-25T12:00:00Z' }] });
    // counts query
    queryResponses.push({
      rows: [
        { entity_type: 'customer', sync_status: 'synced', count: 20 },
        { entity_type: 'customer', sync_status: 'pending', count: 2 },
        { entity_type: 'appointment', sync_status: 'synced', count: 10 },
        { entity_type: 'appointment', sync_status: 'error', count: 1 },
      ],
    });

    const res = await app.inject({
      method: 'GET',
      url: `/jobber/sync/status?tenant_id=${TENANT_ID}`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.last_sync_at).toBe('2026-03-25T12:00:00Z');
    expect(body.pending_count).toBe(2);
    expect(body.error_count).toBe(1);
    expect(body.total_mapped.customers).toBe(22);
    expect(body.total_mapped.appointments).toBe(11);
  });
});

// =============================================
// SAD PATHS
// =============================================

describe('Jobber Routes — Sad Paths', () => {
  // 11. GET /jobber/auth returns 503 when not configured
  it('11. GET /jobber/auth returns 503 when Jobber is not configured', async () => {
    // WHO: Dashboard integration card — user clicks "Connect Jobber" but server lacks JOBBER_CLIENT_ID/SECRET env vars
    // WHAT: isJobberEnabled returns false because required env vars are missing in production
    // WHEN: GET /jobber/auth?tenant_id=... when Jobber env vars not set
    // WHERE: src/routes/jobber.ts registerJobberRoutes — GET /jobber/auth guard check
    // WHY: Without a clear 503, the dashboard would show a cryptic error instead of "Jobber integration not configured" — admin wouldn't know to set env vars
    vi.mocked(jobberClient.isJobberEnabled).mockReturnValue(false);

    const res = await app.inject({
      method: 'GET',
      url: `/jobber/auth?tenant_id=${TENANT_ID}`,
    });

    expect(res.statusCode).toBe(503);
    const body = res.json();
    expect(body.success).toBe(false);
    expect(body.error).toContain('not configured');
  });

  // 12. GET /jobber/auth/callback redirects with ?jobberError=missing_params when no code/state
  it('12. GET /jobber/auth/callback redirects with jobberError=missing_params when no code/state', async () => {
    // WHO: Malformed OAuth redirect or direct browser navigation to callback URL without params
    // WHAT: Callback URL has neither code nor state nor error query params
    // WHEN: GET /jobber/auth/callback (no query params)
    // WHERE: src/routes/jobber.ts registerJobberRoutes — GET /jobber/auth/callback missing params guard
    // WHY: Without this guard, the handler would crash on undefined code/state — user sees a 500 error page instead of being redirected to dashboard with an error toast
    const res = await app.inject({
      method: 'GET',
      url: '/jobber/auth/callback',
    });

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe(`${DASHBOARD_URL}/dashboard?jobberError=missing_params`);
  });

  // 13. GET /jobber/auth/callback redirects with ?jobberError=token_exchange_failed on exchange error
  it('13. GET /jobber/auth/callback redirects with jobberError=token_exchange_failed on exchange error', async () => {
    // WHO: Jobber OAuth server — token exchange fails (expired code, Jobber API outage, network error)
    // WHAT: verifyState succeeds but exchangeCodeForTokens throws — Jobber rejected the authorization code
    // WHEN: GET /jobber/auth/callback?code=...&state=... when Jobber's token endpoint is down
    // WHERE: src/routes/jobber.ts registerJobberRoutes — GET /jobber/auth/callback token exchange try/catch
    // WHY: Without catching this, a Jobber outage during OAuth would show a raw 500 error — user would think SecretaryHQ is broken instead of seeing "connection failed, try again"
    vi.mocked(jobberClient.verifyState).mockReturnValue(TENANT_ID);
    vi.mocked(jobberClient.exchangeCodeForTokens).mockRejectedValue(
      new Error('OAuth exchange failed')
    );

    const res = await app.inject({
      method: 'GET',
      url: '/jobber/auth/callback?code=auth-code&state=valid-jwt',
    });

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe(
      `${DASHBOARD_URL}/dashboard?jobberError=token_exchange_failed`
    );
  });

  // 14. POST /jobber/webhook/:tenantId returns 400 when missing signature
  it('14. POST /jobber/webhook/:tenantId returns 400 when missing signature', async () => {
    // WHO: Unknown caller — sends POST to webhook endpoint without HMAC signature header
    // WHAT: Request has no x-jobber-hmac-sha256 header, fails before any DB lookup
    // WHEN: POST /jobber/webhook/:tenantId without signature header
    // WHERE: src/routes/jobber.ts registerJobberRoutes — POST /jobber/webhook/:tenantId signature presence check
    // WHY: Without rejecting unsigned requests early, an attacker could inject fake webhook events to create/modify customers in any tenant's database
    const res = await app.inject({
      method: 'POST',
      url: `/jobber/webhook/${TENANT_ID}`,
      payload: { topic: 'CLIENT_CREATE' },
      // No x-jobber-hmac-sha256 header
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.success).toBe(false);
    expect(body.error).toContain('Missing');
  });

  // 15. POST /jobber/webhook/:tenantId returns 404 when no active integration
  it('15. POST /jobber/webhook/:tenantId returns 404 when no active integration', async () => {
    // WHO: Jobber webhook server — fires event for a tenant that has since disconnected Jobber
    // WHAT: DB lookup for webhook_secret returns empty rows — no active integration for this tenant
    // WHEN: POST /jobber/webhook/:tenantId after tenant has disconnected Jobber
    // WHERE: src/routes/jobber.ts registerJobberRoutes — POST /jobber/webhook/:tenantId integration lookup
    // WHY: Without this, stale webhooks from Jobber after disconnection would crash on null webhook_secret — the error would pollute logs and mask real issues
    // DB returns no rows (no active integration)
    queryResponses.push({ rows: [] });

    const res = await app.inject({
      method: 'POST',
      url: `/jobber/webhook/${TENANT_ID}`,
      headers: { 'x-jobber-hmac-sha256': 'some-signature' },
      payload: { topic: 'CLIENT_CREATE' },
    });

    expect(res.statusCode).toBe(404);
    const body = res.json();
    expect(body.success).toBe(false);
    expect(body.error).toContain('No active Jobber integration');
    expect(mockClient.release).toHaveBeenCalled();
  });

  // 16. POST /jobber/webhook/:tenantId returns 401 when HMAC signature is invalid
  it('16. POST /jobber/webhook/:tenantId returns 401 when HMAC signature is invalid', async () => {
    // WHO: Attacker or corrupted request — sends webhook with wrong/forged HMAC signature
    // WHAT: Integration exists and webhook_secret is found, but HMAC verification fails against the provided signature
    // WHEN: POST /jobber/webhook/:tenantId with x-jobber-hmac-sha256 that doesn't match computed HMAC
    // WHERE: src/routes/jobber.ts registerJobberRoutes — POST /jobber/webhook/:tenantId HMAC verification
    // WHY: Without HMAC validation, anyone who knows the webhook URL could inject fake client/job events — corrupting the tenant's customer database
    // DB returns webhook_secret
    queryResponses.push({ rows: [{ webhook_secret: WEBHOOK_SECRET }] });

    vi.mocked(jobberClient.verifyWebhookSignature).mockReturnValue(false);

    const res = await app.inject({
      method: 'POST',
      url: `/jobber/webhook/${TENANT_ID}`,
      headers: { 'x-jobber-hmac-sha256': 'bad-signature' },
      payload: { topic: 'CLIENT_CREATE' },
    });

    expect(res.statusCode).toBe(401);
    const body = res.json();
    expect(body.success).toBe(false);
    expect(body.error).toContain('Invalid webhook signature');
    expect(mockClient.release).toHaveBeenCalled();
  });

  // 17. POST /jobber/webhook/:tenantId returns 200 for no-op events (missing topic/itemId)
  it('17. POST /jobber/webhook/:tenantId returns 200 no-op for events missing topic or itemId', async () => {
    // WHO: Jobber webhook server — sends a health check or non-actionable event type (no topic/itemId)
    // WHAT: Payload passes HMAC verification but lacks topic or webHookEvent.itemId fields
    // WHEN: POST /jobber/webhook/:tenantId with valid signature but no actionable event data
    // WHERE: src/routes/jobber.ts registerJobberRoutes — POST /jobber/webhook/:tenantId event dispatch logic
    // WHY: Without gracefully handling no-op events, Jobber's health check pings would trigger token refresh and GraphQL calls that fail — wasting API quota and logging false errors
    const webhookBody = { someField: 'value' }; // no topic, no webHookEvent
    const rawBody = JSON.stringify(webhookBody);
    const signature = computeHmac(rawBody, WEBHOOK_SECRET);

    queryResponses.push({ rows: [{ webhook_secret: WEBHOOK_SECRET }] });
    vi.mocked(jobberClient.verifyWebhookSignature).mockReturnValue(true);

    const res = await app.inject({
      method: 'POST',
      url: `/jobber/webhook/${TENANT_ID}`,
      headers: { 'x-jobber-hmac-sha256': signature },
      payload: webhookBody,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.message).toBe('No actionable event');
    // Should NOT attempt to fetch tokens or sync
    expect(jobberSync.getTokensWithRefresh).not.toHaveBeenCalled();
  });
});

// =============================================
// ADDITIONAL EDGE CASES
// =============================================

describe('Jobber Routes — Edge Cases', () => {
  it('GET /jobber/auth returns 401 when unauthenticated', async () => {
    // WHO: Dashboard integration card — API call made with no auth context
    // WHAT: 2026-05-21 — no JWT → 401 (authentication is the real failure),
    //       not the old misleading 400. The route never runs getAuthUrl.
    // WHERE: src/middleware.ts tenantMiddleware auth gate
    // WHY: a user-supplied tenant_id is no substitute for authentication;
    //      OAuth init is dashboard-authenticated in production
    const res = await app.inject({
      method: 'GET',
      url: '/jobber/auth',
      // No auth header, no tenant_id param
    });

    expect(res.statusCode).toBe(401);
    const body = res.json();
    expect(body.error).toContain('Authentication required');
  });

  it('GET /jobber/settings returns 401 when unauthenticated', async () => {
    // WHO: Dashboard integration card — settings fetch with no auth context
    // WHAT: 2026-05-21 — no JWT → 401 before any DB query (was misleading 400)
    // WHERE: src/middleware.ts tenantMiddleware auth gate
    // WHY: without an authenticated session the query must not run at all
    const res = await app.inject({
      method: 'GET',
      url: '/jobber/settings',
    });

    expect(res.statusCode).toBe(401);
  });

  it('POST /jobber/settings/disconnect returns 401 when unauthenticated', async () => {
    // WHO: Dashboard integration card — disconnect request with no auth context
    // WHAT: 2026-05-21 — no JWT → 401 before any DELETE (was misleading 400)
    // WHERE: src/middleware.ts tenantMiddleware auth gate
    // WHY: an unauthenticated DELETE must never reach a cross-tenant disconnect
    const res = await app.inject({
      method: 'POST',
      url: '/jobber/settings/disconnect',
    });

    expect(res.statusCode).toBe(401);
  });

  it('POST /jobber/sync returns 401 when unauthenticated', async () => {
    // WHO: Dashboard integration card — "Sync Now" clicked with no auth context
    // WHAT: 2026-05-21 — no JWT → 401 before triggering fullSync (was 400)
    // WHERE: src/middleware.ts tenantMiddleware auth gate
    // WHY: fullSync must never run without an authenticated tenant context
    const res = await app.inject({
      method: 'POST',
      url: '/jobber/sync',
    });

    expect(res.statusCode).toBe(401);
  });

  it('GET /jobber/sync/status returns 401 when unauthenticated', async () => {
    // WHO: Dashboard integration card — sync status poll with no auth context
    // WHAT: 2026-05-21 — no JWT → 401 before the aggregation query (was 400)
    // WHERE: src/middleware.ts tenantMiddleware auth gate
    // WHY: an unauthenticated caller must not learn any tenant's sync counts
    const res = await app.inject({
      method: 'GET',
      url: '/jobber/sync/status',
    });

    expect(res.statusCode).toBe(401);
  });

  it('GET /jobber/auth returns 500 when getAuthUrl returns null', async () => {
    // WHO: Dashboard integration card — Jobber is enabled but URL generation fails (misconfigured redirect URI)
    // WHAT: isJobberEnabled returns true but getAuthUrl returns null — env vars exist but are malformed
    // WHEN: GET /jobber/auth?tenant_id=... when getAuthUrl cannot build a valid OAuth URL
    // WHERE: src/routes/jobber.ts registerJobberRoutes — GET /jobber/auth null URL check
    // WHY: Without this, the dashboard would receive { url: null } and try to redirect to "null" — user sees a blank page instead of an actionable error message
    vi.mocked(jobberClient.isJobberEnabled).mockReturnValue(true);
    vi.mocked(jobberClient.getAuthUrl).mockReturnValue(null);

    const res = await app.inject({
      method: 'GET',
      url: `/jobber/auth?tenant_id=${TENANT_ID}`,
    });

    expect(res.statusCode).toBe(500);
    const body = res.json();
    expect(body.success).toBe(false);
    expect(body.error).toContain('Failed to generate');
  });

  it('GET /jobber/sync/status returns null last_sync_at when no settings exist', async () => {
    // WHO: Dashboard integration card — polls sync status for a tenant that connected then disconnected Jobber
    // WHAT: No settings row exists and no sync map entries — all counts default to zero, last_sync_at is null
    // WHEN: GET /jobber/sync/status?tenant_id=... when tenant has no Jobber integration
    // WHERE: src/routes/jobber.ts registerJobberRoutes — GET /jobber/sync/status empty state handling
    // WHY: Without defaulting to zero/null, the dashboard would show undefined counts or crash — the sync status card needs safe defaults to render "No data yet"
    // settings query — no rows
    queryResponses.push({ rows: [] });
    // counts query — no rows
    queryResponses.push({ rows: [] });

    const res = await app.inject({
      method: 'GET',
      url: `/jobber/sync/status?tenant_id=${TENANT_ID}`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.last_sync_at).toBeNull();
    expect(body.pending_count).toBe(0);
    expect(body.error_count).toBe(0);
    expect(body.total_mapped.customers).toBe(0);
    expect(body.total_mapped.appointments).toBe(0);
  });

  it('POST /jobber/sync returns 500 when fullSync throws', async () => {
    // WHO: Dashboard user — clicks "Sync Now" but Jobber API is down or tokens expired beyond refresh
    // WHAT: fullSync throws an unrecoverable error (network timeout, invalid token, Jobber 500)
    // WHEN: POST /jobber/sync?tenant_id=... when Jobber's API is unreachable
    // WHERE: src/routes/jobber.ts registerJobberRoutes — POST /jobber/sync error catch
    // WHY: Without catching this, an unhandled rejection would crash the Fastify process — other tenants' requests would fail until the server restarts
    vi.mocked(jobberSync.fullSync).mockRejectedValue(new Error('Sync engine crashed'));

    const res = await app.inject({
      method: 'POST',
      url: `/jobber/sync?tenant_id=${TENANT_ID}`,
    });

    expect(res.statusCode).toBe(500);
    const body = res.json();
    expect(body.success).toBe(false);
    expect(body.error).toBe('Failed to trigger Jobber sync');
  });

  it('GET /jobber/auth/callback with only code (no state) redirects with missing_params', async () => {
    // WHO: Malformed OAuth redirect — Jobber sends code but state param was stripped (proxy/firewall issue)
    // WHAT: Callback has code but no state — cannot determine which tenant to store tokens for
    // WHEN: GET /jobber/auth/callback?code=some-code (missing state)
    // WHERE: src/routes/jobber.ts registerJobberRoutes — GET /jobber/auth/callback params validation
    // WHY: Without rejecting this, the handler would call verifyState(undefined) — either crashing or storing tokens for a null tenant, breaking the integration
    const res = await app.inject({
      method: 'GET',
      url: '/jobber/auth/callback?code=some-code',
    });

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe(`${DASHBOARD_URL}/dashboard?jobberError=missing_params`);
  });

  it('GET /jobber/auth/callback with only state (no code) redirects with missing_params', async () => {
    // WHO: Malformed OAuth redirect — state present but authorization code was stripped or never issued
    // WHAT: Callback has state but no code — cannot exchange for tokens without an authorization code
    // WHEN: GET /jobber/auth/callback?state=some-state (missing code)
    // WHERE: src/routes/jobber.ts registerJobberRoutes — GET /jobber/auth/callback params validation
    // WHY: Without rejecting this, exchangeCodeForTokens would be called with undefined code — Jobber API returns a cryptic error instead of the user seeing a clean "connection failed" message
    const res = await app.inject({
      method: 'GET',
      url: '/jobber/auth/callback?state=some-state',
    });

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe(`${DASHBOARD_URL}/dashboard?jobberError=missing_params`);
  });

  it('Webhook with topic but no itemId returns 200 no-op', async () => {
    // WHO: Jobber webhook server — sends CLIENT_CREATE event but webHookEvent object is missing itemId field
    // WHAT: Payload has valid topic and passes HMAC but webHookEvent.itemId is undefined — no entity to look up
    // WHEN: POST /jobber/webhook/:tenantId with topic but empty webHookEvent object
    // WHERE: src/routes/jobber.ts registerJobberRoutes — POST /jobber/webhook/:tenantId event dispatch logic
    // WHY: Without this guard, the GraphQL query would be called with undefined ID — returning null client data and causing pullJobberClient to crash on null properties
    const webhookBody = { topic: 'CLIENT_CREATE', webHookEvent: {} }; // no itemId
    const rawBody = JSON.stringify(webhookBody);
    const signature = computeHmac(rawBody, WEBHOOK_SECRET);

    queryResponses.push({ rows: [{ webhook_secret: WEBHOOK_SECRET }] });
    vi.mocked(jobberClient.verifyWebhookSignature).mockReturnValue(true);

    const res = await app.inject({
      method: 'POST',
      url: `/jobber/webhook/${TENANT_ID}`,
      headers: { 'x-jobber-hmac-sha256': signature },
      payload: webhookBody,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.message).toBe('No actionable event');
  });
});
