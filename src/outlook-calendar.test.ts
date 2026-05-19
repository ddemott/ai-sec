import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import jwt from 'jsonwebtoken';

// --- Mock global fetch before importing the module under test ---
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import {
  isOutlookCalendarEnabled,
  getAuthUrl,
  verifyState,
  exchangeCodeForTokens,
  refreshAccessToken,
  revokeToken,
  createEvent,
  updateEvent,
  deleteEvent,
} from './services/outlookCalendar';

const JWT_SECRET = 'test-jwt-secret';
const TENANT_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

const originalEnv = process.env;

beforeEach(() => {
  process.env = { ...originalEnv };
  vi.clearAllMocks();
});

afterAll(() => {
  process.env = originalEnv;
});

function setOutlookEnv() {
  process.env.OUTLOOK_CLIENT_ID = 'test-client-id';
  process.env.OUTLOOK_CLIENT_SECRET = 'test-client-secret';
  process.env.OUTLOOK_CALLBACK_URL = 'http://localhost:4001/calendar/auth/outlook/callback';
  process.env.JWT_SECRET = JWT_SECRET;
}

// ---------------------------------------------------------------------------
// isOutlookCalendarEnabled
// ---------------------------------------------------------------------------
describe('isOutlookCalendarEnabled', () => {
  it('returns true when all env vars are set', () => {
    // WHO: outlookCalendar.ts isOutlookCalendarEnabled()
    // WHAT: all three Outlook OAuth env vars are present (CLIENT_ID, CLIENT_SECRET, CALLBACK_URL)
    // WHEN: server startup or feature flag check for Outlook Calendar availability
    // WHERE: outlookCalendar.ts isOutlookCalendarEnabled()
    // WHY: without this check, dashboard would show Outlook connect buttons even when server can't handle Microsoft OAuth
    setOutlookEnv();
    expect(isOutlookCalendarEnabled()).toBe(true);
  });

  it('returns false when OUTLOOK_CLIENT_ID is missing', () => {
    // WHO: outlookCalendar.ts isOutlookCalendarEnabled()
    // WHAT: OUTLOOK_CLIENT_ID env var is missing while others are set
    // WHEN: server startup with incomplete Microsoft OAuth configuration
    // WHERE: outlookCalendar.ts isOutlookCalendarEnabled()
    // WHY: partial config would cause OAuth to fail at Microsoft login; better to disable the feature entirely
    setOutlookEnv();
    delete process.env.OUTLOOK_CLIENT_ID;
    expect(isOutlookCalendarEnabled()).toBe(false);
  });

  it('returns false when OUTLOOK_CLIENT_SECRET is missing', () => {
    // WHO: outlookCalendar.ts isOutlookCalendarEnabled()
    // WHAT: OUTLOOK_CLIENT_SECRET env var is missing while others are set
    // WHEN: server startup with incomplete Microsoft OAuth configuration
    // WHERE: outlookCalendar.ts isOutlookCalendarEnabled()
    // WHY: partial config would cause token exchange to fail with 401 from Microsoft identity platform
    setOutlookEnv();
    delete process.env.OUTLOOK_CLIENT_SECRET;
    expect(isOutlookCalendarEnabled()).toBe(false);
  });

  it('returns false when OUTLOOK_CALLBACK_URL is missing', () => {
    // WHO: outlookCalendar.ts isOutlookCalendarEnabled()
    // WHAT: OUTLOOK_CALLBACK_URL env var is missing while others are set
    // WHEN: server startup with incomplete Microsoft OAuth configuration
    // WHERE: outlookCalendar.ts isOutlookCalendarEnabled()
    // WHY: without callback URL, OAuth redirect would go nowhere, stranding user after Microsoft consent
    setOutlookEnv();
    delete process.env.OUTLOOK_CALLBACK_URL;
    expect(isOutlookCalendarEnabled()).toBe(false);
  });

  it('returns false when all Outlook env vars are missing', () => {
    // WHO: outlookCalendar.ts isOutlookCalendarEnabled()
    // WHAT: none of the Outlook OAuth env vars are set (deployment without Outlook integration)
    // WHEN: server startup on deployment without Outlook Calendar integration
    // WHERE: outlookCalendar.ts isOutlookCalendarEnabled()
    // WHY: ensures tenants without Outlook config don't see broken connect buttons or trigger OAuth errors
    delete process.env.OUTLOOK_CLIENT_ID;
    delete process.env.OUTLOOK_CLIENT_SECRET;
    delete process.env.OUTLOOK_CALLBACK_URL;
    expect(isOutlookCalendarEnabled()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getAuthUrl
// ---------------------------------------------------------------------------
describe('getAuthUrl', () => {
  it('returns a URL string when configured', () => {
    // WHO: outlookCalendar.ts getAuthUrl()
    // WHAT: Outlook OAuth is fully configured and tenant requests auth URL
    // WHEN: dashboard user clicks "Connect Outlook Calendar" button
    // WHERE: outlookCalendar.ts getAuthUrl() -> URL construction with Microsoft identity platform
    // WHY: without valid URL generation, users cannot initiate Outlook Calendar OAuth flow
    setOutlookEnv();
    const url = getAuthUrl(TENANT_ID);
    expect(url).not.toBeNull();
    expect(url).toContain('login.microsoftonline.com');
  });

  it('includes correct query params', () => {
    // WHO: outlookCalendar.ts getAuthUrl() query parameter construction
    // WHAT: OAuth URL includes client_id, response_type, redirect_uri, scope (Calendars.ReadWrite + offline_access), prompt
    // WHEN: generating Microsoft OAuth URL for tenant calendar connection
    // WHERE: outlookCalendar.ts getAuthUrl() -> URLSearchParams construction
    // WHY: wrong scope means no calendar access; wrong redirect_uri means OAuth callback fails; missing offline_access means no refresh_token
    setOutlookEnv();
    const url = getAuthUrl(TENANT_ID)!;
    const parsed = new URL(url);
    expect(parsed.searchParams.get('client_id')).toBe('test-client-id');
    expect(parsed.searchParams.get('response_type')).toBe('code');
    expect(parsed.searchParams.get('redirect_uri')).toBe(
      'http://localhost:4001/calendar/auth/outlook/callback'
    );
    expect(parsed.searchParams.get('scope')).toContain('Calendars.ReadWrite');
    expect(parsed.searchParams.get('scope')).toContain('offline_access');
    expect(parsed.searchParams.get('prompt')).toBe('consent');
  });

  it('includes a signed JWT state param with tenantId and purpose', () => {
    setOutlookEnv();
    const url = getAuthUrl(TENANT_ID)!;
    const parsed = new URL(url);
    const state = parsed.searchParams.get('state')!;
    const decoded = jwt.verify(state, JWT_SECRET) as { tenantId: string; purpose: string };
    expect(decoded.tenantId).toBe(TENANT_ID);
    expect(decoded.purpose).toBe('outlook-calendar-oauth');
  });

  it('returns null when Outlook Calendar is not configured', () => {
    delete process.env.OUTLOOK_CLIENT_ID;
    delete process.env.OUTLOOK_CLIENT_SECRET;
    delete process.env.OUTLOOK_CALLBACK_URL;
    expect(getAuthUrl(TENANT_ID)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// verifyState
// ---------------------------------------------------------------------------
describe('verifyState', () => {
  it('returns tenantId for a valid state JWT', () => {
    setOutlookEnv();
    const state = jwt.sign({ tenantId: TENANT_ID, purpose: 'outlook-calendar-oauth' }, JWT_SECRET, {
      expiresIn: '10m',
    });
    expect(verifyState(state)).toBe(TENANT_ID);
  });

  it('returns null for an expired state JWT', () => {
    setOutlookEnv();
    const state = jwt.sign({ tenantId: TENANT_ID, purpose: 'outlook-calendar-oauth' }, JWT_SECRET, {
      expiresIn: '-1s',
    });
    expect(verifyState(state)).toBeNull();
  });

  it("returns null when purpose doesn't match", () => {
    setOutlookEnv();
    const state = jwt.sign({ tenantId: TENANT_ID, purpose: 'wrong-purpose' }, JWT_SECRET, {
      expiresIn: '10m',
    });
    expect(verifyState(state)).toBeNull();
  });

  it('returns null for a completely invalid token', () => {
    setOutlookEnv();
    expect(verifyState('not-a-jwt')).toBeNull();
  });

  it('returns null for a token signed with a different secret', () => {
    setOutlookEnv();
    const state = jwt.sign(
      { tenantId: TENANT_ID, purpose: 'outlook-calendar-oauth' },
      'wrong-secret',
      { expiresIn: '10m' }
    );
    expect(verifyState(state)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// exchangeCodeForTokens
// ---------------------------------------------------------------------------
describe('exchangeCodeForTokens', () => {
  it('returns token set on success', async () => {
    setOutlookEnv();
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: 'access-123',
        refresh_token: 'refresh-456',
        expires_in: 3600,
      }),
    });

    const before = Date.now();
    const tokens = await exchangeCodeForTokens('auth-code-789');

    expect(tokens.access_token).toBe('access-123');
    expect(tokens.refresh_token).toBe('refresh-456');
    expect(tokens.expiry_date).toBeGreaterThanOrEqual(before + 3600 * 1000);

    // Verify fetch was called with correct params
    expect(mockFetch).toHaveBeenCalledWith(
      'https://login.microsoftonline.com/common/oauth2/v2.0/token',
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('throws when access_token is missing', async () => {
    setOutlookEnv();
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: null, refresh_token: 'refresh-456' }),
    });

    await expect(exchangeCodeForTokens('auth-code')).rejects.toThrow(
      'Outlook OAuth code exchange returned incomplete tokens'
    );
  });

  it('throws when refresh_token is missing', async () => {
    setOutlookEnv();
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: 'access-123', refresh_token: null }),
    });

    await expect(exchangeCodeForTokens('auth-code')).rejects.toThrow(
      'Outlook OAuth code exchange returned incomplete tokens'
    );
  });

  it('throws when HTTP response is not ok', async () => {
    setOutlookEnv();
    mockFetch.mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => 'Bad Request',
    });

    await expect(exchangeCodeForTokens('auth-code')).rejects.toThrow(
      'Outlook OAuth code exchange failed'
    );
  });

  it('throws when Outlook Calendar is not configured', async () => {
    delete process.env.OUTLOOK_CLIENT_ID;
    delete process.env.OUTLOOK_CLIENT_SECRET;
    delete process.env.OUTLOOK_CALLBACK_URL;

    await expect(exchangeCodeForTokens('auth-code')).rejects.toThrow(
      'Outlook Calendar not configured'
    );
  });
});

// ---------------------------------------------------------------------------
// refreshAccessToken
// ---------------------------------------------------------------------------
describe('refreshAccessToken', () => {
  it('returns refreshed credentials on success', async () => {
    setOutlookEnv();
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: 'new-access-token',
        expires_in: 3600,
      }),
    });

    const before = Date.now();
    const result = await refreshAccessToken('old-refresh-token');

    expect(result.access_token).toBe('new-access-token');
    expect(result.expiry_date).toBeGreaterThanOrEqual(before + 3600 * 1000);
  });

  it('throws when access_token is missing from response', async () => {
    setOutlookEnv();
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: null }),
    });

    await expect(refreshAccessToken('old-refresh-token')).rejects.toThrow(
      'Outlook token refresh returned no access_token'
    );
  });

  it('throws when HTTP response is not ok', async () => {
    setOutlookEnv();
    mockFetch.mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => 'Unauthorized',
    });

    await expect(refreshAccessToken('old-refresh-token')).rejects.toThrow(
      'Outlook token refresh failed'
    );
  });

  it('throws when Outlook Calendar is not configured', async () => {
    delete process.env.OUTLOOK_CLIENT_ID;
    delete process.env.OUTLOOK_CLIENT_SECRET;
    delete process.env.OUTLOOK_CALLBACK_URL;

    await expect(refreshAccessToken('old-refresh-token')).rejects.toThrow(
      'Outlook Calendar not configured'
    );
  });
});

