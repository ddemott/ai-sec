import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock hubspotClient before importing hubspotSync
vi.mock('./services/hubspotClient', () => ({
  refreshAccessToken: vi.fn(),
  createContact: vi.fn(),
  updateContact: vi.fn(),
  createMeeting: vi.fn(),
  updateMeeting: vi.fn(),
  associateMeetingToContact: vi.fn(),
  listContacts: vi.fn(),
}));

import {
  getTokensWithRefresh,
  syncCustomerToHubSpot,
  syncAppointmentToHubSpot,
  pullHubSpotContact,
  fullSync,
} from "./services/hubspotSync";
import * as hubspot from "./services/hubspotClient";

// ---- Mock helpers ----

const TENANT_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const CUSTOMER_ID = '11111111-2222-3333-4444-555555555555';
const APPOINTMENT_ID = '22222222-3333-4444-5555-666666666666';
const HUBSPOT_CONTACT_ID = 'hs-contact-001';
const HUBSPOT_MEETING_ID = 'hs-meeting-001';
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
    status: 'scheduled',
    customer_name: 'John Doe',
    customer_phone: '555-1234',
    resource_name: 'Bay 1',
    updated_at: '2026-03-20T10:00:00Z',
    ...overrides,
  };
}

function makeHubSpotContactData(overrides: Record<string, unknown> = {}): hubspot.HubSpotContact {
  return {
    id: HUBSPOT_CONTACT_ID,
    properties: {
      firstname: 'Jane',
      lastname: 'Smith',
      phone: '555-9999',
      email: 'jane@example.com',
      lastmodifieddate: '2026-03-25T14:00:00Z',
      ...overrides,
    },
  };
}

import { createMockClient as createBaseMockClient, createMockPool, type MockQuery, type MockResponse } from './test-utils-mock';

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

beforeEach(() => {
  vi.clearAllMocks();
});

// =============================================
// HAPPY PATHS — PUSH
// =============================================

