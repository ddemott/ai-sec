import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock squareClient before importing squareSync
vi.mock('./services/squareClient', () => ({
  refreshAccessToken: vi.fn(),
  createCustomer: vi.fn(),
  updateCustomer: vi.fn(),
  createBooking: vi.fn(),
  updateBooking: vi.fn(),
  cancelBooking: vi.fn(),
  listCustomers: vi.fn(),
  listBookings: vi.fn(),
}));

import {
  getTokensWithRefresh,
  syncCustomerToSquare,
  syncAppointmentToSquare,
  pullSquareCustomer,
  fullSync,
} from "./services/squareSync";
import * as square from "./services/squareClient";

// ---- Mock helpers ----

const TENANT_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const CUSTOMER_ID = '11111111-2222-3333-4444-555555555555';
const APPOINTMENT_ID = '22222222-3333-4444-5555-666666666666';
const SQUARE_CUSTOMER_ID = 'sq-cust-001';
const SQUARE_BOOKING_ID = 'sq-book-001';
const RESOURCE_ID = 'res-0001';

function makeIntegrationSettings(overrides: Record<string, any> = {}) {
  return {
    access_token: 'valid-access-token',
    refresh_token: 'valid-refresh-token',
    token_expires_at: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
    is_active: true,
    ...overrides,
  };
}

function makeCustomerRow(overrides: Record<string, any> = {}) {
  return {
    id: CUSTOMER_ID,
    name: 'John Doe',
    phone: '555-1234',
    email: 'john@example.com',
    address: '123 Main St',
    updated_at: '2026-03-20T10:00:00Z',
    ...overrides,
  };
}

function makeAppointmentRow(overrides: Record<string, any> = {}) {
  return {
    id: APPOINTMENT_ID,
    tenant_id: TENANT_ID,
    customer_id: CUSTOMER_ID,
    resource_id: RESOURCE_ID,
    start_time: '2026-03-26T10:00:00Z',
    end_time: '2026-03-26T11:00:00Z',
    description: 'Oil Change',
    status: 'scheduled',
    customer_name: 'John Doe',
    customer_phone: '555-1234',
    resource_name: 'Bay 1',
    updated_at: '2026-03-20T10:00:00Z',
    ...overrides,
  };
}

function makeSquareCustomerData(overrides: Record<string, any> = {}): square.SquareCustomer {
  return {
    id: SQUARE_CUSTOMER_ID,
    given_name: 'Jane',
    family_name: 'Smith',
    phone_number: '555-9999',
    email_address: 'jane@example.com',
    updated_at: '2026-03-25T14:00:00Z',
    ...overrides,
  };
}

interface MockQuery {
  text: string;
  params: any[];
}

function createMockClient() {
  const queries: MockQuery[] = [];
  const queryResponses: Array<{ rows: any[]; rowCount?: number }> = [];

  const mockClient = {
    query: vi.fn(async (text: string, params?: any[]) => {
      queries.push({ text, params: params || [] });
      return queryResponses.shift() || { rows: [], rowCount: 0 };
    }),
    release: vi.fn(),
  };

  return { mockClient, queries, queryResponses };
}

function createMockPool(mockClient: any) {
  return {
    connect: vi.fn(async () => mockClient),
  } as any;
}

const silentLogger = {
  warn: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
});

// =============================================
// HAPPY PATHS — PUSH
// =============================================

