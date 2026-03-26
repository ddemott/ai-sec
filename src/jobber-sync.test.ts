import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock jobberClient before importing jobberSync
vi.mock('./services/jobberClient', () => ({
  refreshAccessToken: vi.fn(),
  graphql: vi.fn(),
  QUERIES: {
    createClient: 'mutation CreateClient($input: ClientCreateInput!) { ... }',
    updateClient: 'mutation UpdateClient($clientId: ID!, $input: ClientUpdateInput!) { ... }',
    createJob: 'mutation CreateJob($input: JobCreateInput!) { ... }',
    listClients: 'query ListClients($first: Int!, $after: String) { ... }',
    listVisits: 'query ListVisits($first: Int!, $after: String) { ... }',
  },
}));

import {
  getTokensWithRefresh,
  syncCustomerToJobber,
  syncAppointmentToJobber,
  pullJobberClient,
  pullJobberVisit,
  fullSync,
} from "./services/jobberSync";
import * as jobber from "./services/jobberClient";

// ---- Mock helpers ----

const TENANT_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const CUSTOMER_ID = '11111111-2222-3333-4444-555555555555';
const APPOINTMENT_ID = '22222222-3333-4444-5555-666666666666';
const JOBBER_CLIENT_ID = 'Z2lkOi8vSm9iYmVyL0NsaWVudC8xMjM=';
const JOBBER_VISIT_ID = 'Z2lkOi8vSm9iYmVyL1Zpc2l0LzQ1Ng==';
const JOBBER_JOB_ID = 'Z2lkOi8vSm9iYmVyL0pvYi83ODk=';
const RESOURCE_ID = 'res-0001';

function makeIntegrationSettings(overrides: Record<string, any> = {}) {
  return {
    access_token: 'valid-access-token',
    refresh_token: 'valid-refresh-token',
    token_expires_at: new Date(Date.now() + 3600 * 1000).toISOString(),
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
    metadata: null,
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
    customer_name: 'John Doe',
    customer_phone: '555-1234',
    resource_name: 'Bay 1',
    updated_at: '2026-03-20T10:00:00Z',
    ...overrides,
  };
}

function makeJobberClientData(overrides: Record<string, any> = {}): jobber.JobberClient {
  return {
    id: JOBBER_CLIENT_ID,
    firstName: 'Jane',
    lastName: 'Smith',
    companyName: null,
    isCompany: false,
    phones: [{ number: '555-9999', primary: true }],
    emails: [{ address: 'jane@example.com', primary: true }],
    billingAddress: { street1: '456 Oak Ave', city: 'Springfield', province: 'IL' },
    createdAt: '2026-03-15T08:00:00Z',
    updatedAt: '2026-03-25T14:00:00Z',
    ...overrides,
  };
}