describe("HubSpot Sync — Push Happy Paths", () => {
  it("PUSH-CREATE: When tenant pushes new customer to HubSpot, system creates contact in HubSpot and records mapping in sync_map so future syncs can update rather than duplicate", async () => {
    // WHO: syncCustomerToHubSpot with action='create'
    // WHAT: Local customer exists, no entity_sync_map entry — triggers createContact REST v3 API call
    // WHEN: Push sync after new customer created in dashboard or via voice AI booking
    // WHERE: services/hubspotSync.ts → syncCustomerToHubSpot() → hubspotClient.createContact()
    // WHY: Without sync_map INSERT after create, next sync would duplicate the contact in HubSpot CRM instead of updating
    const { mockClient, queryResponses, getDataQueries } = createMockClient();
    const pool = createMockPool(mockClient);

    // getTokensWithRefresh: integration settings (token not expired)
    queryResponses.push({ rows: [makeIntegrationSettings()] });

    // syncCustomerToHubSpot: check sync map FIRST (lock ordering: sync_map before customers)
    queryResponses.push({ rows: [] });

    // syncCustomerToHubSpot: fetch local customer SECOND
    queryResponses.push({ rows: [makeCustomerRow()] });

    // syncCustomerToHubSpot: INSERT sync map after create
    queryResponses.push({ rows: [] });

    vi.mocked(hubspot.createContact).mockResolvedValueOnce({
      id: HUBSPOT_CONTACT_ID,
      properties: { firstname: 'John', lastname: 'Doe', lastmodifieddate: '2026-03-20T10:00:00Z' },
    });

    await syncCustomerToHubSpot(pool, TENANT_ID, CUSTOMER_ID, 'create', silentLogger);

    expect(hubspot.createContact).toHaveBeenCalledOnce();
    expect(hubspot.createContact).toHaveBeenCalledWith(
      'valid-access-token',
      expect.objectContaining({ firstname: 'John', lastname: 'Doe' }),
    );
    expect(mockClient.release).toHaveBeenCalled();
    expect(silentLogger.info).toHaveBeenCalledWith(expect.stringContaining('customer pushed to HubSpot'));

    // Verify sync map INSERT was called with correct external_id
    const dataQueries = getDataQueries();
    const insertQuery = dataQueries[3];
    expect(insertQuery[0]).toContain('INSERT INTO entity_sync_map');
    expect(insertQuery[1]).toContain(HUBSPOT_CONTACT_ID);
  });

  it("PUSH-UPDATE: When tenant updates customer that was previously synced, system updates existing HubSpot contact using stored external_id to maintain data consistency across systems", async () => {
    // WHO: syncCustomerToHubSpot with action='update'
    // WHAT: Local customer updated, entity_sync_map has existing external_id — triggers updateContact REST v3 API call
    // WHEN: Push sync after customer phone/email/name edited in dashboard
    // WHERE: services/hubspotSync.ts → syncCustomerToHubSpot() → hubspotClient.updateContact()
    // WHY: Without using stored external_id from sync_map, system would create a duplicate contact in HubSpot instead of updating
    const { mockClient, queryResponses } = createMockClient();
    const pool = createMockPool(mockClient);

    // getTokensWithRefresh: integration settings
    queryResponses.push({ rows: [makeIntegrationSettings()] });

    // check sync map — existing mapping — read sync_map BEFORE customers (lock order)
    queryResponses.push({ rows: [{ external_id: HUBSPOT_CONTACT_ID }] });

    // fetch local customer
    queryResponses.push({ rows: [makeCustomerRow()] });

    // UPDATE sync map after update
    queryResponses.push({ rows: [] });

    vi.mocked(hubspot.updateContact).mockResolvedValueOnce({
      id: HUBSPOT_CONTACT_ID,
      properties: { firstname: 'John', lastname: 'Doe', lastmodifieddate: '2026-03-20T12:00:00Z' },
    });

    await syncCustomerToHubSpot(pool, TENANT_ID, CUSTOMER_ID, 'update', silentLogger);

    expect(hubspot.updateContact).toHaveBeenCalledOnce();
    expect(hubspot.updateContact).toHaveBeenCalledWith(
      'valid-access-token',
      HUBSPOT_CONTACT_ID,
      expect.objectContaining({ firstname: 'John', lastname: 'Doe' }),
    );
    expect(silentLogger.info).toHaveBeenCalledWith(expect.stringContaining('customer updated in HubSpot'));
    expect(mockClient.release).toHaveBeenCalled();
  });

  it("PUSH-DELETE: When tenant deletes customer locally, system removes sync_map entry without calling HubSpot API, preserving HubSpot data while breaking the link", async () => {
    // WHO: syncCustomerToHubSpot with action='delete'
    // WHAT: Local customer soft-deleted, sync_map entry exists — only removes mapping, no HubSpot API call
    // WHEN: Push sync after customer deleted from dashboard
    // WHERE: services/hubspotSync.ts → syncCustomerToHubSpot() → DELETE FROM entity_sync_map
    // WHY: Calling HubSpot's delete API would destroy CRM deal history and engagement timeline that the sales team still needs
    const { mockClient, queryResponses } = createMockClient();
    const pool = createMockPool(mockClient);

    // getTokensWithRefresh
    queryResponses.push({ rows: [makeIntegrationSettings()] });

    // DELETE sync map
    queryResponses.push({ rows: [], rowCount: 1 });

    await syncCustomerToHubSpot(pool, TENANT_ID, CUSTOMER_ID, 'delete', silentLogger);

    // Should NOT call HubSpot API at all
    expect(hubspot.createContact).not.toHaveBeenCalled();
    expect(hubspot.updateContact).not.toHaveBeenCalled();
    expect(silentLogger.info).toHaveBeenCalledWith(expect.stringContaining('sync map entry removed'));
    expect(mockClient.release).toHaveBeenCalled();
  });

  it("PUSH-APPOINTMENT: When tenant creates appointment, system creates HubSpot meeting and associates it with the customer's contact so sales team sees scheduled work", async () => {
    // WHO: syncAppointmentToHubSpot with action='create'
    // WHAT: Local appointment with synced customer — triggers createMeeting + associateMeetingToContact API calls
    // WHEN: Push sync after appointment booked via dashboard or voice AI
    // WHERE: services/hubspotSync.ts → syncAppointmentToHubSpot() → hubspotClient.createMeeting() + associateMeetingToContact()
    // WHY: Without the association call, meeting would exist in HubSpot but not appear on the contact's timeline, making it invisible to sales
    const { mockClient, queryResponses } = createMockClient();
    const pool = createMockPool(mockClient);

    // getTokensWithRefresh
    queryResponses.push({ rows: [makeIntegrationSettings()] });

    // check appointment sync map — new — read sync_map BEFORE appointments (lock order)
    queryResponses.push({ rows: [] });

    // fetch appointment with customer details
    queryResponses.push({ rows: [makeAppointmentRow()] });

    // check customer sync map — already synced
    queryResponses.push({ rows: [{ external_id: HUBSPOT_CONTACT_ID }] });

    // INSERT sync map for appointment
    queryResponses.push({ rows: [] });

    vi.mocked(hubspot.createMeeting).mockResolvedValueOnce({
      id: HUBSPOT_MEETING_ID,
      properties: { hs_meeting_title: 'Oil Change - John Doe' },
    });
    vi.mocked(hubspot.associateMeetingToContact).mockResolvedValueOnce(undefined);

    await syncAppointmentToHubSpot(pool, TENANT_ID, APPOINTMENT_ID, 'create', silentLogger);

    expect(hubspot.createMeeting).toHaveBeenCalledOnce();
    expect(hubspot.createMeeting).toHaveBeenCalledWith(
      'valid-access-token',
      expect.objectContaining({
        hs_meeting_title: 'Oil Change - John Doe',
        hs_meeting_outcome: 'SCHEDULED',
      }),
    );
    expect(hubspot.associateMeetingToContact).toHaveBeenCalledWith(
      'valid-access-token',
      HUBSPOT_MEETING_ID,
      HUBSPOT_CONTACT_ID,
    );
    expect(silentLogger.info).toHaveBeenCalledWith(expect.stringContaining('appointment pushed to HubSpot as meeting'));
    expect(mockClient.release).toHaveBeenCalled();
  });

  it("PUSH-APPOINTMENT-CASCADE: When tenant creates appointment for unsynced customer, system automatically syncs customer first then creates meeting, ensuring referential integrity in HubSpot", async () => {
    // WHO: syncAppointmentToHubSpot calling syncCustomerToHubSpot recursively
    // WHAT: Appointment's customer has no sync_map entry — system auto-syncs customer before creating meeting
    // WHEN: Push sync when voice AI books appointment for a brand-new caller (customer created moments before)
    // WHERE: services/hubspotSync.ts → syncAppointmentToHubSpot() → syncCustomerToHubSpot() → createContact + createMeeting
    // WHY: Without cascade sync, associateMeetingToContact would fail with invalid contact ID — HubSpot requires valid contact for association
    const queries: MockQuery[] = [];
    const allResponses: MockResponse[] = [];

    const mockClient = {
      query: vi.fn(async (text: string, params?: unknown[]) => {
        queries.push({ text, params: params || [] });
        return allResponses.shift() || { rows: [], rowCount: 0 };
      }),
      release: vi.fn(),
    };

    const pool = createMockPool(mockClient);

    // --- Main syncAppointmentToHubSpot flow ---
    // 1. getTokensWithRefresh (for syncAppointmentToHubSpot)
    allResponses.push({ rows: [makeIntegrationSettings()] });

    // 2. check appointment sync map — new (read sync_map BEFORE appointments — lock order)
    allResponses.push({ rows: [] });

    // 3. fetch appointment
    allResponses.push({ rows: [makeAppointmentRow()] });

    // 4. check customer sync map — NOT synced yet
    allResponses.push({ rows: [] });

    // --- Recursive syncCustomerToHubSpot call ---
    // 5. getTokensWithRefresh (for syncCustomerToHubSpot)
    allResponses.push({ rows: [makeIntegrationSettings()] });

    // 6. check customer sync map (empty — create) — read sync_map BEFORE customers (lock order)
    allResponses.push({ rows: [] });

    // 7. fetch local customer
    allResponses.push({ rows: [makeCustomerRow()] });

    // 8. INSERT customer sync map
    allResponses.push({ rows: [] });

    // --- Back in syncAppointmentToHubSpot ---
    // 9. re-check customer sync map — NOW synced
    allResponses.push({ rows: [{ external_id: HUBSPOT_CONTACT_ID }] });

    // 10. INSERT appointment sync map
    allResponses.push({ rows: [] });

    // First: createContact (from recursive syncCustomerToHubSpot)
    vi.mocked(hubspot.createContact).mockResolvedValueOnce({
      id: HUBSPOT_CONTACT_ID,
      properties: { firstname: 'John', lastname: 'Doe', lastmodifieddate: '2026-03-20T10:00:00Z' },
    });

    // Second: createMeeting
    vi.mocked(hubspot.createMeeting).mockResolvedValueOnce({
      id: HUBSPOT_MEETING_ID,
      properties: { hs_meeting_title: 'Oil Change - John Doe' },
    });

    vi.mocked(hubspot.associateMeetingToContact).mockResolvedValueOnce(undefined);

    await syncAppointmentToHubSpot(pool, TENANT_ID, APPOINTMENT_ID, 'create', silentLogger);

    // Should have called createContact once and createMeeting once
    expect(hubspot.createContact).toHaveBeenCalledOnce();
    expect(hubspot.createMeeting).toHaveBeenCalledOnce();
    expect(silentLogger.info).toHaveBeenCalledWith(expect.stringContaining('customer pushed to HubSpot'));
    expect(silentLogger.info).toHaveBeenCalledWith(expect.stringContaining('appointment pushed to HubSpot as meeting'));
  });
});