describe("Square Sync — Push Happy Paths", () => {
  it("1. syncCustomerToSquare creates customer + inserts sync map entry", async () => {
    const { mockClient, queryResponses } = createMockClient();
    const pool = createMockPool(mockClient);

    // getTokensWithRefresh: integration settings (token not expired)
    queryResponses.push({ rows: [makeIntegrationSettings()] });

    // syncCustomerToSquare: fetch local customer
    queryResponses.push({ rows: [makeCustomerRow()] });

    // syncCustomerToSquare: check sync map (empty — new)
    queryResponses.push({ rows: [] });

    // syncCustomerToSquare: INSERT sync map after create
    queryResponses.push({ rows: [] });

    vi.mocked(square.createCustomer).mockResolvedValueOnce({
      customer: {
        id: SQUARE_CUSTOMER_ID,
        given_name: 'John',
        family_name: 'Doe',
        updated_at: '2026-03-20T10:00:00Z',
      },
    });

    await syncCustomerToSquare(pool, TENANT_ID, CUSTOMER_ID, 'create', silentLogger);

    expect(square.createCustomer).toHaveBeenCalledOnce();
    expect(square.createCustomer).toHaveBeenCalledWith(
      'valid-access-token',
      expect.objectContaining({ given_name: 'John', family_name: 'Doe' }),
    );
    expect(mockClient.release).toHaveBeenCalled();
    expect(silentLogger.info).toHaveBeenCalledWith(expect.stringContaining('customer pushed to Square'));

    // Verify sync map INSERT was called with correct external_id
    const insertQuery = mockClient.query.mock.calls[3];
    expect(insertQuery[0]).toContain('INSERT INTO entity_sync_map');
    expect(insertQuery[1]).toContain(SQUARE_CUSTOMER_ID);
  });

  it("2. syncCustomerToSquare updates existing customer", async () => {
    const { mockClient, queryResponses } = createMockClient();
    const pool = createMockPool(mockClient);

    // getTokensWithRefresh: integration settings
    queryResponses.push({ rows: [makeIntegrationSettings()] });

    // fetch local customer
    queryResponses.push({ rows: [makeCustomerRow()] });

    // check sync map — existing mapping
    queryResponses.push({ rows: [{ external_id: SQUARE_CUSTOMER_ID }] });

    // UPDATE sync map after update
    queryResponses.push({ rows: [] });

    vi.mocked(square.updateCustomer).mockResolvedValueOnce({
      customer: {
        id: SQUARE_CUSTOMER_ID,
        given_name: 'John',
        family_name: 'Doe',
        updated_at: '2026-03-20T12:00:00Z',
      },
    });

    await syncCustomerToSquare(pool, TENANT_ID, CUSTOMER_ID, 'update', silentLogger);

    expect(square.updateCustomer).toHaveBeenCalledOnce();
    expect(square.updateCustomer).toHaveBeenCalledWith(
      'valid-access-token',
      SQUARE_CUSTOMER_ID,
      expect.objectContaining({ given_name: 'John', family_name: 'Doe' }),
    );
    expect(silentLogger.info).toHaveBeenCalledWith(expect.stringContaining('customer updated in Square'));
    expect(mockClient.release).toHaveBeenCalled();
  });

  it("3. syncCustomerToSquare delete removes sync map entry", async () => {
    const { mockClient, queryResponses } = createMockClient();
    const pool = createMockPool(mockClient);

    // getTokensWithRefresh
    queryResponses.push({ rows: [makeIntegrationSettings()] });

    // DELETE sync map
    queryResponses.push({ rows: [], rowCount: 1 });

    await syncCustomerToSquare(pool, TENANT_ID, CUSTOMER_ID, 'delete', silentLogger);

    // Should NOT call Square API at all
    expect(square.createCustomer).not.toHaveBeenCalled();
    expect(square.updateCustomer).not.toHaveBeenCalled();
    expect(silentLogger.info).toHaveBeenCalledWith(expect.stringContaining('sync map entry removed'));
    expect(mockClient.release).toHaveBeenCalled();
  });

  it("4. syncAppointmentToSquare creates booking", async () => {
    const { mockClient, queryResponses } = createMockClient();
    const pool = createMockPool(mockClient);

    // getTokensWithRefresh
    queryResponses.push({ rows: [makeIntegrationSettings()] });

    // fetch appointment with customer details
    queryResponses.push({ rows: [makeAppointmentRow()] });

    // check customer sync map — already synced
    queryResponses.push({ rows: [{ external_id: SQUARE_CUSTOMER_ID }] });

    // check appointment sync map — new
    queryResponses.push({ rows: [] });

    // INSERT sync map for appointment
    queryResponses.push({ rows: [] });

    vi.mocked(square.createBooking).mockResolvedValueOnce({
      booking: {
        id: SQUARE_BOOKING_ID,
        start_at: '2026-03-26T10:00:00Z',
      },
    });

    await syncAppointmentToSquare(pool, TENANT_ID, APPOINTMENT_ID, 'create', silentLogger);

    expect(square.createBooking).toHaveBeenCalledOnce();
    expect(square.createBooking).toHaveBeenCalledWith(
      'valid-access-token',
      expect.objectContaining({
        customer_id: SQUARE_CUSTOMER_ID,
      }),
    );
    expect(silentLogger.info).toHaveBeenCalledWith(expect.stringContaining('appointment pushed to Square as booking'));
    expect(mockClient.release).toHaveBeenCalled();
  });

  it("5. syncAppointmentToSquare auto-syncs customer first if not yet synced", async () => {
    const queries: MockQuery[] = [];
    const allResponses: Array<{ rows: any[]; rowCount?: number }> = [];

    const mockClient = {
      query: vi.fn(async (text: string, params?: any[]) => {
        queries.push({ text, params: params || [] });
        return allResponses.shift() || { rows: [], rowCount: 0 };
      }),
      release: vi.fn(),
    };

    const pool = createMockPool(mockClient);

    // --- Main syncAppointmentToSquare flow ---
    // 1. getTokensWithRefresh (for syncAppointmentToSquare)
    allResponses.push({ rows: [makeIntegrationSettings()] });

    // 2. fetch appointment
    allResponses.push({ rows: [makeAppointmentRow()] });

    // 3. check customer sync map — NOT synced yet
    allResponses.push({ rows: [] });

    // --- Recursive syncCustomerToSquare call ---
    // 4. getTokensWithRefresh (for syncCustomerToSquare)
    allResponses.push({ rows: [makeIntegrationSettings()] });

    // 5. fetch local customer
    allResponses.push({ rows: [makeCustomerRow()] });

    // 6. check customer sync map (empty — create)
    allResponses.push({ rows: [] });

    // 7. INSERT customer sync map
    allResponses.push({ rows: [] });

    // --- Back in syncAppointmentToSquare ---
    // 8. re-check customer sync map — NOW synced
    allResponses.push({ rows: [{ external_id: SQUARE_CUSTOMER_ID }] });

    // 9. check appointment sync map — new
    allResponses.push({ rows: [] });

    // 10. INSERT appointment sync map
    allResponses.push({ rows: [] });

    // First: createCustomer (from recursive syncCustomerToSquare)
    vi.mocked(square.createCustomer).mockResolvedValueOnce({
      customer: {
        id: SQUARE_CUSTOMER_ID,
        given_name: 'John',
        family_name: 'Doe',
        updated_at: '2026-03-20T10:00:00Z',
      },
    });

    // Second: createBooking
    vi.mocked(square.createBooking).mockResolvedValueOnce({
      booking: {
        id: SQUARE_BOOKING_ID,
        start_at: '2026-03-26T10:00:00Z',
      },
    });

    await syncAppointmentToSquare(pool, TENANT_ID, APPOINTMENT_ID, 'create', silentLogger);

    // Should have called createCustomer once and createBooking once
    expect(square.createCustomer).toHaveBeenCalledOnce();
    expect(square.createBooking).toHaveBeenCalledOnce();
    expect(silentLogger.info).toHaveBeenCalledWith(expect.stringContaining('customer pushed to Square'));
    expect(silentLogger.info).toHaveBeenCalledWith(expect.stringContaining('appointment pushed to Square as booking'));
  });

  it("6. syncAppointmentToSquare delete cancels booking + updates sync map", async () => {
    const { mockClient, queryResponses } = createMockClient();
    const pool = createMockPool(mockClient);

    // getTokensWithRefresh
    queryResponses.push({ rows: [makeIntegrationSettings()] });

    // check appointment sync map — existing
    queryResponses.push({ rows: [{ external_id: SQUARE_BOOKING_ID }] });

    // UPDATE sync map status to deleted
    queryResponses.push({ rows: [] });

    vi.mocked(square.cancelBooking).mockResolvedValueOnce({
      booking: { id: SQUARE_BOOKING_ID, status: 'CANCELLED_BY_SELLER' },
    });

    await syncAppointmentToSquare(pool, TENANT_ID, APPOINTMENT_ID, 'delete', silentLogger);

    expect(square.cancelBooking).toHaveBeenCalledOnce();
    expect(square.cancelBooking).toHaveBeenCalledWith('valid-access-token', SQUARE_BOOKING_ID);
    expect(silentLogger.info).toHaveBeenCalledWith(expect.stringContaining('sync map entry updated (canceled)'));
    expect(mockClient.release).toHaveBeenCalled();
  });
});

