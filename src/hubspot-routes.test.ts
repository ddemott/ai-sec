import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { createMockClient, createMockPool, createMockWithTenantClient } from './test-utils-mock';

// --- Mock hubspotClient and hubspotSync modules before importing routes ---
vi.mock('./services/crm/hubspotClient', () => ({
  isHubSpotEnabled: vi.fn(),
  getAuthUrl: vi.fn(),
  verifyState: vi.fn(),
  exchangeCodeForTokens: vi.fn(),
  verifyWebhookSignature: vi.fn(),
  getContact: vi.fn(),
}));

vi.mock('./services/crm/hubspotSync', () => ({
  fullSync: vi.fn(),
  getTokensWithRefresh: vi.fn(),
  pullHubSpotContact: vi.fn(),
}));

import { registerHubSpotRoutes } from './routes/hubspot';
import * as hubspotClient from './services/crm/hubspotClient';
import * as hubspotSync from './services/crm/hubspotSync';

// --- Constants ---
const TENANT_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const DASHBOARD_URL = 'https://localhost:4000';

// --- App builder ---

let app: FastifyInstance;
let mockClient: ReturnType<typeof createMockClient>['mockClient'];
let queryResponses: ReturnType<typeof createMockClient>['queryResponses'];
let mockPool: Pool;

// Test-only request shape: the preHandler injects tenantId for the route to read.
type TenantRequest = FastifyRequest & { tenantId?: string };

function buildApp() {
  const created = createMockClient();
  mockClient = created.mockClient;
  queryResponses = created.queryResponses;

  mockPool = createMockPool(mockClient) as unknown as Pool;
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
  fastify.addHook('preHandler', async (request: TenantRequest) => {
    const tenantId =
      (request.query as Record<string, string>)?.tenant_id ||
      (request.headers['x-tenant-id'] as string);
    if (tenantId) {
      request.tenantId = tenantId;
    }
  });

  registerHubSpotRoutes(
    fastify,
    mockPool,
    mockWithTenantClient as unknown as <T>(
      tenantId: string,
      fn: (client: PoolClient) => Promise<T>
    ) => Promise<T>
  );

  return fastify;
}

// --- Setup / teardown ---