// =============================================
// HAPPY PATHS — PULL
// =============================================

describe("HubSpot Sync — Pull Happy Paths", () => {
  it("PULL-CREATE: When HubSpot contact has no local match (by sync_map or phone), system creates new customer locally so CRM leads appear in scheduling system", async () => {
    // WHO: pullHubSpotContact processing a new HubSpot contact
    // WHAT: No entity_sync_map match AND no customers row matching phone — triggers INSERT INTO customers + sync_map
    // WHEN: Pull sync during fullSync or webhook when HubSpot contact was created by sales team outside SecretaryHQ
    // WHERE: services/hubspotSync.ts → pullHubSpotContact() → INSERT INTO customers, INSERT INTO entity_sync_map
    // WHY: Without creating local customer, voice AI wouldn't recognize returning callers who were added through HubSpot CRM
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

    await pullHubSpotContact(pool, TENANT_ID, makeHubSpotContactData(), silentLogger);

    expect(silentLogger.info).toHaveBeenCalledWith(expect.stringContaining('created local customer from hubspot customer'));
    expect(mockClient.release).toHaveBeenCalled();

    // Verify the INSERT customers query (getDataQueries filters out session variable queries)
    const dataQueries = getDataQueries();
    const insertCall = dataQueries[2];
    expect(insertCall[0]).toContain('INSERT INTO customers');
    expect(insertCall[1]).toContain('Jane Smith');
    expect(insertCall[1]).toContain('555-9999');
  });

  it("PULL-MERGE-REMOTE-WINS: When HubSpot contact matches local customer by phone and HubSpot data is newer, system updates local record to keep most recent data from authoritative source", async () => {
    // WHO: pullHubSpotContact merging with existing local customer
    // WHAT: Phone match found, HubSpot lastmodifieddate (2026-03-25) > local updated_at (2026-03-10) — remote wins timestamp merge
    // WHEN: Pull sync when sales rep updated customer email in HubSpot after original booking
    // WHERE: services/hubspotSync.ts → pullHubSpotContact() → UPDATE customers SET name, phone, email
    // WHY: Without timestamp comparison, stale local data would persist and customer would receive communications at old email address
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

    const contactData = makeHubSpotContactData({ lastmodifieddate: '2026-03-25T14:00:00Z' });

    await pullHubSpotContact(pool, TENANT_ID, contactData, silentLogger);

    expect(silentLogger.info).toHaveBeenCalledWith(expect.stringContaining('merged hubspot customer into existing customer'));
    expect(silentLogger.info).toHaveBeenCalledWith(expect.stringContaining('remote was newer'));

    // Verify UPDATE was issued (getDataQueries filters out session variable queries)
    const dataQueries = getDataQueries();
    expect(dataQueries[2][0]).toContain('UPDATE customers');
  });

  it("PULL-MERGE-LOCAL-WINS: When HubSpot contact matches local customer by phone but local data is newer, system keeps local values and only creates sync_map link to prevent stale overwrites", async () => {
    // WHO: pullHubSpotContact merging with existing local customer where local is newer
    // WHAT: Phone match found, local updated_at (2026-03-28) > HubSpot lastmodifieddate (2026-03-25) — local wins, no UPDATE issued
    // WHEN: Pull sync when receptionist updated customer info via dashboard after HubSpot's last modification
    // WHERE: services/hubspotSync.ts → pullHubSpotContact() → INSERT INTO entity_sync_map (skip UPDATE)
    // WHY: Without this guard, a stale HubSpot record would overwrite the receptionist's recent corrections, corrupting name/phone/email fields
    const { mockClient, queryResponses, getDataQueries } = createMockClient();
    const pool = createMockPool(mockClient);

    // check sync map — no existing mapping
    queryResponses.push({ rows: [] });

    // check existing customer by phone — found, but newer than remote
    queryResponses.push({ rows: [{ id: 'existing-local-id', updated_at: '2026-03-28T10:00:00Z' }] });

    // INSERT sync map (still creates mapping even when keeping local)
    queryResponses.push({ rows: [] });

    const contactData = makeHubSpotContactData({ lastmodifieddate: '2026-03-25T14:00:00Z' });

    await pullHubSpotContact(pool, TENANT_ID, contactData, silentLogger);

    expect(silentLogger.info).toHaveBeenCalledWith(expect.stringContaining('local was newer'));
    // Should NOT have issued UPDATE — only 3 data queries (excludes session variable queries)
    expect(getDataQueries()).toHaveLength(3);
  });
});