// =============================================
// HAPPY PATHS — PULL
// =============================================

describe("Square Sync — Pull Happy Paths", () => {
  it("7. pullSquareCustomer creates new local customer", async () => {
    const { mockClient, queryResponses } = createMockClient();
    const pool = createMockPool(mockClient);

    // check sync map — no existing mapping
    queryResponses.push({ rows: [] });

    // check existing customer by phone — none
    queryResponses.push({ rows: [] });

    // INSERT new customer — return new ID
    queryResponses.push({ rows: [{ id: 'new-local-id' }] });

    // INSERT sync map
    queryResponses.push({ rows: [] });

    await pullSquareCustomer(pool, TENANT_ID, makeSquareCustomerData(), silentLogger);

    expect(silentLogger.info).toHaveBeenCalledWith(expect.stringContaining('created local customer from Square customer'));
    expect(mockClient.release).toHaveBeenCalled();

    // Verify the INSERT customers query
    const insertCall = mockClient.query.mock.calls[2];
    expect(insertCall[0]).toContain('INSERT INTO customers');
    expect(insertCall[1]).toContain('Jane Smith');
    expect(insertCall[1]).toContain('555-9999');
  });

  it("8. pullSquareCustomer merges when remote is newer", async () => {
    const { mockClient, queryResponses } = createMockClient();
    const pool = createMockPool(mockClient);

    // check sync map — no existing mapping
    queryResponses.push({ rows: [] });

    // check existing customer by phone — found, but older
    queryResponses.push({ rows: [{ id: 'existing-local-id', updated_at: '2026-03-10T10:00:00Z' }] });

    // UPDATE existing customer (remote newer)
    queryResponses.push({ rows: [] });

    // INSERT sync map
    queryResponses.push({ rows: [] });

    const customerData = makeSquareCustomerData({ updated_at: '2026-03-25T14:00:00Z' });

    await pullSquareCustomer(pool, TENANT_ID, customerData, silentLogger);

    expect(silentLogger.info).toHaveBeenCalledWith(expect.stringContaining('merged Square customer into existing customer'));
    expect(silentLogger.info).toHaveBeenCalledWith(expect.stringContaining('remote was newer'));

    // Verify UPDATE was issued
    const updateCall = mockClient.query.mock.calls[2];
    expect(updateCall[0]).toContain('UPDATE customers');
  });

  it("9. pullSquareCustomer keeps local when local is newer", async () => {
    const { mockClient, queryResponses } = createMockClient();
    const pool = createMockPool(mockClient);

    // check sync map — no existing mapping
    queryResponses.push({ rows: [] });

    // check existing customer by phone — found, but newer than remote
    queryResponses.push({ rows: [{ id: 'existing-local-id', updated_at: '2026-03-28T10:00:00Z' }] });

    // INSERT sync map (still creates mapping even when keeping local)
    queryResponses.push({ rows: [] });

    const customerData = makeSquareCustomerData({ updated_at: '2026-03-25T14:00:00Z' });

    await pullSquareCustomer(pool, TENANT_ID, customerData, silentLogger);

    expect(silentLogger.info).toHaveBeenCalledWith(expect.stringContaining('local was newer'));
    // Should NOT have issued UPDATE — only 3 queries: sync map check, phone check, sync map insert
    expect(mockClient.query).toHaveBeenCalledTimes(3);
  });
});

