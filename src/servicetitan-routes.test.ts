import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import type { PoolClient } from 'pg';

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
const DASHBOARD_URL = 'https://localhost:3001';

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
    const res = await app.inject({
      method: 'GET',
      url: '/servicetitan/auth/callback',
    });

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe(`${DASHBOARD_URL}/dashboard?servicetitanError=missing_params`);
  });

  it('10. GET /servicetitan/auth/callback redirects with error on bad state', async () => {
    vi.mocked(servicetitanClient.verifyState).mockReturnValue(null);

    const res = await app.inject({
      method: 'GET',
      url: '/servicetitan/auth/callback?code=auth-code&state=bad-jwt',
    });

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe(`${DASHBOARD_URL}/dashboard?servicetitanError=invalid_state`);
  });

  it('11. GET /servicetitan/auth/callback redirects on token exchange failure', async () => {
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
    queryResponses.push({ rows: [] });

    const res = await app.inject({
      method: 'GET',
      url: `/servicetitan/settings?tenant_id=${TENANT_ID}`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toBeNull();
  });
});