// ---------------------------------------------------------------------------
// revokeToken
// ---------------------------------------------------------------------------
describe('revokeToken', () => {
  it("is a no-op (Microsoft doesn't have simple token revocation)", async () => {
    setOutlookEnv();
    await expect(revokeToken('token-to-revoke')).resolves.toBeUndefined();
    // fetch should NOT be called for revocation
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// createEvent
// ---------------------------------------------------------------------------
describe('createEvent', () => {
  const eventInput = {
    summary: 'Oil Change',
    description: 'Full synthetic',
    start: '2026-04-01T09:00:00',
    end: '2026-04-01T10:00:00',
    location: 'Bay 3',
    timeZone: 'America/New_York',
  };

  it('returns the event ID from Outlook Calendar', async () => {
    setOutlookEnv();
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: 'outlook-event-123' }),
    });

    const id = await createEvent('access', 'refresh', 'primary', eventInput);
    expect(id).toBe('outlook-event-123');
  });

  it('uses /me/events for primary calendar', async () => {
    setOutlookEnv();
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: 'event-1' }),
    });

    await createEvent('access', 'refresh', 'primary', eventInput);

    expect(mockFetch).toHaveBeenCalledWith(
      'https://graph.microsoft.com/v1.0/me/events',
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('uses /me/calendars/{id}/events for specific calendar', async () => {
    setOutlookEnv();
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: 'event-2' }),
    });

    await createEvent('access', 'refresh', 'cal-uuid-123', eventInput);

    expect(mockFetch).toHaveBeenCalledWith(
      'https://graph.microsoft.com/v1.0/me/calendars/cal-uuid-123/events',
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('sends correct Graph API event body', async () => {
    setOutlookEnv();
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: 'event-3' }),
    });

    await createEvent('access', 'refresh', 'primary', eventInput);

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.subject).toBe('Oil Change');
    expect(body.body).toEqual({ contentType: 'text', content: 'Full synthetic' });
    expect(body.start).toEqual({ dateTime: '2026-04-01T09:00:00', timeZone: 'America/New_York' });
    expect(body.end).toEqual({ dateTime: '2026-04-01T10:00:00', timeZone: 'America/New_York' });
    expect(body.location).toEqual({ displayName: 'Bay 3' });
  });

  it('defaults timeZone to America/Chicago when not specified', async () => {
    setOutlookEnv();
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: 'event-4' }),
    });

    const noTzEvent = {
      summary: 'Tire Rotation',
      start: '2026-04-01T09:00:00',
      end: '2026-04-01T09:30:00',
    };
    await createEvent('access', 'refresh', 'primary', noTzEvent);

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.start.timeZone).toBe('America/Chicago');
    expect(body.end.timeZone).toBe('America/Chicago');
  });

  it('throws when Outlook Calendar returns no event ID', async () => {
    setOutlookEnv();
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
    });

    await expect(createEvent('access', 'refresh', 'primary', eventInput)).rejects.toThrow(
      'Outlook Calendar did not return an event ID'
    );
  });

  it('throws when Graph API returns an error', async () => {
    setOutlookEnv();
    mockFetch.mockResolvedValue({
      ok: false,
      status: 403,
      text: async () => 'Forbidden',
    });

    await expect(createEvent('access', 'refresh', 'primary', eventInput)).rejects.toThrow(
      'Microsoft Graph API'
    );
  });

  it('includes Authorization header with access token', async () => {
    setOutlookEnv();
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: 'event-5' }),
    });

    await createEvent('my-access-token', 'refresh', 'primary', eventInput);

    const headers = mockFetch.mock.calls[0][1].headers;
    expect(headers.Authorization).toBe('Bearer my-access-token');
  });
});

