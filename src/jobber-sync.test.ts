import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock jobberClient before importing jobberSync
vi.mock('./services/crm/jobberClient', () => ({
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
} from './services/crm/jobberSync';
import * as jobber from './services/crm/jobberClient';

// ---- Mock helpers ----

const TENANT_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const CUSTOMER_ID = '11111111-2222-3333-4444-555555555555';
const APPOINTMENT_ID = '22222222-3333-4444-5555-666666666666';
const JOBBER_CLIENT_ID = 'Z2lkOi8vSm9iYmVyL0NsaWVudC8xMjM=';
const JOBBER_VISIT_ID = 'Z2lkOi8vSm9iYmVyL1Zpc2l0LzQ1Ng==';
const JOBBER_JOB_ID = 'Z2lkOi8vSm9iYmVyL0pvYi83ODk=';
const RESOURCE_ID = 'res-0001';

function makeIntegrationSettings(overrides: Record<string, unknown> = {}) {
  return {
    access_token: 'valid-access-token',
    refresh_token: 'valid-refresh-token',
    token_expires_at: new Date(Date.now() + 3600 * 1000).toISOString(),
    is_active: true,
    ...overrides,
  };
}

function makeCustomerRow(overrides: Record<string, unknown> = {}) {
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

function makeAppointmentRow(overrides: Record<string, unknown> = {}) {
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

function makeJobberClientData(overrides: Record<string, unknown> = {}): jobber.JobberClient {
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

function makeJobberVisitData(overrides: Record<string, unknown> = {}): jobber.JobberVisit {
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

import { createMockClient as createBaseMockClient, createMockPool } from './test-utils-mock';

// Wrap the shared mock client with a getDataQueries() helper that filters out
// session-variable queries. Test assertions index into mock.calls positionally
// (`getDataQueries()[2][0]` for SQL text), so we keep the vi-mock-calls shape
// rather than switching to the queries[].filter object shape.
function createMockClient() {
  const base = createBaseMockClient();
  const getDataQueries = () =>
    (
      base.mockClient.query as unknown as { mock: { calls: [string, unknown[]?][] } }
    ).mock.calls.filter((call) => !call[0].startsWith('SET LOCAL') && !call[0].startsWith('RESET'));
  return { ...base, getDataQueries };
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

describe('Jobber Sync — Push Happy Paths', () => {
  it('PUSH-CREATE: When tenant pushes new customer to Jobber, system creates client via GraphQL and records mapping in sync_map so future syncs can update rather than duplicate', async () => {
    // WHO: syncCustomerToJobber with action='create'
    // WHAT: Local customer exists, no entity_sync_map entry — triggers clientCreate GraphQL mutation
    // WHEN: Push sync after new customer created in dashboard or via voice AI booking
    // WHERE: services/jobberSync.ts → syncCustomerToJobber() → jobberClient.graphql(QUERIES.createClient)
    // WHY: Without sync_map INSERT after create, next sync would duplicate the customer in Jobber instead of updating
    const { mockClient, queryResponses } = createMockClient();
    const pool = createMockPool(mockClient);

    // getTokensWithRefresh: integration settings (token not expired)
    queryResponses.push({ rows: [makeIntegrationSettings()] });

    // syncCustomerToJobber: check sync map (empty — new) — read sync_map BEFORE customers (lock order)
    queryResponses.push({ rows: [] });

    // syncCustomerToJobber: fetch local customer
    queryResponses.push({ rows: [makeCustomerRow()] });

    // syncCustomerToJobber: INSERT sync map after create
    queryResponses.push({ rows: [] });

    // Mock Jobber graphql response for clientCreate
    vi.mocked(jobber.graphql).mockResolvedValueOnce({
      data: {
        clientCreate: {
          client: {
            id: JOBBER_CLIENT_ID,
            firstName: 'John',
            lastName: 'Doe',
            updatedAt: '2026-03-20T10:00:00Z',
          },
          userErrors: [],
        },
      },
    });

    await syncCustomerToJobber(pool, TENANT_ID, CUSTOMER_ID, 'create', silentLogger);

    expect(jobber.graphql).toHaveBeenCalledOnce();
    expect(mockClient.release).toHaveBeenCalled();
    expect(silentLogger.info).toHaveBeenCalledWith(
      expect.stringContaining('customer pushed to Jobber')
    );

    // Verify the sync map INSERT was called with correct external_id
    const insertQuery = mockClient.query.mock.calls[3]; // 4th query (0-indexed)
    expect(insertQuery[0]).toContain('INSERT INTO entity_sync_map');
    expect(insertQuery[1]).toContain(JOBBER_CLIENT_ID);
  });

  it('PUSH-UPDATE: When tenant updates customer that was previously synced, system updates existing Jobber client using stored external_id to maintain data consistency across systems', async () => {
    // WHO: syncCustomerToJobber with action='update'
    // WHAT: Local customer updated, entity_sync_map has existing external_id — triggers clientUpdate GraphQL mutation
    // WHEN: Push sync after customer phone/email/name edited in dashboard
    // WHERE: services/jobberSync.ts → syncCustomerToJobber() → jobberClient.graphql(QUERIES.updateClient)
    // WHY: Without using stored external_id from sync_map, system would create a duplicate client in Jobber instead of updating the existing one
    const { mockClient, queryResponses } = createMockClient();
    const pool = createMockPool(mockClient);

    // getTokensWithRefresh: integration settings
    queryResponses.push({ rows: [makeIntegrationSettings()] });

    // check sync map — existing mapping — read sync_map BEFORE customers (lock order)
    queryResponses.push({
      rows: [{ external_id: JOBBER_CLIENT_ID, remote_updated_at: '2026-03-18T10:00:00Z' }],
    });

    // fetch local customer
    queryResponses.push({ rows: [makeCustomerRow()] });

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
      expect.objectContaining({ clientId: JOBBER_CLIENT_ID })
    );
    expect(silentLogger.info).toHaveBeenCalledWith(
      expect.stringContaining('customer updated in Jobber')
    );
    expect(mockClient.release).toHaveBeenCalled();
  });

  it('PUSH-DELETE: When tenant deletes customer locally, system removes sync_map entry without calling Jobber API, preserving Jobber data while breaking the link', async () => {
    // WHO: syncCustomerToJobber with action='delete'
    // WHAT: Local customer soft-deleted, sync_map entry exists — only removes mapping, no Jobber API call
    // WHEN: Push sync after customer deleted from dashboard
    // WHERE: services/jobberSync.ts → syncCustomerToJobber() → DELETE FROM entity_sync_map
    // WHY: Calling Jobber's delete API would destroy client history (invoices, job records) that the field service team still needs
    const { mockClient, queryResponses } = createMockClient();
    const pool = createMockPool(mockClient);

    // getTokensWithRefresh
    queryResponses.push({ rows: [makeIntegrationSettings()] });

    // DELETE sync map
    queryResponses.push({ rows: [], rowCount: 1 });

    await syncCustomerToJobber(pool, TENANT_ID, CUSTOMER_ID, 'delete', silentLogger);

    // Should NOT call Jobber API at all
    expect(jobber.graphql).not.toHaveBeenCalled();
    expect(silentLogger.info).toHaveBeenCalledWith(
      expect.stringContaining('sync map entry removed')
    );
    expect(mockClient.release).toHaveBeenCalled();
  });

  it("PUSH-APPOINTMENT: When tenant creates appointment, system creates Jobber job with visit attached to the customer's client so field service team sees scheduled work", async () => {
    // WHO: syncAppointmentToJobber with action='create'
    // WHAT: Local appointment with synced customer — triggers jobCreate GraphQL mutation with clientId from sync_map
    // WHEN: Push sync after appointment booked via dashboard or voice AI
    // WHERE: services/jobberSync.ts → syncAppointmentToJobber() → jobberClient.graphql(QUERIES.createJob)
    // WHY: Without linking job to correct clientId, Jobber dispatch would show orphan jobs with no customer contact info
    const { mockClient, queryResponses } = createMockClient();
    const pool = createMockPool(mockClient);

    // getTokensWithRefresh
    queryResponses.push({ rows: [makeIntegrationSettings()] });

    // check appointment sync map — new — read sync_map BEFORE appointments (lock order)
    queryResponses.push({ rows: [] });

    // fetch appointment with customer details
    queryResponses.push({ rows: [makeAppointmentRow()] });

    // check customer sync map — already synced
    queryResponses.push({ rows: [{ external_id: JOBBER_CLIENT_ID }] });

    // INSERT sync map for appointment
    queryResponses.push({ rows: [] });

    vi.mocked(jobber.graphql).mockResolvedValueOnce({
      data: {
        jobCreate: {
          job: {
            id: JOBBER_JOB_ID,
            jobNumber: '42',
            title: 'Oil Change',
            visits: {
              nodes: [
                {
                  id: JOBBER_VISIT_ID,
                  startAt: '2026-03-26T10:00:00Z',
                  endAt: '2026-03-26T11:00:00Z',
                },
              ],
            },
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
      })
    );
    expect(silentLogger.info).toHaveBeenCalledWith(
      expect.stringContaining('appointment pushed to Jobber as job')
    );
    expect(mockClient.release).toHaveBeenCalled();
  });

  it('PUSH-APPOINTMENT-CASCADE: When tenant creates appointment for unsynced customer, system automatically syncs customer first then creates job, ensuring referential integrity in Jobber', async () => {
    // WHO: syncAppointmentToJobber calling syncCustomerToJobber recursively
    // WHAT: Appointment's customer has no sync_map entry — system auto-syncs customer before creating job
    // WHEN: Push sync when voice AI books appointment for a brand-new caller (customer created moments before)
    // WHERE: services/jobberSync.ts → syncAppointmentToJobber() → syncCustomerToJobber() → jobberClient.graphql
    // WHY: Without cascade sync, jobCreate would fail with invalid clientId or create orphan job — Jobber requires valid client reference
    // This test needs TWO pool.connect() calls: one for getTokensWithRefresh (inside
    // syncCustomerToJobber which is called recursively), and two for the main flows.
    // Since syncCustomerToJobber is called recursively, it goes through getTokensWithRefresh
    // again with its own pool.connect. We need to handle multiple connect calls.

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

    // --- Main syncAppointmentToJobber flow ---
    // 1. getTokensWithRefresh (for syncAppointmentToJobber)
    allResponses.push({ rows: [makeIntegrationSettings()] });

    // 2. check appointment sync map — new (read sync_map BEFORE appointments — lock order)
    allResponses.push({ rows: [] });

    // 3. fetch appointment
    allResponses.push({ rows: [makeAppointmentRow()] });

    // 4. check customer sync map — NOT synced yet
    allResponses.push({ rows: [] });

    // --- Recursive syncCustomerToJobber call ---
    // 5. getTokensWithRefresh (for syncCustomerToJobber)
    allResponses.push({ rows: [makeIntegrationSettings()] });

    // 6. check customer sync map (empty — create) — read sync_map BEFORE customers (lock order)
    allResponses.push({ rows: [] });

    // 7. fetch local customer
    allResponses.push({ rows: [makeCustomerRow()] });

    // 8. INSERT customer sync map
    allResponses.push({ rows: [] });

    // --- Back in syncAppointmentToJobber ---
    // 9. re-check customer sync map — NOW synced
    allResponses.push({ rows: [{ external_id: JOBBER_CLIENT_ID }] });

    // 10. INSERT appointment sync map
    allResponses.push({ rows: [] });

    // First graphql call: clientCreate (from recursive syncCustomerToJobber)
    vi.mocked(jobber.graphql).mockResolvedValueOnce({
      data: {
        clientCreate: {
          client: {
            id: JOBBER_CLIENT_ID,
            firstName: 'John',
            lastName: 'Doe',
            updatedAt: '2026-03-20T10:00:00Z',
          },
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
    expect(silentLogger.info).toHaveBeenCalledWith(
      expect.stringContaining('customer pushed to Jobber')
    );
    expect(silentLogger.info).toHaveBeenCalledWith(
      expect.stringContaining('appointment pushed to Jobber as job')
    );
  });
});

// =============================================
// HAPPY PATHS — PULL
// =============================================

describe('Jobber Sync — Pull Happy Paths', () => {
  it('PULL-CREATE: When Jobber client has no local match (by sync_map or phone), system creates new customer locally so field service leads appear in scheduling system', async () => {
    // WHO: pullJobberClient processing a new Jobber client
    // WHAT: No entity_sync_map match AND no customers row matching phone — triggers INSERT INTO customers + sync_map
    // WHEN: Pull sync during fullSync or webhook when Jobber client was created outside SecretaryHQ
    // WHERE: services/jobberSync.ts → pullJobberClient() → INSERT INTO customers, INSERT INTO entity_sync_map
    // WHY: Without creating local customer, appointments booked in Jobber would have no matching customer for voice AI to reference
    const { mockClient, queryResponses, getDataQueries } = createMockClient();
    const pool = createMockPool(mockClient);

    // check sync map — no existing mapping
    queryResponses.push({ rows: [] });

    // check existing customer by phone — none
    queryResponses.push({ rows: [] });

    // INSERT new customer — return new ID
    queryResponses.push({ rows: [{ customer_id: 'new-local-id' }] });

    // INSERT sync map
    queryResponses.push({ rows: [] });

    await pullJobberClient(pool, TENANT_ID, makeJobberClientData(), silentLogger);

    expect(silentLogger.info).toHaveBeenCalledWith(
      expect.stringContaining('created local customer from jobber customer')
    );
    expect(mockClient.release).toHaveBeenCalled();

    // Verify the INSERT customers query
    const insertCall = getDataQueries()[2];
    expect(insertCall[0]).toContain('INSERT INTO customers');
    expect(insertCall[1]).toContain('Jane Smith');
    expect(insertCall[1]).toContain('555-9999');
  });

  it('PULL-MERGE-REMOTE-WINS: When Jobber client matches local customer by phone and Jobber data is newer, system updates local record to keep most recent data from authoritative source', async () => {
    // WHO: pullJobberClient merging with existing local customer
    // WHAT: Phone match found, Jobber updatedAt (2026-03-25) > local updated_at (2026-03-10) — remote wins timestamp merge
    // WHEN: Pull sync when field tech updated customer address in Jobber after original booking
    // WHERE: services/jobberSync.ts → pullJobberClient() → UPDATE customers SET name, phone, email, address
    // WHY: Without timestamp comparison, stale local data would persist and customer would receive calls/SMS at old phone number
    const { mockClient, queryResponses, getDataQueries } = createMockClient();
    const pool = createMockPool(mockClient);

    // check sync map — no existing mapping
    queryResponses.push({ rows: [] });

    // check existing customer by phone — found, but older
    queryResponses.push({
      rows: [{ customer_id: 'existing-local-id', updated_at: '2026-03-10T10:00:00Z' }],
    });

    // UPDATE existing customer (remote newer)
    queryResponses.push({ rows: [] });

    // INSERT sync map
    queryResponses.push({ rows: [] });

    const jobberData = makeJobberClientData({ updatedAt: '2026-03-25T14:00:00Z' });

    await pullJobberClient(pool, TENANT_ID, jobberData, silentLogger);

    expect(silentLogger.info).toHaveBeenCalledWith(
      expect.stringContaining('merged jobber customer into existing customer')
    );
    expect(silentLogger.info).toHaveBeenCalledWith(expect.stringContaining('remote was newer'));

    // Verify UPDATE was issued
    const updateCall = getDataQueries()[2];
    expect(updateCall[0]).toContain('UPDATE customers');
  });

  it('PULL-MERGE-LOCAL-WINS: When Jobber client matches local customer by phone but local data is newer, system keeps local values and only creates sync_map link to prevent stale overwrites', async () => {
    // WHO: pullJobberClient merging with existing local customer where local is newer
    // WHAT: Phone match found, local updated_at (2026-03-28) > Jobber updatedAt (2026-03-25) — local wins, no UPDATE issued
    // WHEN: Pull sync when receptionist updated customer info via dashboard after Jobber's last sync
    // WHERE: services/jobberSync.ts → pullJobberClient() → INSERT INTO entity_sync_map (skip UPDATE)
    // WHY: Without this guard, a stale Jobber record would overwrite the receptionist's recent corrections, corrupting name/phone/email fields
    const { mockClient, queryResponses, getDataQueries } = createMockClient();
    const pool = createMockPool(mockClient);

    // check sync map — no existing mapping
    queryResponses.push({ rows: [] });

    // check existing customer by phone — found, but newer than remote
    queryResponses.push({
      rows: [{ customer_id: 'existing-local-id', updated_at: '2026-03-28T10:00:00Z' }],
    });

    // INSERT sync map (still creates mapping even when keeping local)
    queryResponses.push({ rows: [] });

    const jobberData = makeJobberClientData({ updatedAt: '2026-03-25T14:00:00Z' });

    await pullJobberClient(pool, TENANT_ID, jobberData, silentLogger);

    expect(silentLogger.info).toHaveBeenCalledWith(
      expect.stringContaining('local was newer, kept local values')
    );
    // Should NOT have issued UPDATE (only sync map check, phone check, sync map insert)
    expect(getDataQueries().length).toBe(3);
  });

  it('PULL-UPDATE-SYNCED: When already-synced Jobber client has newer data than local record, system updates local customer to reflect latest changes from field service system', async () => {
    // WHO: pullJobberClient updating an already-mapped customer
    // WHAT: sync_map entry exists with older remote_updated_at, Jobber updatedAt (2026-03-25) > local updated_at (2026-03-22) — UPDATE local
    // WHEN: Pull sync when field tech updated customer details in Jobber after initial sync
    // WHERE: services/jobberSync.ts → pullJobberClient() → UPDATE customers, UPDATE entity_sync_map.remote_updated_at
    // WHY: Without updating sync_map.remote_updated_at after merge, the same record would be re-processed every sync cycle, wasting DB writes
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

    expect(silentLogger.info).toHaveBeenCalledWith(
      expect.stringContaining('updated local customer from jobber')
    );
    expect(silentLogger.info).toHaveBeenCalledWith(expect.stringContaining('remote was newer'));
  });

  it("PULL-SKIP-UNCHANGED: When Jobber client's updatedAt matches sync_map.remote_updated_at, system skips processing to avoid redundant DB writes and improve sync performance", async () => {
    // WHO: pullJobberClient checking already-synced version
    // WHAT: sync_map.remote_updated_at matches Jobber updatedAt exactly — no DB queries beyond the sync_map check
    // WHEN: Pull sync during fullSync pagination when most records haven't changed since last sync
    // WHERE: services/jobberSync.ts → pullJobberClient() → early return after entity_sync_map SELECT
    // WHY: Without this skip optimization, fullSync of 10K+ Jobber clients would issue unnecessary SELECT+UPDATE pairs, causing DB load spikes
    const { mockClient, queryResponses, getDataQueries } = createMockClient();
    const pool = createMockPool(mockClient);

    const sameTimestamp = '2026-03-25T14:00:00Z';

    // check sync map — existing mapping with SAME remote timestamp
    queryResponses.push({
      rows: [{ local_id: 'existing-local-id', remote_updated_at: sameTimestamp }],
    });

    const jobberData = makeJobberClientData({ updatedAt: sameTimestamp });

    await pullJobberClient(pool, TENANT_ID, jobberData, silentLogger);

    expect(silentLogger.info).toHaveBeenCalledWith(
      expect.stringContaining('already synced this version')
    );
    // Only 1 data query: the sync map check (excludes session variable queries)
    expect(getDataQueries().length).toBe(1);
    expect(mockClient.release).toHaveBeenCalled();
  });
});

// =============================================
// SAD PATHS
// =============================================

describe('Jobber Sync — Sad Paths', () => {
  it('NO-SETTINGS: When tenant has no Jobber integration configured, getTokensWithRefresh returns null allowing sync operations to skip gracefully without errors', async () => {
    // WHO: getTokensWithRefresh for a tenant without Jobber integration
    // WHAT: tenant_integration_settings query returns 0 rows — function returns null
    // WHEN: Push/pull sync triggered for tenant that never connected Jobber OAuth
    // WHERE: services/jobberSync.ts → getTokensWithRefresh() → SELECT FROM tenant_integration_settings
    // WHY: Without null return, downstream sync functions would crash on undefined access_token, causing unhandled promise rejections
    const { mockClient, queryResponses } = createMockClient();
    const pool = createMockPool(mockClient);

    // getTokensWithRefresh: no settings row
    queryResponses.push({ rows: [] });

    const result = await getTokensWithRefresh(pool, TENANT_ID, silentLogger);

    expect(result).toBeNull();
    expect(mockClient.release).toHaveBeenCalled();
  });

  it("INACTIVE-INTEGRATION: When tenant's Jobber integration is marked inactive (is_active=false), system returns null and logs warning so disabled integrations don't attempt API calls", async () => {
    // WHO: getTokensWithRefresh for a tenant with disabled Jobber integration
    // WHAT: tenant_integration_settings.is_active = false — function returns null with warning log
    // WHEN: Sync triggered after admin disabled integration (or after token refresh failure auto-disabled it)
    // WHERE: services/jobberSync.ts → getTokensWithRefresh() → is_active check
    // WHY: Without this guard, system would send API calls with potentially revoked tokens, causing 401 errors and wasted API quota
    const { mockClient, queryResponses } = createMockClient();
    const pool = createMockPool(mockClient);

    queryResponses.push({ rows: [makeIntegrationSettings({ is_active: false })] });

    const result = await getTokensWithRefresh(pool, TENANT_ID, silentLogger);

    expect(result).toBeNull();
    expect(silentLogger.warn).toHaveBeenCalledWith(expect.stringContaining('integration inactive'));
    expect(mockClient.release).toHaveBeenCalled();
  });

  it("MISSING-TOKENS: When tenant's Jobber integration has null access/refresh tokens (incomplete OAuth), system returns null and logs warning to prevent API calls with invalid credentials", async () => {
    // WHO: getTokensWithRefresh for a tenant with incomplete OAuth flow
    // WHAT: tenant_integration_settings has is_active=true but access_token=null, refresh_token=null
    // WHEN: Sync triggered after OAuth started but callback never completed (user closed browser mid-flow)
    // WHERE: services/jobberSync.ts → getTokensWithRefresh() → null token check
    // WHY: Without this guard, graphql() would send Authorization: Bearer null header, causing cryptic Jobber 401 errors
    const { mockClient, queryResponses } = createMockClient();
    const pool = createMockPool(mockClient);

    queryResponses.push({
      rows: [makeIntegrationSettings({ access_token: null, refresh_token: null })],
    });

    const result = await getTokensWithRefresh(pool, TENANT_ID, silentLogger);

    expect(result).toBeNull();
    expect(silentLogger.warn).toHaveBeenCalledWith(expect.stringContaining('missing tokens'));
    expect(mockClient.release).toHaveBeenCalled();
  });

  it('TOKEN-REFRESH-FAILURE: When OAuth token refresh fails (e.g., user revoked access in Jobber), system marks integration inactive in DB and returns null to prevent repeated failed API calls', async () => {
    // WHO: getTokensWithRefresh when token is expired and refresh fails
    // WHAT: token_expires_at is in the past, refreshAccessToken throws 'OAuth grant revoked' — marks is_active=false in DB
    // WHEN: Sync triggered after user revoked Jobber OAuth access from their Jobber account settings
    // WHERE: services/jobberSync.ts → getTokensWithRefresh() → jobberClient.refreshAccessToken() → UPDATE tenant_integration_settings SET is_active=false
    // WHY: Without auto-disabling, every subsequent sync attempt would retry the failed refresh, generating error logs and wasting API calls indefinitely
    const { mockClient, queryResponses } = createMockClient();
    const pool = createMockPool(mockClient);

    // Token is expired (forces refresh)
    queryResponses.push({
      rows: [
        makeIntegrationSettings({
          token_expires_at: new Date(Date.now() - 60 * 1000).toISOString(), // 1 min ago
        }),
      ],
    });

    // UPDATE to mark inactive
    queryResponses.push({ rows: [] });

    vi.mocked(jobber.refreshAccessToken).mockRejectedValueOnce(new Error('OAuth grant revoked'));

    const result = await getTokensWithRefresh(pool, TENANT_ID, silentLogger);

    expect(result).toBeNull();
    expect(silentLogger.error).toHaveBeenCalledWith(
      expect.stringContaining('token refresh FAILED')
    );
    expect(silentLogger.error).toHaveBeenCalledWith(
      expect.stringContaining('integration marked inactive')
    );

    // Should have issued UPDATE to set is_active = false
    const updateCall = mockClient.query.mock.calls[1];
    expect(updateCall[0]).toContain('is_active = false');
    expect(mockClient.release).toHaveBeenCalled();
  });

  it("CUSTOMER-NOT-FOUND: When sync triggered for customer_id that doesn't exist in local DB (e.g., race condition or stale event), system logs warning and skips push to avoid creating orphan Jobber records", async () => {
    // WHO: syncCustomerToJobber when local customer was deleted between event dispatch and sync execution
    // WHAT: SELECT FROM customers returns 0 rows for the given customer_id — skip push, no GraphQL call
    // WHEN: Race condition where customer deleted while push sync event was queued (e.g., n8n webhook delay)
    // WHERE: services/jobberSync.ts → syncCustomerToJobber() → SELECT FROM customers WHERE customer_id = $1
    // WHY: Without this check, system would send empty/null fields to Jobber clientCreate, creating garbage records in the field service system
    const { mockClient, queryResponses } = createMockClient();
    const pool = createMockPool(mockClient);

    // getTokensWithRefresh
    queryResponses.push({ rows: [makeIntegrationSettings()] });

    // check sync map — read sync_map BEFORE customers (lock order)
    queryResponses.push({ rows: [] });

    // fetch local customer — not found
    queryResponses.push({ rows: [] });

    await syncCustomerToJobber(pool, TENANT_ID, CUSTOMER_ID, 'create', silentLogger);

    expect(jobber.graphql).not.toHaveBeenCalled();
    expect(silentLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('customer not found in DB')
    );
    expect(mockClient.release).toHaveBeenCalled();
  });

  it('GRAPHQL-USER-ERRORS: When Jobber GraphQL mutation returns userErrors array (e.g., invalid phone format), system logs the specific error messages so admins can diagnose data quality issues', async () => {
    // WHO: syncCustomerToJobber when Jobber rejects the mutation payload
    // WHAT: clientCreate returns userErrors array with validation failure (invalid phone) — client is null, no sync_map created
    // WHEN: Push sync when local customer has phone format Jobber doesn't accept (e.g., international format without country code)
    // WHERE: services/jobberSync.ts → syncCustomerToJobber() → jobberClient.graphql() → userErrors check
    // WHY: Without logging specific userErrors, admins would see silent sync failures with no way to diagnose which field caused the rejection
    const { mockClient, queryResponses } = createMockClient();
    const pool = createMockPool(mockClient);

    // getTokensWithRefresh
    queryResponses.push({ rows: [makeIntegrationSettings()] });

    // check sync map — empty — read sync_map BEFORE customers (lock order)
    queryResponses.push({ rows: [] });

    // fetch local customer
    queryResponses.push({ rows: [makeCustomerRow()] });

    vi.mocked(jobber.graphql).mockResolvedValueOnce({
      data: {
        clientCreate: {
          client: null,
          userErrors: [{ message: 'Phone number is invalid', path: ['input', 'phones'] }],
        },
      },
    });

    await syncCustomerToJobber(pool, TENANT_ID, CUSTOMER_ID, 'create', silentLogger);

    expect(silentLogger.error).toHaveBeenCalledWith(
      expect.stringContaining('Jobber clientCreate failed')
    );
    expect(silentLogger.error).toHaveBeenCalledWith(
      expect.stringContaining('Phone number is invalid')
    );
    expect(mockClient.release).toHaveBeenCalled();
  });

  it('NO-PHONE-SKIP: When Jobber client has no phone numbers, pull skips it because phone is required for customer matching and appointment booking workflows', async () => {
    // WHO: pullJobberClient receiving a Jobber client with empty phones array
    // WHAT: JobberClient.phones = [] — skip pull entirely, no DB queries issued
    // WHEN: Pull sync when Jobber has commercial/company clients with no phone (email-only contacts)
    // WHERE: services/jobberSync.ts → pullJobberClient() → phones array length check
    // WHY: Without phone, customer can't be matched to existing records (duplicate risk) and voice AI can't send SMS confirmations
    const { mockClient } = createMockClient();
    const pool = createMockPool(mockClient);

    const jobberData = makeJobberClientData({ phones: [] });

    await pullJobberClient(pool, TENANT_ID, jobberData, silentLogger);

    expect(silentLogger.warn).toHaveBeenCalledWith(expect.stringContaining('no phone number'));
    // No pool.connect() needed — shared helper returns early before acquiring a connection
  });

  it('VISIT-NO-CLIENT: When Jobber visit has no associated client (orphan job), pull skips it because appointments require a customer for booking and communication', async () => {
    // WHO: pullJobberVisit receiving a visit whose job has client=null
    // WHAT: JobberVisit.job.client is null — skip pull, no customer to associate appointment with
    // WHEN: Pull sync when Jobber has internal/overhead jobs not linked to any client
    // WHERE: services/jobberSync.ts → pullJobberVisit() → job.client null check
    // WHY: Without a client, the appointment would have no customer_id, breaking booking display and voice AI caller lookup
    const { mockClient } = createMockClient();
    const pool = createMockPool(mockClient);

    const visitData = makeJobberVisitData({
      job: { id: JOBBER_JOB_ID, title: 'Job', client: null },
    });

    await pullJobberVisit(
      pool,
      TENANT_ID,
      visitData as unknown as jobber.JobberVisit,
      silentLogger
    );

    expect(silentLogger.warn).toHaveBeenCalledWith(expect.stringContaining('no associated client'));
    expect(mockClient.release).toHaveBeenCalled();
  });

  it('NO-RESOURCES: When tenant has no active resources configured, visit pull skips because appointments require a resource (technician/bay) for scheduling', async () => {
    // WHO: pullJobberVisit when tenant has no resources in the database
    // WHAT: Customer sync_map found but SELECT FROM resources returns 0 rows — skip visit pull
    // WHEN: Pull sync triggered before tenant completes setup wizard (resources not yet configured)
    // WHERE: services/jobberSync.ts → pullJobberVisit() → SELECT FROM resources WHERE tenant_id = $1
    // WHY: Without a resource_id, INSERT INTO appointments would violate NOT NULL constraint and crash the sync
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

  it('CLIENT-RELEASE-ON-ERROR: When DB query throws during sync operation, system still releases pool client in finally block to prevent connection pool exhaustion', async () => {
    // WHO: getTokensWithRefresh when database connection fails mid-query
    // WHAT: First query throws 'DB connection lost' — function re-throws but still calls client.release()
    // WHEN: Any sync operation when Postgres is temporarily unreachable (network blip, connection timeout)
    // WHERE: services/jobberSync.ts → getTokensWithRefresh() → finally { client.release() }
    // WHY: Without release in finally block, leaked pool connections would accumulate until pool exhaustion (max 2 connections), blocking all sync operations
    const { mockClient } = createMockClient();
    const pool = createMockPool(mockClient);

    // Make the first query throw
    mockClient.query.mockRejectedValueOnce(new Error('DB connection lost'));

    await expect(getTokensWithRefresh(pool, TENANT_ID, silentLogger)).rejects.toThrow(
      'DB connection lost'
    );

    // Even after error, release must be called
    expect(mockClient.release).toHaveBeenCalled();
  });
});

// =============================================
// PULL VISIT — HAPPY + SAD PATHS
// =============================================

describe('Jobber Sync — Pull Visit', () => {
  it('PULL-VISIT-CREATE: When Jobber visit has mapped client and tenant has resources, system creates local appointment so scheduled field work appears in booking calendar', async () => {
    // WHO: pullJobberVisit processing a new Jobber visit
    // WHAT: Customer mapped in sync_map, tenant has resource → INSERT INTO appointments + sync_map
    // WHEN: Pull sync during fullSync or webhook when Jobber dispatched a new visit
    // WHERE: services/jobberSync.ts → pullJobberVisit() → INSERT INTO appointments, INSERT INTO entity_sync_map
    // WHY: Without creating local appointment, field visits would be invisible to the receptionist and voice AI couldn't prevent double-booking
    const { mockClient, queryResponses } = createMockClient();
    const pool = createMockPool(mockClient);

    // customer sync map — found
    queryResponses.push({ rows: [{ local_id: 'local-cust-1' }] });

    // resources query — found
    queryResponses.push({ rows: [{ resource_id: RESOURCE_ID }] });

    // check visit sync map — new
    queryResponses.push({ rows: [] });

    // INSERT appointment
    queryResponses.push({ rows: [{ appointment_id: 'new-appt-id' }] });

    // INSERT visit sync map
    queryResponses.push({ rows: [] });

    await pullJobberVisit(pool, TENANT_ID, makeJobberVisitData(), silentLogger);

    expect(silentLogger.info).toHaveBeenCalledWith(
      expect.stringContaining('created local appointment from Jobber visit')
    );
    expect(mockClient.release).toHaveBeenCalled();
  });

  it('PULL-VISIT-UPDATE-REMOTE-WINS: When already-synced Jobber visit has newer data, system updates local appointment times to reflect field schedule changes', async () => {
    // WHO: pullJobberVisit updating an existing mapped appointment
    // WHAT: sync_map entry exists with older timestamp, Jobber updatedAt > local updated_at → UPDATE appointments SET start_time, end_time
    // WHEN: Pull sync when dispatcher rescheduled a visit in Jobber after initial sync
    // WHERE: services/jobberSync.ts → pullJobberVisit() → UPDATE appointments, UPDATE entity_sync_map
    // WHY: Without updating times, voice AI would give callers the old appointment time, causing scheduling confusion
    const { mockClient, queryResponses } = createMockClient();
    const pool = createMockPool(mockClient);

    // customer sync map — found
    queryResponses.push({ rows: [{ local_id: 'local-cust-1' }] });

    // resources query — found
    queryResponses.push({ rows: [{ resource_id: RESOURCE_ID }] });

    // check visit sync map — existing with older timestamp
    queryResponses.push({
      rows: [{ local_id: 'existing-appt-id', remote_updated_at: '2026-03-20T10:00:00Z' }],
    });

    // fetch local appointment updated_at
    queryResponses.push({ rows: [{ updated_at: '2026-03-22T10:00:00Z' }] });

    // UPDATE appointment
    queryResponses.push({ rows: [] });

    // UPDATE sync map
    queryResponses.push({ rows: [] });

    await pullJobberVisit(
      pool,
      TENANT_ID,
      makeJobberVisitData({ updatedAt: '2026-03-25T14:00:00Z' }),
      silentLogger
    );

    expect(silentLogger.info).toHaveBeenCalledWith(
      expect.stringContaining('updated local appointment from Jobber visit')
    );
    expect(silentLogger.info).toHaveBeenCalledWith(expect.stringContaining('remote was newer'));
  });

  it('PULL-VISIT-LOCAL-WINS: When already-synced visit has older Jobber data than local, system keeps local values and updates sync_map timestamp only', async () => {
    // WHO: pullJobberVisit when local appointment was modified more recently
    // WHAT: sync_map entry exists, Jobber updatedAt < local updated_at → no UPDATE, only sync_map.remote_updated_at updated
    // WHEN: Receptionist rescheduled appointment in dashboard after dispatcher's last Jobber edit
    // WHERE: services/jobberSync.ts → pullJobberVisit() → timestamp comparison → UPDATE entity_sync_map only
    // WHY: Without checking timestamps, Jobber's stale schedule would overwrite the receptionist's correction
    const { mockClient, queryResponses } = createMockClient();
    const pool = createMockPool(mockClient);

    // customer sync map — found
    queryResponses.push({ rows: [{ local_id: 'local-cust-1' }] });

    // resources
    queryResponses.push({ rows: [{ resource_id: RESOURCE_ID }] });

    // visit sync map — existing with older timestamp
    queryResponses.push({
      rows: [{ local_id: 'existing-appt-id', remote_updated_at: '2026-03-20T10:00:00Z' }],
    });

    // local appointment is newer
    queryResponses.push({ rows: [{ updated_at: '2026-03-28T10:00:00Z' }] });

    // UPDATE sync map only (no appointment update)
    queryResponses.push({ rows: [] });

    await pullJobberVisit(
      pool,
      TENANT_ID,
      makeJobberVisitData({ updatedAt: '2026-03-25T14:00:00Z' }),
      silentLogger
    );

    expect(silentLogger.info).toHaveBeenCalledWith(expect.stringContaining('kept local values'));
  });

  it('PULL-VISIT-SKIP-UNCHANGED: When visit updatedAt matches sync_map.remote_updated_at, system skips to avoid redundant writes', async () => {
    // WHO: pullJobberVisit with already-synced version
    // WHAT: sync_map.remote_updated_at matches — early return after sync_map check
    // WHEN: fullSync re-visits already-processed records
    // WHERE: services/jobberSync.ts → pullJobberVisit() → early return
    // WHY: Prevents unnecessary DB load during large syncs
    const { mockClient, queryResponses } = createMockClient();
    const pool = createMockPool(mockClient);

    const ts = '2026-03-25T14:00:00Z';

    // customer sync map
    queryResponses.push({ rows: [{ local_id: 'local-cust-1' }] });
    // resources
    queryResponses.push({ rows: [{ resource_id: RESOURCE_ID }] });
    // visit sync map — same timestamp
    queryResponses.push({ rows: [{ local_id: 'existing-appt', remote_updated_at: ts }] });

    await pullJobberVisit(pool, TENANT_ID, makeJobberVisitData({ updatedAt: ts }), silentLogger);

    expect(silentLogger.info).toHaveBeenCalledWith(
      expect.stringContaining('already synced this version')
    );
  });

  it("VISIT-CLIENT-NOT-SYNCED: When visit's client hasn't been pulled yet, system skips because we can't create an appointment without a local customer", async () => {
    // WHO: pullJobberVisit when client sync_map lookup returns empty
    // WHAT: No entity_sync_map entry for the visit's client → skip visit pull
    // WHEN: Visit webhook arrives before client webhook (out-of-order delivery)
    // WHERE: services/jobberSync.ts → pullJobberVisit() → custSyncRes check
    // WHY: Without mapped customer, INSERT INTO appointments would have no customer_id
    const { mockClient, queryResponses } = createMockClient();
    const pool = createMockPool(mockClient);

    // customer sync map — NOT found
    queryResponses.push({ rows: [] });

    await pullJobberVisit(pool, TENANT_ID, makeJobberVisitData(), silentLogger);

    expect(silentLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('not yet synced locally')
    );
  });
});

// =============================================
// FULL SYNC
// =============================================

describe('Jobber Sync — Full Sync', () => {
  it('FULL-SYNC-EMPTY: When no tokens available, returns zero counts without making API calls', async () => {
    // WHO: fullSync for tenant without Jobber integration
    // WHAT: getTokensWithRefresh returns null → early return with zero counts
    // WHEN: fullSync cron fires for tenant that never connected Jobber
    // WHERE: services/jobberSync.ts → fullSync() → getTokensWithRefresh null check
    // WHY: Without early return, fullSync would NPE on tokens.accessToken
    const { mockClient, queryResponses } = createMockClient();
    const pool = createMockPool(mockClient);

    queryResponses.push({ rows: [] }); // no settings

    const result = await fullSync(pool, TENANT_ID, silentLogger);

    expect(result).toEqual({ clientsSynced: 0, visitsSynced: 0, errors: 0 });
    expect(jobber.graphql).not.toHaveBeenCalled();
  });

  it('FULL-SYNC-WITH-DATA: When Jobber API returns clients and visits, system pulls them all and updates last_sync_at', async () => {
    // WHO: fullSync with active Jobber integration
    // WHAT: Paginates clients (1 page) + visits (1 page), pulls each, updates last_sync_at
    // WHEN: Scheduled nightly full sync
    // WHERE: services/jobberSync.ts → fullSync() → graphql pagination → pullJobberClient/pullJobberVisit
    // WHY: Ensures any changes made directly in Jobber are reflected locally
    const { mockClient, queryResponses } = createMockClient();
    const pool = createMockPool(mockClient);

    // getTokensWithRefresh
    queryResponses.push({ rows: [makeIntegrationSettings()] });

    // For each pullJobberClient call (1 client):
    // sync map check, phone check, INSERT customer, INSERT sync map
    queryResponses.push({ rows: [] }); // sync map
    queryResponses.push({ rows: [] }); // phone check
    queryResponses.push({ rows: [{ customer_id: 'new-local-1' }] }); // INSERT customer
    queryResponses.push({ rows: [] }); // INSERT sync map

    // For each pullJobberVisit call (1 visit):
    // customer sync map, resources, visit sync map, INSERT appointment, INSERT sync map
    queryResponses.push({ rows: [{ local_id: 'new-local-1' }] }); // customer sync
    queryResponses.push({ rows: [{ resource_id: RESOURCE_ID }] }); // resources
    queryResponses.push({ rows: [] }); // visit sync map
    queryResponses.push({ rows: [{ appointment_id: 'new-appt-1' }] }); // INSERT appointment
    queryResponses.push({ rows: [] }); // INSERT sync map

    // UPDATE last_sync_at
    queryResponses.push({ rows: [] });

    // listClients — 1 page with 1 client
    vi.mocked(jobber.graphql).mockResolvedValueOnce({
      data: {
        clients: {
          nodes: [makeJobberClientData()],
          pageInfo: { hasNextPage: false, endCursor: 'cursor1' },
        },
      },
    });

    // listVisits — 1 page with 1 visit
    vi.mocked(jobber.graphql).mockResolvedValueOnce({
      data: {
        visits: {
          nodes: [makeJobberVisitData()],
          pageInfo: { hasNextPage: false, endCursor: 'cursor2' },
        },
      },
    });

    const result = await fullSync(pool, TENANT_ID, silentLogger);

    expect(result.clientsSynced).toBe(1);
    expect(result.visitsSynced).toBe(1);
    expect(result.errors).toBe(0);
    expect(silentLogger.info).toHaveBeenCalledWith(expect.stringContaining('full sync complete'));
  });

  it('FULL-SYNC-PAGINATION-ERROR: When API pagination fails, fullSync logs error and still updates last_sync_at', async () => {
    // WHO: fullSync when Jobber API returns error during pagination
    // WHAT: graphql throws on listClients and listVisits first page → sync continues, updates last_sync_at
    // WHEN: Jobber API outage during scheduled sync
    // WHERE: services/jobberSync.ts → fullSync() → pagination catch blocks
    // WHY: Without updating last_sync_at, next sync would re-attempt the full history
    const { mockClient, queryResponses } = createMockClient();
    const pool = createMockPool(mockClient);

    queryResponses.push({ rows: [makeIntegrationSettings()] });
    queryResponses.push({ rows: [] }); // UPDATE last_sync_at

    vi.mocked(jobber.graphql).mockRejectedValueOnce(new Error('Jobber API 500'));
    vi.mocked(jobber.graphql).mockRejectedValueOnce(new Error('Jobber API 500'));

    const result = await fullSync(pool, TENANT_ID, silentLogger);

    expect(result.clientsSynced).toBe(0);
    expect(result.visitsSynced).toBe(0);
    expect(silentLogger.error).toHaveBeenCalledWith(
      expect.stringContaining('client pagination failed')
    );
    expect(silentLogger.error).toHaveBeenCalledWith(
      expect.stringContaining('visit pagination failed')
    );
  });
});
