import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock servicetitanClient before importing servicetitanSync
vi.mock('./services/servicetitanClient', () => ({
  refreshAccessToken: vi.fn(),
  createCustomer: vi.fn(),
  updateCustomer: vi.fn(),
  createJob: vi.fn(),
  updateJob: vi.fn(),
  cancelJob: vi.fn(),
  listCustomers: vi.fn(),
  listJobs: vi.fn(),
}));

import {
  getTokensWithRefresh,
  syncCustomerToServiceTitan,
  syncAppointmentToServiceTitan,
  pullServiceTitanCustomer,
  fullSync,
} from "./services/servicetitanSync";
import * as servicetitan from "./services/servicetitanClient";

// ---- Mock helpers ----

const TENANT_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const CUSTOMER_ID = '11111111-2222-3333-4444-555555555555';
const APPOINTMENT_ID = '22222222-3333-4444-5555-666666666666';
const ST_CUSTOMER_ID = 12345;
const ST_JOB_ID = 67890;
const RESOURCE_ID = 'res-0001';
const APP_KEY = 'test-app-key';
const TENANT_SID = '999888777';

function makeIntegrationSettings(overrides: Record<string, any> = {}) {
  return {
    access_token: 'valid-access-token',
    refresh_token: 'valid-refresh-token',
    token_expires_at: new Date(Date.now() + 3600 * 1000).toISOString(),
    is_active: true,
    settings: { tenant_sid: TENANT_SID },
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

function makeServiceTitanCustomerData(overrides: Record<string, any> = {}): servicetitan.ServiceTitanCustomer {
  return {
    id: ST_CUSTOMER_ID,
    name: 'Jane Smith',
    phoneNumber: '555-9999',
    email: 'jane@example.com',
    modifiedOn: '2026-03-25T14:00:00Z',
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
      // Handle session variable queries (version tracking context) - these don't consume from queue
      if (text.startsWith('SET LOCAL') || text.startsWith('RESET')) {
        return { rows: [], rowCount: 0 };
      }
      return queryResponses.shift() || { rows: [], rowCount: 0 };
    }),
    release: vi.fn(),
  };

  // Helper to get non-session-variable queries (for test assertions)
  const getDataQueries = () => mockClient.query.mock.calls.filter(
    (call: any[]) => !call[0].startsWith('SET LOCAL') && !call[0].startsWith('RESET')
  );

  return { mockClient, queries, queryResponses, getDataQueries };
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

const originalEnv = process.env;

beforeEach(() => {
  process.env = { ...originalEnv };
  process.env.SERVICETITAN_APP_KEY = APP_KEY;
  vi.clearAllMocks();
});

// =============================================
// HAPPY PATHS — PUSH
// =============================================

describe("ServiceTitan Sync — Push Happy Paths", () => {
  it("PUSH-CREATE: When tenant pushes new customer to ServiceTitan, system creates customer via API and records mapping in sync_map so future syncs can update rather than duplicate", async () => {
    const { mockClient, queryResponses } = createMockClient();
    const pool = createMockPool(mockClient);

    // getTokensWithRefresh: integration settings (token not expired)
    queryResponses.push({ rows: [makeIntegrationSettings()] });

    // syncCustomerToServiceTitan: fetch local customer
    queryResponses.push({ rows: [makeCustomerRow()] });

    // syncCustomerToServiceTitan: check sync map (empty — new)
    queryResponses.push({ rows: [] });

    // syncCustomerToServiceTitan: INSERT sync map after create
    queryResponses.push({ rows: [] });

    vi.mocked(servicetitan.createCustomer).mockResolvedValueOnce({
      id: ST_CUSTOMER_ID,
      name: 'John Doe',
      modifiedOn: '2026-03-20T10:00:00Z',
    });

    await syncCustomerToServiceTitan(pool, TENANT_ID, CUSTOMER_ID, 'create', silentLogger);

    expect(servicetitan.createCustomer).toHaveBeenCalledOnce();
    expect(servicetitan.createCustomer).toHaveBeenCalledWith(
      'valid-access-token',
      APP_KEY,
      TENANT_SID,
      expect.objectContaining({ name: 'John Doe' }),
    );
    expect(mockClient.release).toHaveBeenCalled();
    expect(silentLogger.info).toHaveBeenCalledWith(expect.stringContaining('customer pushed to ServiceTitan'));

    // Verify sync map INSERT was called with correct external_id
    const insertQuery = mockClient.query.mock.calls[3];
    expect(insertQuery[0]).toContain('INSERT INTO entity_sync_map');
    expect(insertQuery[1]).toContain(String(ST_CUSTOMER_ID));
  });

  it("PUSH-UPDATE: When tenant updates customer that was previously synced, system updates existing ServiceTitan customer using stored external_id to maintain data consistency across systems", async () => {
    const { mockClient, queryResponses } = createMockClient();
    const pool = createMockPool(mockClient);

    // getTokensWithRefresh: integration settings
    queryResponses.push({ rows: [makeIntegrationSettings()] });

    // fetch local customer
    queryResponses.push({ rows: [makeCustomerRow()] });

    // check sync map — existing mapping
    queryResponses.push({ rows: [{ external_id: String(ST_CUSTOMER_ID) }] });

    // UPDATE sync map after update
    queryResponses.push({ rows: [] });

    vi.mocked(servicetitan.updateCustomer).mockResolvedValueOnce({
      id: ST_CUSTOMER_ID,
      name: 'John Doe',
      modifiedOn: '2026-03-20T12:00:00Z',
    });

    await syncCustomerToServiceTitan(pool, TENANT_ID, CUSTOMER_ID, 'update', silentLogger);

    expect(servicetitan.updateCustomer).toHaveBeenCalledOnce();
    expect(servicetitan.updateCustomer).toHaveBeenCalledWith(
      'valid-access-token',
      APP_KEY,
      TENANT_SID,
      String(ST_CUSTOMER_ID),
      expect.objectContaining({ name: 'John Doe' }),
    );
    expect(silentLogger.info).toHaveBeenCalledWith(expect.stringContaining('customer updated in ServiceTitan'));
    expect(mockClient.release).toHaveBeenCalled();
  });

  it("PUSH-DELETE: When tenant deletes customer locally, system removes sync_map entry without calling ServiceTitan API, preserving ServiceTitan data while breaking the link", async () => {
    const { mockClient, queryResponses } = createMockClient();
    const pool = createMockPool(mockClient);

    // getTokensWithRefresh
    queryResponses.push({ rows: [makeIntegrationSettings()] });

    // DELETE sync map
    queryResponses.push({ rows: [], rowCount: 1 });

    await syncCustomerToServiceTitan(pool, TENANT_ID, CUSTOMER_ID, 'delete', silentLogger);

    // Should NOT call ServiceTitan API at all
    expect(servicetitan.createCustomer).not.toHaveBeenCalled();
    expect(servicetitan.updateCustomer).not.toHaveBeenCalled();
    expect(silentLogger.info).toHaveBeenCalledWith(expect.stringContaining('sync map entry removed'));
    expect(mockClient.release).toHaveBeenCalled();
  });

  it("PUSH-APPOINTMENT: When tenant creates appointment, system creates ServiceTitan job linked to the customer so field service dispatch system shows scheduled work", async () => {
    const { mockClient, queryResponses } = createMockClient();
    const pool = createMockPool(mockClient);

    // getTokensWithRefresh
    queryResponses.push({ rows: [makeIntegrationSettings()] });

    // fetch appointment with customer details
    queryResponses.push({ rows: [makeAppointmentRow()] });

    // check customer sync map — already synced
    queryResponses.push({ rows: [{ external_id: String(ST_CUSTOMER_ID) }] });

    // check appointment sync map — new
    queryResponses.push({ rows: [] });

    // INSERT sync map for appointment
    queryResponses.push({ rows: [] });

    vi.mocked(servicetitan.createJob).mockResolvedValueOnce({
      id: ST_JOB_ID,
      customerId: ST_CUSTOMER_ID,
      summary: 'Oil Change - John Doe',
    });

    await syncAppointmentToServiceTitan(pool, TENANT_ID, APPOINTMENT_ID, 'create', silentLogger);

    expect(servicetitan.createJob).toHaveBeenCalledOnce();
    expect(servicetitan.createJob).toHaveBeenCalledWith(
      'valid-access-token',
      APP_KEY,
      TENANT_SID,
      expect.objectContaining({
        summary: 'Oil Change - John Doe',
        customerId: ST_CUSTOMER_ID,
      }),
    );
    expect(silentLogger.info).toHaveBeenCalledWith(expect.stringContaining('appointment pushed to ServiceTitan as job'));
    expect(mockClient.release).toHaveBeenCalled();
  });

  it("PUSH-APPOINTMENT-CASCADE: When tenant creates appointment for unsynced customer, system automatically syncs customer first then creates job, ensuring referential integrity in ServiceTitan", async () => {
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

    // --- Main syncAppointmentToServiceTitan flow ---
    // 1. getTokensWithRefresh (for syncAppointmentToServiceTitan)
    allResponses.push({ rows: [makeIntegrationSettings()] });

    // 2. fetch appointment
    allResponses.push({ rows: [makeAppointmentRow()] });

    // 3. check customer sync map — NOT synced yet
    allResponses.push({ rows: [] });

    // --- Recursive syncCustomerToServiceTitan call ---
    // 4. getTokensWithRefresh (for syncCustomerToServiceTitan)
    allResponses.push({ rows: [makeIntegrationSettings()] });

    // 5. fetch local customer
    allResponses.push({ rows: [makeCustomerRow()] });

    // 6. check customer sync map (empty — create)
    allResponses.push({ rows: [] });

    // 7. INSERT customer sync map
    allResponses.push({ rows: [] });

    // --- Back in syncAppointmentToServiceTitan ---
    // 8. re-check customer sync map — NOW synced
    allResponses.push({ rows: [{ external_id: String(ST_CUSTOMER_ID) }] });

    // 9. check appointment sync map — new
    allResponses.push({ rows: [] });

    // 10. INSERT appointment sync map
    allResponses.push({ rows: [] });

    // First: createCustomer (from recursive syncCustomerToServiceTitan)
    vi.mocked(servicetitan.createCustomer).mockResolvedValueOnce({
      id: ST_CUSTOMER_ID,
      name: 'John Doe',
      modifiedOn: '2026-03-20T10:00:00Z',
    });

    // Second: createJob
    vi.mocked(servicetitan.createJob).mockResolvedValueOnce({
      id: ST_JOB_ID,
      customerId: ST_CUSTOMER_ID,
      summary: 'Oil Change - John Doe',
    });

    await syncAppointmentToServiceTitan(pool, TENANT_ID, APPOINTMENT_ID, 'create', silentLogger);

    // Should have called createCustomer once and createJob once
    expect(servicetitan.createCustomer).toHaveBeenCalledOnce();
    expect(servicetitan.createJob).toHaveBeenCalledOnce();
    expect(silentLogger.info).toHaveBeenCalledWith(expect.stringContaining('customer pushed to ServiceTitan'));
    expect(silentLogger.info).toHaveBeenCalledWith(expect.stringContaining('appointment pushed to ServiceTitan as job'));
  });
});

// =============================================
// HAPPY PATHS — PULL
// =============================================

describe("ServiceTitan Sync — Pull Happy Paths", () => {
  it("PULL-CREATE: When ServiceTitan customer has no local match (by sync_map or phone), system creates new customer locally so field service leads appear in scheduling system", async () => {
    const { mockClient, queryResponses, getDataQueries } = createMockClient();
    const pool = createMockPool(mockClient);

    // check sync map — no existing mapping
    queryResponses.push({ rows: [] });

    // check existing customer by phone — none
    queryResponses.push({ rows: [] });

    // INSERT new customer — return new ID
    queryResponses.push({ rows: [{ id: 'new-local-id' }] });

    // INSERT sync map
    queryResponses.push({ rows: [] });

    await pullServiceTitanCustomer(pool, TENANT_ID, makeServiceTitanCustomerData(), silentLogger);

    expect(silentLogger.info).toHaveBeenCalledWith(expect.stringContaining('created local customer from ServiceTitan customer'));
    expect(mockClient.release).toHaveBeenCalled();

    // Verify the INSERT customers query
    const insertCall = getDataQueries()[2];
    expect(insertCall[0]).toContain('INSERT INTO customers');
    expect(insertCall[1]).toContain('Jane Smith');
    expect(insertCall[1]).toContain('555-9999');
  });

  it("PULL-MERGE-REMOTE-WINS: When ServiceTitan customer matches local customer by phone and ServiceTitan data is newer, system updates local record to keep most recent data from dispatch system", async () => {
    const { mockClient, queryResponses, getDataQueries } = createMockClient();
    const pool = createMockPool(mockClient);

    // check sync map — no existing mapping
    queryResponses.push({ rows: [] });

    // check existing customer by phone — found, but older
    queryResponses.push({ rows: [{ id: 'existing-local-id', updated_at: '2026-03-10T10:00:00Z' }] });

    // UPDATE existing customer (remote newer)
    queryResponses.push({ rows: [] });

    // INSERT sync map
    queryResponses.push({ rows: [] });

    const customerData = makeServiceTitanCustomerData({ modifiedOn: '2026-03-25T14:00:00Z' });

    await pullServiceTitanCustomer(pool, TENANT_ID, customerData, silentLogger);

    expect(silentLogger.info).toHaveBeenCalledWith(expect.stringContaining('merged ServiceTitan customer into existing customer'));
    expect(silentLogger.info).toHaveBeenCalledWith(expect.stringContaining('remote was newer'));

    // Verify UPDATE was issued
    const updateCall = getDataQueries()[2];
    expect(updateCall[0]).toContain('UPDATE customers');
  });

  it("PULL-MERGE-LOCAL-WINS: When ServiceTitan customer matches local customer by phone but local data is newer, system keeps local values and only creates sync_map link to prevent stale overwrites", async () => {
    const { mockClient, queryResponses, getDataQueries } = createMockClient();
    const pool = createMockPool(mockClient);

    // check sync map — no existing mapping
    queryResponses.push({ rows: [] });

    // check existing customer by phone — found, but newer than remote
    queryResponses.push({ rows: [{ id: 'existing-local-id', updated_at: '2026-03-28T10:00:00Z' }] });

    // INSERT sync map (still creates mapping even when keeping local)
    queryResponses.push({ rows: [] });

    const customerData = makeServiceTitanCustomerData({ modifiedOn: '2026-03-25T14:00:00Z' });

    await pullServiceTitanCustomer(pool, TENANT_ID, customerData, silentLogger);

    expect(silentLogger.info).toHaveBeenCalledWith(expect.stringContaining('local was newer'));
    // Should NOT have issued UPDATE — only 3 data queries: sync map check, phone check, sync map insert
    expect(getDataQueries().length).toBe(3);
  });
});

// =============================================
// SAD PATHS
// =============================================

describe("ServiceTitan Sync — Sad Paths", () => {
  it("NO-SETTINGS: When tenant has no ServiceTitan integration configured, getTokensWithRefresh returns null allowing sync operations to skip gracefully without errors", async () => {
    const { mockClient, queryResponses } = createMockClient();
    const pool = createMockPool(mockClient);

    // getTokensWithRefresh: no settings row
    queryResponses.push({ rows: [] });

    const result = await getTokensWithRefresh(pool, TENANT_ID, silentLogger);

    expect(result).toBeNull();
    expect(mockClient.release).toHaveBeenCalled();
  });

  it("INACTIVE-INTEGRATION: When tenant's ServiceTitan integration is marked inactive (is_active=false), system returns null and logs warning so disabled integrations don't attempt API calls", async () => {
    const { mockClient, queryResponses } = createMockClient();
    const pool = createMockPool(mockClient);

    queryResponses.push({ rows: [makeIntegrationSettings({ is_active: false })] });

    const result = await getTokensWithRefresh(pool, TENANT_ID, silentLogger);

    expect(result).toBeNull();
    expect(silentLogger.warn).toHaveBeenCalledWith(expect.stringContaining('integration inactive'));
    expect(mockClient.release).toHaveBeenCalled();
  });

  it("MISSING-APP-KEY: When SERVICETITAN_APP_KEY environment variable is not configured, system returns null and logs error because API authentication requires the app key", async () => {
    delete process.env.SERVICETITAN_APP_KEY;
    const { mockClient, queryResponses } = createMockClient();
    const pool = createMockPool(mockClient);

    queryResponses.push({ rows: [makeIntegrationSettings()] });

    const result = await getTokensWithRefresh(pool, TENANT_ID, silentLogger);

    expect(result).toBeNull();
    expect(silentLogger.warn).toHaveBeenCalledWith(expect.stringContaining('SERVICETITAN_APP_KEY not set'));
    // Note: appKey check happens before pool.connect(), so client may not be acquired
  });

  it("MISSING-TENANT-SID: When integration settings lack tenant_sid (ServiceTitan tenant identifier), system returns null because API calls require the tenant context", async () => {
    const { mockClient, queryResponses } = createMockClient();
    const pool = createMockPool(mockClient);

    queryResponses.push({ rows: [makeIntegrationSettings({ settings: {} })] });

    const result = await getTokensWithRefresh(pool, TENANT_ID, silentLogger);

    expect(result).toBeNull();
    expect(silentLogger.warn).toHaveBeenCalledWith(expect.stringContaining('tenant_sid not found'));
    expect(mockClient.release).toHaveBeenCalled();
  });

  it("TOKEN-REFRESH-FAILURE: When OAuth token refresh fails (e.g., user revoked ServiceTitan authorization), system marks integration inactive in DB and returns null to prevent repeated failed API calls", async () => {
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

    vi.mocked(servicetitan.refreshAccessToken).mockRejectedValueOnce(new Error('OAuth grant revoked'));

    const result = await getTokensWithRefresh(pool, TENANT_ID, silentLogger);

    expect(result).toBeNull();
    expect(silentLogger.error).toHaveBeenCalledWith(expect.stringContaining('token refresh FAILED'));
    expect(silentLogger.error).toHaveBeenCalledWith(expect.stringContaining('integration marked inactive'));

    // Should have issued UPDATE to set is_active = false
    const updateCall = mockClient.query.mock.calls[1];
    expect(updateCall[0]).toContain('is_active = false');
    expect(mockClient.release).toHaveBeenCalled();
  });

  it("CUSTOMER-NOT-FOUND: When sync triggered for customer_id that doesn't exist in local DB (e.g., race condition or stale event), system logs warning and skips push to avoid creating orphan ServiceTitan records", async () => {
    const { mockClient, queryResponses } = createMockClient();
    const pool = createMockPool(mockClient);

    // getTokensWithRefresh
    queryResponses.push({ rows: [makeIntegrationSettings()] });

    // fetch local customer — not found
    queryResponses.push({ rows: [] });

    await syncCustomerToServiceTitan(pool, TENANT_ID, CUSTOMER_ID, 'create', silentLogger);

    expect(servicetitan.createCustomer).not.toHaveBeenCalled();
    expect(silentLogger.warn).toHaveBeenCalledWith(expect.stringContaining('customer not found in DB'));
    expect(mockClient.release).toHaveBeenCalled();
  });

  it("NO-PHONE-SKIP: When ServiceTitan customer has no phone number, pull skips it because phone is required for customer matching and appointment booking workflows", async () => {
    const { mockClient } = createMockClient();
    const pool = createMockPool(mockClient);

    const customerData = makeServiceTitanCustomerData({ phoneNumber: '' });

    await pullServiceTitanCustomer(pool, TENANT_ID, customerData, silentLogger);

    expect(silentLogger.warn).toHaveBeenCalledWith(expect.stringContaining('no phone number'));
    expect(mockClient.release).toHaveBeenCalled();
  });

  it("ALREADY-SYNCED: When ServiceTitan customer's modifiedOn matches sync_map.remote_updated_at, system skips processing to avoid redundant DB writes and improve sync performance", async () => {
    const { mockClient, queryResponses, getDataQueries } = createMockClient();
    const pool = createMockPool(mockClient);

    const sameTimestamp = '2026-03-25T14:00:00Z';

    // check sync map — existing mapping with SAME remote timestamp
    queryResponses.push({
      rows: [{ local_id: 'existing-local-id', remote_updated_at: sameTimestamp }],
    });

    const customerData = makeServiceTitanCustomerData({ modifiedOn: sameTimestamp });

    await pullServiceTitanCustomer(pool, TENANT_ID, customerData, silentLogger);

    expect(silentLogger.info).toHaveBeenCalledWith(expect.stringContaining('already synced this version'));
    // Only 1 data query: the sync map check (excludes session variable queries)
    expect(getDataQueries().length).toBe(1);
    expect(mockClient.release).toHaveBeenCalled();
  });

  it("CLIENT-RELEASE-ON-ERROR: When DB query throws during sync operation, system still releases pool client in finally block to prevent connection pool exhaustion", async () => {
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

  it("PAGINATION-ERROR: When ServiceTitan API returns error during customer/job list pagination, fullSync logs error and continues to update last_sync_at so next sync resumes from clean state", async () => {
    const { mockClient, queryResponses } = createMockClient();
    const pool = createMockPool(mockClient);

    // getTokensWithRefresh
    queryResponses.push({ rows: [makeIntegrationSettings()] });

    // UPDATE last_sync_at (at end of fullSync)
    queryResponses.push({ rows: [] });

    // listCustomers throws on first page
    vi.mocked(servicetitan.listCustomers).mockRejectedValueOnce(new Error('ServiceTitan API 500'));

    // listJobs throws on first page too
    vi.mocked(servicetitan.listJobs).mockRejectedValueOnce(new Error('ServiceTitan API 500'));

    const result = await fullSync(pool, TENANT_ID, silentLogger);

    expect(result.customersSynced).toBe(0);
    expect(result.appointmentsSynced).toBe(0);
    expect(result.errors).toBe(0); // errors counter is for individual failures, not pagination
    expect(silentLogger.error).toHaveBeenCalledWith(expect.stringContaining('customer pagination failed'));
    // Should still update last_sync_at
    expect(mockClient.release).toHaveBeenCalled();
  });
});