// ---------------------------------------------------------------------------
// updateEvent
// ---------------------------------------------------------------------------
describe('updateEvent', () => {
  const eventInput = {
    summary: 'Updated Appointment',
    start: '2026-04-01T11:00:00',
    end: '2026-04-01T12:00:00',
    timeZone: 'America/Denver',
  };

  it('calls PATCH /me/events/{id} with correct body', async () => {
    setOutlookEnv();
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: 'event-id' }),
    });

    await updateEvent('access', 'refresh', 'cal-id', 'event-id', eventInput);

    expect(mockFetch).toHaveBeenCalledWith(
      'https://graph.microsoft.com/v1.0/me/events/event-id',
      expect.objectContaining({ method: 'PATCH' })
    );

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.subject).toBe('Updated Appointment');
    expect(body.start.timeZone).toBe('America/Denver');
  });

  it('throws when Graph API returns an error', async () => {
    setOutlookEnv();
    mockFetch.mockResolvedValue({
      ok: false,
      status: 404,
      text: async () => 'Not Found',
    });

    await expect(
      updateEvent('access', 'refresh', 'cal-id', 'event-id', eventInput)
    ).rejects.toThrow('Microsoft Graph API');
  });
});

// ---------------------------------------------------------------------------
// deleteEvent
// ---------------------------------------------------------------------------
describe('deleteEvent', () => {
  it('calls DELETE /me/events/{id}', async () => {
    setOutlookEnv();
    mockFetch.mockResolvedValue({
      ok: true,
      status: 204,
    });

    await deleteEvent('access', 'refresh', 'cal-id', 'event-id');

    expect(mockFetch).toHaveBeenCalledWith(
      'https://graph.microsoft.com/v1.0/me/events/event-id',
      expect.objectContaining({ method: 'DELETE' })
    );
  });

  it('throws when Graph API returns an error', async () => {
    setOutlookEnv();
    mockFetch.mockResolvedValue({
      ok: false,
      status: 404,
      text: async () => 'Not Found',
    });

    await expect(deleteEvent('access', 'refresh', 'cal-id', 'event-id')).rejects.toThrow(
      'Microsoft Graph API'
    );
  });
});