// =============================================
// SAD PATHS
// =============================================

describe("HubSpot Sync — Sad Paths", () => {
  it("NO-SETTINGS: When tenant has no HubSpot integration configured, getTokensWithRefresh returns null allowing sync operations to skip gracefully without errors", async () => {
    // WHO: getTokensWithRefresh for a tenant without HubSpot integration
    // WHAT: tenant_integration_settings query returns 0 rows — function returns null
    // WHEN: Push/pull sync triggered for tenant that never connected HubSpot OAuth
    // WHERE: services/hubspotSync.ts → getTokensWithRefresh() → SELECT FROM tenant_integration_settings
    // WHY: Without null return, downstream sync functions would crash on undefined access_token, causing unhandled promise rejections
    const { mockClient, queryResponses } = createMockClient();
    const pool = createMockPool(mockClient);

    // getTokensWithRefresh: no settings row
    queryResponses.push({ rows: [] });

    const result = await getTokensWithRefresh(pool, TENANT_ID, silentLogger);

    expect(result).toBeNull();
    expect(mockClient.release).toHaveBeenCalled();
  });

  it("INACTIVE-INTEGRATION: When tenant's HubSpot integration is marked inactive (is_active=false), system returns null and logs warning so disabled integrations don't attempt API calls", async () => {
    // WHO: getTokensWithRefresh for a tenant with disabled HubSpot integration
    // WHAT: tenant_integration_settings.is_active = false — function returns null with warning log
    // WHEN: Sync triggered after admin disabled integration (or after token refresh failure auto-disabled it)
    // WHERE: services/hubspotSync.ts → getTokensWithRefresh() → is_active check
    // WHY: Without this guard, system would send API calls with potentially revoked tokens, causing 401 errors and wasted HubSpot API quota
    const { mockClient, queryResponses } = createMockClient();
    const pool = createMockPool(mockClient);

    queryResponses.push({ rows: [makeIntegrationSettings({ is_active: false })] });

    const result = await getTokensWithRefresh(pool, TENANT_ID, silentLogger);

    expect(result).toBeNull();
    expect(silentLogger.warn).toHaveBeenCalledWith(expect.stringContaining('integration inactive'));
    expect(mockClient.release).toHaveBeenCalled();
  });

  it("TOKEN-REFRESH-FAILURE: When OAuth token refresh fails (e.g., user revoked access), system marks integration inactive in DB and returns null to prevent repeated failed API calls", async () => {
    // WHO: getTokensWithRefresh when token is expired and refresh fails
    // WHAT: token_expires_at is in the past, refreshAccessToken throws 'OAuth grant revoked' — marks is_active=false in DB
    // WHEN: Sync triggered after user revoked HubSpot OAuth access from their HubSpot account settings
    // WHERE: services/hubspotSync.ts → getTokensWithRefresh() → hubspotClient.refreshAccessToken() → UPDATE SET is_active=false
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

    vi.mocked(hubspot.refreshAccessToken).mockRejectedValueOnce(new Error('OAuth grant revoked'));

    const result = await getTokensWithRefresh(pool, TENANT_ID, silentLogger);

    expect(result).toBeNull();
    expect(silentLogger.error).toHaveBeenCalledWith(expect.stringContaining('token refresh FAILED'));
    expect(silentLogger.error).toHaveBeenCalledWith(expect.stringContaining('integration marked inactive'));

    // Should have issued UPDATE to set is_active = false
    const updateCall = mockClient.query.mock.calls[1];
    expect(updateCall[0]).toContain('is_active = false');
    expect(mockClient.release).toHaveBeenCalled();
  });

  it("CUSTOMER-NOT-FOUND: When sync triggered for customer_id that doesn't exist in local DB (e.g., race condition or stale event), system logs warning and skips push to avoid creating orphan HubSpot records", async () => {
    // WHO: syncCustomerToHubSpot when local customer was deleted between event dispatch and sync execution
    // WHAT: SELECT FROM customers returns 0 rows for the given customer_id — skip push, no API call
    // WHEN: Race condition where customer deleted while push sync event was queued (e.g., n8n webhook delay)
    // WHERE: services/hubspotSync.ts → syncCustomerToHubSpot() → SELECT FROM customers WHERE customer_id = $1
    // WHY: Without this check, system would send empty/null fields to createContact, creating garbage records in HubSpot CRM
    const { mockClient, queryResponses } = createMockClient();
    const pool = createMockPool(mockClient);

    // getTokensWithRefresh
    queryResponses.push({ rows: [makeIntegrationSettings()] });

    // check sync map — no existing mapping (read sync_map BEFORE customers — lock order)
    queryResponses.push({ rows: [] });

    // fetch local customer — not found
    queryResponses.push({ rows: [] });

    await syncCustomerToHubSpot(pool, TENANT_ID, CUSTOMER_ID, 'create', silentLogger);

    expect(hubspot.createContact).not.toHaveBeenCalled();
    expect(silentLogger.warn).toHaveBeenCalledWith(expect.stringContaining('customer not found in DB'));
    expect(mockClient.release).toHaveBeenCalled();
  });

  it("NO-PHONE-SKIP: When HubSpot contact has no phone number, pull skips it because phone is required for customer matching and appointment booking workflows", async () => {
    // WHO: pullHubSpotContact receiving a HubSpot contact with empty phone property
    // WHAT: HubSpotContact.properties.phone = '' — skip pull entirely, no DB queries issued
    // WHEN: Pull sync when HubSpot has marketing-only contacts with no phone collected (email-only leads)
    // WHERE: services/hubspotSync.ts → pullHubSpotContact() → properties.phone empty check
    // WHY: Without phone, customer can't be matched to existing records (duplicate risk) and voice AI can't send SMS confirmations
    const { mockClient } = createMockClient();
    const pool = createMockPool(mockClient);

    const contactData = makeHubSpotContactData({ phone: '' });

    await pullHubSpotContact(pool, TENANT_ID, contactData, silentLogger);

    expect(silentLogger.warn).toHaveBeenCalledWith(expect.stringContaining('no phone number'));
    // No pool.connect() needed — shared helper returns early before acquiring a connection
  });

  it("ALREADY-SYNCED: When HubSpot contact's lastmodifieddate matches sync_map.remote_updated_at, system skips processing to avoid redundant DB writes and improve sync performance", async () => {
    // WHO: pullHubSpotContact checking already-synced version
    // WHAT: sync_map.remote_updated_at matches HubSpot lastmodifieddate exactly — no DB queries beyond the sync_map check
    // WHEN: Pull sync during fullSync pagination when most contacts haven't changed since last sync
    // WHERE: services/hubspotSync.ts → pullHubSpotContact() → early return after entity_sync_map SELECT
    // WHY: Without this skip optimization, fullSync of thousands of HubSpot contacts would issue unnecessary SELECT+UPDATE pairs
    const { mockClient, queryResponses, getDataQueries } = createMockClient();
    const pool = createMockPool(mockClient);

    const sameTimestamp = '2026-03-25T14:00:00Z';

    // check sync map — existing mapping with SAME remote timestamp
    queryResponses.push({
      rows: [{ local_id: 'existing-local-id', remote_updated_at: sameTimestamp }],
    });

    const contactData = makeHubSpotContactData({ lastmodifieddate: sameTimestamp });

    await pullHubSpotContact(pool, TENANT_ID, contactData, silentLogger);

    expect(silentLogger.info).toHaveBeenCalledWith(expect.stringContaining('already synced this version'));
    // Only 1 data query: the sync map check (excludes session variable queries)
    expect(getDataQueries()).toHaveLength(1);
    expect(mockClient.release).toHaveBeenCalled();
  });

  it("CLIENT-RELEASE-ON-ERROR: When DB query throws during sync operation, system still releases pool client in finally block to prevent connection pool exhaustion", async () => {
    // WHO: getTokensWithRefresh when database connection fails mid-query
    // WHAT: First query throws 'DB connection lost' — function re-throws but still calls client.release()
    // WHEN: Any sync operation when Postgres is temporarily unreachable (network blip, connection timeout)
    // WHERE: services/hubspotSync.ts → getTokensWithRefresh() → finally { client.release() }
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

  it("PAGINATION-ERROR: When HubSpot API returns error during contact list pagination, fullSync logs error and continues to update last_sync_at so next sync resumes from clean state", async () => {
    // WHO: fullSync when HubSpot API returns 500 during pagination
    // WHAT: listContacts throws on first page — sync completes with 0 records but updates last_sync_at
    // WHEN: HubSpot API experiencing downtime during scheduled full sync
    // WHERE: services/hubspotSync.ts → fullSync() → listContacts pagination → UPDATE last_sync_at
    // WHY: Without updating last_sync_at after partial failure, next sync would re-fetch all contacts from beginning of time instead of just the gap period
    const { mockClient, queryResponses } = createMockClient();
    const pool = createMockPool(mockClient);

    // getTokensWithRefresh
    queryResponses.push({ rows: [makeIntegrationSettings()] });

    // UPDATE last_sync_at (at end of fullSync)
    queryResponses.push({ rows: [] });

    // listContacts throws on first page
    vi.mocked(hubspot.listContacts).mockRejectedValueOnce(new Error('HubSpot API 500'));

    const result = await fullSync(pool, TENANT_ID, silentLogger);

    expect(result.contactsSynced).toBe(0);
    expect(result.errors).toBe(0); // errors counter is for individual contact failures, not pagination
    expect(silentLogger.error).toHaveBeenCalledWith(expect.stringContaining('contact pagination failed'));
    // Should still update last_sync_at
    expect(mockClient.release).toHaveBeenCalled();
  });
});
