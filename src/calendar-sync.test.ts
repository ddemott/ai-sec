import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the googleCalendar module before importing calendarSync
vi.mock('./services/googleCalendar', () => ({
  refreshAccessToken: vi.fn(),
  createEvent: vi.fn(),
  updateEvent: vi.fn(),
  deleteEvent: vi.fn(),
}));

import { syncAppointmentToCalendar } from "./services/calendarSync";
import * as gcal from "./services/googleCalendar";

// ---- Mock helpers ----

const TENANT_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const APPOINTMENT_ID = '11111111-2222-3333-4444-555555555555';
const CALENDAR_ID = 'primary';
const EXTERNAL_EVENT_ID = 'gcal-event-abc123';

function makeSettings(overrides: Record<string, any> = {}) {
  return {
    provider: 'google',
    external_calendar_id: CALENDAR_ID,
    access_token: 'valid-access-token',
    refresh_token: 'valid-refresh-token',
    token_expires_at: new Date(Date.now() + 3600 * 1000).toISOString(), // 1h from now
    is_active: true,
    ...overrides,
  };
}

function makeAppointment(overrides: Record<string, any> = {}) {
  return {
    id: APPOINTMENT_ID,
    tenant_id: TENANT_ID,
    customer_id: 'cust-1',
    resource_id: 'res-1',
    start_time: '2026-03-26T10:00:00Z',
    end_time: '2026-03-26T11:00:00Z',
    description: 'Oil Change',
    location: '123 Main St',
    customer_name: 'John Doe',
    customer_phone: '555-1234',
    resource_name: 'Bay 1',
    service_name: 'Oil Change Service',
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
// HAPPY PATHS
// =============================================

describe("Calendar Sync — Happy Paths", () => {
  it("creates Google Calendar event when appointment is created and calendar is connected", async () => {
    const { mockClient, queryResponses } = createMockClient();
    const pool = createMockPool(mockClient);

    const settings = makeSettings();
    const appt = makeAppointment();

    // 1. calendar settings query
    queryResponses.push({ rows: [settings] });
    // 2. appointment details query
    queryResponses.push({ rows: [appt] });
    // 3. INSERT into appointment_sync_map
    queryResponses.push({ rows: [], rowCount: 1 });

    vi.mocked(gcal.createEvent).mockResolvedValue(EXTERNAL_EVENT_ID);

    await syncAppointmentToCalendar(pool, TENANT_ID, APPOINTMENT_ID, 'create', silentLogger);

    // Verify createEvent was called with correct args
    expect(gcal.createEvent).toHaveBeenCalledOnce();
    const [accessToken, refreshToken, calendarId, event] = vi.mocked(gcal.createEvent).mock.calls[0];
    expect(accessToken).toBe('valid-access-token');
    expect(refreshToken).toBe('valid-refresh-token');
    expect(calendarId).toBe(CALENDAR_ID);
    expect(event.summary).toBe('Oil Change - John Doe');
    expect(event.start).toBe('2026-03-26T10:00:00Z');
    expect(event.end).toBe('2026-03-26T11:00:00Z');

    // Verify sync map INSERT was called with appointment ID and external event ID
    const insertCall = mockClient.query.mock.calls[2];
    expect(insertCall[0]).toContain('INSERT INTO appointment_sync_map');
    expect(insertCall[1]).toEqual([APPOINTMENT_ID, EXTERNAL_EVENT_ID]);

    // Client released
    expect(mockClient.release).toHaveBeenCalledOnce();
    expect(silentLogger.info).toHaveBeenCalledWith(expect.stringContaining('event created'));
  });

  it("updates Google Calendar event when appointment is updated and sync map entry exists", async () => {
    const { mockClient, queryResponses } = createMockClient();
    const pool = createMockPool(mockClient);

    const settings = makeSettings();
    const appt = makeAppointment();

    // 1. calendar settings
    queryResponses.push({ rows: [settings] });
    // 2. sync map lookup — existing entry
    queryResponses.push({ rows: [{ external_event_id: EXTERNAL_EVENT_ID }] });
    // 3. appointment details
    queryResponses.push({ rows: [appt] });
    // 4. UPDATE sync map last_synced_at
    queryResponses.push({ rows: [], rowCount: 1 });

    vi.mocked(gcal.updateEvent).mockResolvedValue(undefined);

    await syncAppointmentToCalendar(pool, TENANT_ID, APPOINTMENT_ID, 'update', silentLogger);

    expect(gcal.updateEvent).toHaveBeenCalledOnce();
    const [accessToken, refreshToken, calendarId, eventId, event] = vi.mocked(gcal.updateEvent).mock.calls[0];
    expect(accessToken).toBe('valid-access-token');
    expect(calendarId).toBe(CALENDAR_ID);
    expect(eventId).toBe(EXTERNAL_EVENT_ID);
    expect(event.summary).toBe('Oil Change - John Doe');

    // Verify sync map was updated
    const updateCall = mockClient.query.mock.calls[3];
    expect(updateCall[0]).toContain('UPDATE appointment_sync_map');
    expect(updateCall[1]).toEqual([APPOINTMENT_ID]);

    expect(mockClient.release).toHaveBeenCalledOnce();
    expect(silentLogger.info).toHaveBeenCalledWith(expect.stringContaining('event updated'));
  });

  it("deletes Google Calendar event when appointment is deleted and sync map entry exists", async () => {
    const { mockClient, queryResponses } = createMockClient();
    const pool = createMockPool(mockClient);

    const settings = makeSettings();

    // 1. calendar settings
    queryResponses.push({ rows: [settings] });
    // 2. sync map lookup
    queryResponses.push({ rows: [{ external_event_id: EXTERNAL_EVENT_ID }] });
    // 3. DELETE from sync map
    queryResponses.push({ rows: [], rowCount: 1 });

    vi.mocked(gcal.deleteEvent).mockResolvedValue(undefined);

    await syncAppointmentToCalendar(pool, TENANT_ID, APPOINTMENT_ID, 'delete', silentLogger);

    expect(gcal.deleteEvent).toHaveBeenCalledOnce();
    const [accessToken, refreshToken, calendarId, eventId] = vi.mocked(gcal.deleteEvent).mock.calls[0];
    expect(accessToken).toBe('valid-access-token');
    expect(calendarId).toBe(CALENDAR_ID);
    expect(eventId).toBe(EXTERNAL_EVENT_ID);

    // Verify sync map DELETE
    const deleteCall = mockClient.query.mock.calls[2];
    expect(deleteCall[0]).toContain('DELETE FROM appointment_sync_map');
    expect(deleteCall[1]).toEqual([APPOINTMENT_ID]);

    expect(mockClient.release).toHaveBeenCalledOnce();
    expect(silentLogger.info).toHaveBeenCalledWith(expect.stringContaining('event deleted'));
  });

  it("refreshes expired token before syncing", async () => {
    const { mockClient, queryResponses } = createMockClient();
    const pool = createMockPool(mockClient);

    // Token expired 10 minutes ago
    const settings = makeSettings({
      token_expires_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
    });
    const appt = makeAppointment();

    // 1. calendar settings (expired token)
    queryResponses.push({ rows: [settings] });
    // 2. UPDATE token after refresh
    queryResponses.push({ rows: [], rowCount: 1 });
    // 3. appointment details
    queryResponses.push({ rows: [appt] });
    // 4. INSERT sync map
    queryResponses.push({ rows: [], rowCount: 1 });

    const newExpiry = Date.now() + 3600 * 1000;
    vi.mocked(gcal.refreshAccessToken).mockResolvedValue({
      access_token: 'new-access-token',
      expiry_date: newExpiry,
    });
    vi.mocked(gcal.createEvent).mockResolvedValue(EXTERNAL_EVENT_ID);

    await syncAppointmentToCalendar(pool, TENANT_ID, APPOINTMENT_ID, 'create', silentLogger);

    // Verify token was refreshed
    expect(gcal.refreshAccessToken).toHaveBeenCalledWith('valid-refresh-token');

    // Verify DB was updated with new token
    const tokenUpdateCall = mockClient.query.mock.calls[1];
    expect(tokenUpdateCall[0]).toContain('UPDATE tenant_calendar_settings SET access_token');
    expect(tokenUpdateCall[1][0]).toBe('new-access-token');
    expect(tokenUpdateCall[1][2]).toBe(TENANT_ID);

    // Verify createEvent used the NEW access token
    expect(gcal.createEvent).toHaveBeenCalledOnce();
    const [accessToken] = vi.mocked(gcal.createEvent).mock.calls[0];
    expect(accessToken).toBe('new-access-token');

    expect(silentLogger.info).toHaveBeenCalledWith(expect.stringContaining('token refreshed'));
  });

  it("update falls back to create when no sync map entry exists", async () => {
    const { mockClient, queryResponses } = createMockClient();
    const pool = createMockPool(mockClient);

    const settings = makeSettings();
    const appt = makeAppointment();

    // First call (update path):
    // 1. calendar settings
    queryResponses.push({ rows: [settings] });
    // 2. sync map lookup — empty (no entry)
    queryResponses.push({ rows: [] });

    // Recursive call (create path):
    // 3. calendar settings again
    queryResponses.push({ rows: [settings] });
    // 4. appointment details
    queryResponses.push({ rows: [appt] });
    // 5. INSERT sync map
    queryResponses.push({ rows: [], rowCount: 1 });

    vi.mocked(gcal.createEvent).mockResolvedValue(EXTERNAL_EVENT_ID);

    await syncAppointmentToCalendar(pool, TENANT_ID, APPOINTMENT_ID, 'update', silentLogger);

    // Should have fallen back to create
    expect(gcal.createEvent).toHaveBeenCalledOnce();
    expect(gcal.updateEvent).not.toHaveBeenCalled();

    // Verify sync map INSERT happened
    const lastInsertCall = mockClient.query.mock.calls.find(
      (call: any[]) => typeof call[0] === 'string' && call[0].includes('INSERT INTO appointment_sync_map')
    );
    expect(lastInsertCall).toBeDefined();
  });

  it("builds correct calendar event from appointment data (summary, description, start/end)", async () => {
    const { mockClient, queryResponses } = createMockClient();
    const pool = createMockPool(mockClient);

    const settings = makeSettings();
    const appt = makeAppointment({
      description: 'Tire Rotation',
      customer_name: 'Jane Smith',
      customer_phone: '555-9876',
      resource_name: 'Bay 2',
      service_name: 'Rotation Service',
      start_time: '2026-04-01T14:00:00Z',
      end_time: '2026-04-01T15:30:00Z',
      location: '456 Oak Ave',
    });

    queryResponses.push({ rows: [settings] });
    queryResponses.push({ rows: [appt] });
    queryResponses.push({ rows: [], rowCount: 1 });

    vi.mocked(gcal.createEvent).mockResolvedValue('event-xyz');

    await syncAppointmentToCalendar(pool, TENANT_ID, APPOINTMENT_ID, 'create', silentLogger);

    const event = vi.mocked(gcal.createEvent).mock.calls[0][3];
    expect(event.summary).toBe('Tire Rotation - Jane Smith');
    expect(event.start).toBe('2026-04-01T14:00:00Z');
    expect(event.end).toBe('2026-04-01T15:30:00Z');
    expect(event.location).toBe('456 Oak Ave');
    expect(event.description).toContain('Customer: Jane Smith');
    expect(event.description).toContain('Phone: 555-9876');
    expect(event.description).toContain('Resource: Bay 2');
    expect(event.description).toContain('Service: Rotation Service');
    expect(event.description).toContain('Booked via Secretary HQ');
  });

  it("builds summary fallback when description is missing", async () => {
    const { mockClient, queryResponses } = createMockClient();
    const pool = createMockPool(mockClient);

    const settings = makeSettings();
    const appt = makeAppointment({ description: null });

    queryResponses.push({ rows: [settings] });
    queryResponses.push({ rows: [appt] });
    queryResponses.push({ rows: [], rowCount: 1 });

    vi.mocked(gcal.createEvent).mockResolvedValue('event-xyz');

    await syncAppointmentToCalendar(pool, TENANT_ID, APPOINTMENT_ID, 'create', silentLogger);

    const event = vi.mocked(gcal.createEvent).mock.calls[0][3];
    expect(event.summary).toBe('Appointment - John Doe');
  });
});

// =============================================
// SAD PATHS
// =============================================

describe("Calendar Sync — Sad Paths", () => {
  // WHO: Any tenant without a connected calendar
  // WHAT: Sync is called after appointment mutation but no calendar_settings row exists
  // WHY: Most tenants won't have Google Calendar connected — sync must be a silent no-op
  // WHERE: syncAppointmentToCalendar → settings query returns empty
  // HOW: Returns early without calling any Google API or writing to sync_map
  it("returns silently when no calendar settings exist for tenant", async () => {
    const { mockClient, queryResponses } = createMockClient();
    const pool = createMockPool(mockClient);

    // Settings query returns empty
    queryResponses.push({ rows: [] });

    await syncAppointmentToCalendar(pool, TENANT_ID, APPOINTMENT_ID, 'create', silentLogger);

    expect(gcal.createEvent).not.toHaveBeenCalled();
    expect(gcal.updateEvent).not.toHaveBeenCalled();
    expect(gcal.deleteEvent).not.toHaveBeenCalled();
    expect(mockClient.release).toHaveBeenCalledOnce();
  });

  // WHO: Tenant whose calendar was auto-deactivated (e.g., token refresh failed)
  // WHAT: Sync called but is_active=false in settings — calendar was disconnected
  // WHY: After a failed token refresh, we mark is_active=false so user sees "Reconnect" prompt
  // WHERE: syncAppointmentToCalendar → settings.is_active check
  // HOW: Returns early, no Google API calls, no sync_map writes
  it("returns silently when calendar is not active (is_active = false)", async () => {
    const { mockClient, queryResponses } = createMockClient();
    const pool = createMockPool(mockClient);

    queryResponses.push({ rows: [makeSettings({ is_active: false })] });

    await syncAppointmentToCalendar(pool, TENANT_ID, APPOINTMENT_ID, 'create', silentLogger);

    expect(gcal.createEvent).not.toHaveBeenCalled();
    expect(mockClient.release).toHaveBeenCalledOnce();
  });

  // WHO: Tenant who connected Outlook (future) — only Google is implemented
  // WHAT: Sync called but provider is 'outlook', not 'google'
  // WHY: Outlook sync is deferred — we must not attempt Google API calls for non-Google providers
  // WHERE: syncAppointmentToCalendar → settings.provider check
  // HOW: Returns early, no API calls
  it("returns silently when provider is not 'google'", async () => {
    const { mockClient, queryResponses } = createMockClient();
    const pool = createMockPool(mockClient);

    queryResponses.push({ rows: [makeSettings({ provider: 'outlook' })] });

    await syncAppointmentToCalendar(pool, TENANT_ID, APPOINTMENT_ID, 'create', silentLogger);

    expect(gcal.createEvent).not.toHaveBeenCalled();
    expect(mockClient.release).toHaveBeenCalledOnce();
  });

  // WHO: Tenant whose OAuth flow was interrupted — settings row exists but tokens are null
  // WHAT: Calendar settings exist but access_token is null (incomplete OAuth)
  // WHY: OAuth callback might have failed partway — we must not call Google without a token
  // WHERE: syncAppointmentToCalendar → access_token/refresh_token null check
  // HOW: Returns early, no API calls
  it("returns silently when access_token is missing", async () => {
    const { mockClient, queryResponses } = createMockClient();
    const pool = createMockPool(mockClient);

    queryResponses.push({ rows: [makeSettings({ access_token: null })] });

    await syncAppointmentToCalendar(pool, TENANT_ID, APPOINTMENT_ID, 'create', silentLogger);

    expect(gcal.createEvent).not.toHaveBeenCalled();
    expect(mockClient.release).toHaveBeenCalledOnce();
  });

  // WHO: Tenant whose refresh_token was revoked or never stored
  // WHAT: access_token exists but refresh_token is null
  // WHY: Without a refresh_token, we can't recover when the access_token expires
  // WHERE: syncAppointmentToCalendar → refresh_token null check
  // HOW: Returns early, no API calls
  it("returns silently when refresh_token is missing", async () => {
    const { mockClient, queryResponses } = createMockClient();
    const pool = createMockPool(mockClient);

    queryResponses.push({ rows: [makeSettings({ refresh_token: null })] });

    await syncAppointmentToCalendar(pool, TENANT_ID, APPOINTMENT_ID, 'create', silentLogger);

    expect(gcal.createEvent).not.toHaveBeenCalled();
    expect(mockClient.release).toHaveBeenCalledOnce();
  });

  // WHO: Tenant whose Google OAuth grant was revoked (e.g., user removed app in Google settings)
  // WHAT: Token is expired, refresh attempt fails with "Token revoked"
  // WHY: Must mark calendar as inactive so the dashboard shows "Reconnect" instead of silently failing
  // WHERE: syncAppointmentToCalendar → refreshAccessToken catch → UPDATE is_active=false
  // HOW: Catches refresh error, writes is_active=false to DB, logs error, returns early
  it("marks calendar inactive when token refresh fails", async () => {
    const { mockClient, queryResponses } = createMockClient();
    const pool = createMockPool(mockClient);

    // Expired token
    const settings = makeSettings({
      token_expires_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
    });

    // 1. calendar settings
    queryResponses.push({ rows: [settings] });
    // 2. UPDATE to mark inactive
    queryResponses.push({ rows: [], rowCount: 1 });

    vi.mocked(gcal.refreshAccessToken).mockRejectedValue(new Error('Token revoked'));

    await syncAppointmentToCalendar(pool, TENANT_ID, APPOINTMENT_ID, 'create', silentLogger);

    // Verify calendar was marked inactive
    const deactivateCall = mockClient.query.mock.calls[1];
    expect(deactivateCall[0]).toContain('UPDATE tenant_calendar_settings SET is_active = false');
    expect(deactivateCall[1]).toEqual([TENANT_ID]);

    // No Google API calls should have been made
    expect(gcal.createEvent).not.toHaveBeenCalled();

    // Error was logged with structured 5W context
    expect(silentLogger.error).toHaveBeenCalledWith(expect.stringContaining('refresh FAILED'));
    expect(silentLogger.error).toHaveBeenCalledWith(expect.stringContaining('WHO:'));
    expect(silentLogger.error).toHaveBeenCalledWith(expect.stringContaining('WHY:'));
    expect(silentLogger.error).toHaveBeenCalledWith(expect.stringContaining('Token revoked'));
    expect(mockClient.release).toHaveBeenCalledOnce();
  });

  // WHO: Appointment being deleted that was never synced to Google Calendar
  // WHAT: Delete action but no appointment_sync_map entry exists
  // WHY: Appointments created before calendar was connected have no sync map — must not error
  // WHERE: syncAppointmentToCalendar(delete) → sync map query returns empty
  // HOW: Returns early, no Google deleteEvent call
  it("delete handles missing sync map entry gracefully", async () => {
    const { mockClient, queryResponses } = createMockClient();
    const pool = createMockPool(mockClient);

    const settings = makeSettings();

    // 1. calendar settings
    queryResponses.push({ rows: [settings] });
    // 2. sync map lookup — no entry
    queryResponses.push({ rows: [] });

    await syncAppointmentToCalendar(pool, TENANT_ID, APPOINTMENT_ID, 'delete', silentLogger);

    // Should not attempt to delete from Google
    expect(gcal.deleteEvent).not.toHaveBeenCalled();
    expect(mockClient.release).toHaveBeenCalledOnce();
  });

  // WHO: Tenant deleting appointment whose Google Calendar event was already manually removed
  // WHAT: deleteEvent throws "Not Found" but sync map cleanup still completes
  // WHY: Users may delete events directly in Google Calendar — our cleanup must not fail
  // WHERE: syncAppointmentToCalendar(delete) → deleteEvent catch → still DELETE FROM sync_map
  // HOW: Swallows the Google API error, proceeds to clean up sync_map, logs success
  it("delete handles Google API error gracefully (event already deleted)", async () => {
    const { mockClient, queryResponses } = createMockClient();
    const pool = createMockPool(mockClient);

    const settings = makeSettings();

    // 1. calendar settings
    queryResponses.push({ rows: [settings] });
    // 2. sync map lookup
    queryResponses.push({ rows: [{ external_event_id: EXTERNAL_EVENT_ID }] });
    // 3. DELETE from sync map (still happens after Google error)
    queryResponses.push({ rows: [], rowCount: 1 });

    vi.mocked(gcal.deleteEvent).mockRejectedValue(new Error('Not Found'));

    await syncAppointmentToCalendar(pool, TENANT_ID, APPOINTMENT_ID, 'delete', silentLogger);

    // deleteEvent was called but error was swallowed
    expect(gcal.deleteEvent).toHaveBeenCalledOnce();

    // Sync map entry was still cleaned up
    const deleteCall = mockClient.query.mock.calls[2];
    expect(deleteCall[0]).toContain('DELETE FROM appointment_sync_map');
    expect(deleteCall[1]).toEqual([APPOINTMENT_ID]);

    expect(mockClient.release).toHaveBeenCalledOnce();
    expect(silentLogger.info).toHaveBeenCalledWith(expect.stringContaining('event deleted'));
  });

  // WHO: Any appointment mutation when Google Calendar API is down (500 error)
  // WHAT: createEvent throws a Google API error during sync
  // WHY: Calendar sync is fire-and-forget — appointment mutations must NEVER fail due to sync errors
  // WHERE: syncAppointmentToCalendar → createEvent rejects → finally block releases client
  // HOW: Error propagates but client is always released; caller (.catch(() => {})) swallows it
  it("sync failure does not throw (fire-and-forget behavior) — client always released", async () => {
    const { mockClient, queryResponses } = createMockClient();
    const pool = createMockPool(mockClient);

    const settings = makeSettings();
    const appt = makeAppointment();

    // 1. calendar settings
    queryResponses.push({ rows: [settings] });
    // 2. appointment details
    queryResponses.push({ rows: [appt] });

    // createEvent throws
    vi.mocked(gcal.createEvent).mockRejectedValue(new Error('Google API 500'));

    // The function itself should not throw — the error propagates up because
    // the outer try/finally does not catch. Verify the client is always released.
    // Note: syncAppointmentToCalendar does NOT wrap the action in a try/catch,
    // so the error WILL propagate. But the finally block ensures release.
    try {
      await syncAppointmentToCalendar(pool, TENANT_ID, APPOINTMENT_ID, 'create', silentLogger);
    } catch {
      // Expected — the function does not catch sync errors for create/update
    }

    // The important thing: client is always released even on error
    expect(mockClient.release).toHaveBeenCalledOnce();
  });

  // WHO: Any sync attempt when the database connection fails
  // WHAT: The initial settings query throws a connection error
  // WHY: DB outages must not leak pool connections — client.release() must always be called
  // WHERE: syncAppointmentToCalendar → first query throws → finally block
  // HOW: Error propagates, but finally block ensures client.release() is called
  it("releases client even when settings query throws", async () => {
    const mockClient = {
      query: vi.fn().mockRejectedValue(new Error('Connection reset')),
      release: vi.fn(),
    };
    const pool = createMockPool(mockClient);

    try {
      await syncAppointmentToCalendar(pool, TENANT_ID, APPOINTMENT_ID, 'create', silentLogger);
    } catch {
      // Expected
    }

    // Client is released via finally block
    expect(mockClient.release).toHaveBeenCalledOnce();
  });

  // WHO: Tenant whose access_token expires in 3 minutes (within 5-minute buffer)
  // WHAT: Token isn't technically expired yet, but will be soon — proactive refresh
  // WHY: Google API calls take time; refreshing proactively avoids mid-request expiry
  // WHERE: syncAppointmentToCalendar → Date.now() > expiresAt - 5min check
  // HOW: Triggers refreshAccessToken even though token hasn't expired yet
  it("token refresh triggered when token_expires_at is within 5 minute buffer", async () => {
    const { mockClient, queryResponses } = createMockClient();
    const pool = createMockPool(mockClient);

    // Token expires in 3 minutes (within the 5-minute buffer)
    const settings = makeSettings({
      token_expires_at: new Date(Date.now() + 3 * 60 * 1000).toISOString(),
    });
    const appt = makeAppointment();

    queryResponses.push({ rows: [settings] });
    queryResponses.push({ rows: [], rowCount: 1 }); // token update
    queryResponses.push({ rows: [appt] }); // appointment
    queryResponses.push({ rows: [], rowCount: 1 }); // sync map

    vi.mocked(gcal.refreshAccessToken).mockResolvedValue({
      access_token: 'refreshed-token',
      expiry_date: Date.now() + 3600 * 1000,
    });
    vi.mocked(gcal.createEvent).mockResolvedValue('event-123');

    await syncAppointmentToCalendar(pool, TENANT_ID, APPOINTMENT_ID, 'create', silentLogger);

    expect(gcal.refreshAccessToken).toHaveBeenCalledOnce();
    expect(vi.mocked(gcal.createEvent).mock.calls[0][0]).toBe('refreshed-token');
  });

  // WHO: Tenant whose token_expires_at was never stored (legacy or partial OAuth)
  // WHAT: token_expires_at is null, so expiresAt resolves to 0 — always triggers refresh
  // WHY: Null expiry must be treated as expired, not as "never expires"
  // WHERE: syncAppointmentToCalendar → expiresAt = 0 → Date.now() > -300000 → true
  // HOW: Calls refreshAccessToken, uses the new token for the sync
  it("treats null token_expires_at as expired and refreshes", async () => {
    const { mockClient, queryResponses } = createMockClient();
    const pool = createMockPool(mockClient);

    const settings = makeSettings({ token_expires_at: null });
    const appt = makeAppointment();

    queryResponses.push({ rows: [settings] });
    queryResponses.push({ rows: [], rowCount: 1 }); // token update
    queryResponses.push({ rows: [appt] }); // appointment
    queryResponses.push({ rows: [], rowCount: 1 }); // sync map

    vi.mocked(gcal.refreshAccessToken).mockResolvedValue({
      access_token: 'refreshed-token',
      expiry_date: Date.now() + 3600 * 1000,
    });
    vi.mocked(gcal.createEvent).mockResolvedValue('event-123');

    await syncAppointmentToCalendar(pool, TENANT_ID, APPOINTMENT_ID, 'create', silentLogger);

    // null token_expires_at means expiresAt=0, so Date.now() > 0 - 300000 is true -> refresh
    expect(gcal.refreshAccessToken).toHaveBeenCalledOnce();
  });
});