// =============================================
// SAD PATHS
// =============================================

describe("Square Sync — Sad Paths", () => {
  it("10. Returns null when no settings", async () => {
    const { mockClient, queryResponses } = createMockClient();
    const pool = createMockPool(mockClient);

    // getTokensWithRefresh: no settings row
    queryResponses.push({ rows: [] });

    const result = await getTokensWithRefresh(pool, TENANT_ID, silentLogger);

    expect(result).toBeNull();
    expect(mockClient.release).toHaveBeenCalled();
  });

  it("11. Returns null when inactive", async () => {
    const { mockClient, queryResponses } = createMockClient();
    const pool = createMockPool(mockClient);

    queryResponses.push({ rows: [makeIntegrationSettings({ is_active: false })] });

    const result = await getTokensWithRefresh(pool, TENANT_ID, silentLogger);

    expect(result).toBeNull();
    expect(silentLogger.warn).toHaveBeenCalledWith(expect.stringContaining('integration inactive'));
    expect(mockClient.release).toHaveBeenCalled();
  });

  it("12. Marks inactive on token refresh failure", async () => {
    const { mockClient, queryResponses } = createMockClient();
    const pool = createMockPool(mockClient);

    // Token is expired (forces refresh)
    queryResponses.push({
      rows: [makeIntegrationSettings({
        token_expires_at: new Date(Date.now() - 60 * 1000).toISOString(), // 1 min ago
      })],
    });

    // UPDATE to mark inactive
    queryResponses.push({ rows: [] });

    vi.mocked(square.refreshAccessToken).mockRejectedValueOnce(new Error('OAuth grant revoked'));

    const result = await getTokensWithRefresh(pool, TENANT_ID, silentLogger);

    expect(result).toBeNull();
    expect(silentLogger.error).toHaveBeenCalledWith(expect.stringContaining('token refresh FAILED'));
    expect(silentLogger.error).toHaveBeenCalledWith(expect.stringContaining('integration marked inactive'));

    // Should have issued UPDATE to set is_active = false
    const updateCall = mockClient.query.mock.calls[1];
    expect(updateCall[0]).toContain('is_active = false');
    expect(mockClient.release).toHaveBeenCalled();
  });

  it("13. Customer not found — skips push", async () => {
    const { mockClient, queryResponses } = createMockClient();
    const pool = createMockPool(mockClient);

    // getTokensWithRefresh
    queryResponses.push({ rows: [makeIntegrationSettings()] });

    // fetch local customer — not found
    queryResponses.push({ rows: [] });

    await syncCustomerToSquare(pool, TENANT_ID, CUSTOMER_ID, 'create', silentLogger);

    expect(square.createCustomer).not.toHaveBeenCalled();
    expect(silentLogger.warn).toHaveBeenCalledWith(expect.stringContaining('customer not found in DB'));
    expect(mockClient.release).toHaveBeenCalled();
  });

  it("14. pullSquareCustomer skips customer with no phone", async () => {
    const { mockClient } = createMockClient();
    const pool = createMockPool(mockClient);

    const customerData = makeSquareCustomerData({ phone_number: '' });

    await pullSquareCustomer(pool, TENANT_ID, customerData, silentLogger);

    expect(silentLogger.warn).toHaveBeenCalledWith(expect.stringContaining('no phone number'));
    expect(mockClient.release).toHaveBeenCalled();
  });

  it("15. pullSquareCustomer skips already-synced version", async () => {
    const { mockClient, queryResponses } = createMockClient();
    const pool = createMockPool(mockClient);

    const sameTimestamp = '2026-03-25T14:00:00Z';

    // check sync map — existing mapping with SAME remote timestamp
    queryResponses.push({
      rows: [{ local_id: 'existing-local-id', remote_updated_at: sameTimestamp }],
    });

    const customerData = makeSquareCustomerData({ updated_at: sameTimestamp });

    await pullSquareCustomer(pool, TENANT_ID, customerData, silentLogger);

    expect(silentLogger.info).toHaveBeenCalledWith(expect.stringContaining('already synced this version'));
    // Only 1 query: the sync map check
    expect(mockClient.query).toHaveBeenCalledTimes(1);
    expect(mockClient.release).toHaveBeenCalled();
  });

  it("16. Client always released on error", async () => {
    const { mockClient } = createMockClient();
    const pool = createMockPool(mockClient);

    // Make the first query throw
    mockClient.query.mockRejectedValueOnce(new Error('DB connection lost'));

    await expect(
      getTokensWithRefresh(pool, TENANT_ID, silentLogger)
    ).rejects.toThrow('DB connection lost');

    // Even after error, release must be called
    expect(mockClient.release).toHaveBeenCalled();
  });

  it("17. fullSync handles pagination errors gracefully", async () => {
    const { mockClient, queryResponses } = createMockClient();
    const pool = createMockPool(mockClient);

    // getTokensWithRefresh
    queryResponses.push({ rows: [makeIntegrationSettings()] });

    // UPDATE last_sync_at (at end of fullSync)
    queryResponses.push({ rows: [] });

    // listCustomers throws on first page
    vi.mocked(square.listCustomers).mockRejectedValueOnce(new Error('Square API 500'));

    // listBookings throws on first page
    vi.mocked(square.listBookings).mockRejectedValueOnce(new Error('Square API 500'));

    const result = await fullSync(pool, TENANT_ID, silentLogger);

    expect(result.customersSynced).toBe(0);
    expect(result.appointmentsSynced).toBe(0);
    expect(result.errors).toBe(0); // errors counter is for individual failures, not pagination
    expect(silentLogger.error).toHaveBeenCalledWith(expect.stringContaining('customer pagination failed'));
    // Should still update last_sync_at
    expect(mockClient.release).toHaveBeenCalled();
  });
});
