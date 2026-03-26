import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify from 'fastify';
import crypto from 'crypto';
import type { FastifyInstance } from 'fastify';
import type { PoolClient } from 'pg';

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
const DASHBOARD_URL = 'https://localhost:3001';
const WEBHOOK_SECRET = 'whsec_test_secret_123';

// --- Mock helpers ---

interface MockQuery {
  text: string;
  params: unknown[];
}

function createMockClient() {
  const queries: MockQuery[] = [];
  const queryResponses: Array<{ rows: unknown[]; rowCount?: number }> = [];

  const mockClient = {
    query: vi.fn(async (text: string, params?: unknown[]) => {
      queries.push({ text, params: params || [] });
      return queryResponses.shift() || { rows: [], rowCount: 0 };
    }),
    release: vi.fn(),
  };

  return { mockClient, queries, queryResponses };
}

function createMockPool(mockClient: ReturnType<typeof createMockClient>['mockClient']) {
  return {
    connect: vi.fn(async () => mockClient),
  } as any; // eslint-disable-line @typescript-eslint/no-explicit-any
}

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

  // withTenantClient mock: calls fn with mockClient directly (no RLS setup needed)
  const mockWithTenantClient = vi.fn(
    async <T>(_tenantId: string, fn: (client: PoolClient) => Promise<T>): Promise<T> => {
      return fn(mockClient as unknown as PoolClient);
    }
  );

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

  registerJobberRoutes(fastify, mockPool, mockWithTenantClient as any);

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
    vi.mocked(jobberClient.isJobberEnabled).mockReturnValue(true);
    vi.mocked(jobberClient.getAuthUrl).mockReturnValue('https://api.getjobber.com/api/oauth/authorize?client_id=test');

    const res = await app.inject({
      method: 'GET',
      url: `/jobber/auth?tenant_id=${TENANT_ID}`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.url).toBe('https://api.getjobber.com/api/oauth/authorize?client_id=test');
    expect(jobberClient.getAuthUrl).toHaveBeenCalledWith(TENANT_ID);
  });

  // 2. GET /jobber/auth/callback exchanges code, stores tokens, redirects
  it('2. GET /jobber/auth/callback exchanges code, stores tokens, redirects to dashboard', async () => {
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
    const res = await app.inject({
      method: 'GET',
      url: '/jobber/auth/callback?error=access_denied',
    });

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe(`${DASHBOARD_URL}/dashboard?jobberError=access_denied`);
  });

  // 4. GET /jobber/auth/callback redirects with ?jobberError=invalid_state for bad state
  it('4. GET /jobber/auth/callback redirects with jobberError=invalid_state for bad state', async () => {
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
    const res = await app.inject({
      method: 'GET',
      url: '/jobber/auth/callback',
    });

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe(`${DASHBOARD_URL}/dashboard?jobberError=missing_params`);
  });

  // 13. GET /jobber/auth/callback redirects with ?jobberError=token_exchange_failed on exchange error
  it('13. GET /jobber/auth/callback redirects with jobberError=token_exchange_failed on exchange error', async () => {
    vi.mocked(jobberClient.verifyState).mockReturnValue(TENANT_ID);
    vi.mocked(jobberClient.exchangeCodeForTokens).mockRejectedValue(new Error('OAuth exchange failed'));

    const res = await app.inject({
      method: 'GET',
      url: '/jobber/auth/callback?code=auth-code&state=valid-jwt',
    });

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe(`${DASHBOARD_URL}/dashboard?jobberError=token_exchange_failed`);
  });

  // 14. POST /jobber/webhook/:tenantId returns 400 when missing signature
  it('14. POST /jobber/webhook/:tenantId returns 400 when missing signature', async () => {
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
  it('GET /jobber/auth returns 400 when tenant_id is missing', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/jobber/auth',
      // No tenant_id param
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error).toContain('tenant_id');
  });

  it('GET /jobber/settings returns 400 when tenant_id is missing', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/jobber/settings',
    });

    expect(res.statusCode).toBe(400);
  });

  it('POST /jobber/settings/disconnect returns 400 when tenant_id is missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/jobber/settings/disconnect',
    });

    expect(res.statusCode).toBe(400);
  });

  it('POST /jobber/sync returns 400 when tenant_id is missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/jobber/sync',
    });

    expect(res.statusCode).toBe(400);
  });

  it('GET /jobber/sync/status returns 400 when tenant_id is missing', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/jobber/sync/status',
    });

    expect(res.statusCode).toBe(400);
  });

  it('GET /jobber/auth returns 500 when getAuthUrl returns null', async () => {
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
    const res = await app.inject({
      method: 'GET',
      url: '/jobber/auth/callback?code=some-code',
    });

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe(`${DASHBOARD_URL}/dashboard?jobberError=missing_params`);
  });

  it('GET /jobber/auth/callback with only state (no code) redirects with missing_params', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/jobber/auth/callback?state=some-state',
    });

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe(`${DASHBOARD_URL}/dashboard?jobberError=missing_params`);
  });

  it('Webhook with topic but no itemId returns 200 no-op', async () => {
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
