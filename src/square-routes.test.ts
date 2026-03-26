import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import type { PoolClient } from 'pg';

// --- Mock squareClient and squareSync modules before importing routes ---
vi.mock('./services/squareClient', () => ({
  isSquareEnabled: vi.fn(),
  getAuthUrl: vi.fn(),
  verifyState: vi.fn(),
  exchangeCodeForTokens: vi.fn(),
  verifyWebhookSignature: vi.fn(),
  getCustomer: vi.fn(),
}));

vi.mock('./services/squareSync', () => ({
  fullSync: vi.fn(),
  getTokensWithRefresh: vi.fn(),
  pullSquareCustomer: vi.fn(),
}));

import { registerSquareRoutes } from './routes/square';
import * as squareClient from './services/squareClient';
import * as squareSync from './services/squareSync';

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

  registerSquareRoutes(fastify, mockPool, mockWithTenantClient as any);

  return fastify;
}

// --- Setup / teardown ---

beforeAll(async () => {
  process.env.DASHBOARD_URL = DASHBOARD_URL;
  process.env.SQUARE_WEBHOOK_SIGNATURE_KEY = 'test-square-webhook-key';
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

describe('Square Routes — Happy Paths', () => {
  it('1. GET /square/auth returns OAuth URL when configured', async () => {
    vi.mocked(squareClient.isSquareEnabled).mockReturnValue(true);
    vi.mocked(squareClient.getAuthUrl).mockReturnValue('https://connect.squareup.com/oauth2/authorize?client_id=test');

    const res = await app.inject({
      method: 'GET',
      url: `/square/auth?tenant_id=${TENANT_ID}`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.url).toBe('https://connect.squareup.com/oauth2/authorize?client_id=test');
    expect(squareClient.getAuthUrl).toHaveBeenCalledWith(TENANT_ID);
  });

  it('2. GET /square/auth/callback exchanges code, redirects with ?squareConnected=true', async () => {
    vi.mocked(squareClient.verifyState).mockReturnValue(TENANT_ID);
    vi.mocked(squareClient.exchangeCodeForTokens).mockResolvedValue({
      access_token: 'access-123',
      refresh_token: 'refresh-456',
      expiry_date: Date.now() + 30 * 24 * 3600 * 1000,
    });

    // Pool.connect for INSERT
    queryResponses.push({ rows: [] });

    const res = await app.inject({
      method: 'GET',
      url: '/square/auth/callback?code=auth-code-xyz&state=valid-jwt-state',
    });

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe(`${DASHBOARD_URL}/dashboard?squareConnected=true`);
    expect(squareClient.verifyState).toHaveBeenCalledWith('valid-jwt-state');
    expect(squareClient.exchangeCodeForTokens).toHaveBeenCalledWith('auth-code-xyz');
    expect(mockClient.query).toHaveBeenCalled();
    expect(mockClient.release).toHaveBeenCalled();
  });

  it('3. GET /square/settings returns settings', async () => {
    const settingsRow = {
      tenant_id: TENANT_ID,
      provider: 'square',
      is_active: true,
      last_sync_at: '2026-03-25T10:00:00Z',
      created_at: '2026-03-20T08:00:00Z',
      updated_at: '2026-03-25T10:00:00Z',
    };
    queryResponses.push({ rows: [settingsRow] });

    const res = await app.inject({
      method: 'GET',
      url: `/square/settings?tenant_id=${TENANT_ID}`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.tenant_id).toBe(TENANT_ID);
    expect(body.provider).toBe('square');
    expect(body.is_active).toBe(true);
    // Should NOT contain token fields
    expect(body.access_token).toBeUndefined();
    expect(body.refresh_token).toBeUndefined();
  });

  it('4. POST /square/settings/disconnect deletes settings + sync map', async () => {
    // DELETE from tenant_integration_settings
    queryResponses.push({ rows: [], rowCount: 1 });
    // DELETE from entity_sync_map
    queryResponses.push({ rows: [], rowCount: 3 });

    const res = await app.inject({
      method: 'POST',
      url: `/square/settings/disconnect?tenant_id=${TENANT_ID}`,
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

  it('5. POST /square/webhook processes valid event', async () => {
    const webhookBody = {
      type: 'customer.created',
      merchant_id: 'M123',
      data: { id: 'sq-cust-001' },
    };

    vi.mocked(squareClient.verifyWebhookSignature).mockReturnValue(true);

    // Tenant lookup by merchantId (uses pool.query)
    queryResponses.push({ rows: [{ tenant_id: TENANT_ID }] });

    vi.mocked(squareSync.getTokensWithRefresh).mockResolvedValue({
      accessToken: 'access-token-123',
      refreshToken: 'refresh-token-456',
    });

    vi.mocked(squareClient.getCustomer).mockResolvedValue({
      customer: {
        id: 'sq-cust-001',
        given_name: 'John',
        family_name: 'Doe',
        phone_number: '555-1234',
      },
    });

    vi.mocked(squareSync.pullSquareCustomer).mockResolvedValue(undefined);

    const res = await app.inject({
      method: 'POST',
      url: '/square/webhook',
      headers: {
        'x-square-hmacsha256-signature': 'valid-sig',
      },
      payload: webhookBody,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.message).toBe('Webhook received');
  });

  it('6. POST /square/sync triggers fullSync', async () => {
    vi.mocked(squareSync.fullSync).mockResolvedValue({
      customersSynced: 15,
      appointmentsSynced: 8,
      errors: 0,
    });

    const res = await app.inject({
      method: 'POST',
      url: `/square/sync?tenant_id=${TENANT_ID}`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.customersSynced).toBe(15);
    expect(body.appointmentsSynced).toBe(8);
    expect(squareSync.fullSync).toHaveBeenCalledWith(expect.anything(), TENANT_ID);
  });

  it('7. GET /square/sync/status returns counts', async () => {
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
      url: `/square/sync/status?tenant_id=${TENANT_ID}`,
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

describe('Square Routes — Sad Paths', () => {
  it('8. GET /square/auth returns 503 when not configured', async () => {
    vi.mocked(squareClient.isSquareEnabled).mockReturnValue(false);

    const res = await app.inject({
      method: 'GET',
      url: `/square/auth?tenant_id=${TENANT_ID}`,
    });

    expect(res.statusCode).toBe(503);
    const body = res.json();
    expect(body.success).toBe(false);
    expect(body.error).toContain('not configured');
  });

  it('9. GET /square/auth/callback redirects with error on missing params', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/square/auth/callback',
    });

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe(`${DASHBOARD_URL}/dashboard?squareError=missing_params`);
  });

  it('10. GET /square/auth/callback redirects with error on bad state', async () => {
    vi.mocked(squareClient.verifyState).mockReturnValue(null);

    const res = await app.inject({
      method: 'GET',
      url: '/square/auth/callback?code=auth-code&state=bad-jwt',
    });

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe(`${DASHBOARD_URL}/dashboard?squareError=invalid_state`);
  });

  it('11. GET /square/auth/callback redirects on token exchange failure', async () => {
    vi.mocked(squareClient.verifyState).mockReturnValue(TENANT_ID);
    vi.mocked(squareClient.exchangeCodeForTokens).mockRejectedValue(new Error('OAuth exchange failed'));

    const res = await app.inject({
      method: 'GET',
      url: '/square/auth/callback?code=auth-code&state=valid-jwt',
    });

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe(`${DASHBOARD_URL}/dashboard?squareError=token_exchange_failed`);
  });

  it('12. POST /square/webhook 400 on missing signature', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/square/webhook',
      payload: { type: 'customer.created', merchant_id: 'M123' },
      // No x-square-hmacsha256-signature header
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.success).toBe(false);
    expect(body.error).toContain('Missing signature');
  });

  it('13. POST /square/webhook 401 on invalid signature', async () => {
    vi.mocked(squareClient.verifyWebhookSignature).mockReturnValue(false);

    const res = await app.inject({
      method: 'POST',
      url: '/square/webhook',
      headers: {
        'x-square-hmacsha256-signature': 'bad-signature',
      },
      payload: { type: 'customer.created', merchant_id: 'M123' },
    });

    expect(res.statusCode).toBe(401);
    const body = res.json();
    expect(body.success).toBe(false);
    expect(body.error).toContain('Invalid webhook signature');
  });

  it('14. POST /square/webhook 500 when signature key not configured', async () => {
    const savedKey = process.env.SQUARE_WEBHOOK_SIGNATURE_KEY;
    delete process.env.SQUARE_WEBHOOK_SIGNATURE_KEY;

    const res = await app.inject({
      method: 'POST',
      url: '/square/webhook',
      headers: {
        'x-square-hmacsha256-signature': 'some-sig',
      },
      payload: { type: 'customer.created', merchant_id: 'M123' },
    });

    expect(res.statusCode).toBe(500);
    const body = res.json();
    expect(body.success).toBe(false);
    expect(body.error).toContain('signature key not configured');

    process.env.SQUARE_WEBHOOK_SIGNATURE_KEY = savedKey;
  });
});