function makeJobberVisitData(overrides: Record<string, any> = {}): jobber.JobberVisit {
  return {
    id: JOBBER_VISIT_ID,
    title: 'Tire Rotation',
    startAt: '2026-03-28T09:00:00Z',
    endAt: '2026-03-28T10:00:00Z',
    status: 'scheduled',
    completedAt: null,
    job: { id: JOBBER_JOB_ID, title: 'Tire Job', client: { id: JOBBER_CLIENT_ID } },
    assignedServiceMembers: { nodes: [] },
    createdAt: '2026-03-20T08:00:00Z',
    updatedAt: '2026-03-25T14:00:00Z',
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

describe("Jobber Sync — Push Happy Paths", () => {
  it("1. syncCustomerToJobber creates Jobber client + inserts sync map entry", async () => {
    const { mockClient, queryResponses } = createMockClient();
    const pool = createMockPool(mockClient);

    // getTokensWithRefresh: integration settings (token not expired)
    queryResponses.push({ rows: [makeIntegrationSettings()] });

    // syncCustomerToJobber: fetch local customer
    queryResponses.push({ rows: [makeCustomerRow()] });

    // syncCustomerToJobber: check sync map (empty — new)
    queryResponses.push({ rows: [] });

    // syncCustomerToJobber: INSERT sync map after create
    queryResponses.push({ rows: [] });

    // Mock Jobber graphql response for clientCreate
    vi.mocked(jobber.graphql).mockResolvedValueOnce({
      data: {
        clientCreate: {
          client: { id: JOBBER_CLIENT_ID, firstName: 'John', lastName: 'Doe', updatedAt: '2026-03-20T10:00:00Z' },
          userErrors: [],
        },
      },
    });

    await syncCustomerToJobber(pool, TENANT_ID, CUSTOMER_ID, 'create', silentLogger);

    expect(jobber.graphql).toHaveBeenCalledOnce();
    expect(mockClient.release).toHaveBeenCalled();
    expect(silentLogger.info).toHaveBeenCalledWith(expect.stringContaining('customer pushed to Jobber'));

    // Verify the sync map INSERT was called with correct external_id
    const insertQuery = mockClient.query.mock.calls[3]; // 4th query (0-indexed)
    expect(insertQuery[0]).toContain('INSERT INTO entity_sync_map');
    expect(insertQuery[1]).toContain(JOBBER_CLIENT_ID);
  });

  it("2. syncCustomerToJobber updates existing Jobber client", async () => {
    const { mockClient, queryResponses } = createMockClient();
    const pool = createMockPool(mockClient);

    // getTokensWithRefresh: integration settings
    queryResponses.push({ rows: [makeIntegrationSettings()] });

    // fetch local customer
    queryResponses.push({ rows: [makeCustomerRow()] });

    // check sync map — existing mapping
    queryResponses.push({ rows: [{ external_id: JOBBER_CLIENT_ID, remote_updated_at: '2026-03-18T10:00:00Z' }] });

    // UPDATE sync map after update
    queryResponses.push({ rows: [] });

    vi.mocked(jobber.graphql).mockResolvedValueOnce({
      data: {
        clientUpdate: {
          client: { id: JOBBER_CLIENT_ID, updatedAt: '2026-03-20T12:00:00Z' },
          userErrors: [],
        },
      },
    });

    await syncCustomerToJobber(pool, TENANT_ID, CUSTOMER_ID, 'update', silentLogger);

    expect(jobber.graphql).toHaveBeenCalledOnce();
    // Should have used updateClient query
    expect(jobber.graphql).toHaveBeenCalledWith(
      'valid-access-token',
      jobber.QUERIES.updateClient,
      expect.objectContaining({ clientId: JOBBER_CLIENT_ID }),
    );
    expect(silentLogger.info).toHaveBeenCalledWith(expect.stringContaining('customer updated in Jobber'));
    expect(mockClient.release).toHaveBeenCalled();
  });

  it("3. syncCustomerToJobber delete removes sync map entry", async () => {
    const { mockClient, queryResponses } = createMockClient();
    const pool = createMockPool(mockClient);

    // getTokensWithRefresh
    queryResponses.push({ rows: [makeIntegrationSettings()] });

    // DELETE sync map
    queryResponses.push({ rows: [], rowCount: 1 });

    await syncCustomerToJobber(pool, TENANT_ID, CUSTOMER_ID, 'delete', silentLogger);

    // Should NOT call Jobber API at all
    expect(jobber.graphql).not.toHaveBeenCalled();
    expect(silentLogger.info).toHaveBeenCalledWith(expect.stringContaining('sync map entry removed'));
    expect(mockClient.release).toHaveBeenCalled();
  });

  it("4. syncAppointmentToJobber creates Jobber job+visit + inserts sync map", async () => {
    const { mockClient, queryResponses } = createMockClient();
    const pool = createMockPool(mockClient);

    // getTokensWithRefresh
    queryResponses.push({ rows: [makeIntegrationSettings()] });

    // fetch appointment with customer details
    queryResponses.push({ rows: [makeAppointmentRow()] });

    // check customer sync map — already synced
    queryResponses.push({ rows: [{ external_id: JOBBER_CLIENT_ID }] });

    // check appointment sync map — new
    queryResponses.push({ rows: [] });

    // INSERT sync map for appointment
    queryResponses.push({ rows: [] });

    vi.mocked(jobber.graphql).mockResolvedValueOnce({
      data: {
        jobCreate: {
          job: {
            id: JOBBER_JOB_ID,
            jobNumber: '42',
            title: 'Oil Change',
            visits: { nodes: [{ id: JOBBER_VISIT_ID, startAt: '2026-03-26T10:00:00Z', endAt: '2026-03-26T11:00:00Z' }] },
          },
          userErrors: [],
        },
      },
    });

    await syncAppointmentToJobber(pool, TENANT_ID, APPOINTMENT_ID, 'create', silentLogger);

    expect(jobber.graphql).toHaveBeenCalledOnce();
    expect(jobber.graphql).toHaveBeenCalledWith(
      'valid-access-token',
      jobber.QUERIES.createJob,
      expect.objectContaining({
        input: expect.objectContaining({ clientId: JOBBER_CLIENT_ID }),
      }),
    );
    expect(silentLogger.info).toHaveBeenCalledWith(expect.stringContaining('appointment pushed to Jobber as job'));
    expect(mockClient.release).toHaveBeenCalled();
  });

  it("5. syncAppointmentToJobber auto-pushes customer if not yet synced", async () => {
    // This test needs TWO pool.connect() calls: one for getTokensWithRefresh (inside
    // syncCustomerToJobber which is called recursively), and two for the main flows.
    // Since syncCustomerToJobber is called recursively, it goes through getTokensWithRefresh
    // again with its own pool.connect. We need to handle multiple connect calls.

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

    // --- Main syncAppointmentToJobber flow ---
    // 1. getTokensWithRefresh (for syncAppointmentToJobber)
    allResponses.push({ rows: [makeIntegrationSettings()] });

    // 2. fetch appointment
    allResponses.push({ rows: [makeAppointmentRow()] });

    // 3. check customer sync map — NOT synced yet
    allResponses.push({ rows: [] });

    // --- Recursive syncCustomerToJobber call ---
    // 4. getTokensWithRefresh (for syncCustomerToJobber)
    allResponses.push({ rows: [makeIntegrationSettings()] });

    // 5. fetch local customer
    allResponses.push({ rows: [makeCustomerRow()] });

    // 6. check customer sync map (empty — create)
    allResponses.push({ rows: [] });

    // 7. INSERT customer sync map
    allResponses.push({ rows: [] });

    // --- Back in syncAppointmentToJobber ---
    // 8. re-check customer sync map — NOW synced
    allResponses.push({ rows: [{ external_id: JOBBER_CLIENT_ID }] });

    // 9. check appointment sync map — new
    allResponses.push({ rows: [] });

    // 10. INSERT appointment sync map
    allResponses.push({ rows: [] });

    // First graphql call: clientCreate (from recursive syncCustomerToJobber)
    vi.mocked(jobber.graphql).mockResolvedValueOnce({
      data: {
        clientCreate: {
          client: { id: JOBBER_CLIENT_ID, firstName: 'John', lastName: 'Doe', updatedAt: '2026-03-20T10:00:00Z' },
          userErrors: [],
        },
      },
    });

    // Second graphql call: jobCreate
    vi.mocked(jobber.graphql).mockResolvedValueOnce({
      data: {
        jobCreate: {
          job: {
            id: JOBBER_JOB_ID,
            title: 'Oil Change',
            visits: { nodes: [{ id: JOBBER_VISIT_ID }] },
          },
          userErrors: [],
        },
      },
    });

    await syncAppointmentToJobber(pool, TENANT_ID, APPOINTMENT_ID, 'create', silentLogger);

    // Should have called graphql twice: once for customer, once for job
    expect(jobber.graphql).toHaveBeenCalledTimes(2);
    expect(silentLogger.info).toHaveBeenCalledWith(expect.stringContaining('customer pushed to Jobber'));
    expect(silentLogger.info).toHaveBeenCalledWith(expect.stringContaining('appointment pushed to Jobber as job'));
  });
});

// =============================================
// HAPPY PATHS — PULL
// =============================================

describe("Jobber Sync — Pull Happy Paths", () => {
  it("6. pullJobberClient creates new local customer from Jobber data", async () => {
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

    await pullJobberClient(pool, TENANT_ID, makeJobberClientData(), silentLogger);

    expect(silentLogger.info).toHaveBeenCalledWith(expect.stringContaining('created local customer from Jobber client'));
    expect(mockClient.release).toHaveBeenCalled();

    // Verify the INSERT customers query
    const insertCall = mockClient.query.mock.calls[2];
    expect(insertCall[0]).toContain('INSERT INTO customers');
    expect(insertCall[1]).toContain('Jane Smith');
    expect(insertCall[1]).toContain('555-9999');
  });

  it("7. pullJobberClient matches existing customer by phone, merges (remote newer)", async () => {
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

    const jobberData = makeJobberClientData({ updatedAt: '2026-03-25T14:00:00Z' });

    await pullJobberClient(pool, TENANT_ID, jobberData, silentLogger);

    expect(silentLogger.info).toHaveBeenCalledWith(expect.stringContaining('merged Jobber client into existing customer'));
    expect(silentLogger.info).toHaveBeenCalledWith(expect.stringContaining('remote was newer'));

    // Verify UPDATE was issued
    const updateCall = mockClient.query.mock.calls[2];
    expect(updateCall[0]).toContain('UPDATE customers');
  });

  it("8. pullJobberClient matches existing customer by phone, keeps local (local newer)", async () => {
    const { mockClient, queryResponses } = createMockClient();
    const pool = createMockPool(mockClient);

    // check sync map — no existing mapping
    queryResponses.push({ rows: [] });

    // check existing customer by phone — found, but newer than remote
    queryResponses.push({ rows: [{ id: 'existing-local-id', updated_at: '2026-03-28T10:00:00Z' }] });

    // INSERT sync map (still creates mapping even when keeping local)
    queryResponses.push({ rows: [] });

    const jobberData = makeJobberClientData({ updatedAt: '2026-03-25T14:00:00Z' });

    await pullJobberClient(pool, TENANT_ID, jobberData, silentLogger);

    expect(silentLogger.info).toHaveBeenCalledWith(expect.stringContaining('local was newer, kept local values'));
    // Should NOT have issued UPDATE
    expect(mockClient.query.mock.calls.length).toBe(3); // sync map check, phone check, sync map insert
  });

  it("9. pullJobberClient updates existing synced customer (remote newer)", async () => {
    const { mockClient, queryResponses } = createMockClient();
    const pool = createMockPool(mockClient);

    // check sync map — existing mapping with older remote timestamp
    queryResponses.push({
      rows: [{ local_id: 'existing-local-id', remote_updated_at: '2026-03-20T10:00:00Z' }],
    });

    // fetch local customer updated_at
    queryResponses.push({ rows: [{ updated_at: '2026-03-22T10:00:00Z' }] });

    // UPDATE local customer
    queryResponses.push({ rows: [] });

    // UPDATE sync map
    queryResponses.push({ rows: [] });

    const jobberData = makeJobberClientData({ updatedAt: '2026-03-25T14:00:00Z' });

    await pullJobberClient(pool, TENANT_ID, jobberData, silentLogger);

    expect(silentLogger.info).toHaveBeenCalledWith(expect.stringContaining('updated local customer from Jobber'));
    expect(silentLogger.info).toHaveBeenCalledWith(expect.stringContaining('remote was newer'));
  });

  it("10. pullJobberClient skips update (already synced this version)", async () => {
    const { mockClient, queryResponses } = createMockClient();
    const pool = createMockPool(mockClient);

    const sameTimestamp = '2026-03-25T14:00:00Z';

    // check sync map — existing mapping with SAME remote timestamp
    queryResponses.push({
      rows: [{ local_id: 'existing-local-id', remote_updated_at: sameTimestamp }],
    });

    const jobberData = makeJobberClientData({ updatedAt: sameTimestamp });

    await pullJobberClient(pool, TENANT_ID, jobberData, silentLogger);

    expect(silentLogger.info).toHaveBeenCalledWith(expect.stringContaining('already synced this version'));
    // Only 1 query: the sync map check
    expect(mockClient.query).toHaveBeenCalledTimes(1);
    expect(mockClient.release).toHaveBeenCalled();
  });
});

// =============================================
// SAD PATHS
// =============================================

describe("Jobber Sync — Sad Paths", () => {
  it("11. Returns silently when no integration settings exist", async () => {
    const { mockClient, queryResponses } = createMockClient();
    const pool = createMockPool(mockClient);

    // getTokensWithRefresh: no settings row
    queryResponses.push({ rows: [] });

    const result = await getTokensWithRefresh(pool, TENANT_ID, silentLogger);

    expect(result).toBeNull();
    expect(mockClient.release).toHaveBeenCalled();
  });

  it("12. Returns silently when integration is inactive", async () => {
    const { mockClient, queryResponses } = createMockClient();
    const pool = createMockPool(mockClient);

    queryResponses.push({ rows: [makeIntegrationSettings({ is_active: false })] });

    const result = await getTokensWithRefresh(pool, TENANT_ID, silentLogger);

    expect(result).toBeNull();
    expect(silentLogger.warn).toHaveBeenCalledWith(expect.stringContaining('integration inactive'));
    expect(mockClient.release).toHaveBeenCalled();
  });

  it("13. Returns silently when tokens are missing", async () => {
    const { mockClient, queryResponses } = createMockClient();
    const pool = createMockPool(mockClient);

    queryResponses.push({ rows: [makeIntegrationSettings({ access_token: null, refresh_token: null })] });

    const result = await getTokensWithRefresh(pool, TENANT_ID, silentLogger);

    expect(result).toBeNull();
    expect(silentLogger.warn).toHaveBeenCalledWith(expect.stringContaining('missing tokens'));
    expect(mockClient.release).toHaveBeenCalled();
  });

  it("14. Marks integration inactive when token refresh fails", async () => {
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

    vi.mocked(jobber.refreshAccessToken).mockRejectedValueOnce(new Error('OAuth grant revoked'));

    const result = await getTokensWithRefresh(pool, TENANT_ID, silentLogger);

    expect(result).toBeNull();
    expect(silentLogger.error).toHaveBeenCalledWith(expect.stringContaining('token refresh FAILED'));
    expect(silentLogger.error).toHaveBeenCalledWith(expect.stringContaining('integration marked inactive'));

    // Should have issued UPDATE to set is_active = false
    const updateCall = mockClient.query.mock.calls[1];
    expect(updateCall[0]).toContain('is_active = false');
    expect(mockClient.release).toHaveBeenCalled();
  });

  it("15. Customer not found in DB — skips push", async () => {
    const { mockClient, queryResponses } = createMockClient();
    const pool = createMockPool(mockClient);

    // getTokensWithRefresh
    queryResponses.push({ rows: [makeIntegrationSettings()] });

    // fetch local customer — not found
    queryResponses.push({ rows: [] });

    await syncCustomerToJobber(pool, TENANT_ID, CUSTOMER_ID, 'create', silentLogger);

    expect(jobber.graphql).not.toHaveBeenCalled();
    expect(silentLogger.warn).toHaveBeenCalledWith(expect.stringContaining('customer not found in DB'));
    expect(mockClient.release).toHaveBeenCalled();
  });

  it("16. Jobber clientCreate returns userErrors — logs error", async () => {
    const { mockClient, queryResponses } = createMockClient();
    const pool = createMockPool(mockClient);

    // getTokensWithRefresh
    queryResponses.push({ rows: [makeIntegrationSettings()] });

    // fetch local customer
    queryResponses.push({ rows: [makeCustomerRow()] });

    // check sync map — empty
    queryResponses.push({ rows: [] });

    vi.mocked(jobber.graphql).mockResolvedValueOnce({
      data: {
        clientCreate: {
          client: null,
          userErrors: [{ message: 'Phone number is invalid', path: ['input', 'phones'] }],
        },
      },
    });

    await syncCustomerToJobber(pool, TENANT_ID, CUSTOMER_ID, 'create', silentLogger);

    expect(silentLogger.error).toHaveBeenCalledWith(expect.stringContaining('Jobber clientCreate failed'));
    expect(silentLogger.error).toHaveBeenCalledWith(expect.stringContaining('Phone number is invalid'));
    expect(mockClient.release).toHaveBeenCalled();
  });

  it("17. pullJobberClient skips client with no phone number", async () => {
    const { mockClient } = createMockClient();
    const pool = createMockPool(mockClient);

    const jobberData = makeJobberClientData({ phones: [] });

    await pullJobberClient(pool, TENANT_ID, jobberData, silentLogger);

    expect(silentLogger.warn).toHaveBeenCalledWith(expect.stringContaining('no phone number'));
    expect(mockClient.release).toHaveBeenCalled();
  });

  it("18. pullJobberVisit skips visit with no associated client", async () => {
    const { mockClient } = createMockClient();
    const pool = createMockPool(mockClient);

    const visitData = makeJobberVisitData({ job: { id: JOBBER_JOB_ID, title: 'Job', client: null } });

    await pullJobberVisit(pool, TENANT_ID, visitData as any, silentLogger);

    expect(silentLogger.warn).toHaveBeenCalledWith(expect.stringContaining('no associated client'));
    expect(mockClient.release).toHaveBeenCalled();
  });

  it("19. pullJobberVisit skips when no local resources exist", async () => {
    const { mockClient, queryResponses } = createMockClient();
    const pool = createMockPool(mockClient);

    // customer sync map — found
    queryResponses.push({ rows: [{ local_id: 'local-cust-1' }] });

    // resources query — empty
    queryResponses.push({ rows: [] });

    await pullJobberVisit(pool, TENANT_ID, makeJobberVisitData(), silentLogger);

    expect(silentLogger.warn).toHaveBeenCalledWith(expect.stringContaining('no active resources'));
    expect(mockClient.release).toHaveBeenCalled();
  });

  it("20. Client always released (finally block) even when query throws", async () => {
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
});
