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
import type { ServiceTitanJob } from "./services/servicetitanClient";

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

import { createMockClient as createBaseMockClient, createMockPool } from './test-utils-mock';

// Wrap the shared mock client with a getDataQueries() helper that filters out
// session-variable queries (vi-mock-calls shape, indexed positionally).
function createMockClient() {
  const base = createBaseMockClient();
  const getDataQueries = () =>
    (base.mockClient.query as unknown as { mock: { calls: [string, unknown[]?][] } }).mock.calls.filter(
      (call) => !call[0].startsWith('SET LOCAL') && !call[0].startsWith('RESET'),
    );
  return { ...base, getDataQueries };
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
    // WHO: syncCustomerToServiceTitan with action='create'
    // WHAT: Local customer exists, no entity_sync_map entry — triggers createCustomer REST API call with ST-App-Key auth
    // WHEN: Push sync after new customer created in dashboard or via voice AI booking
    // WHERE: services/servicetitanSync.ts → syncCustomerToServiceTitan() → servicetitanClient.createCustomer()
    // WHY: Without sync_map INSERT after create, next sync would duplicate the customer in ServiceTitan instead of updating
    const { mockClient, queryResponses } = createMockClient();
    const pool = createMockPool(mockClient);

    // getTokensWithRefresh: integration settings (token not expired)
    queryResponses.push({ rows: [makeIntegrationSettings()] });

    // syncCustomerToServiceTitan: check sync map FIRST (lock ordering: sync_map before customers)
    queryResponses.push({ rows: [] });

    // syncCustomerToServiceTitan: fetch local customer SECOND
    queryResponses.push({ rows: [makeCustomerRow()] });

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
    // WHO: syncCustomerToServiceTitan with action='update'
    // WHAT: Local customer updated, entity_sync_map has existing external_id — triggers updateCustomer REST API call
    // WHEN: Push sync after customer phone/email/name edited in dashboard
    // WHERE: services/servicetitanSync.ts → syncCustomerToServiceTitan() → servicetitanClient.updateCustomer()
    // WHY: Without using stored external_id from sync_map, system would create a duplicate customer in ServiceTitan instead of updating
    const { mockClient, queryResponses } = createMockClient();
    const pool = createMockPool(mockClient);

    // getTokensWithRefresh: integration settings
    queryResponses.push({ rows: [makeIntegrationSettings()] });

    // check sync map FIRST — existing mapping (lock ordering: sync_map before customers)
    queryResponses.push({ rows: [{ external_id: String(ST_CUSTOMER_ID) }] });

    // fetch local customer SECOND
    queryResponses.push({ rows: [makeCustomerRow()] });

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
    // WHO: syncCustomerToServiceTitan with action='delete'
    // WHAT: Local customer soft-deleted, sync_map entry exists — only removes mapping, no ServiceTitan API call
    // WHEN: Push sync after customer deleted from dashboard
    // WHERE: services/servicetitanSync.ts → syncCustomerToServiceTitan() → DELETE FROM entity_sync_map
    // WHY: Calling ServiceTitan's delete API would destroy dispatch history (jobs, invoices) that the service team still needs
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
    // WHO: syncAppointmentToServiceTitan with action='create'
    // WHAT: Local appointment with synced customer — triggers createJob REST API call with customerId from sync_map
    // WHEN: Push sync after appointment booked via dashboard or voice AI
    // WHERE: services/servicetitanSync.ts → syncAppointmentToServiceTitan() → servicetitanClient.createJob()
    // WHY: Without linking job to correct customerId, ServiceTitan dispatch board would show orphan jobs with no customer context
    const { mockClient, queryResponses } = createMockClient();
    const pool = createMockPool(mockClient);

    // getTokensWithRefresh
    queryResponses.push({ rows: [makeIntegrationSettings()] });

    // check appointment sync map FIRST — new (lock ordering: sync_map before appointments)
    queryResponses.push({ rows: [] });

    // fetch appointment with customer details SECOND
    queryResponses.push({ rows: [makeAppointmentRow()] });

    // check customer sync map — already synced
    queryResponses.push({ rows: [{ external_id: String(ST_CUSTOMER_ID) }] });

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
    // WHO: syncAppointmentToServiceTitan calling syncCustomerToServiceTitan recursively
    // WHAT: Appointment's customer has no sync_map entry — system auto-syncs customer before creating job
    // WHEN: Push sync when voice AI books appointment for a brand-new caller (customer created moments before)
    // WHERE: services/servicetitanSync.ts → syncAppointmentToServiceTitan() → syncCustomerToServiceTitan() → createCustomer + createJob
    // WHY: Without cascade sync, createJob would fail with invalid customerId — ServiceTitan requires valid customer reference for jobs
    const queries: MockQuery[] = [];
    const allResponses: Array<{ rows: unknown[]; rowCount?: number }> = [];

    const mockClient = {
      query: vi.fn(async (text: string, params?: unknown[]) => {
        queries.push({ text, params: params || [] });
        return allResponses.shift() || { rows: [], rowCount: 0 };
      }),
      release: vi.fn(),
    };

    const pool = createMockPool(mockClient);

    // --- Main syncAppointmentToServiceTitan flow ---
    // 1. getTokensWithRefresh (for syncAppointmentToServiceTitan)
    allResponses.push({ rows: [makeIntegrationSettings()] });

    // 2. check appt sync map FIRST (lock ordering: sync_map before appointments)
    allResponses.push({ rows: [] });

    // 3. fetch appointment SECOND
    allResponses.push({ rows: [makeAppointmentRow()] });

    // 4. check customer sync map — NOT synced yet
    allResponses.push({ rows: [] });

    // --- Recursive syncCustomerToServiceTitan call ---
    // 5. getTokensWithRefresh (for syncCustomerToServiceTitan)
    allResponses.push({ rows: [makeIntegrationSettings()] });

    // 6. check customer sync map FIRST (lock ordering in recursive call)
    allResponses.push({ rows: [] });

    // 7. fetch local customer SECOND
    allResponses.push({ rows: [makeCustomerRow()] });

    // 8. INSERT customer sync map
    allResponses.push({ rows: [] });

    // --- Back in syncAppointmentToServiceTitan ---
    // 9. re-check customer sync map — NOW synced
    allResponses.push({ rows: [{ external_id: String(ST_CUSTOMER_ID) }] });

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
    // WHO: pullServiceTitanCustomer processing a new ServiceTitan customer
    // WHAT: No entity_sync_map match AND no customers row matching phone — triggers INSERT INTO customers + sync_map
    // WHEN: Pull sync during fullSync when ServiceTitan customer was created by dispatch team outside SecretaryHQ
    // WHERE: services/servicetitanSync.ts → pullServiceTitanCustomer() → INSERT INTO customers, INSERT INTO entity_sync_map
    // WHY: Without creating local customer, voice AI wouldn't recognize returning callers who were added through ServiceTitan dispatch
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

    expect(silentLogger.info).toHaveBeenCalledWith(expect.stringContaining('created local customer from servicetitan customer'));
    expect(mockClient.release).toHaveBeenCalled();

    // Verify the INSERT customers query
    const insertCall = getDataQueries()[2];
    expect(insertCall[0]).toContain('INSERT INTO customers');
    expect(insertCall[1]).toContain('Jane Smith');
    expect(insertCall[1]).toContain('555-9999');
  });

  it("PULL-MERGE-REMOTE-WINS: When ServiceTitan customer matches local customer by phone and ServiceTitan data is newer, system updates local record to keep most recent data from dispatch system", async () => {
    // WHO: pullServiceTitanCustomer merging with existing local customer
    // WHAT: Phone match found, ServiceTitan modifiedOn (2026-03-25) > local updated_at (2026-03-10) — remote wins timestamp merge
    // WHEN: Pull sync when dispatch tech updated customer address in ServiceTitan after original booking
    // WHERE: services/servicetitanSync.ts → pullServiceTitanCustomer() → UPDATE customers SET name, phone, email
    // WHY: Without timestamp comparison, stale local data would persist and customer would receive service calls at wrong address
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

    expect(silentLogger.info).toHaveBeenCalledWith(expect.stringContaining('merged servicetitan customer into existing customer'));
    expect(silentLogger.info).toHaveBeenCalledWith(expect.stringContaining('remote was newer'));

    // Verify UPDATE was issued
    const updateCall = getDataQueries()[2];
    expect(updateCall[0]).toContain('UPDATE customers');
  });

  it("PULL-MERGE-LOCAL-WINS: When ServiceTitan customer matches local customer by phone but local data is newer, system keeps local values and only creates sync_map link to prevent stale overwrites", async () => {
    // WHO: pullServiceTitanCustomer merging with existing local customer where local is newer
    // WHAT: Phone match found, local updated_at (2026-03-28) > ServiceTitan modifiedOn (2026-03-25) — local wins, no UPDATE issued
    // WHEN: Pull sync when receptionist updated customer info via dashboard after ServiceTitan's last modification
    // WHERE: services/servicetitanSync.ts → pullServiceTitanCustomer() → INSERT INTO entity_sync_map (skip UPDATE)
    // WHY: Without this guard, a stale ServiceTitan record would overwrite the receptionist's recent corrections, corrupting name/phone/email fields
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
    // WHO: getTokensWithRefresh for a tenant without ServiceTitan integration
    // WHAT: tenant_integration_settings query returns 0 rows — function returns null
    // WHEN: Push/pull sync triggered for tenant that never connected ServiceTitan OAuth
    // WHERE: services/servicetitanSync.ts → getTokensWithRefresh() → SELECT FROM tenant_integration_settings
    // WHY: Without null return, downstream sync functions would crash on undefined access_token, causing unhandled promise rejections
    const { mockClient, queryResponses } = createMockClient();
    const pool = createMockPool(mockClient);

    // getTokensWithRefresh: no settings row
    queryResponses.push({ rows: [] });

    const result = await getTokensWithRefresh(pool, TENANT_ID, silentLogger);

    expect(result).toBeNull();
    expect(mockClient.release).toHaveBeenCalled();
  });

  it("INACTIVE-INTEGRATION: When tenant's ServiceTitan integration is marked inactive (is_active=false), system returns null and logs warning so disabled integrations don't attempt API calls", async () => {
    // WHO: getTokensWithRefresh for a tenant with disabled ServiceTitan integration
    // WHAT: tenant_integration_settings.is_active = false — function returns null with warning log
    // WHEN: Sync triggered after admin disabled integration (or after token refresh failure auto-disabled it)
    // WHERE: services/servicetitanSync.ts → getTokensWithRefresh() → is_active check
    // WHY: Without this guard, system would send API calls with potentially revoked tokens, causing 401 errors and wasted API quota
    const { mockClient, queryResponses } = createMockClient();
    const pool = createMockPool(mockClient);

    queryResponses.push({ rows: [makeIntegrationSettings({ is_active: false })] });

    const result = await getTokensWithRefresh(pool, TENANT_ID, silentLogger);

    expect(result).toBeNull();
    expect(silentLogger.warn).toHaveBeenCalledWith(expect.stringContaining('integration inactive'));
    expect(mockClient.release).toHaveBeenCalled();
  });

  it("MISSING-APP-KEY: When SERVICETITAN_APP_KEY environment variable is not configured, system returns null and logs error because API authentication requires the app key", async () => {
    // WHO: getTokensWithRefresh when SERVICETITAN_APP_KEY env var is missing
    // WHAT: process.env.SERVICETITAN_APP_KEY is undefined — function returns null with warning log
    // WHEN: Deployment misconfiguration where env var was not set in Railway or local .env
    // WHERE: services/servicetitanSync.ts → getTokensWithRefresh() → SERVICETITAN_APP_KEY check
    // WHY: Without app key, all ServiceTitan API calls would fail with 403 — ST-App-Key header is required for every request
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
    // WHO: getTokensWithRefresh when integration settings.tenant_sid is missing
    // WHAT: tenant_integration_settings.settings is empty object {} — no tenant_sid field, returns null
    // WHEN: Integration created via OAuth but tenant_sid was not captured during callback (incomplete setup)
    // WHERE: services/servicetitanSync.ts → getTokensWithRefresh() → settings.tenant_sid check
    // WHY: Without tenant_sid, all ServiceTitan REST API calls would use wrong URL path (/tenant/{sid}/...) and return 404
    const { mockClient, queryResponses } = createMockClient();
    const pool = createMockPool(mockClient);

    queryResponses.push({ rows: [makeIntegrationSettings({ settings: {} })] });

    const result = await getTokensWithRefresh(pool, TENANT_ID, silentLogger);

    expect(result).toBeNull();
    expect(silentLogger.warn).toHaveBeenCalledWith(expect.stringContaining('tenant_sid not found'));
    expect(mockClient.release).toHaveBeenCalled();
  });

  it("TOKEN-REFRESH-FAILURE: When OAuth token refresh fails (e.g., user revoked ServiceTitan authorization), system marks integration inactive in DB and returns null to prevent repeated failed API calls", async () => {
    // WHO: getTokensWithRefresh when token is expired and refresh fails
    // WHAT: token_expires_at is in the past, refreshAccessToken throws 'OAuth grant revoked' — marks is_active=false in DB
    // WHEN: Sync triggered after user revoked ServiceTitan OAuth access from their ST account settings
    // WHERE: services/servicetitanSync.ts → getTokensWithRefresh() → servicetitanClient.refreshAccessToken() → UPDATE SET is_active=false
    // WHY: Without auto-disabling, every subsequent sync attempt would retry the failed refresh, generating error logs and wasting API calls indefinitely
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
    // WHO: syncCustomerToServiceTitan when local customer was deleted between event dispatch and sync execution
    // WHAT: SELECT FROM customers returns 0 rows for the given customer_id — skip push, no API call
    // WHEN: Race condition where customer deleted while push sync event was queued (e.g., n8n webhook delay)
    // WHERE: services/servicetitanSync.ts → syncCustomerToServiceTitan() → SELECT FROM customers WHERE id = $1
    // WHY: Without this check, system would send empty/null fields to createCustomer, creating garbage records in ServiceTitan dispatch
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
    // WHO: pullServiceTitanCustomer receiving a customer with empty phoneNumber
    // WHAT: ServiceTitanCustomer.phoneNumber = '' — skip pull entirely, no DB queries issued
    // WHEN: Pull sync when ServiceTitan has commercial accounts with no phone (dispatch-only contacts)
    // WHERE: services/servicetitanSync.ts → pullServiceTitanCustomer() → phoneNumber empty check
    // WHY: Without phone, customer can't be matched to existing records (duplicate risk) and voice AI can't send SMS confirmations
    const { mockClient } = createMockClient();
    const pool = createMockPool(mockClient);

    const customerData = makeServiceTitanCustomerData({ phoneNumber: '' });

    await pullServiceTitanCustomer(pool, TENANT_ID, customerData, silentLogger);

    expect(silentLogger.warn).toHaveBeenCalledWith(expect.stringContaining('no phone number'));
    // No pool.connect() needed — shared helper returns early before acquiring a connection
  });

  it("ALREADY-SYNCED: When ServiceTitan customer's modifiedOn matches sync_map.remote_updated_at, system skips processing to avoid redundant DB writes and improve sync performance", async () => {
    // WHO: pullServiceTitanCustomer checking already-synced version
    // WHAT: sync_map.remote_updated_at matches ServiceTitan modifiedOn exactly — no DB queries beyond the sync_map check
    // WHEN: Pull sync during fullSync pagination when most records haven't changed since last sync
    // WHERE: services/servicetitanSync.ts → pullServiceTitanCustomer() → early return after entity_sync_map SELECT
    // WHY: Without this skip optimization, fullSync of thousands of ServiceTitan customers would issue unnecessary SELECT+UPDATE pairs
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
    // WHO: getTokensWithRefresh when database connection fails mid-query
    // WHAT: First query throws 'DB connection lost' — function re-throws but still calls client.release()
    // WHEN: Any sync operation when Postgres is temporarily unreachable (network blip, connection timeout)
    // WHERE: services/servicetitanSync.ts → getTokensWithRefresh() → finally { client.release() }
    // WHY: Without release in finally block, leaked pool connections would accumulate until pool exhaustion (max 2 connections), blocking all sync operations
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
    // WHO: fullSync when ServiceTitan API returns 500 during pagination
    // WHAT: listCustomers and listJobs both throw on first page — sync completes with 0 records but updates last_sync_at
    // WHEN: ServiceTitan API experiencing downtime during scheduled full sync
    // WHERE: services/servicetitanSync.ts → fullSync() → listCustomers/listJobs pagination → UPDATE last_sync_at
    // WHY: Without updating last_sync_at after partial failure, next sync would re-fetch all data from beginning of time instead of just the gap period
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

// =============================================
// PULL JOB — HAPPY + SAD PATHS
// =============================================

import { pullServiceTitanJob, syncAppointmentToServiceTitan as syncApptST } from "./services/servicetitanSync";

describe("ServiceTitan Sync — Pull Job", () => {
  it("PULL-JOB-CREATE: When ServiceTitan job has mapped customer, system creates local appointment with summary and scheduled date", async () => {
    // WHO: pullServiceTitanJob processing a new ServiceTitan job
    // WHAT: Customer mapped in sync_map → INSERT INTO appointments with summary, start_time, end_time (default 1hr), plus sync_map entry
    // WHEN: Pull sync during fullSync or webhook when dispatch created a new job
    // WHERE: services/servicetitanSync.ts → pullServiceTitanJob() → INSERT INTO appointments, INSERT INTO entity_sync_map
    // WHY: Without creating local appointment, dispatched field work would be invisible to receptionist and voice AI
    const { mockClient, queryResponses } = createMockClient();
    const pool = createMockPool(mockClient);

    // customer sync map
    queryResponses.push({ rows: [{ local_id: 'local-cust-1' }] });

    // job sync map — new
    queryResponses.push({ rows: [] });

    // INSERT appointment
    queryResponses.push({ rows: [{ id: 'new-appt-id' }] });

    // INSERT sync map
    queryResponses.push({ rows: [] });

    const jobData: servicetitan.ServiceTitanJob = {
      id: ST_JOB_ID,
      customerId: ST_CUSTOMER_ID,
      summary: 'Water Heater Repair',
      status: 'Scheduled',
      scheduledDate: '2026-03-28T09:00:00Z',
      modifiedOn: '2026-03-28T08:00:00Z',
    };

    await pullServiceTitanJob(pool, TENANT_ID, jobData, silentLogger);

    expect(silentLogger.info).toHaveBeenCalledWith(expect.stringContaining('created local appointment from ServiceTitan job'));
    expect(mockClient.release).toHaveBeenCalled();
  });

  it("PULL-JOB-CANCELED: When ServiceTitan job has status='Canceled', system creates appointment with 'canceled' status", async () => {
    // WHO: pullServiceTitanJob with a canceled job
    // WHAT: status='Canceled' → appointment.status='canceled'
    // WHEN: Dispatcher canceled the job in ServiceTitan
    // WHERE: services/servicetitanSync.ts → pullServiceTitanJob() → status mapping
    // WHY: Without mapping, canceled jobs would appear as active in booking calendar
    const { mockClient, queryResponses } = createMockClient();
    const pool = createMockPool(mockClient);

    queryResponses.push({ rows: [{ local_id: 'local-cust-1' }] }); // customer sync
    queryResponses.push({ rows: [] }); // job sync map — new
    queryResponses.push({ rows: [{ id: 'new-appt' }] }); // INSERT
    queryResponses.push({ rows: [] }); // INSERT sync map

    const jobData: servicetitan.ServiceTitanJob = {
      id: ST_JOB_ID,
      customerId: ST_CUSTOMER_ID,
      summary: 'Canceled Job',
      status: 'Canceled',
      scheduledDate: '2026-03-28T09:00:00Z',
      modifiedOn: '2026-03-28T08:00:00Z',
    };

    await pullServiceTitanJob(pool, TENANT_ID, jobData, silentLogger);

    const insertCall = mockClient.query.mock.calls.find(
      (c: unknown[]) => typeof c[0] === 'string' && c[0].includes('INSERT INTO appointments')
    );
    expect(insertCall![1]).toContain('canceled');
  });

  it("PULL-JOB-UPDATE: When already-synced ServiceTitan job has newer data, system updates local appointment description and status", async () => {
    // WHO: pullServiceTitanJob updating an existing mapped appointment
    // WHAT: sync_map entry exists with older timestamp → UPDATE appointments SET description, status
    // WHEN: Dispatcher updated job summary in ServiceTitan after initial sync
    // WHERE: services/servicetitanSync.ts → pullServiceTitanJob() → UPDATE appointments, UPDATE entity_sync_map
    // WHY: Without updating, receptionist would reference stale job description when speaking with caller
    const { mockClient, queryResponses } = createMockClient();
    const pool = createMockPool(mockClient);

    // customer sync map lookup (job has customerId)
    queryResponses.push({ rows: [{ local_id: 'local-cust-1' }] });

    // job sync map — existing with older timestamp
    queryResponses.push({ rows: [{ local_id: 'existing-appt', remote_updated_at: '2026-03-20T10:00:00Z' }] });

    // UPDATE appointment
    queryResponses.push({ rows: [] });

    // UPDATE sync map
    queryResponses.push({ rows: [] });

    const jobData: servicetitan.ServiceTitanJob = {
      id: ST_JOB_ID,
      customerId: ST_CUSTOMER_ID,
      summary: 'Updated Summary',
      status: 'Scheduled',
      modifiedOn: '2026-03-28T08:00:00Z',
    };

    await pullServiceTitanJob(pool, TENANT_ID, jobData, silentLogger);

    expect(silentLogger.info).toHaveBeenCalledWith(expect.stringContaining('updated local appointment from ServiceTitan job'));
  });

  it("PULL-JOB-NO-CUSTOMER: When ServiceTitan job has no mapped local customer, system skips because appointments need a customer reference", async () => {
    // WHO: pullServiceTitanJob when customer hasn't been synced yet
    // WHAT: No sync_map entry for customerId AND no customerId on job → skip
    // WHEN: Job webhook arrives before customer sync (out-of-order delivery)
    // WHERE: services/servicetitanSync.ts → pullServiceTitanJob() → localCustomerId null check
    // WHY: Appointments without customer_id break booking display and voice AI caller lookup
    const { mockClient, queryResponses } = createMockClient();
    const pool = createMockPool(mockClient);

    // customer sync map — not found
    queryResponses.push({ rows: [] });

    // job sync map — new
    queryResponses.push({ rows: [] });

    const jobData: servicetitan.ServiceTitanJob = {
      id: ST_JOB_ID,
      customerId: 99999,
      summary: 'Orphan Job',
      status: 'Scheduled',
      modifiedOn: '2026-03-28T08:00:00Z',
    };

    await pullServiceTitanJob(pool, TENANT_ID, jobData, silentLogger);

    expect(silentLogger.warn).toHaveBeenCalledWith(expect.stringContaining('no mapped local customer'));
  });

  it("PULL-JOB-SKIP-UNCHANGED: When job modifiedOn matches sync_map, system skips to avoid redundant writes", async () => {
    // WHO: pullServiceTitanJob with already-synced version
    // WHAT: sync_map.remote_updated_at matches → early return
    // WHEN: fullSync re-processes unchanged jobs
    // WHERE: services/servicetitanSync.ts → pullServiceTitanJob() → timestamp check
    // WHY: Prevents unnecessary DB load during large syncs
    const { mockClient, queryResponses } = createMockClient();
    const pool = createMockPool(mockClient);

    const ts = '2026-03-28T08:00:00Z';

    // job sync map — same timestamp
    queryResponses.push({ rows: [{ local_id: 'existing-appt', remote_updated_at: ts }] });

    const jobData: servicetitan.ServiceTitanJob = {
      id: ST_JOB_ID,
      modifiedOn: ts,
      status: 'Scheduled',
    };

    await pullServiceTitanJob(pool, TENANT_ID, jobData, silentLogger);

    expect(silentLogger.info).toHaveBeenCalledWith(expect.stringContaining('already synced this version'));
  });
});

// =============================================
// PUSH APPOINTMENT — DELETE + UPDATE
// =============================================

describe("ServiceTitan Sync — Push Appointment Delete/Update", () => {
  it("PUSH-APPOINTMENT-DELETE: When tenant deletes appointment, system cancels ServiceTitan job and updates sync_map to 'canceled'", async () => {
    // WHO: syncAppointmentToServiceTitan with action='delete'
    // WHAT: sync_map entry exists → cancelJob API call, sync_map status updated to 'canceled'
    // WHEN: Receptionist or voice AI cancels an appointment
    // WHERE: services/servicetitanSync.ts → syncAppointmentToServiceTitan() → cancelJob()
    // WHY: Without canceling in ServiceTitan, dispatch board would still show the job as active
    const { mockClient, queryResponses } = createMockClient();
    const pool = createMockPool(mockClient);

    // getTokensWithRefresh
    queryResponses.push({ rows: [makeIntegrationSettings()] });

    // check sync map — existing
    queryResponses.push({ rows: [{ external_id: String(ST_JOB_ID) }] });

    // UPDATE sync map status
    queryResponses.push({ rows: [] });

    vi.mocked(servicetitan.cancelJob).mockResolvedValueOnce({ id: 0, customerId: 0 } as ServiceTitanJob);

    await syncApptST(pool, TENANT_ID, APPOINTMENT_ID, 'delete', silentLogger);

    expect(servicetitan.cancelJob).toHaveBeenCalledWith(
      'valid-access-token', APP_KEY, TENANT_SID, String(ST_JOB_ID)
    );
    expect(silentLogger.info).toHaveBeenCalledWith(expect.stringContaining('sync map entry updated (canceled)'));
  });

  it("PUSH-APPOINTMENT-DELETE-GRACEFUL: When cancelJob API fails, system still updates sync_map and logs warning", async () => {
    // WHO: syncAppointmentToServiceTitan delete when API call fails
    // WHAT: cancelJob throws → warning logged, sync_map still updated to 'canceled'
    // WHEN: ServiceTitan API returns 500 during cancel
    // WHERE: services/servicetitanSync.ts → syncAppointmentToServiceTitan() → cancelJob catch
    // WHY: Without graceful handling, one API error would leave sync_map in stale state
    const { mockClient, queryResponses } = createMockClient();
    const pool = createMockPool(mockClient);

    queryResponses.push({ rows: [makeIntegrationSettings()] });
    queryResponses.push({ rows: [{ external_id: String(ST_JOB_ID) }] });
    queryResponses.push({ rows: [] }); // UPDATE sync map

    vi.mocked(servicetitan.cancelJob).mockRejectedValueOnce(new Error('API 500'));

    await syncApptST(pool, TENANT_ID, APPOINTMENT_ID, 'delete', silentLogger);

    expect(silentLogger.warn).toHaveBeenCalledWith(expect.stringContaining('failed to cancel job'));
    expect(silentLogger.info).toHaveBeenCalledWith(expect.stringContaining('sync map entry updated (canceled)'));
  });

  it("PUSH-APPOINTMENT-UPDATE: When tenant updates existing synced appointment, system updates ServiceTitan job with new schedule and status", async () => {
    // WHO: syncAppointmentToServiceTitan with action='update'
    // WHAT: sync_map entry exists → updateJob API call with updated summary and scheduledDate
    // WHEN: Receptionist rescheduled appointment in dashboard
    // WHERE: services/servicetitanSync.ts → syncAppointmentToServiceTitan() → updateJob()
    // WHY: Without pushing update, dispatch board would show stale schedule
    const { mockClient, queryResponses } = createMockClient();
    const pool = createMockPool(mockClient);

    queryResponses.push({ rows: [makeIntegrationSettings()] });

    // sync map — existing
    queryResponses.push({ rows: [{ external_id: String(ST_JOB_ID) }] });

    // fetch appointment
    queryResponses.push({ rows: [makeAppointmentRow()] });

    // customer sync map
    queryResponses.push({ rows: [{ external_id: String(ST_CUSTOMER_ID) }] });

    // UPDATE sync map
    queryResponses.push({ rows: [] });

    vi.mocked(servicetitan.updateJob).mockResolvedValueOnce({ id: 0, customerId: 0 } as ServiceTitanJob);

    await syncApptST(pool, TENANT_ID, APPOINTMENT_ID, 'update', silentLogger);

    expect(servicetitan.updateJob).toHaveBeenCalledOnce();
    expect(silentLogger.info).toHaveBeenCalledWith(expect.stringContaining('job updated in ServiceTitan'));
  });
});

// =============================================
// FULL SYNC WITH DATA
// =============================================

describe("ServiceTitan Sync — Full Sync with Data", () => {
  it("FULL-SYNC-WITH-DATA: When ServiceTitan API returns customers and jobs, system pulls them all and updates last_sync_at", async () => {
    // WHO: fullSync with active ServiceTitan integration
    // WHAT: Paginates customers (1 page) + jobs (1 page), pulls each, updates last_sync_at
    // WHEN: Scheduled nightly full sync
    // WHERE: services/servicetitanSync.ts → fullSync() → listCustomers/listJobs → pull functions
    // WHY: Ensures dispatch changes are reflected in scheduling system
    const { mockClient, queryResponses } = createMockClient();
    const pool = createMockPool(mockClient);

    // getTokensWithRefresh
    queryResponses.push({ rows: [makeIntegrationSettings()] });

    // pullServiceTitanCustomer: sync map, phone check, INSERT customer, INSERT sync map
    queryResponses.push({ rows: [] });
    queryResponses.push({ rows: [] });
    queryResponses.push({ rows: [{ id: 'new-local-1' }] });
    queryResponses.push({ rows: [] });

    // pullServiceTitanJob: customer sync, job sync map, INSERT appointment, INSERT sync map
    queryResponses.push({ rows: [{ local_id: 'new-local-1' }] });
    queryResponses.push({ rows: [] });
    queryResponses.push({ rows: [{ id: 'new-appt-1' }] });
    queryResponses.push({ rows: [] });

    // UPDATE last_sync_at
    queryResponses.push({ rows: [] });

    vi.mocked(servicetitan.listCustomers).mockResolvedValueOnce({
      data: [makeServiceTitanCustomerData()],
      hasMore: false,
    });

    vi.mocked(servicetitan.listJobs).mockResolvedValueOnce({
      data: [{
        id: ST_JOB_ID,
        customerId: ST_CUSTOMER_ID,
        summary: 'AC Repair',
        status: 'Scheduled',
        scheduledDate: '2026-03-28T09:00:00Z',
        modifiedOn: '2026-03-28T08:00:00Z',
      }],
      hasMore: false,
    });

    const result = await fullSync(pool, TENANT_ID, silentLogger);

    expect(result.customersSynced).toBe(1);
    expect(result.appointmentsSynced).toBe(1);
    expect(result.errors).toBe(0);
    expect(silentLogger.info).toHaveBeenCalledWith(expect.stringContaining('full sync complete'));
  });

  it("FULL-SYNC-EMPTY: When no tokens available, returns zero counts without making API calls", async () => {
    // WHO: fullSync for tenant without ServiceTitan
    // WHAT: getTokensWithRefresh returns null → early return
    // WHEN: fullSync cron fires for tenant that never connected ServiceTitan
    // WHERE: services/servicetitanSync.ts → fullSync() → null token check
    // WHY: Without early return, fullSync would NPE on tokens.accessToken
    const { mockClient, queryResponses } = createMockClient();
    const pool = createMockPool(mockClient);

    queryResponses.push({ rows: [] }); // no settings

    const result = await fullSync(pool, TENANT_ID, silentLogger);

    expect(result).toEqual({ customersSynced: 0, appointmentsSynced: 0, errors: 0 });
    expect(servicetitan.listCustomers).not.toHaveBeenCalled();
  });
});