beforeAll(async () => {
  process.env.DASHBOARD_URL = DASHBOARD_URL;
  process.env.HUBSPOT_CLIENT_SECRET = 'test-hubspot-secret';
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

describe('HubSpot Routes — Happy Paths', () => {
  it('1. GET /hubspot/auth returns OAuth URL when configured', async () => {
    // WHO: Dashboard integration card — user clicks "Connect HubSpot" button
    // WHAT: HubSpot env vars are set (HUBSPOT_CLIENT_ID, HUBSPOT_CLIENT_SECRET), request includes tenant_id
    // WHEN: GET /hubspot/auth?tenant_id=...
    // WHERE: src/routes/hubspot.ts registerHubSpotRoutes — GET /hubspot/auth handler
    // WHY: Without this, clicking "Connect HubSpot" would fail silently — user cannot link their HubSpot account for contact/meeting sync
    vi.mocked(hubspotClient.isHubSpotEnabled).mockReturnValue(true);
    vi.mocked(hubspotClient.getAuthUrl).mockReturnValue(
      'https://app.hubspot.com/oauth/authorize?client_id=test'
    );

    const res = await app.inject({
      method: 'GET',
      url: `/hubspot/auth?tenant_id=${TENANT_ID}`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.authUrl).toBe('https://app.hubspot.com/oauth/authorize?client_id=test');
    expect(hubspotClient.getAuthUrl).toHaveBeenCalledWith(TENANT_ID);
  });

  it('2. GET /hubspot/auth/callback exchanges code, redirects with ?hubspotConnected=true', async () => {
    // WHO: HubSpot OAuth server — redirects user back after granting access
    // WHAT: Callback URL contains valid code + JWT state param, token exchange succeeds, tokens stored in tenant_integration_settings
    // WHEN: GET /hubspot/auth/callback?code=...&state=... (OAuth redirect)
    // WHERE: src/routes/hubspot.ts registerHubSpotRoutes — GET /hubspot/auth/callback handler via oauthCallbackFactory
    // WHY: Without this, the OAuth flow completes on HubSpot's side but tokens never persist — user appears connected but all HubSpot API calls fail with 401
    vi.mocked(hubspotClient.verifyState).mockReturnValue(TENANT_ID);
    vi.mocked(hubspotClient.exchangeCodeForTokens).mockResolvedValue({
      access_token: 'access-123',
      refresh_token: 'refresh-456',
      expiry_date: Date.now() + 3600 * 1000,
    });

    // Pool.connect for INSERT
    queryResponses.push({ rows: [] });

    const res = await app.inject({
      method: 'GET',
      url: '/hubspot/auth/callback?code=auth-code-xyz&state=valid-jwt-state',
    });

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe(`${DASHBOARD_URL}/dashboard?hubspotConnected=true`);
    expect(hubspotClient.verifyState).toHaveBeenCalledWith('valid-jwt-state');
    expect(hubspotClient.exchangeCodeForTokens).toHaveBeenCalledWith('auth-code-xyz');
    expect(mockClient.query).toHaveBeenCalled();
    expect(mockClient.release).toHaveBeenCalled();
  });

  it('3. GET /hubspot/settings returns settings', async () => {
    // WHO: Dashboard integration card — polls connection status on CRM settings page load
    // WHAT: tenant_integration_settings row exists, response strips access_token/refresh_token before returning
    // WHEN: GET /hubspot/settings?tenant_id=...
    // WHERE: src/routes/hubspot.ts registerHubSpotRoutes — GET /hubspot/settings handler
    // WHY: Without token stripping, OAuth tokens leak to the browser — a XSS attack could steal them and impersonate the tenant on HubSpot's API
    const settingsRow = {
      tenant_id: TENANT_ID,
      provider: 'hubspot',
      is_active: true,
      last_sync_at: '2026-03-25T10:00:00Z',
      created_at: '2026-03-20T08:00:00Z',
      updated_at: '2026-03-25T10:00:00Z',
    };
    queryResponses.push({ rows: [settingsRow] });

    const res = await app.inject({
      method: 'GET',
      url: `/hubspot/settings?tenant_id=${TENANT_ID}`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.tenant_id).toBe(TENANT_ID);
    expect(body.provider).toBe('hubspot');
    expect(body.is_active).toBe(true);
    // Should NOT contain token fields
    expect(body.access_token).toBeUndefined();
    expect(body.refresh_token).toBeUndefined();
  });

  it('4. POST /hubspot/settings/disconnect deletes settings + sync map', async () => {
    // WHO: Dashboard user — clicks "Disconnect HubSpot" button on CRM integration card
    // WHAT: Deletes tenant_integration_settings row AND all entity_sync_map rows for this tenant+provider
    // WHEN: POST /hubspot/settings/disconnect?tenant_id=...
    // WHERE: src/routes/hubspot.ts registerHubSpotRoutes — POST /hubspot/settings/disconnect handler
    // WHY: Without deleting sync map entries, reconnecting HubSpot later would cause duplicate contacts — stale external_id mappings conflict with fresh HubSpot data
    // DELETE from tenant_integration_settings
    queryResponses.push({ rows: [], rowCount: 1 });
    // DELETE from entity_sync_map
    queryResponses.push({ rows: [], rowCount: 3 });

    const res = await app.inject({
      method: 'POST',
      url: `/hubspot/settings/disconnect?tenant_id=${TENANT_ID}`,
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

  it('5. POST /hubspot/webhook processes valid event', async () => {
    // WHO: HubSpot webhook server — fires contact.creation event when a contact is created in HubSpot
    // WHAT: Valid v3 signature + fresh timestamp, tenant lookup by portalId succeeds, contact fetched and synced to local DB
    // WHEN: POST /hubspot/webhook with x-hubspot-signature-v3 and x-hubspot-request-timestamp headers
    // WHERE: src/routes/hubspot.ts registerHubSpotRoutes — POST /hubspot/webhook handler
    // WHY: Without this, new contacts created in HubSpot would never appear in SecretaryHQ — bidirectional sync breaks and the voice AI has stale customer data
    const now = Date.now();
    const webhookBody = [
      { subscriptionType: 'contact.creation', objectId: '12345', portalId: '99999' },
    ];
    const _rawBody = JSON.stringify(webhookBody);

    vi.mocked(hubspotClient.verifyWebhookSignature).mockReturnValue(true);

    // Tenant lookup by portalId (uses pool.query)
    queryResponses.push({ rows: [{ tenant_id: TENANT_ID }] });

    vi.mocked(hubspotSync.getTokensWithRefresh).mockResolvedValue({
      accessToken: 'access-token-123',
      refreshToken: 'refresh-token-456',
    });

    vi.mocked(hubspotClient.getContact).mockResolvedValue({
      id: '12345',
      properties: { firstname: 'John', lastname: 'Doe', phone: '555-1234' },
    });

    vi.mocked(hubspotSync.pullHubSpotContact).mockResolvedValue(undefined);

    const res = await app.inject({
      method: 'POST',
      url: '/hubspot/webhook',
      headers: {
        'x-hubspot-signature-v3': 'valid-sig',
        'x-hubspot-request-timestamp': String(now),
      },
      payload: webhookBody,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.message).toBe('Webhook received');
  });

  it('6. POST /hubspot/sync triggers fullSync', async () => {
    // WHO: Dashboard user — clicks "Sync Now" button on HubSpot integration card
    // WHAT: fullSync pulls all contacts and meetings from HubSpot REST v3 API, returns count of synced entities
    // WHEN: POST /hubspot/sync?tenant_id=...
    // WHERE: src/routes/hubspot.ts registerHubSpotRoutes — POST /hubspot/sync handler calling hubspotSync.fullSync
    // WHY: Without this, users have no way to trigger a full data pull — initial setup after connecting HubSpot would show zero synced records
    vi.mocked(hubspotSync.fullSync).mockResolvedValue({
      contactsSynced: 15,
      meetingsSynced: 8,
      errors: 0,
    });

    const res = await app.inject({
      method: 'POST',
      url: `/hubspot/sync?tenant_id=${TENANT_ID}`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.contactsSynced).toBe(15);
    expect(body.meetingsSynced).toBe(8);
    expect(hubspotSync.fullSync).toHaveBeenCalledWith(expect.anything(), TENANT_ID);
  });

  it('7. GET /hubspot/sync/status returns counts', async () => {
    // WHO: Dashboard integration card — polls sync status to show progress badges (synced/pending/error counts)
    // WHAT: Aggregates entity_sync_map rows by entity_type and sync_status, joins with last_sync_at from settings
    // WHEN: GET /hubspot/sync/status?tenant_id=...
    // WHERE: src/routes/hubspot.ts registerHubSpotRoutes — GET /hubspot/sync/status handler
    // WHY: Without this, the HubSpot integration card shows no sync progress — user cannot tell if sync worked, how many records failed, or when last sync ran
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
      url: `/hubspot/sync/status?tenant_id=${TENANT_ID}`,
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

describe('HubSpot Routes — Sad Paths', () => {
  it('8. GET /hubspot/auth returns 503 when not configured', async () => {
    // WHO: Dashboard integration card — user clicks "Connect HubSpot" but server lacks HUBSPOT_CLIENT_ID/SECRET env vars
    // WHAT: isHubSpotEnabled returns false because required env vars are missing in production
    // WHEN: GET /hubspot/auth?tenant_id=... when HubSpot env vars not set
    // WHERE: src/routes/hubspot.ts registerHubSpotRoutes — GET /hubspot/auth guard check
    // WHY: Without a clear 503, the dashboard would show a cryptic error instead of "HubSpot integration not configured" — admin wouldn't know to set env vars
    vi.mocked(hubspotClient.isHubSpotEnabled).mockReturnValue(false);

    const res = await app.inject({
      method: 'GET',
      url: `/hubspot/auth?tenant_id=${TENANT_ID}`,
    });

    expect(res.statusCode).toBe(503);
    const body = res.json();
    expect(body.success).toBe(false);
    expect(body.error).toContain('not configured');
  });

  it('9. GET /hubspot/auth/callback redirects with error on missing params', async () => {
    // WHO: Malformed OAuth redirect or direct browser navigation to callback URL without params
    // WHAT: Callback URL has neither code nor state nor error query params
    // WHEN: GET /hubspot/auth/callback (no query params)
    // WHERE: src/routes/hubspot.ts registerHubSpotRoutes — GET /hubspot/auth/callback missing params guard
    // WHY: Without this guard, the handler would crash on undefined code/state — user sees a 500 error page instead of being redirected to dashboard with an error toast
    const res = await app.inject({
      method: 'GET',
      url: '/hubspot/auth/callback',
    });

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe(`${DASHBOARD_URL}/dashboard?hubspotError=missing_params`);
  });

  it('10. GET /hubspot/auth/callback redirects with error on bad state', async () => {
    // WHO: Attacker or expired session — callback arrives with tampered/expired JWT state
    // WHAT: verifyState returns null because the state JWT is invalid, expired, or forged
    // WHEN: GET /hubspot/auth/callback?code=...&state=bad-jwt
    // WHERE: src/routes/hubspot.ts registerHubSpotRoutes — GET /hubspot/auth/callback state verification
    // WHY: Without this, a CSRF attack could link an attacker's HubSpot account to a victim's tenant — state validation prevents OAuth session fixation
    vi.mocked(hubspotClient.verifyState).mockReturnValue(null);

    const res = await app.inject({
      method: 'GET',
      url: '/hubspot/auth/callback?code=auth-code&state=bad-jwt',
    });

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe(`${DASHBOARD_URL}/dashboard?hubspotError=invalid_state`);
  });

  it('11. GET /hubspot/auth/callback redirects on token exchange failure', async () => {
    // WHO: HubSpot OAuth server — token exchange fails (expired code, HubSpot API outage, network error)
    // WHAT: verifyState succeeds but exchangeCodeForTokens throws — HubSpot rejected the authorization code
    // WHEN: GET /hubspot/auth/callback?code=...&state=... when HubSpot's token endpoint is down
    // WHERE: src/routes/hubspot.ts registerHubSpotRoutes — GET /hubspot/auth/callback token exchange try/catch
    // WHY: Without catching this, a HubSpot outage during OAuth would show a raw 500 error — user sees broken page instead of "connection failed, try again"
    vi.mocked(hubspotClient.verifyState).mockReturnValue(TENANT_ID);
    vi.mocked(hubspotClient.exchangeCodeForTokens).mockRejectedValue(
      new Error('OAuth exchange failed')
    );

    const res = await app.inject({
      method: 'GET',
      url: '/hubspot/auth/callback?code=auth-code&state=valid-jwt',
    });

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe(
      `${DASHBOARD_URL}/dashboard?hubspotError=token_exchange_failed`
    );
  });

  it('12. POST /hubspot/webhook 400 on missing signature', async () => {
    // WHO: Unknown caller — sends POST to webhook endpoint without HubSpot v3 signature headers
    // WHAT: Request has no x-hubspot-signature-v3 or x-hubspot-request-timestamp headers
    // WHEN: POST /hubspot/webhook without signature headers
    // WHERE: src/routes/hubspot.ts registerHubSpotRoutes — POST /hubspot/webhook signature presence check
    // WHY: Without rejecting unsigned requests, an attacker could inject fake contact events — corrupting any tenant's customer database
    const res = await app.inject({
      method: 'POST',
      url: '/hubspot/webhook',
      payload: { subscriptionType: 'contact.creation', objectId: '123' },
      // No x-hubspot-signature-v3 or x-hubspot-request-timestamp headers
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.success).toBe(false);
    expect(body.error).toContain('Missing signature');
  });

  it('13. POST /hubspot/webhook 401 on stale timestamp', async () => {
    // WHO: Replay attacker — resends a previously captured webhook request with an old timestamp
    // WHAT: x-hubspot-request-timestamp is more than 5 minutes old, indicating a potential replay attack
    // WHEN: POST /hubspot/webhook with stale timestamp (10 min ago)
    // WHERE: src/routes/hubspot.ts registerHubSpotRoutes — POST /hubspot/webhook timestamp freshness check
    // WHY: Without timestamp validation, a captured webhook could be replayed hours later to re-trigger sync — potentially overwriting newer data with stale values
    const staleTimestamp = String(Date.now() - 10 * 60 * 1000); // 10 min ago

    const res = await app.inject({
      method: 'POST',
      url: '/hubspot/webhook',
      headers: {
        'x-hubspot-signature-v3': 'some-sig',
        'x-hubspot-request-timestamp': staleTimestamp,
      },
      payload: { subscriptionType: 'contact.creation', objectId: '123' },
    });

    expect(res.statusCode).toBe(401);
    const body = res.json();
    expect(body.success).toBe(false);
    expect(body.error).toContain('timestamp too old');
  });

  it('14. POST /hubspot/webhook 401 on invalid signature', async () => {
    // WHO: Attacker or corrupted request — sends webhook with wrong/forged v3 signature
    // WHAT: Timestamp is fresh but verifyWebhookSignature returns false — HMAC doesn't match HUBSPOT_CLIENT_SECRET
    // WHEN: POST /hubspot/webhook with x-hubspot-signature-v3 that doesn't match computed HMAC
    // WHERE: src/routes/hubspot.ts registerHubSpotRoutes — POST /hubspot/webhook v3 signature verification
    // WHY: Without HMAC validation, anyone who knows the webhook URL could inject fake contact/meeting events — corrupting the tenant's customer database
    const now = Date.now();

    vi.mocked(hubspotClient.verifyWebhookSignature).mockReturnValue(false);

    const res = await app.inject({
      method: 'POST',
      url: '/hubspot/webhook',
      headers: {
        'x-hubspot-signature-v3': 'bad-signature',
        'x-hubspot-request-timestamp': String(now),
      },
      payload: { subscriptionType: 'contact.creation', objectId: '123' },
    });

    expect(res.statusCode).toBe(401);
    const body = res.json();
    expect(body.success).toBe(false);
    expect(body.error).toContain('Invalid webhook signature');
  });
});
