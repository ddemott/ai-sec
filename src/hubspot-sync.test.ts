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

function makeHubSpotContactData(overrides: Record<string, any> = {}): hubspot.HubSpotContact {
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

describe("HubSpot Sync — Push Happy Paths", () => {
  it("1. syncCustomerToHubSpot creates contact + inserts sync map entry", async () => {
    const { mockClient, queryResponses } = createMockClient();
    const pool = createMockPool(mockClient);

    // getTokensWithRefresh: integration settings (token not expired)
    queryResponses.push({ rows: [makeIntegrationSettings()] });

    // syncCustomerToHubSpot: fetch local customer
    queryResponses.push({ rows: [makeCustomerRow()] });

    // syncCustomerToHubSpot: check sync map (empty — new)
    queryResponses.push({ rows: [] });

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
    const insertQuery = mockClient.query.mock.calls[3];
    expect(insertQuery[0]).toContain('INSERT INTO entity_sync_map');
    expect(insertQuery[1]).toContain(HUBSPOT_CONTACT_ID);
  });

  it("2. syncCustomerToHubSpot updates existing contact", async () => {
    const { mockClient, queryResponses } = createMockClient();
    const pool = createMockPool(mockClient);

    // getTokensWithRefresh: integration settings
    queryResponses.push({ rows: [makeIntegrationSettings()] });

    // fetch local customer
    queryResponses.push({ rows: [makeCustomerRow()] });

    // check sync map — existing mapping
    queryResponses.push({ rows: [{ external_id: HUBSPOT_CONTACT_ID }] });

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

  it("3. syncCustomerToHubSpot delete removes sync map entry", async () => {
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

  it("4. syncAppointmentToHubSpot creates meeting + associates with contact", async () => {
    const { mockClient, queryResponses } = createMockClient();
    const pool = createMockPool(mockClient);

    // getTokensWithRefresh
    queryResponses.push({ rows: [makeIntegrationSettings()] });

    // fetch appointment with customer details
    queryResponses.push({ rows: [makeAppointmentRow()] });

    // check customer sync map — already synced
    queryResponses.push({ rows: [{ external_id: HUBSPOT_CONTACT_ID }] });

    // check appointment sync map — new
    queryResponses.push({ rows: [] });

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

  it("5. syncAppointmentToHubSpot auto-syncs customer first if not yet synced", async () => {
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

    // --- Main syncAppointmentToHubSpot flow ---
    // 1. getTokensWithRefresh (for syncAppointmentToHubSpot)
    allResponses.push({ rows: [makeIntegrationSettings()] });

    // 2. fetch appointment
    allResponses.push({ rows: [makeAppointmentRow()] });

    // 3. check customer sync map — NOT synced yet
    allResponses.push({ rows: [] });

    // --- Recursive syncCustomerToHubSpot call ---
    // 4. getTokensWithRefresh (for syncCustomerToHubSpot)
    allResponses.push({ rows: [makeIntegrationSettings()] });

    // 5. fetch local customer
    allResponses.push({ rows: [makeCustomerRow()] });

    // 6. check customer sync map (empty — create)
    allResponses.push({ rows: [] });

    // 7. INSERT customer sync map
    allResponses.push({ rows: [] });

    // --- Back in syncAppointmentToHubSpot ---
    // 8. re-check customer sync map — NOW synced
    allResponses.push({ rows: [{ external_id: HUBSPOT_CONTACT_ID }] });

    // 9. check appointment sync map — new
    allResponses.push({ rows: [] });

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
  it("6. pullHubSpotContact creates new local customer", async () => {
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

    await pullHubSpotContact(pool, TENANT_ID, makeHubSpotContactData(), silentLogger);

    expect(silentLogger.info).toHaveBeenCalledWith(expect.stringContaining('created local customer from HubSpot contact'));
    expect(mockClient.release).toHaveBeenCalled();

    // Verify the INSERT customers query
    const insertCall = mockClient.query.mock.calls[2];
    expect(insertCall[0]).toContain('INSERT INTO customers');
    expect(insertCall[1]).toContain('Jane Smith');
    expect(insertCall[1]).toContain('555-9999');
  });

  it("7. pullHubSpotContact merges when remote is newer", async () => {
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

    const contactData = makeHubSpotContactData({ lastmodifieddate: '2026-03-25T14:00:00Z' });

    await pullHubSpotContact(pool, TENANT_ID, contactData, silentLogger);

    expect(silentLogger.info).toHaveBeenCalledWith(expect.stringContaining('merged HubSpot contact into existing customer'));
    expect(silentLogger.info).toHaveBeenCalledWith(expect.stringContaining('remote was newer'));

    // Verify UPDATE was issued
    const updateCall = mockClient.query.mock.calls[2];
    expect(updateCall[0]).toContain('UPDATE customers');
  });

  it("8. pullHubSpotContact keeps local when local is newer", async () => {
    const { mockClient, queryResponses } = createMockClient();
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
    // Should NOT have issued UPDATE — only 3 queries: sync map check, phone check, sync map insert
    expect(mockClient.query).toHaveBeenCalledTimes(3);
  });
});

// =============================================
// SAD PATHS
// =============================================

describe("HubSpot Sync — Sad Paths", () => {
  it("9. Returns null when no settings", async () => {
    const { mockClient, queryResponses } = createMockClient();
    const pool = createMockPool(mockClient);

    // getTokensWithRefresh: no settings row
    queryResponses.push({ rows: [] });

    const result = await getTokensWithRefresh(pool, TENANT_ID, silentLogger);

    expect(result).toBeNull();
    expect(mockClient.release).toHaveBeenCalled();
  });

  it("10. Returns null when inactive", async () => {
    const { mockClient, queryResponses } = createMockClient();
    const pool = createMockPool(mockClient);

    queryResponses.push({ rows: [makeIntegrationSettings({ is_active: false })] });

    const result = await getTokensWithRefresh(pool, TENANT_ID, silentLogger);

    expect(result).toBeNull();
    expect(silentLogger.warn).toHaveBeenCalledWith(expect.stringContaining('integration inactive'));
    expect(mockClient.release).toHaveBeenCalled();
  });

  it("11. Marks inactive on token refresh failure", async () => {
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

  it("12. Customer not found — skips push", async () => {
    const { mockClient, queryResponses } = createMockClient();
    const pool = createMockPool(mockClient);

    // getTokensWithRefresh
    queryResponses.push({ rows: [makeIntegrationSettings()] });

    // fetch local customer — not found
    queryResponses.push({ rows: [] });

    await syncCustomerToHubSpot(pool, TENANT_ID, CUSTOMER_ID, 'create', silentLogger);

    expect(hubspot.createContact).not.toHaveBeenCalled();
    expect(silentLogger.warn).toHaveBeenCalledWith(expect.stringContaining('customer not found in DB'));
    expect(mockClient.release).toHaveBeenCalled();
  });

  it("13. pullHubSpotContact skips contact with no phone", async () => {
    const { mockClient } = createMockClient();
    const pool = createMockPool(mockClient);

    const contactData = makeHubSpotContactData({ phone: '' });

    await pullHubSpotContact(pool, TENANT_ID, contactData, silentLogger);

    expect(silentLogger.warn).toHaveBeenCalledWith(expect.stringContaining('no phone number'));
    expect(mockClient.release).toHaveBeenCalled();
  });

  it("14. pullHubSpotContact skips already-synced version", async () => {
    const { mockClient, queryResponses } = createMockClient();
    const pool = createMockPool(mockClient);

    const sameTimestamp = '2026-03-25T14:00:00Z';

    // check sync map — existing mapping with SAME remote timestamp
    queryResponses.push({
      rows: [{ local_id: 'existing-local-id', remote_updated_at: sameTimestamp }],
    });

    const contactData = makeHubSpotContactData({ lastmodifieddate: sameTimestamp });

    await pullHubSpotContact(pool, TENANT_ID, contactData, silentLogger);

    expect(silentLogger.info).toHaveBeenCalledWith(expect.stringContaining('already synced this version'));
    // Only 1 query: the sync map check
    expect(mockClient.query).toHaveBeenCalledTimes(1);
    expect(mockClient.release).toHaveBeenCalled();
  });

  it("15. Client always released on error", async () => {
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

  it("16. fullSync handles pagination errors gracefully", async () => {
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
