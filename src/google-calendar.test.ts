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
  process.env.GOOGLE_CALLBACK_URL = "http://localhost:3000/calendar/callback";
  process.env.JWT_SECRET = JWT_SECRET;
}

// ---------------------------------------------------------------------------
// isGoogleCalendarEnabled
// ---------------------------------------------------------------------------
describe("isGoogleCalendarEnabled", () => {
  it("returns true when all env vars are set", () => {
    setGoogleEnv();
    expect(isGoogleCalendarEnabled()).toBe(true);
  });

  it("returns false when GOOGLE_CLIENT_ID is missing", () => {
    setGoogleEnv();
    delete process.env.GOOGLE_CLIENT_ID;
    expect(isGoogleCalendarEnabled()).toBe(false);
  });

  it("returns false when GOOGLE_CLIENT_SECRET is missing", () => {
    setGoogleEnv();
    delete process.env.GOOGLE_CLIENT_SECRET;
    expect(isGoogleCalendarEnabled()).toBe(false);
  });

  it("returns false when GOOGLE_CALLBACK_URL is missing", () => {
    setGoogleEnv();
    delete process.env.GOOGLE_CALLBACK_URL;
    expect(isGoogleCalendarEnabled()).toBe(false);
  });

  it("returns false when all Google env vars are missing", () => {
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
    setGoogleEnv();
    const fakeUrl = "https://accounts.google.com/o/oauth2/v2/auth?scope=calendar";
    mockGenerateAuthUrl.mockReturnValue(fakeUrl);

    const url = getAuthUrl(TENANT_ID);
    expect(url).toBe(fakeUrl);
  });

  it("passes correct options to generateAuthUrl", () => {
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
    setGoogleEnv();
    mockGenerateAuthUrl.mockImplementation((opts: any) => {
      // Verify the state is a valid JWT
      const decoded = jwt.verify(opts.state, JWT_SECRET) as any;
      expect(decoded.tenantId).toBe(TENANT_ID);
      expect(decoded.purpose).toBe("google-calendar-oauth");
      return "https://accounts.google.com/auth";
    });

    const url = getAuthUrl(TENANT_ID);
    expect(url).not.toBeNull();
    expect(mockGenerateAuthUrl).toHaveBeenCalledTimes(1);
  });

  it("returns null when Google Calendar is not configured", () => {
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
    setGoogleEnv();
    const state = jwt.sign(
      { tenantId: TENANT_ID, purpose: "google-calendar-oauth" },
      JWT_SECRET,
      { expiresIn: "10m" }
    );

    const result = verifyState(state);
    expect(result).toBe(TENANT_ID);
  });

  // WHO: Attacker or delayed OAuth callback — state JWT has expired (>10 min old)
  // WHAT: verifyState receives an expired JWT
  // WHY: Prevents replay attacks — OAuth state tokens must be short-lived
  // WHERE: verifyState → jwt.verify throws TokenExpiredError
  // HOW: Returns null, callback route redirects with calendarError=invalid_state
  it("returns null for an expired state JWT", () => {
    setGoogleEnv();
    const state = jwt.sign(
      { tenantId: TENANT_ID, purpose: "google-calendar-oauth" },
      JWT_SECRET,
      { expiresIn: "-1s" } // already expired
    );

    const result = verifyState(state);
    expect(result).toBeNull();
  });

  // WHO: Attacker reusing a JWT from a different OAuth flow (e.g., Outlook)
  // WHAT: JWT is valid but purpose field is wrong — not "google-calendar-oauth"
  // WHY: Prevents cross-flow CSRF — a valid JWT for one flow must not work for another
  // WHERE: verifyState → decoded.purpose !== 'google-calendar-oauth'
  // HOW: Returns null even though JWT signature is valid
  it("returns null when purpose doesn't match", () => {
    setGoogleEnv();
    const state = jwt.sign(
      { tenantId: TENANT_ID, purpose: "wrong-purpose" },
      JWT_SECRET,
      { expiresIn: "10m" }
    );

    const result = verifyState(state);
    expect(result).toBeNull();
  });

  // WHO: Attacker sending garbage data as the state parameter
  // WHAT: State is not a JWT at all — random string
  // WHY: Must handle malformed input without crashing
  // WHERE: verifyState → jwt.verify throws JsonWebTokenError
  // HOW: Returns null, caught by try/catch
  it("returns null for a completely invalid token", () => {
    setGoogleEnv();
    const result = verifyState("not-a-jwt");
    expect(result).toBeNull();
  });

  // WHO: Attacker who forged a JWT with a different secret key
  // WHAT: JWT structure is valid but signature doesn't match our JWT_SECRET
  // WHY: Prevents tenant impersonation — only our server can issue valid state tokens
  // WHERE: verifyState → jwt.verify throws JsonWebTokenError (signature mismatch)
  // HOW: Returns null, attacker cannot link their Google account to another tenant
  it("returns null for a token signed with a different secret", () => {
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

  // WHO: Google returning a partial response — access_token missing from token exchange
  // WHAT: getToken succeeds but tokens.access_token is null
  // WHY: Must fail loudly — storing null tokens would break all future sync attempts
  // WHERE: exchangeCodeForTokens → null check after getToken
  // HOW: Throws "Failed to get tokens from Google", callback route redirects with error
  it("throws when access_token is missing", async () => {
    setGoogleEnv();
    mockGetToken.mockResolvedValue({
      tokens: { access_token: null, refresh_token: "refresh-456" },
    });

    await expect(exchangeCodeForTokens("auth-code")).rejects.toThrow(
      "Failed to get tokens from Google"
    );
  });

  // WHO: Google returning tokens without a refresh_token (happens when prompt≠consent)
  // WHAT: access_token present but refresh_token is null
  // WHY: Without refresh_token, tokens can't be renewed — sync would break after 1 hour
  // WHERE: exchangeCodeForTokens → refresh_token null check
  // HOW: Throws error, forces re-auth with prompt=consent to get refresh_token
  it("throws when refresh_token is missing", async () => {
    setGoogleEnv();
    mockGetToken.mockResolvedValue({
      tokens: { access_token: "access-123", refresh_token: null },
    });

    await expect(exchangeCodeForTokens("auth-code")).rejects.toThrow(
      "Failed to get tokens from Google"
    );
  });

  // WHO: Server deployed without GOOGLE_CLIENT_ID/SECRET/CALLBACK_URL env vars
  // WHAT: exchangeCodeForTokens called but OAuth2 client can't be created
  // WHY: Calendar sync is optional — server must run without Google credentials
  // WHERE: exchangeCodeForTokens → createOAuth2Client returns null → throw
  // HOW: Throws "Google Calendar not configured", caller shows appropriate error
  it("throws when Google Calendar is not configured", async () => {
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

  // WHO: Google returning empty credentials during token refresh (service outage)
  // WHAT: refreshAccessToken succeeds but credentials.access_token is null
  // WHY: Must fail — calendarSync will catch this and mark calendar as inactive
  // WHERE: refreshAccessToken → credentials.access_token null check
  // HOW: Throws "Failed to refresh Google access token"
  it("throws when access_token is missing from refreshed credentials", async () => {
    setGoogleEnv();
    mockRefreshAccessToken.mockResolvedValue({
      credentials: { access_token: null },
    });

    await expect(refreshAccessToken("old-refresh-token")).rejects.toThrow(
      "Failed to refresh Google access token"
    );
  });

  it("throws when Google Calendar is not configured", async () => {
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
    setGoogleEnv();
    mockRevokeToken.mockResolvedValue(undefined);

    await revokeToken("token-to-revoke");

    expect(mockRevokeToken).toHaveBeenCalledWith("token-to-revoke");
  });

  // WHO: Tenant disconnecting calendar — Google revoke endpoint is down or token already expired
  // WHAT: revokeToken API call fails with an error
  // WHY: Token revocation is best-effort — disconnect must succeed even if Google is unreachable
  // WHERE: revokeToken → try/catch swallows the error
  // HOW: Resolves successfully despite the API error — disconnect proceeds
  it("does not throw when revokeToken fails (best-effort)", async () => {
    setGoogleEnv();
    mockRevokeToken.mockRejectedValue(new Error("revoke failed"));

    await expect(revokeToken("token-to-revoke")).resolves.toBeUndefined();
  });

  it("silently returns when Google Calendar is not configured", async () => {
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
    setGoogleEnv();
    mockEventsInsert.mockResolvedValue({ data: { id: "gcal-event-123" } });

    const id = await createEvent("access", "refresh", "primary", eventInput);

    expect(id).toBe("gcal-event-123");
  });

  it("passes correct parameters to events.insert", async () => {
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

  // WHO: Google Calendar API returning a malformed response (no event ID)
  // WHAT: events.insert succeeds (200) but response has no id field
  // WHY: Without an event ID, we can't update or delete the event later — must fail
  // WHERE: createEvent → res.data.id check
  // HOW: Throws "Google Calendar did not return an event ID"
  it("throws when Google Calendar returns no event ID", async () => {
    setGoogleEnv();
    mockEventsInsert.mockResolvedValue({ data: {} });

    await expect(
      createEvent("access", "refresh", "primary", eventInput)
    ).rejects.toThrow("Google Calendar did not return an event ID");
  });

  it("throws when Google Calendar is not configured", async () => {
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
    setGoogleEnv();
    mockEventsDelete.mockResolvedValue({ data: {} });

    await deleteEvent("access", "refresh", "cal-id", "event-id");

    expect(mockEventsDelete).toHaveBeenCalledWith({
      calendarId: "cal-id",
      eventId: "event-id",
    });
  });

  it("throws when Google Calendar is not configured", async () => {
    delete process.env.GOOGLE_CLIENT_ID;

    await expect(
      deleteEvent("access", "refresh", "cal-id", "event-id")
    ).rejects.toThrow("Google Calendar not configured");
  });
});
