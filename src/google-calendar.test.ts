import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import jwt from "jsonwebtoken";

// --- Mock googleapis before importing the module under test ---

const mockGenerateAuthUrl = vi.fn();
const mockGetToken = vi.fn();
const mockRefreshAccessToken = vi.fn();
const mockRevokeToken = vi.fn();
const mockSetCredentials = vi.fn();

const mockEventsInsert = vi.fn();
const mockEventsUpdate = vi.fn();
const mockEventsDelete = vi.fn();

const mockOAuth2Instance = {
  generateAuthUrl: mockGenerateAuthUrl,
  getToken: mockGetToken,
  refreshAccessToken: mockRefreshAccessToken,
  revokeToken: mockRevokeToken,
  setCredentials: mockSetCredentials,
};

vi.mock("googleapis", () => {
  // Must use a real function (not arrow) so it can be called with `new`
  function OAuth2() {
    return mockOAuth2Instance;
  }
  return {
    google: {
      auth: { OAuth2 },
      calendar: vi.fn(() => ({
        events: {
          insert: mockEventsInsert,
          update: mockEventsUpdate,
          delete: mockEventsDelete,
        },
      })),
    },
  };
});

import {
  isGoogleCalendarEnabled,
  getAuthUrl,
  verifyState,
  exchangeCodeForTokens,
  refreshAccessToken,
  revokeToken,
  createEvent,
  updateEvent,
  deleteEvent,
} from "./services/googleCalendar";

const JWT_SECRET = "test-jwt-secret";
const TENANT_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

const originalEnv = process.env;

beforeEach(() => {
  process.env = { ...originalEnv };
  vi.clearAllMocks();
});

afterAll(() => {
  process.env = originalEnv;
});

function setGoogleEnv() {
  process.env.GOOGLE_CLIENT_ID = "test-client-id";
  process.env.GOOGLE_CLIENT_SECRET = "test-client-secret";
  process.env.GOOGLE_CALLBACK_URL = "http://localhost:4001/calendar/callback";
  process.env.JWT_SECRET = JWT_SECRET;
}

