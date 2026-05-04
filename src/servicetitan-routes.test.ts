import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { createMockClient, createMockPool, createMockWithTenantClient } from './test-utils-mock';

// --- Mock servicetitanClient and servicetitanSync modules before importing routes ---
vi.mock('./services/servicetitanClient', () => ({
  isServiceTitanEnabled: vi.fn(),
  getAuthUrl: vi.fn(),
  verifyState: vi.fn(),
  exchangeCodeForTokens: vi.fn(),
}));

vi.mock('./services/servicetitanSync', () => ({
  fullSync: vi.fn(),
  getTokensWithRefresh: vi.fn(),
  pullServiceTitanCustomer: vi.fn(),
  pullServiceTitanJob: vi.fn(),
}));

import { registerServiceTitanRoutes } from './routes/servicetitan';
import * as servicetitanClient from './services/servicetitanClient';
import * as servicetitanSync from './services/servicetitanSync';

// --- Constants ---
const TENANT_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const DASHBOARD_URL = 'https://localhost:4000';

// --- App builder ---

let app: FastifyInstance;
let mockClient: ReturnType<typeof createMockClient>['mockClient'];
let queryResponses: ReturnType<typeof createMockClient>['queryResponses'];
let mockPool: any;

function buildApp() {
  const created = createMockClient();
  mockClient = created.mockClient;
  queryResponses = created.queryResponses;

  mockPool = createMockPool(mockClient);
  const mockWithTenantClient = createMockWithTenantClient(mockClient);

  const fastify = Fastify({ logger: false });

  // Simulate tenant middleware: inject tenantId from query param or header
  fastify.addHook('preHandler', async (request: any) => {
    const tenantId =
      (request.query as Record<string, string>)?.tenant_id ||
      (request.headers['x-tenant-id'] as string);
    if (tenantId) {
      request.tenantId = tenantId;
    }
  });

  registerServiceTitanRoutes(fastify, mockPool, mockWithTenantClient as any);

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

describe('ServiceTitan Routes — Happy Paths', () => {
  it('1. GET /servicetitan/auth returns OAuth URL when configured', async () => {
    // WHO: Dashboard integration card — user clicks "Connect ServiceTitan" button
    // WHAT: ServiceTitan env vars are set (ST_CLIENT_ID, ST_CLIENT_SECRET, ST_APP_KEY), request includes tenant_id
    // WHEN: GET /servicetitan/auth?tenant_id=...
    // WHERE: src/routes/servicetitan.ts registerServiceTitanRoutes — GET /servicetitan/auth handler
    // WHY: Without this, clicking "Connect ServiceTitan" would fail silently — user cannot link their ST account for customer/job sync
    vi.mocked(servicetitanClient.isServiceTitanEnabled).mockReturnValue(true);
    vi.mocked(servicetitanClient.getAuthUrl).mockReturnValue('https://auth.servicetitan.io/connect/authorize?client_id=test');

    const res = await app.inject({
      method: 'GET',
      url: `/servicetitan/auth?tenant_id=${TENANT_ID}`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.url).toBe('https://auth.servicetitan.io/connect/authorize?client_id=test');
    expect(servicetitanClient.getAuthUrl).toHaveBeenCalledWith(TENANT_ID);
  });

  it('2. GET /servicetitan/auth/callback exchanges code, stores tenantSid, redirects with ?servicetitanConnected=true', async () => {
    // WHO: ServiceTitan OAuth server — redirects user back after granting access, includes tenant_sid query param
    // WHAT: Callback has code + state + tenant_sid, tokens stored in tenant_integration_settings with tenant_sid in settings JSONB
    // WHEN: GET /servicetitan/auth/callback?code=...&state=...&tenant_sid=999888777 (OAuth redirect)
    // WHERE: src/routes/servicetitan.ts registerServiceTitanRoutes — GET /servicetitan/auth/callback handler via oauthCallbackFactory
    // WHY: Without storing tenant_sid, all ServiceTitan API calls would fail — ST requires tenant_sid header for every REST v2 request, breaking customer/job sync entirely
    vi.mocked(servicetitanClient.verifyState).mockReturnValue(TENANT_ID);
    vi.mocked(servicetitanClient.exchangeCodeForTokens).mockResolvedValue({
      access_token: 'access-123',
      refresh_token: 'refresh-456',
      expiry_date: Date.now() + 3600 * 1000,
    });

    // Pool.connect for INSERT
    queryResponses.push({ rows: [] });

    const res = await app.inject({
      method: 'GET',
      url: '/servicetitan/auth/callback?code=auth-code-xyz&state=valid-jwt-state&tenant_sid=999888777',
    });

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe(`${DASHBOARD_URL}/dashboard?servicetitanConnected=true`);
    expect(servicetitanClient.verifyState).toHaveBeenCalledWith('valid-jwt-state');
    expect(servicetitanClient.exchangeCodeForTokens).toHaveBeenCalledWith('auth-code-xyz');
    expect(mockClient.query).toHaveBeenCalled();
    expect(mockClient.release).toHaveBeenCalled();

    // Verify settings JSONB includes tenant_sid
    const insertCall = mockClient.query.mock.calls[0];
    expect(insertCall[0]).toContain('INSERT INTO tenant_integration_settings');
    expect(insertCall[1]).toContain(JSON.stringify({ tenant_sid: '999888777' }));
  });

  it('3. GET /servicetitan/settings returns settings', async () => {
    // WHO: Dashboard integration card — polls connection status on CRM settings page load
    // WHAT: tenant_integration_settings row exists, response strips access_token/refresh_token before returning
    // WHEN: GET /servicetitan/settings?tenant_id=...
    // WHERE: src/routes/servicetitan.ts registerServiceTitanRoutes — GET /servicetitan/settings handler
    // WHY: Without token stripping, OAuth tokens and ST-App-Key would leak to the browser — a XSS attack could steal them and impersonate the tenant on ServiceTitan's API
    const settingsRow = {
      tenant_id: TENANT_ID,
      provider: 'servicetitan',
      is_active: true,
      last_sync_at: '2026-03-25T10:00:00Z',
      created_at: '2026-03-20T08:00:00Z',
      updated_at: '2026-03-25T10:00:00Z',
    };
    queryResponses.push({ rows: [settingsRow] });

    const res = await app.inject({
      method: 'GET',
      url: `/servicetitan/settings?tenant_id=${TENANT_ID}`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.tenant_id).toBe(TENANT_ID);
    expect(body.provider).toBe('servicetitan');
    expect(body.is_active).toBe(true);
    // Should NOT contain token fields
    expect(body.access_token).toBeUndefined();
    expect(body.refresh_token).toBeUndefined();
  });

  it('4. POST /servicetitan/settings/disconnect deletes settings + sync map', async () => {
    // WHO: Dashboard user — clicks "Disconnect ServiceTitan" button on CRM integration card
    // WHAT: Deletes tenant_integration_settings row AND all entity_sync_map rows for this tenant+provider
    // WHEN: POST /servicetitan/settings/disconnect?tenant_id=...
    // WHERE: src/routes/servicetitan.ts registerServiceTitanRoutes — POST /servicetitan/settings/disconnect handler
    // WHY: Without deleting sync map entries, reconnecting ST later would cause duplicate customers — stale external_id mappings conflict with fresh ServiceTitan data
    // DELETE from tenant_integration_settings
    queryResponses.push({ rows: [], rowCount: 1 });
    // DELETE from entity_sync_map
    queryResponses.push({ rows: [], rowCount: 3 });

    const res = await app.inject({
      method: 'POST',
      url: `/servicetitan/settings/disconnect?tenant_id=${TENANT_ID}`,
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

  it('5. POST /servicetitan/webhook accepts payload without signature check', async () => {
    // WHO: ServiceTitan webhook server — fires customer.created event (ST webhooks have no HMAC signing)
    // WHAT: Payload contains event array with tenantId (ST's tenant_sid), tenant lookup succeeds, customer synced to local DB
    // WHEN: POST /servicetitan/webhook with customer.created event payload
    // WHERE: src/routes/servicetitan.ts registerServiceTitanRoutes — POST /servicetitan/webhook handler
    // WHY: Without this, new customers created in ServiceTitan would never appear in SecretaryHQ — bidirectional sync breaks and the voice AI has stale customer data
    const webhookBody = [
      { eventType: 'customer.created', data: { id: 12345, name: 'Test', phoneNumber: '555-1234' }, tenantId: '999888777' },
    ];

    // Tenant lookup by tenantSid (uses pool.query)
    queryResponses.push({ rows: [{ tenant_id: TENANT_ID }] });

    vi.mocked(servicetitanSync.getTokensWithRefresh).mockResolvedValue({
      accessToken: 'access-token-123',
      refreshToken: 'refresh-token-456',
      appKey: 'test-app-key',
      tenantSid: '999888777',
    });

    vi.mocked(servicetitanSync.pullServiceTitanCustomer).mockResolvedValue(undefined);

    const res = await app.inject({
      method: 'POST',
      url: '/servicetitan/webhook',
      payload: webhookBody,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.message).toBe('Webhook received');
  });

  it('6. POST /servicetitan/sync triggers fullSync', async () => {
    // WHO: Dashboard user — clicks "Sync Now" button on ServiceTitan integration card
    // WHAT: fullSync pulls all customers and jobs from ServiceTitan REST v2 API, returns count of synced entities
    // WHEN: POST /servicetitan/sync?tenant_id=...
    // WHERE: src/routes/servicetitan.ts registerServiceTitanRoutes — POST /servicetitan/sync handler calling servicetitanSync.fullSync
    // WHY: Without this, users have no way to trigger a full data pull — initial setup after connecting ServiceTitan would show zero synced records
    vi.mocked(servicetitanSync.fullSync).mockResolvedValue({
      customersSynced: 15,
      appointmentsSynced: 8,
      errors: 0,
    });

    const res = await app.inject({
      method: 'POST',
      url: `/servicetitan/sync?tenant_id=${TENANT_ID}`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.customersSynced).toBe(15);
    expect(body.appointmentsSynced).toBe(8);
    expect(servicetitanSync.fullSync).toHaveBeenCalledWith(expect.anything(), TENANT_ID);
  });

  it('7. GET /servicetitan/sync/status returns counts', async () => {
    // WHO: Dashboard integration card — polls sync status to show progress badges (synced/pending/error counts)
    // WHAT: Aggregates entity_sync_map rows by entity_type and sync_status, joins with last_sync_at from settings
    // WHEN: GET /servicetitan/sync/status?tenant_id=...
    // WHERE: src/routes/servicetitan.ts registerServiceTitanRoutes — GET /servicetitan/sync/status handler
    // WHY: Without this, the ServiceTitan integration card shows no sync progress — user cannot tell if sync worked, how many records failed, or when last sync ran
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
      url: `/servicetitan/sync/status?tenant_id=${TENANT_ID}`,
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

describe('ServiceTitan Routes — Sad Paths', () => {
  it('8. GET /servicetitan/auth returns 503 when not configured', async () => {
    // WHO: Dashboard integration card — user clicks "Connect ServiceTitan" but server lacks ST_CLIENT_ID/SECRET env vars
    // WHAT: isServiceTitanEnabled returns false because required env vars are missing in production
    // WHEN: GET /servicetitan/auth?tenant_id=... when ServiceTitan env vars not set
    // WHERE: src/routes/servicetitan.ts registerServiceTitanRoutes — GET /servicetitan/auth guard check
    // WHY: Without a clear 503, the dashboard would show a cryptic error instead of "ServiceTitan integration not configured" — admin wouldn't know to set env vars
    vi.mocked(servicetitanClient.isServiceTitanEnabled).mockReturnValue(false);

    const res = await app.inject({
      method: 'GET',
      url: `/servicetitan/auth?tenant_id=${TENANT_ID}`,
    });

    expect(res.statusCode).toBe(503);
    const body = res.json();
    expect(body.success).toBe(false);
    expect(body.error).toContain('not configured');
  });

  it('9. GET /servicetitan/auth/callback redirects with error on missing params', async () => {
    // WHO: Malformed OAuth redirect or direct browser navigation to callback URL without params
    // WHAT: Callback URL has neither code nor state nor error query params
    // WHEN: GET /servicetitan/auth/callback (no query params)
    // WHERE: src/routes/servicetitan.ts registerServiceTitanRoutes — GET /servicetitan/auth/callback missing params guard
    // WHY: Without this guard, the handler would crash on undefined code/state — user sees a 500 error page instead of being redirected to dashboard with an error toast
    const res = await app.inject({
      method: 'GET',
      url: '/servicetitan/auth/callback',
    });

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe(`${DASHBOARD_URL}/dashboard?servicetitanError=missing_params`);
  });

  it('10. GET /servicetitan/auth/callback redirects with error on bad state', async () => {
    // WHO: Attacker or expired session — callback arrives with tampered/expired JWT state
    // WHAT: verifyState returns null because the state JWT is invalid, expired, or forged
    // WHEN: GET /servicetitan/auth/callback?code=...&state=bad-jwt
    // WHERE: src/routes/servicetitan.ts registerServiceTitanRoutes — GET /servicetitan/auth/callback state verification
    // WHY: Without this, a CSRF attack could link an attacker's ServiceTitan account to a victim's tenant — state validation prevents OAuth session fixation
    vi.mocked(servicetitanClient.verifyState).mockReturnValue(null);

    const res = await app.inject({
      method: 'GET',
      url: '/servicetitan/auth/callback?code=auth-code&state=bad-jwt',
    });

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe(`${DASHBOARD_URL}/dashboard?servicetitanError=invalid_state`);
  });

  it('11. GET /servicetitan/auth/callback redirects on token exchange failure', async () => {
    // WHO: ServiceTitan OAuth server — token exchange fails (expired code, ST API outage, network error)
    // WHAT: verifyState succeeds but exchangeCodeForTokens throws — ServiceTitan rejected the authorization code
    // WHEN: GET /servicetitan/auth/callback?code=...&state=... when ST's token endpoint is down
    // WHERE: src/routes/servicetitan.ts registerServiceTitanRoutes — GET /servicetitan/auth/callback token exchange try/catch
    // WHY: Without catching this, a ServiceTitan outage during OAuth would show a raw 500 error — user sees broken page instead of "connection failed, try again"
    vi.mocked(servicetitanClient.verifyState).mockReturnValue(TENANT_ID);
    vi.mocked(servicetitanClient.exchangeCodeForTokens).mockRejectedValue(new Error('OAuth exchange failed'));

    const res = await app.inject({
      method: 'GET',
      url: '/servicetitan/auth/callback?code=auth-code&state=valid-jwt',
    });

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe(`${DASHBOARD_URL}/dashboard?servicetitanError=token_exchange_failed`);
  });

  it('12. GET /servicetitan/settings returns null when not connected', async () => {
    // WHO: Dashboard integration card — checks if ServiceTitan is connected for a tenant that hasn't set up ST yet
    // WHAT: No tenant_integration_settings row exists for this tenant+provider, DB returns empty rows
    // WHEN: GET /servicetitan/settings?tenant_id=... (tenant has never connected ServiceTitan)
    // WHERE: src/routes/servicetitan.ts registerServiceTitanRoutes — GET /servicetitan/settings handler, empty result branch
    // WHY: Without returning null, the dashboard would crash trying to read properties of undefined — the "Connect ServiceTitan" button wouldn't render
    queryResponses.push({ rows: [] });

    const res = await app.inject({
      method: 'GET',
      url: `/servicetitan/settings?tenant_id=${TENANT_ID}`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toBeNull();
  });
});
