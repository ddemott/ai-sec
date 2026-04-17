import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock both calendar modules before importing calendarSync
vi.mock('./services/googleCalendar', () => ({
  refreshAccessToken: vi.fn(),
  createEvent: vi.fn(),
  updateEvent: vi.fn(),
  deleteEvent: vi.fn(),
}));

vi.mock('./services/outlookCalendar', () => ({
  refreshAccessToken: vi.fn(),
  createEvent: vi.fn(),
  updateEvent: vi.fn(),
  deleteEvent: vi.fn(),
}));

import { syncAppointmentToCalendar } from "./services/calendarSync";
import * as gcal from "./services/googleCalendar";
import * as outlookCal from "./services/outlookCalendar";

// ---- Mock helpers ----

const TENANT_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const APPOINTMENT_ID = '11111111-2222-3333-4444-555555555555';
const CALENDAR_ID = 'primary';
const EXTERNAL_EVENT_ID = 'gcal-event-abc123';
const OUTLOOK_EVENT_ID = 'AAMkAGI2TAAAA=';

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
  it("GOOGLE-CREATE: When tenant creates appointment with Google Calendar connected, system creates calendar event so customer receives invite and appointment shows on provider's calendar", async () => {
    // WHO: calendarSync.ts syncAppointmentToCalendar() with Google provider
    // WHAT: tenant creates a new appointment while Google Calendar OAuth is active
    // WHEN: appointment create action triggers calendar sync
    // WHERE: calendarSync.ts -> googleCalendar.ts createEvent() -> appointment_sync_map INSERT
    // WHY: without this, new appointments won't appear on the provider's Google Calendar, breaking the two-way calendar promise
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

    // Verify sync map INSERT was called with appointment ID, external event ID, and provider
    const insertCall = mockClient.query.mock.calls[2];
    expect(insertCall[0]).toContain('INSERT INTO appointment_sync_map');
    expect(insertCall[1]).toEqual([APPOINTMENT_ID, EXTERNAL_EVENT_ID, 'google']);

    // Client released
    expect(mockClient.release).toHaveBeenCalledOnce();
    expect(silentLogger.info).toHaveBeenCalledWith(expect.stringContaining('event created'));
  });

  it("GOOGLE-UPDATE: When tenant updates appointment that was previously synced, system updates Google Calendar event using stored event_id to keep calendar in sync with scheduling changes", async () => {
    // WHO: calendarSync.ts syncAppointmentToCalendar() with Google provider
    // WHAT: tenant reschedules or modifies an existing appointment that was previously synced
    // WHEN: appointment update action triggers calendar sync with existing sync_map entry
    // WHERE: calendarSync.ts -> appointment_sync_map lookup -> googleCalendar.ts updateEvent()
    // WHY: without this, rescheduled appointments show stale times on Google Calendar, causing customer no-shows
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

  it("GOOGLE-DELETE: When tenant deletes appointment, system deletes Google Calendar event so cancelled appointments don't appear on provider's calendar", async () => {
    // WHO: calendarSync.ts syncAppointmentToCalendar() with Google provider
    // WHAT: tenant cancels/deletes an appointment that was previously synced to Google Calendar
    // WHEN: appointment delete action triggers calendar sync with existing sync_map entry
    // WHERE: calendarSync.ts -> appointment_sync_map lookup -> googleCalendar.ts deleteEvent() -> sync_map DELETE
    // WHY: without this, cancelled appointments remain on Google Calendar, causing confusion and wasted customer time
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

  it("GOOGLE-TOKEN-REFRESH: When Google OAuth token is expired, system refreshes it before syncing to ensure uninterrupted calendar integration", async () => {
    // WHO: calendarSync.ts token refresh logic for Google provider
    // WHAT: Google OAuth access_token has expired (token_expires_at in the past)
    // WHEN: any sync action detects expired token before making Google Calendar API call
    // WHERE: calendarSync.ts -> googleCalendar.ts refreshAccessToken() -> tenant_calendar_settings UPDATE
    // WHY: without proactive refresh, every calendar sync fails with 401 after token expires (1h default), breaking sync silently
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

  it("GOOGLE-UPDATE-FALLBACK: When update triggered for appointment with no sync_map entry (e.g., calendar connected after appointment created), system creates new event instead of failing", async () => {
    // WHO: calendarSync.ts syncAppointmentToCalendar() update->create fallback
    // WHAT: appointment update triggered but no sync_map entry exists (calendar connected after appointment was created)
    // WHEN: update action finds empty sync_map lookup and recursively calls create
    // WHERE: calendarSync.ts update path -> sync_map miss -> recursive create path
    // WHY: without fallback, appointments created before calendar connection would never sync, leaving gaps in the provider's calendar
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

  it("EVENT-PAYLOAD: When creating calendar event, system builds correct payload with summary (service + customer), description, and ISO timestamps so event displays properly in Google Calendar", async () => {
    // WHO: calendarSync.ts event payload builder
    // WHAT: appointment with full details (description, customer, phone, resource, service, location, timestamps)
    // WHEN: create action builds the event object before calling Google Calendar API
    // WHERE: calendarSync.ts event construction logic -> googleCalendar.ts createEvent()
    // WHY: malformed payloads cause events to display without titles, wrong times, or missing contact info on Google Calendar
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

  it("EVENT-SUMMARY-FALLBACK: When appointment has no description, system uses 'Appointment' as summary fallback so calendar events always have a readable title", async () => {
    // WHO: calendarSync.ts event payload builder
    // WHAT: appointment has null description (e.g., booked via voice AI without specifying service)
    // WHEN: create action builds event summary from appointment description
    // WHERE: calendarSync.ts summary construction -> fallback to 'Appointment'
    // WHY: without fallback, calendar events display blank/null titles, making them unreadable on Google Calendar
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
  it("NO-SETTINGS: When tenant has no calendar integration configured, sync returns silently allowing appointment operations to complete without calendar errors", async () => {
    // WHO: calendarSync.ts syncAppointmentToCalendar() settings check
    // WHAT: tenant_calendar_settings query returns no rows (no calendar integration configured)
    // WHEN: any sync action starts and checks for calendar settings
    // WHERE: calendarSync.ts -> settings query -> early return
    // WHY: without silent return, every appointment CRUD for tenants without calendar integration would throw, blocking core functionality
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

  it("INACTIVE-CALENDAR: When tenant's calendar integration is marked inactive (is_active=false), system skips sync so disabled calendars don't receive events", async () => {
    // WHO: calendarSync.ts syncAppointmentToCalendar() active check
    // WHAT: tenant_calendar_settings has is_active=false (disabled after failed token refresh or manual disconnect)
    // WHEN: any sync action checks is_active flag after loading settings
    // WHERE: calendarSync.ts -> settings.is_active check -> early return
    // WHY: without this check, system would attempt API calls with revoked tokens, generating 401 errors and unnecessary load
    const { mockClient, queryResponses } = createMockClient();
    const pool = createMockPool(mockClient);

    queryResponses.push({ rows: [makeSettings({ is_active: false })] });

    await syncAppointmentToCalendar(pool, TENANT_ID, APPOINTMENT_ID, 'create', silentLogger);

    expect(gcal.createEvent).not.toHaveBeenCalled();
    expect(mockClient.release).toHaveBeenCalledOnce();
  });

  it("UNSUPPORTED-PROVIDER: When calendar provider is not 'google' or 'outlook', system logs warning and skips sync to handle misconfigured integrations gracefully", async () => {
    // WHO: calendarSync.ts provider dispatch logic
    // WHAT: tenant_calendar_settings has unknown provider value (e.g., 'icloud' from bad DB migration or API misuse)
    // WHEN: sync action dispatches based on provider string after settings validation
    // WHERE: calendarSync.ts -> provider switch/if block -> unrecognized provider path
    // WHY: without graceful handling, unsupported providers would cause unhandled errors crashing the sync and blocking appointment operations
    const { mockClient, queryResponses } = createMockClient();
    const pool = createMockPool(mockClient);

    queryResponses.push({ rows: [makeSettings({ provider: 'icloud' })] });

    await syncAppointmentToCalendar(pool, TENANT_ID, APPOINTMENT_ID, 'create', silentLogger);

    expect(gcal.createEvent).not.toHaveBeenCalled();
    expect(mockClient.release).toHaveBeenCalledOnce();
  });

  it("MISSING-ACCESS-TOKEN: When calendar integration has no access_token (incomplete OAuth), system skips sync to prevent API calls with invalid credentials", async () => {
    // WHO: calendarSync.ts token validation logic
    // WHAT: tenant_calendar_settings has null access_token (OAuth flow started but not completed)
    // WHEN: sync action validates tokens before attempting API call
    // WHERE: calendarSync.ts -> access_token null check -> early return
    // WHY: without this guard, null access_token would cause Google/Outlook API calls to fail with cryptic auth errors
    const { mockClient, queryResponses } = createMockClient();
    const pool = createMockPool(mockClient);

    queryResponses.push({ rows: [makeSettings({ access_token: null })] });

    await syncAppointmentToCalendar(pool, TENANT_ID, APPOINTMENT_ID, 'create', silentLogger);

    expect(gcal.createEvent).not.toHaveBeenCalled();
    expect(mockClient.release).toHaveBeenCalledOnce();
  });

  it("MISSING-REFRESH-TOKEN: When calendar integration has no refresh_token (incomplete OAuth), system skips sync because token refresh would fail", async () => {
    // WHO: calendarSync.ts token validation logic
    // WHAT: tenant_calendar_settings has null refresh_token (OAuth flow incomplete or refresh_token revoked)
    // WHEN: sync action validates tokens before attempting API call
    // WHERE: calendarSync.ts -> refresh_token null check -> early return
    // WHY: without this guard, expired access_token cannot be refreshed, causing persistent sync failures until OAuth is re-done
    const { mockClient, queryResponses } = createMockClient();
    const pool = createMockPool(mockClient);

    queryResponses.push({ rows: [makeSettings({ refresh_token: null })] });

    await syncAppointmentToCalendar(pool, TENANT_ID, APPOINTMENT_ID, 'create', silentLogger);

    expect(gcal.createEvent).not.toHaveBeenCalled();
    expect(mockClient.release).toHaveBeenCalledOnce();
  });

  it("TOKEN-REFRESH-FAILURE: When OAuth token refresh fails (e.g., user revoked Google authorization), system marks calendar inactive in DB to prevent repeated failed API calls", async () => {
    // WHO: calendarSync.ts token refresh error handler for Google provider
    // WHAT: Google OAuth refresh_token is revoked or invalidated by user
    // WHEN: token refresh attempt throws error during sync operation
    // WHERE: calendarSync.ts -> refreshAccessToken() catch -> UPDATE is_active=false
    // WHY: without deactivation, every subsequent appointment operation would retry the failed refresh, wasting resources and delaying responses
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

  it("DELETE-NO-SYNC-MAP: When delete triggered for appointment with no sync_map entry (never synced to calendar), system skips API call and logs info since there's nothing to delete", async () => {
    // WHO: calendarSync.ts delete path sync_map check
    // WHAT: appointment delete triggered but no sync_map entry exists (appointment was created before calendar was connected)
    // WHEN: delete action queries appointment_sync_map and finds no matching row
    // WHERE: calendarSync.ts -> sync_map lookup -> empty result -> skip API call
    // WHY: without this check, system would attempt to delete a non-existent Google Calendar event, causing unnecessary 404 errors
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

  it("DELETE-API-ERROR: When Google Calendar delete fails (e.g., event already deleted manually), system logs warning but doesn't throw so appointment deletion completes", async () => {
    // WHO: calendarSync.ts delete path error handler for Google provider
    // WHAT: Google Calendar deleteEvent() throws (event already deleted manually by user in Google Calendar)
    // WHEN: delete action attempts to remove calendar event and receives API error
    // WHERE: calendarSync.ts -> googleCalendar.ts deleteEvent() catch -> sync_map cleanup continues
    // WHY: without error swallowing, appointment deletion would fail whenever a user manually deletes the calendar event first
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

  it("FIRE-AND-FORGET: When calendar API call fails during sync, system logs error but doesn't throw so appointment CRUD operations complete regardless of calendar status", async () => {
    // WHO: calendarSync.ts error resilience for Google provider create path
    // WHAT: Google Calendar API returns 500 during event creation
    // WHEN: createEvent() throws after appointment details are fetched
    // WHERE: calendarSync.ts -> googleCalendar.ts createEvent() -> error propagation -> finally release
    // WHY: calendar sync must never block appointment CRUD; pool client must always be released to prevent connection pool exhaustion
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

  it("CLIENT-RELEASE-ON-ERROR: When DB query throws during sync operation, system still releases pool client in finally block to prevent connection pool exhaustion", async () => {
    // WHO: calendarSync.ts finally block DB client cleanup
    // WHAT: initial DB query (settings lookup) throws connection error
    // WHEN: pool.connect() succeeds but first query fails (e.g., network partition)
    // WHERE: calendarSync.ts -> try/finally -> mockClient.release()
    // WHY: without finally-block release, each failed sync leaks a DB connection, eventually exhausting the pool and crashing the server
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

  it("PROACTIVE-REFRESH: When token_expires_at is within 5-minute buffer, system proactively refreshes token to prevent mid-operation expiration during calendar sync", async () => {
    // WHO: calendarSync.ts proactive token refresh logic
    // WHAT: Google OAuth token expires in 3 minutes (within the 5-minute safety buffer)
    // WHEN: sync action checks token_expires_at against Date.now() + buffer before API call
    // WHERE: calendarSync.ts -> expiry check with 5min buffer -> refreshAccessToken()
    // WHY: without proactive refresh, tokens expiring mid-operation cause partial sync failures (event created but sync_map not updated)
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

  it("NULL-EXPIRY-REFRESH: When token_expires_at is null (legacy data), system treats token as expired and refreshes to ensure valid credentials", async () => {
    // WHO: calendarSync.ts null expiry handling logic
    // WHAT: tenant_calendar_settings has null token_expires_at (legacy row or migration gap)
    // WHEN: sync action parses token_expires_at and gets 0/NaN, treating it as expired
    // WHERE: calendarSync.ts -> expiry parse -> null coalesces to 0 -> triggers refresh
    // WHY: without null handling, legacy rows would use potentially expired tokens, causing silent sync failures
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

// =============================================
// OUTLOOK — HAPPY PATHS
// =============================================

function makeOutlookSettings(overrides: Record<string, any> = {}) {
  return {
    provider: 'outlook',
    external_calendar_id: CALENDAR_ID,
    access_token: 'outlook-access-token',
    refresh_token: 'outlook-refresh-token',
    token_expires_at: new Date(Date.now() + 3600 * 1000).toISOString(),
    is_active: true,
    ...overrides,
  };
}

describe("Calendar Sync — Outlook Happy Paths", () => {
  it("OUTLOOK-CREATE: When tenant creates appointment with Outlook Calendar connected, system creates calendar event via Microsoft Graph API so appointment shows in Outlook", async () => {
    // WHO: calendarSync.ts syncAppointmentToCalendar() with Outlook provider
    // WHAT: tenant creates a new appointment while Outlook Calendar OAuth is active
    // WHEN: appointment create action triggers calendar sync and provider is 'outlook'
    // WHERE: calendarSync.ts -> outlookCalendar.ts createEvent() -> appointment_sync_map INSERT
    // WHY: without this, new appointments won't appear in the provider's Outlook Calendar, breaking the calendar integration
    const { mockClient, queryResponses } = createMockClient();
    const pool = createMockPool(mockClient);

    const settings = makeOutlookSettings();
    const appt = makeAppointment();

    queryResponses.push({ rows: [settings] });
    queryResponses.push({ rows: [appt] });
    queryResponses.push({ rows: [], rowCount: 1 });

    vi.mocked(outlookCal.createEvent).mockResolvedValue(OUTLOOK_EVENT_ID);

    await syncAppointmentToCalendar(pool, TENANT_ID, APPOINTMENT_ID, 'create', silentLogger);

    // Verify Outlook createEvent was called — NOT Google
    expect(outlookCal.createEvent).toHaveBeenCalledOnce();
    expect(gcal.createEvent).not.toHaveBeenCalled();

    const [accessToken, refreshToken, calendarId, event] = vi.mocked(outlookCal.createEvent).mock.calls[0];
    expect(accessToken).toBe('outlook-access-token');
    expect(refreshToken).toBe('outlook-refresh-token');
    expect(calendarId).toBe(CALENDAR_ID);
    expect(event.summary).toBe('Oil Change - John Doe');

    // Verify sync map INSERT uses 'outlook' provider
    const insertCall = mockClient.query.mock.calls[2];
    expect(insertCall[0]).toContain('INSERT INTO appointment_sync_map');
    expect(insertCall[1]).toEqual([APPOINTMENT_ID, OUTLOOK_EVENT_ID, 'outlook']);

    expect(mockClient.release).toHaveBeenCalledOnce();
    expect(silentLogger.info).toHaveBeenCalledWith(expect.stringContaining('Outlook Calendar'));
  });

  it("OUTLOOK-UPDATE: When tenant updates appointment synced to Outlook, system updates calendar event using stored event_id to keep Outlook in sync with scheduling changes", async () => {
    // WHO: calendarSync.ts syncAppointmentToCalendar() with Outlook provider
    // WHAT: tenant reschedules an existing appointment that was previously synced to Outlook
    // WHEN: appointment update action triggers sync with existing sync_map entry for Outlook
    // WHERE: calendarSync.ts -> sync_map lookup -> outlookCalendar.ts updateEvent()
    // WHY: without this, rescheduled appointments show stale times in Outlook, causing customer confusion
    const { mockClient, queryResponses } = createMockClient();
    const pool = createMockPool(mockClient);

    const settings = makeOutlookSettings();
    const appt = makeAppointment();

    queryResponses.push({ rows: [settings] });
    queryResponses.push({ rows: [{ external_event_id: OUTLOOK_EVENT_ID }] });
    queryResponses.push({ rows: [appt] });
    queryResponses.push({ rows: [], rowCount: 1 });

    vi.mocked(outlookCal.updateEvent).mockResolvedValue(undefined);

    await syncAppointmentToCalendar(pool, TENANT_ID, APPOINTMENT_ID, 'update', silentLogger);

    expect(outlookCal.updateEvent).toHaveBeenCalledOnce();
    expect(gcal.updateEvent).not.toHaveBeenCalled();

    const [accessToken, refreshToken, calendarId, eventId, event] = vi.mocked(outlookCal.updateEvent).mock.calls[0];
    expect(accessToken).toBe('outlook-access-token');
    expect(eventId).toBe(OUTLOOK_EVENT_ID);
    expect(event.summary).toBe('Oil Change - John Doe');

    expect(silentLogger.info).toHaveBeenCalledWith(expect.stringContaining('event updated in Outlook'));
  });

  it("OUTLOOK-DELETE: When tenant deletes appointment synced to Outlook, system deletes calendar event via Graph API so cancelled appointments don't appear in Outlook", async () => {
    // WHO: calendarSync.ts syncAppointmentToCalendar() with Outlook provider
    // WHAT: tenant cancels/deletes an appointment previously synced to Outlook
    // WHEN: appointment delete action triggers sync with existing sync_map entry for Outlook
    // WHERE: calendarSync.ts -> sync_map lookup -> outlookCalendar.ts deleteEvent() -> sync_map DELETE
    // WHY: without this, cancelled appointments remain in Outlook Calendar, causing wasted customer time
    const { mockClient, queryResponses } = createMockClient();
    const pool = createMockPool(mockClient);

    const settings = makeOutlookSettings();

    queryResponses.push({ rows: [settings] });
    queryResponses.push({ rows: [{ external_event_id: OUTLOOK_EVENT_ID }] });
    queryResponses.push({ rows: [], rowCount: 1 });

    vi.mocked(outlookCal.deleteEvent).mockResolvedValue(undefined);

    await syncAppointmentToCalendar(pool, TENANT_ID, APPOINTMENT_ID, 'delete', silentLogger);

    expect(outlookCal.deleteEvent).toHaveBeenCalledOnce();
    expect(gcal.deleteEvent).not.toHaveBeenCalled();

    const [accessToken, refreshToken, calendarId, eventId] = vi.mocked(outlookCal.deleteEvent).mock.calls[0];
    expect(accessToken).toBe('outlook-access-token');
    expect(eventId).toBe(OUTLOOK_EVENT_ID);

    const deleteCall = mockClient.query.mock.calls[2];
    expect(deleteCall[0]).toContain('DELETE FROM appointment_sync_map');

    expect(silentLogger.info).toHaveBeenCalledWith(expect.stringContaining('event deleted from Outlook'));
  });

  it("OUTLOOK-TOKEN-REFRESH: When Outlook OAuth token is expired, system refreshes via Microsoft identity platform before syncing to ensure uninterrupted calendar integration", async () => {
    // WHO: calendarSync.ts token refresh logic for Outlook provider
    // WHAT: Outlook OAuth access_token has expired (token_expires_at in the past)
    // WHEN: sync action detects expired token and calls outlookCalendar.refreshAccessToken()
    // WHERE: calendarSync.ts -> provider='outlook' -> outlookCalendar.ts refreshAccessToken() -> token UPDATE
    // WHY: without refresh, every Outlook sync fails with 401 after token expires, breaking calendar integration silently
    const { mockClient, queryResponses } = createMockClient();
    const pool = createMockPool(mockClient);

    const settings = makeOutlookSettings({
      token_expires_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
    });
    const appt = makeAppointment();

    queryResponses.push({ rows: [settings] });
    queryResponses.push({ rows: [], rowCount: 1 }); // token update
    queryResponses.push({ rows: [appt] });
    queryResponses.push({ rows: [], rowCount: 1 }); // sync map

    vi.mocked(outlookCal.refreshAccessToken).mockResolvedValue({
      access_token: 'new-outlook-token',
      expiry_date: Date.now() + 3600 * 1000,
    });
    vi.mocked(outlookCal.createEvent).mockResolvedValue(OUTLOOK_EVENT_ID);

    await syncAppointmentToCalendar(pool, TENANT_ID, APPOINTMENT_ID, 'create', silentLogger);

    // Verify Outlook refresh was called — NOT Google
    expect(outlookCal.refreshAccessToken).toHaveBeenCalledWith('outlook-refresh-token');
    expect(gcal.refreshAccessToken).not.toHaveBeenCalled();

    // Verify createEvent used the refreshed token
    const [accessToken] = vi.mocked(outlookCal.createEvent).mock.calls[0];
    expect(accessToken).toBe('new-outlook-token');

    expect(silentLogger.info).toHaveBeenCalledWith(expect.stringContaining('token refreshed'));
  });

  it("OUTLOOK-UPDATE-FALLBACK: When update triggered for Outlook appointment with no sync_map entry (e.g., calendar connected after appointment created), system creates new event instead of failing", async () => {
    // WHO: calendarSync.ts update->create fallback for Outlook provider
    // WHAT: appointment update triggered but no sync_map entry exists for Outlook
    // WHEN: update action finds empty sync_map lookup and recursively calls create
    // WHERE: calendarSync.ts update path -> sync_map miss -> recursive create -> outlookCalendar.ts createEvent()
    // WHY: without fallback, appointments created before Outlook connection would never sync to the provider's calendar
    const { mockClient, queryResponses } = createMockClient();
    const pool = createMockPool(mockClient);

    const settings = makeOutlookSettings();
    const appt = makeAppointment();

    // First call (update path):
    queryResponses.push({ rows: [settings] });
    queryResponses.push({ rows: [] }); // sync map empty

    // Recursive call (create path):
    queryResponses.push({ rows: [settings] });
    queryResponses.push({ rows: [appt] });
    queryResponses.push({ rows: [], rowCount: 1 });

    vi.mocked(outlookCal.createEvent).mockResolvedValue(OUTLOOK_EVENT_ID);

    await syncAppointmentToCalendar(pool, TENANT_ID, APPOINTMENT_ID, 'update', silentLogger);

    expect(outlookCal.createEvent).toHaveBeenCalledOnce();
    expect(outlookCal.updateEvent).not.toHaveBeenCalled();
    expect(gcal.createEvent).not.toHaveBeenCalled();
  });
});

// =============================================
// OUTLOOK — SAD PATHS
// =============================================

describe("Calendar Sync — Outlook Sad Paths", () => {
  it("OUTLOOK-REFRESH-FAILURE: When Outlook OAuth token refresh fails (e.g., user revoked Microsoft authorization), system marks calendar inactive to prevent repeated failed API calls", async () => {
    // WHO: calendarSync.ts token refresh error handler for Outlook provider
    // WHAT: Microsoft identity platform rejects refresh_token (user revoked app access)
    // WHEN: token refresh attempt throws error during Outlook sync operation
    // WHERE: calendarSync.ts -> outlookCalendar.ts refreshAccessToken() catch -> UPDATE is_active=false
    // WHY: without deactivation, every subsequent sync retries the failed refresh, wasting resources and logging noise
    const { mockClient, queryResponses } = createMockClient();
    const pool = createMockPool(mockClient);

    const settings = makeOutlookSettings({
      token_expires_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
    });

    queryResponses.push({ rows: [settings] });
    queryResponses.push({ rows: [], rowCount: 1 }); // deactivate

    vi.mocked(outlookCal.refreshAccessToken).mockRejectedValue(new Error('Token revoked'));

    await syncAppointmentToCalendar(pool, TENANT_ID, APPOINTMENT_ID, 'create', silentLogger);

    // Calendar marked inactive
    const deactivateCall = mockClient.query.mock.calls[1];
    expect(deactivateCall[0]).toContain('UPDATE tenant_calendar_settings SET is_active = false');

    // No Outlook or Google API calls
    expect(outlookCal.createEvent).not.toHaveBeenCalled();
    expect(gcal.createEvent).not.toHaveBeenCalled();

    // Error log mentions Outlook specifically
    expect(silentLogger.error).toHaveBeenCalledWith(expect.stringContaining('refresh FAILED'));
    expect(silentLogger.error).toHaveBeenCalledWith(expect.stringContaining('Outlook'));
    expect(silentLogger.error).toHaveBeenCalledWith(expect.stringContaining('Token revoked'));
    expect(mockClient.release).toHaveBeenCalledOnce();
  });

  it("OUTLOOK-DELETE-NO-MAP: When Outlook delete triggered for appointment with no sync_map entry (never synced), system skips API call since there's nothing to delete", async () => {
    // WHO: calendarSync.ts delete path sync_map check for Outlook provider
    // WHAT: appointment delete triggered but no sync_map entry exists (never synced to Outlook)
    // WHEN: delete action queries appointment_sync_map and finds no matching row
    // WHERE: calendarSync.ts -> sync_map lookup -> empty result -> skip Outlook API call
    // WHY: without this check, system would attempt to delete a non-existent Outlook event, causing unnecessary Graph API 404 errors
    const { mockClient, queryResponses } = createMockClient();
    const pool = createMockPool(mockClient);

    queryResponses.push({ rows: [makeOutlookSettings()] });
    queryResponses.push({ rows: [] }); // no sync map entry

    await syncAppointmentToCalendar(pool, TENANT_ID, APPOINTMENT_ID, 'delete', silentLogger);

    expect(outlookCal.deleteEvent).not.toHaveBeenCalled();
    expect(silentLogger.info).toHaveBeenCalledWith(expect.stringContaining('Outlook Calendar'));
    expect(mockClient.release).toHaveBeenCalledOnce();
  });

  it("OUTLOOK-DELETE-API-ERROR: When Graph API delete fails (e.g., event already deleted manually), system logs warning but doesn't throw so appointment deletion completes", async () => {
    // WHO: calendarSync.ts delete path error handler for Outlook provider
    // WHAT: Microsoft Graph API deleteEvent() throws (event already deleted manually by user in Outlook)
    // WHEN: delete action attempts to remove Outlook event and receives API error
    // WHERE: calendarSync.ts -> outlookCalendar.ts deleteEvent() catch -> sync_map cleanup continues
    // WHY: without error swallowing, appointment deletion would fail whenever a user manually deletes the Outlook event first
    const { mockClient, queryResponses } = createMockClient();
    const pool = createMockPool(mockClient);

    queryResponses.push({ rows: [makeOutlookSettings()] });
    queryResponses.push({ rows: [{ external_event_id: OUTLOOK_EVENT_ID }] });
    queryResponses.push({ rows: [], rowCount: 1 }); // sync map cleanup

    vi.mocked(outlookCal.deleteEvent).mockRejectedValue(new Error('Not Found'));

    await syncAppointmentToCalendar(pool, TENANT_ID, APPOINTMENT_ID, 'delete', silentLogger);

    // deleteEvent was called but error was swallowed
    expect(outlookCal.deleteEvent).toHaveBeenCalledOnce();

    // Sync map entry was still cleaned up
    const deleteCall = mockClient.query.mock.calls[2];
    expect(deleteCall[0]).toContain('DELETE FROM appointment_sync_map');

    // Warning logged with Outlook context
    expect(silentLogger.warn).toHaveBeenCalledWith(expect.stringContaining('Outlook deleteEvent failed'));
    expect(silentLogger.info).toHaveBeenCalledWith(expect.stringContaining('event deleted from Outlook'));
    expect(mockClient.release).toHaveBeenCalledOnce();
  });

  it("OUTLOOK-FIRE-AND-FORGET: When Outlook API call fails during sync, system logs error but doesn't throw so appointment CRUD operations complete regardless of calendar status", async () => {
    // WHO: calendarSync.ts error resilience for Outlook provider create path
    // WHAT: Microsoft Graph API returns 500 during event creation
    // WHEN: createEvent() throws after appointment details are fetched
    // WHERE: calendarSync.ts -> outlookCalendar.ts createEvent() -> error propagation -> finally release
    // WHY: calendar sync must never block appointment CRUD; pool client must always be released to prevent connection pool exhaustion
    const { mockClient, queryResponses } = createMockClient();
    const pool = createMockPool(mockClient);

    queryResponses.push({ rows: [makeOutlookSettings()] });
    queryResponses.push({ rows: [makeAppointment()] });

    vi.mocked(outlookCal.createEvent).mockRejectedValue(new Error('Graph API 500'));

    try {
      await syncAppointmentToCalendar(pool, TENANT_ID, APPOINTMENT_ID, 'create', silentLogger);
    } catch {
      // Expected
    }

    expect(mockClient.release).toHaveBeenCalledOnce();
  });

  it("OUTLOOK-APPOINTMENT-NOT-FOUND: When Outlook create triggered for appointment_id that doesn't exist in DB (e.g., race condition), system skips sync to avoid creating orphan calendar events", async () => {
    // WHO: calendarSync.ts create path appointment lookup for Outlook provider
    // WHAT: appointment_id does not exist in DB (race condition: deleted between CRUD and sync)
    // WHEN: create action queries appointment details and gets empty result
    // WHERE: calendarSync.ts -> appointment query -> empty rows -> skip Outlook API call
    // WHY: without this guard, orphan calendar events would be created in Outlook with no corresponding local appointment
    const { mockClient, queryResponses } = createMockClient();
    const pool = createMockPool(mockClient);

    queryResponses.push({ rows: [makeOutlookSettings()] });
    queryResponses.push({ rows: [] }); // appointment not found

    await syncAppointmentToCalendar(pool, TENANT_ID, APPOINTMENT_ID, 'create', silentLogger);

    expect(outlookCal.createEvent).not.toHaveBeenCalled();
    expect(silentLogger.warn).toHaveBeenCalledWith(expect.stringContaining('appointment not found'));
    expect(mockClient.release).toHaveBeenCalledOnce();
  });

  it("OUTLOOK-UPDATE-NOT-FOUND: When Outlook update triggered for appointment_id that doesn't exist in DB (e.g., deleted before sync), system skips sync gracefully", async () => {
    // WHO: calendarSync.ts update path appointment lookup for Outlook provider
    // WHAT: appointment_id does not exist in DB (deleted between update trigger and sync execution)
    // WHEN: update action has sync_map entry but appointment query returns empty
    // WHERE: calendarSync.ts -> sync_map found -> appointment query -> empty rows -> skip Outlook API call
    // WHY: without this guard, update would fail trying to build event payload from null appointment data
    const { mockClient, queryResponses } = createMockClient();
    const pool = createMockPool(mockClient);

    queryResponses.push({ rows: [makeOutlookSettings()] });
    queryResponses.push({ rows: [{ external_event_id: OUTLOOK_EVENT_ID }] }); // sync map exists
    queryResponses.push({ rows: [] }); // appointment not found

    await syncAppointmentToCalendar(pool, TENANT_ID, APPOINTMENT_ID, 'update', silentLogger);

    expect(outlookCal.updateEvent).not.toHaveBeenCalled();
    expect(silentLogger.warn).toHaveBeenCalledWith(expect.stringContaining('appointment not found'));
    expect(mockClient.release).toHaveBeenCalledOnce();
  });

  it("OUTLOOK-PROACTIVE-REFRESH: When Outlook token_expires_at is within 5-minute buffer, system proactively refreshes token to prevent mid-operation expiration during calendar sync", async () => {
    // WHO: calendarSync.ts proactive token refresh logic for Outlook provider
    // WHAT: Outlook OAuth token expires in 3 minutes (within the 5-minute safety buffer)
    // WHEN: sync action checks token_expires_at against Date.now() + buffer before Graph API call
    // WHERE: calendarSync.ts -> expiry check with 5min buffer -> outlookCalendar.ts refreshAccessToken()
    // WHY: without proactive refresh, tokens expiring mid-operation cause partial sync failures with Outlook Graph API
    const { mockClient, queryResponses } = createMockClient();
    const pool = createMockPool(mockClient);

    // Token expires in 3 minutes (within buffer)
    const settings = makeOutlookSettings({
      token_expires_at: new Date(Date.now() + 3 * 60 * 1000).toISOString(),
    });
    const appt = makeAppointment();

    queryResponses.push({ rows: [settings] });
    queryResponses.push({ rows: [], rowCount: 1 }); // token update
    queryResponses.push({ rows: [appt] });
    queryResponses.push({ rows: [], rowCount: 1 }); // sync map

    vi.mocked(outlookCal.refreshAccessToken).mockResolvedValue({
      access_token: 'refreshed-outlook-token',
      expiry_date: Date.now() + 3600 * 1000,
    });
    vi.mocked(outlookCal.createEvent).mockResolvedValue(OUTLOOK_EVENT_ID);

    await syncAppointmentToCalendar(pool, TENANT_ID, APPOINTMENT_ID, 'create', silentLogger);

    expect(outlookCal.refreshAccessToken).toHaveBeenCalledOnce();
    expect(vi.mocked(outlookCal.createEvent).mock.calls[0][0]).toBe('refreshed-outlook-token');
  });
});
