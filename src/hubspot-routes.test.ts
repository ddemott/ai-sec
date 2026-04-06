import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import type { PoolClient } from 'pg';

// --- Mock hubspotClient and hubspotSync modules before importing routes ---
vi.mock('./services/hubspotClient', () => ({
  isHubSpotEnabled: vi.fn(),
  getAuthUrl: vi.fn(),
  verifyState: vi.fn(),
  exchangeCodeForTokens: vi.fn(),
  verifyWebhookSignature: vi.fn(),
  getContact: vi.fn(),
}));

vi.mock('./services/hubspotSync', () => ({
  fullSync: vi.fn(),
  getTokensWithRefresh: vi.fn(),
  pullHubSpotContact: vi.fn(),
}));

import { registerHubSpotRoutes } from './routes/hubspot';
import * as hubspotClient from './services/hubspotClient';
import * as hubspotSync from './services/hubspotSync';

// --- Constants ---
const TENANT_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const DASHBOARD_URL = 'https://localhost:4000';

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
    query: vi.fn(async (text: string, params?: unknown[]) => {
      return mockClient.query(text, params);
    }),
  } as any;
}

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

  // withTenantClient mock: calls fn with mockClient directly
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

  registerHubSpotRoutes(fastify, mockPool, mockWithTenantClient as any);

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
    vi.mocked(hubspotClient.isHubSpotEnabled).mockReturnValue(true);
    vi.mocked(hubspotClient.getAuthUrl).mockReturnValue('https://app.hubspot.com/oauth/authorize?client_id=test');

    const res = await app.inject({
      method: 'GET',
      url: `/hubspot/auth?tenant_id=${TENANT_ID}`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.url).toBe('https://app.hubspot.com/oauth/authorize?client_id=test');
    expect(hubspotClient.getAuthUrl).toHaveBeenCalledWith(TENANT_ID);
  });

  it('2. GET /hubspot/auth/callback exchanges code, redirects with ?hubspotConnected=true', async () => {
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
    const now = Date.now();
    const webhookBody = [
      { subscriptionType: 'contact.creation', objectId: '12345', portalId: '99999' },
    ];
    const rawBody = JSON.stringify(webhookBody);

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
    const res = await app.inject({
      method: 'GET',
      url: '/hubspot/auth/callback',
    });

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe(`${DASHBOARD_URL}/dashboard?hubspotError=missing_params`);
  });

  it('10. GET /hubspot/auth/callback redirects with error on bad state', async () => {
    vi.mocked(hubspotClient.verifyState).mockReturnValue(null);

    const res = await app.inject({
      method: 'GET',
      url: '/hubspot/auth/callback?code=auth-code&state=bad-jwt',
    });

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe(`${DASHBOARD_URL}/dashboard?hubspotError=invalid_state`);
  });

  it('11. GET /hubspot/auth/callback redirects on token exchange failure', async () => {
    vi.mocked(hubspotClient.verifyState).mockReturnValue(TENANT_ID);
    vi.mocked(hubspotClient.exchangeCodeForTokens).mockRejectedValue(new Error('OAuth exchange failed'));

    const res = await app.inject({
      method: 'GET',
      url: '/hubspot/auth/callback?code=auth-code&state=valid-jwt',
    });

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe(`${DASHBOARD_URL}/dashboard?hubspotError=token_exchange_failed`);
  });

  it('12. POST /hubspot/webhook 400 on missing signature', async () => {
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