// ---------------------------------------------------------------------------
// isGoogleCalendarEnabled
// ---------------------------------------------------------------------------
describe("isGoogleCalendarEnabled", () => {
  it("returns true when all env vars are set", () => {
    // WHO: googleCalendar.ts isGoogleCalendarEnabled()
    // WHAT: all three Google OAuth env vars are present (CLIENT_ID, CLIENT_SECRET, CALLBACK_URL)
    // WHEN: server startup or feature flag check for Google Calendar availability
    // WHERE: googleCalendar.ts isGoogleCalendarEnabled()
    // WHY: without this check, the dashboard would show Google Calendar connect buttons even when the server can't handle OAuth
    setGoogleEnv();
    expect(isGoogleCalendarEnabled()).toBe(true);
  });

  it("returns false when GOOGLE_CLIENT_ID is missing", () => {
    // WHO: googleCalendar.ts isGoogleCalendarEnabled()
    // WHAT: GOOGLE_CLIENT_ID env var is missing while others are set
    // WHEN: server startup with incomplete Google OAuth configuration
    // WHERE: googleCalendar.ts isGoogleCalendarEnabled()
    // WHY: partial config would cause OAuth to fail at authorize step; better to disable the feature entirely
    setGoogleEnv();
    delete process.env.GOOGLE_CLIENT_ID;
    expect(isGoogleCalendarEnabled()).toBe(false);
  });

  it("returns false when GOOGLE_CLIENT_SECRET is missing", () => {
    // WHO: googleCalendar.ts isGoogleCalendarEnabled()
    // WHAT: GOOGLE_CLIENT_SECRET env var is missing while others are set
    // WHEN: server startup with incomplete Google OAuth configuration
    // WHERE: googleCalendar.ts isGoogleCalendarEnabled()
    // WHY: partial config would cause OAuth token exchange to fail with 401 from Google
    setGoogleEnv();
    delete process.env.GOOGLE_CLIENT_SECRET;
    expect(isGoogleCalendarEnabled()).toBe(false);
  });

  it("returns false when GOOGLE_CALLBACK_URL is missing", () => {
    // WHO: googleCalendar.ts isGoogleCalendarEnabled()
    // WHAT: GOOGLE_CALLBACK_URL env var is missing while others are set
    // WHEN: server startup with incomplete Google OAuth configuration
    // WHERE: googleCalendar.ts isGoogleCalendarEnabled()
    // WHY: without callback URL, OAuth redirect would go nowhere, stranding the user after Google consent
    setGoogleEnv();
    delete process.env.GOOGLE_CALLBACK_URL;
    expect(isGoogleCalendarEnabled()).toBe(false);
  });

  it("returns false when all Google env vars are missing", () => {
    // WHO: googleCalendar.ts isGoogleCalendarEnabled()
    // WHAT: none of the Google OAuth env vars are set (fresh deployment without calendar config)
    // WHEN: server startup on deployment without Google Calendar integration
    // WHERE: googleCalendar.ts isGoogleCalendarEnabled()
    // WHY: ensures tenants without calendar config don't see broken connect buttons or trigger OAuth errors
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    delete process.env.GOOGLE_CALLBACK_URL;
    expect(isGoogleCalendarEnabled()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getAuthUrl
// ---------------------------------------------------------------------------
describe("getAuthUrl", () => {
  it("returns a URL string when configured", () => {
    // WHO: googleCalendar.ts getAuthUrl()
    // WHAT: Google OAuth is fully configured and tenant requests auth URL
    // WHEN: dashboard user clicks "Connect Google Calendar" button
    // WHERE: googleCalendar.ts getAuthUrl() -> OAuth2Client.generateAuthUrl()
    // WHY: without valid URL generation, users cannot initiate Google Calendar OAuth flow
    setGoogleEnv();
    const fakeUrl = "https://accounts.google.com/o/oauth2/v2/auth?scope=calendar";
    mockGenerateAuthUrl.mockReturnValue(fakeUrl);

    const url = getAuthUrl(TENANT_ID);
    expect(url).toBe(fakeUrl);
  });

  it("passes correct options to generateAuthUrl", () => {
    // WHO: googleCalendar.ts getAuthUrl()
    // WHAT: verify OAuth2 options (access_type=offline, prompt=consent, calendar.events scope)
    // WHEN: generating Google OAuth URL for tenant calendar connection
    // WHERE: googleCalendar.ts getAuthUrl() -> generateAuthUrl() call arguments
    // WHY: wrong access_type means no refresh_token; wrong scope means calendar events can't be created/updated
    setGoogleEnv();
    mockGenerateAuthUrl.mockReturnValue("https://accounts.google.com/auth");

    getAuthUrl(TENANT_ID);

    expect(mockGenerateAuthUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        access_type: "offline",
        prompt: "consent",
        scope: ["https://www.googleapis.com/auth/calendar.events"],
      })
    );
  });

  it("includes a signed JWT state param with tenantId and purpose", () => {
    // WHO: googleCalendar.ts getAuthUrl() state parameter
    // WHAT: state param contains signed JWT with tenantId and purpose='google-calendar-oauth'
    // WHEN: OAuth URL generation includes CSRF-protection state parameter
    // WHERE: googleCalendar.ts getAuthUrl() -> jwt.sign() -> state param
    // WHY: without signed state, attackers could forge OAuth callbacks to connect their Google account to another tenant (CSRF)
    setGoogleEnv();
    mockGenerateAuthUrl.mockImplementation((opts: { state: string }) => {
      // Verify the state is a valid JWT
      const decoded = jwt.verify(opts.state, JWT_SECRET) as { tenantId: string; purpose: string };
      expect(decoded.tenantId).toBe(TENANT_ID);
      expect(decoded.purpose).toBe("google-calendar-oauth");
      return "https://accounts.google.com/auth";
    });

    const url = getAuthUrl(TENANT_ID);
    expect(url).not.toBeNull();
    expect(mockGenerateAuthUrl).toHaveBeenCalledTimes(1);
  });

  it("returns null when Google Calendar is not configured", () => {
    // WHO: googleCalendar.ts getAuthUrl() when unconfigured
    // WHAT: Google OAuth env vars are missing and tenant requests auth URL
    // WHEN: dashboard checks for calendar connect URL on unconfigured deployment
    // WHERE: googleCalendar.ts getAuthUrl() -> isGoogleCalendarEnabled() check -> null return
    // WHY: without null return, OAuth2 client construction would throw, crashing the calendar settings endpoint
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    delete process.env.GOOGLE_CALLBACK_URL;

    const url = getAuthUrl(TENANT_ID);
    expect(url).toBeNull();
    expect(mockGenerateAuthUrl).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// verifyState
// ---------------------------------------------------------------------------
describe("verifyState", () => {
  it("returns tenantId for a valid state JWT", () => {
    // WHO: googleCalendar.ts verifyState()
    // WHAT: valid JWT with correct tenantId, purpose, and unexpired signature
    // WHEN: Google OAuth callback returns with state parameter
    // WHERE: googleCalendar.ts verifyState() -> jwt.verify()
    // WHY: successful verification links the OAuth callback to the correct tenant for token storage
    setGoogleEnv();
    const state = jwt.sign(
      { tenantId: TENANT_ID, purpose: "google-calendar-oauth" },
      JWT_SECRET,
      { expiresIn: "10m" }
    );

    const result = verifyState(state);
    expect(result).toBe(TENANT_ID);
  });

  it("returns null for an expired state JWT", () => {
    // WHO: googleCalendar.ts verifyState()
    // WHAT: JWT state token has expired (user took too long to complete OAuth consent)
    // WHEN: OAuth callback received after state JWT expiration window
    // WHERE: googleCalendar.ts verifyState() -> jwt.verify() throws TokenExpiredError
    // WHY: expired state allows replay attacks; attacker could reuse a captured OAuth callback URL
    setGoogleEnv();
    const state = jwt.sign(
      { tenantId: TENANT_ID, purpose: "google-calendar-oauth" },
      JWT_SECRET,
      { expiresIn: "-1s" } // already expired
    );

    const result = verifyState(state);
    expect(result).toBeNull();
  });

  it("returns null when purpose doesn't match", () => {
    // WHO: googleCalendar.ts verifyState()
    // WHAT: JWT has wrong purpose claim (e.g., 'outlook-calendar-oauth' or 'wrong-purpose')
    // WHEN: OAuth callback receives state JWT intended for a different integration
    // WHERE: googleCalendar.ts verifyState() -> purpose comparison
    // WHY: without purpose check, an Outlook OAuth state could be replayed against Google callback, cross-linking tokens
    setGoogleEnv();
    const state = jwt.sign(
      { tenantId: TENANT_ID, purpose: "wrong-purpose" },
      JWT_SECRET,
      { expiresIn: "10m" }
    );

    const result = verifyState(state);
    expect(result).toBeNull();
  });

  it("returns null for a completely invalid token", () => {
    // WHO: googleCalendar.ts verifyState()
    // WHAT: state parameter is not a JWT at all (random string, corrupted, or tampered)
    // WHEN: OAuth callback receives garbage state parameter
    // WHERE: googleCalendar.ts verifyState() -> jwt.verify() throws JsonWebTokenError
    // WHY: without rejection, malformed state could bypass tenant identification, storing tokens under wrong tenant
    setGoogleEnv();
    const result = verifyState("not-a-jwt");
    expect(result).toBeNull();
  });

  it("returns null for a token signed with a different secret", () => {
    // WHO: googleCalendar.ts verifyState()
    // WHAT: JWT signed with wrong secret (forged by attacker or from different environment)
    // WHEN: OAuth callback receives JWT that doesn't match server's JWT_SECRET
    // WHERE: googleCalendar.ts verifyState() -> jwt.verify() throws signature mismatch
    // WHY: without signature verification, attacker could forge state JWTs to connect their Google account to any tenant
    setGoogleEnv();
    const state = jwt.sign(
      { tenantId: TENANT_ID, purpose: "google-calendar-oauth" },
      "wrong-secret",
      { expiresIn: "10m" }
    );

    const result = verifyState(state);
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// exchangeCodeForTokens
// ---------------------------------------------------------------------------
describe("exchangeCodeForTokens", () => {
  it("returns token set on success", async () => {
    // WHO: googleCalendar.ts exchangeCodeForTokens()
    // WHAT: valid auth code exchanged for access_token, refresh_token, and expiry_date
    // WHEN: Google OAuth callback passes auth code to backend for token exchange
    // WHERE: googleCalendar.ts exchangeCodeForTokens() -> OAuth2Client.getToken()
    // WHY: token exchange is the critical step that grants calendar API access; failure here means no calendar integration
    setGoogleEnv();
    const expiryDate = Date.now() + 3600 * 1000;
    mockGetToken.mockResolvedValue({
      tokens: {
        access_token: "access-123",
        refresh_token: "refresh-456",
        expiry_date: expiryDate,
      },
    });

    const tokens = await exchangeCodeForTokens("auth-code-789");

    expect(tokens).toEqual({
      access_token: "access-123",
      refresh_token: "refresh-456",
      expiry_date: expiryDate,
    });
    expect(mockGetToken).toHaveBeenCalledWith("auth-code-789");
  });

  it("falls back to computed expiry_date when not provided", async () => {
    // WHO: googleCalendar.ts exchangeCodeForTokens() expiry fallback
    // WHAT: Google returns null expiry_date (rare but documented edge case)
    // WHEN: token exchange succeeds but Google omits expiry_date from response
    // WHERE: googleCalendar.ts exchangeCodeForTokens() -> expiry_date null check -> Date.now() + 3600s
    // WHY: without fallback, null expiry_date causes immediate token refresh on every API call, wasting Google API quota
    setGoogleEnv();
    const before = Date.now();
    mockGetToken.mockResolvedValue({
      tokens: {
        access_token: "access-123",
        refresh_token: "refresh-456",
        expiry_date: null,
      },
    });

    const tokens = await exchangeCodeForTokens("auth-code");
    const after = Date.now();

    // Should be roughly now + 1 hour
    expect(tokens.expiry_date).toBeGreaterThanOrEqual(before + 3600 * 1000);
    expect(tokens.expiry_date).toBeLessThanOrEqual(after + 3600 * 1000);
  });

  it("throws when access_token is missing", async () => {
    // WHO: googleCalendar.ts exchangeCodeForTokens() validation
    // WHAT: Google returns null access_token (invalid or expired auth code)
    // WHEN: token exchange response lacks access_token
    // WHERE: googleCalendar.ts exchangeCodeForTokens() -> access_token null check
    // WHY: without validation, null access_token would be stored in DB and cause all subsequent calendar API calls to fail with 401
    setGoogleEnv();
    mockGetToken.mockResolvedValue({
      tokens: { access_token: null, refresh_token: "refresh-456" },
    });

    await expect(exchangeCodeForTokens("auth-code")).rejects.toThrow(
      "Failed to get tokens from Google"
    );
  });

  it("throws when refresh_token is missing", async () => {
    // WHO: googleCalendar.ts exchangeCodeForTokens() validation
    // WHAT: Google returns null refresh_token (user didn't grant offline access or already had a token)
    // WHEN: token exchange response lacks refresh_token
    // WHERE: googleCalendar.ts exchangeCodeForTokens() -> refresh_token null check
    // WHY: without refresh_token, calendar sync breaks after access_token expires (1h), requiring manual re-OAuth
    setGoogleEnv();
    mockGetToken.mockResolvedValue({
      tokens: { access_token: "access-123", refresh_token: null },
    });

    await expect(exchangeCodeForTokens("auth-code")).rejects.toThrow(
      "Failed to get tokens from Google"
    );
  });

  it("throws when Google Calendar is not configured", async () => {
    // WHO: googleCalendar.ts exchangeCodeForTokens() config guard
    // WHAT: Google OAuth env vars are missing during token exchange attempt
    // WHEN: OAuth callback hits backend that doesn't have Google Calendar configured
    // WHERE: googleCalendar.ts exchangeCodeForTokens() -> isGoogleCalendarEnabled() check
    // WHY: without this guard, OAuth2 client construction throws cryptic error instead of clear "not configured" message
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    delete process.env.GOOGLE_CALLBACK_URL;

    await expect(exchangeCodeForTokens("auth-code")).rejects.toThrow(
      "Google Calendar not configured"
    );
  });
});

// ---------------------------------------------------------------------------
// refreshAccessToken
// ---------------------------------------------------------------------------
describe("refreshAccessToken", () => {
  it("returns refreshed credentials on success", async () => {
    // WHO: googleCalendar.ts refreshAccessToken()
    // WHAT: valid refresh_token exchanged for new access_token and expiry_date
    // WHEN: calendarSync detects expired token and triggers refresh before API call
    // WHERE: googleCalendar.ts refreshAccessToken() -> OAuth2Client.refreshAccessToken()
    // WHY: token refresh is essential for continuous calendar sync; failure means all syncs stop until manual re-OAuth
    setGoogleEnv();
    const expiryDate = Date.now() + 3600 * 1000;
    mockRefreshAccessToken.mockResolvedValue({
      credentials: {
        access_token: "new-access-token",
        expiry_date: expiryDate,
      },
    });

    const result = await refreshAccessToken("old-refresh-token");

    expect(result).toEqual({
      access_token: "new-access-token",
      expiry_date: expiryDate,
    });
    expect(mockSetCredentials).toHaveBeenCalledWith({
      refresh_token: "old-refresh-token",
    });
  });

  it("falls back to computed expiry_date when not provided", async () => {
    // WHO: googleCalendar.ts refreshAccessToken() expiry fallback
    // WHAT: Google refresh response returns null expiry_date
    // WHEN: token refresh succeeds but Google omits expiry_date from credentials
    // WHERE: googleCalendar.ts refreshAccessToken() -> expiry_date null check -> Date.now() + 3600s
    // WHY: without fallback, null expiry causes immediate re-refresh on next sync, creating an infinite refresh loop
    setGoogleEnv();
    const before = Date.now();
    mockRefreshAccessToken.mockResolvedValue({
      credentials: { access_token: "new-access-token", expiry_date: null },
    });

    const result = await refreshAccessToken("old-refresh-token");
    const after = Date.now();

    expect(result.expiry_date).toBeGreaterThanOrEqual(before + 3600 * 1000);
    expect(result.expiry_date).toBeLessThanOrEqual(after + 3600 * 1000);
  });

  it("throws when access_token is missing from refreshed credentials", async () => {
    // WHO: googleCalendar.ts refreshAccessToken() validation
    // WHAT: Google refresh returns null access_token (refresh_token may be revoked)
    // WHEN: token refresh response lacks access_token
    // WHERE: googleCalendar.ts refreshAccessToken() -> access_token null check
    // WHY: without validation, null access_token would be stored and used for API calls, causing persistent 401 errors
    setGoogleEnv();
    mockRefreshAccessToken.mockResolvedValue({
      credentials: { access_token: null },
    });

    await expect(refreshAccessToken("old-refresh-token")).rejects.toThrow(
      "Failed to refresh Google access token"
    );
  });

  it("throws when Google Calendar is not configured", async () => {
    // WHO: googleCalendar.ts refreshAccessToken() config guard
    // WHAT: Google OAuth env vars are missing during token refresh
    // WHEN: calendarSync attempts token refresh on unconfigured deployment
    // WHERE: googleCalendar.ts refreshAccessToken() -> isGoogleCalendarEnabled() check
    // WHY: without guard, OAuth2 client construction fails with cryptic error instead of actionable message
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    delete process.env.GOOGLE_CALLBACK_URL;

    await expect(refreshAccessToken("old-refresh-token")).rejects.toThrow(
      "Google Calendar not configured"
    );
  });
});

// ---------------------------------------------------------------------------
// revokeToken
// ---------------------------------------------------------------------------
describe("revokeToken", () => {
  it("calls revokeToken on the OAuth client", async () => {
    // WHO: googleCalendar.ts revokeToken()
    // WHAT: tenant disconnects Google Calendar and their token is revoked
    // WHEN: user clicks "Disconnect Google Calendar" in dashboard settings
    // WHERE: googleCalendar.ts revokeToken() -> OAuth2Client.revokeToken()
    // WHY: without revocation, disconnected tenants still have valid Google tokens, which is a security risk
    setGoogleEnv();
    mockRevokeToken.mockResolvedValue(undefined);

    await revokeToken("token-to-revoke");

    expect(mockRevokeToken).toHaveBeenCalledWith("token-to-revoke");
  });

  it("does not throw when revokeToken fails (best-effort)", async () => {
    // WHO: googleCalendar.ts revokeToken() error handling
    // WHAT: Google revoke endpoint returns error (token already revoked or network failure)
    // WHEN: disconnect flow attempts to revoke an already-invalid token
    // WHERE: googleCalendar.ts revokeToken() -> try/catch swallows error
    // WHY: revocation is best-effort; failing to revoke should not block the disconnect flow or surface errors to the user
    setGoogleEnv();
    mockRevokeToken.mockRejectedValue(new Error("revoke failed"));

    await expect(revokeToken("token-to-revoke")).resolves.toBeUndefined();
  });

  it("silently returns when Google Calendar is not configured", async () => {
    // WHO: googleCalendar.ts revokeToken() when unconfigured
    // WHAT: Google OAuth env vars missing during token revocation attempt
    // WHEN: disconnect flow runs on deployment without Google Calendar config
    // WHERE: googleCalendar.ts revokeToken() -> isGoogleCalendarEnabled() check -> silent return
    // WHY: without silent return, disconnect would throw on unconfigured deployments where revocation is unnecessary anyway
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    delete process.env.GOOGLE_CALLBACK_URL;

    await expect(revokeToken("token-to-revoke")).resolves.toBeUndefined();
    expect(mockRevokeToken).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// createEvent
// ---------------------------------------------------------------------------
describe("createEvent", () => {
  const eventInput = {
    summary: "Oil Change",
    description: "Full synthetic",
    start: "2026-04-01T09:00:00",
    end: "2026-04-01T10:00:00",
    location: "Bay 3",
    timeZone: "America/New_York",
  };

  it("returns the event ID from Google Calendar", async () => {
    // WHO: googleCalendar.ts createEvent()
    // WHAT: valid event input creates a Google Calendar event and returns its ID
    // WHEN: calendarSync triggers event creation after appointment is booked
    // WHERE: googleCalendar.ts createEvent() -> google.calendar.events.insert()
    // WHY: returned event ID is stored in appointment_sync_map for future updates/deletes; without it, sync_map is incomplete
    setGoogleEnv();
    mockEventsInsert.mockResolvedValue({ data: { id: "gcal-event-123" } });

    const id = await createEvent("access", "refresh", "primary", eventInput);

    expect(id).toBe("gcal-event-123");
  });

  it("passes correct parameters to events.insert", async () => {
    // WHO: googleCalendar.ts createEvent() parameter mapping
    // WHAT: event input fields are correctly mapped to Google Calendar API format
    // WHEN: createEvent builds the events.insert() request body
    // WHERE: googleCalendar.ts createEvent() -> events.insert({ calendarId, requestBody })
    // WHY: incorrect field mapping causes events to appear with wrong times, missing location, or on the wrong calendar
    setGoogleEnv();
    mockEventsInsert.mockResolvedValue({ data: { id: "gcal-event-123" } });

    await createEvent("access", "refresh", "cal-id", eventInput);

    expect(mockEventsInsert).toHaveBeenCalledWith({
      calendarId: "cal-id",
      requestBody: {
        summary: "Oil Change",
        description: "Full synthetic",
        location: "Bay 3",
        start: { dateTime: "2026-04-01T09:00:00", timeZone: "America/New_York" },
        end: { dateTime: "2026-04-01T10:00:00", timeZone: "America/New_York" },
      },
    });
  });

  it("defaults timeZone to America/Chicago when not specified", async () => {
    // WHO: googleCalendar.ts createEvent() timezone default
    // WHAT: event input has no timeZone field (legacy data or omitted by caller)
    // WHEN: createEvent builds event body without explicit timezone
    // WHERE: googleCalendar.ts createEvent() -> timeZone fallback to 'America/Chicago'
    // WHY: without default timezone, Google interprets times as UTC, causing events to appear at wrong local times (e.g., 9am shows as 3am CST)
    setGoogleEnv();
    mockEventsInsert.mockResolvedValue({ data: { id: "gcal-event-456" } });

    const noTzEvent = { summary: "Tire Rotation", start: "2026-04-01T09:00:00", end: "2026-04-01T09:30:00" };
    await createEvent("access", "refresh", "primary", noTzEvent);

    expect(mockEventsInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        requestBody: expect.objectContaining({
          start: { dateTime: "2026-04-01T09:00:00", timeZone: "America/Chicago" },
          end: { dateTime: "2026-04-01T09:30:00", timeZone: "America/Chicago" },
        }),
      })
    );
  });

  it("throws when Google Calendar returns no event ID", async () => {
    // WHO: googleCalendar.ts createEvent() response validation
    // WHAT: Google Calendar API returns success but empty data (no event ID)
    // WHEN: events.insert() succeeds but response lacks id field (API anomaly)
    // WHERE: googleCalendar.ts createEvent() -> data.id null check
    // WHY: without ID validation, null would be stored in sync_map, breaking all future update/delete operations for this event
    setGoogleEnv();
    mockEventsInsert.mockResolvedValue({ data: {} });

    await expect(
      createEvent("access", "refresh", "primary", eventInput)
    ).rejects.toThrow("Google Calendar did not return an event ID");
  });

  it("throws when Google Calendar is not configured", async () => {
    // WHO: googleCalendar.ts createEvent() config guard
    // WHAT: Google OAuth env vars missing during event creation
    // WHEN: calendarSync attempts to create event on unconfigured deployment
    // WHERE: googleCalendar.ts createEvent() -> isGoogleCalendarEnabled() check
    // WHY: without guard, OAuth2 client construction throws cryptic error instead of clear "not configured" message
    delete process.env.GOOGLE_CLIENT_ID;

    await expect(
      createEvent("access", "refresh", "primary", eventInput)
    ).rejects.toThrow("Google Calendar not configured");
  });
});

// ---------------------------------------------------------------------------
// updateEvent
// ---------------------------------------------------------------------------
describe("updateEvent", () => {
  const eventInput = {
    summary: "Updated Appointment",
    start: "2026-04-01T11:00:00",
    end: "2026-04-01T12:00:00",
    timeZone: "America/Denver",
  };

  it("calls events.update with correct parameters", async () => {
    // WHO: googleCalendar.ts updateEvent()
    // WHAT: existing Google Calendar event updated with new summary, times, and timezone
    // WHEN: calendarSync triggers event update after appointment is rescheduled
    // WHERE: googleCalendar.ts updateEvent() -> google.calendar.events.update()
    // WHY: incorrect parameter mapping causes stale event data on Google Calendar after rescheduling
    setGoogleEnv();
    mockEventsUpdate.mockResolvedValue({ data: {} });

    await updateEvent("access", "refresh", "cal-id", "event-id", eventInput);

    expect(mockEventsUpdate).toHaveBeenCalledWith({
      calendarId: "cal-id",
      eventId: "event-id",
      requestBody: {
        summary: "Updated Appointment",
        description: undefined,
        location: undefined,
        start: { dateTime: "2026-04-01T11:00:00", timeZone: "America/Denver" },
        end: { dateTime: "2026-04-01T12:00:00", timeZone: "America/Denver" },
      },
    });
  });

  it("throws when Google Calendar is not configured", async () => {
    // WHO: googleCalendar.ts updateEvent() config guard
    // WHAT: Google OAuth env vars missing during event update
    // WHEN: calendarSync attempts to update event on unconfigured deployment
    // WHERE: googleCalendar.ts updateEvent() -> isGoogleCalendarEnabled() check
    // WHY: without guard, update attempt on unconfigured server throws cryptic error instead of clear message
    delete process.env.GOOGLE_CLIENT_ID;

    await expect(
      updateEvent("access", "refresh", "cal-id", "event-id", eventInput)
    ).rejects.toThrow("Google Calendar not configured");
  });
});

// ---------------------------------------------------------------------------
// deleteEvent
// ---------------------------------------------------------------------------
describe("deleteEvent", () => {
  it("calls events.delete with correct parameters", async () => {
    // WHO: googleCalendar.ts deleteEvent()
    // WHAT: Google Calendar event deleted by calendarId and eventId
    // WHEN: calendarSync triggers event deletion after appointment is cancelled
    // WHERE: googleCalendar.ts deleteEvent() -> google.calendar.events.delete()
    // WHY: without correct calendarId/eventId params, wrong event could be deleted or deletion silently fails
    setGoogleEnv();
    mockEventsDelete.mockResolvedValue({ data: {} });

    await deleteEvent("access", "refresh", "cal-id", "event-id");

    expect(mockEventsDelete).toHaveBeenCalledWith({
      calendarId: "cal-id",
      eventId: "event-id",
    });
  });

  it("throws when Google Calendar is not configured", async () => {
    // WHO: googleCalendar.ts deleteEvent() config guard
    // WHAT: Google OAuth env vars missing during event deletion
    // WHEN: calendarSync attempts to delete event on unconfigured deployment
    // WHERE: googleCalendar.ts deleteEvent() -> isGoogleCalendarEnabled() check
    // WHY: without guard, delete attempt on unconfigured server throws cryptic error instead of clear message
    delete process.env.GOOGLE_CLIENT_ID;

    await expect(
      deleteEvent("access", "refresh", "cal-id", "event-id")
    ).rejects.toThrow("Google Calendar not configured");
  });
});
