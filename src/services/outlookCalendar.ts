import jwt from 'jsonwebtoken';

const SCOPES = 'Calendars.ReadWrite offline_access';
const AUTHORIZE_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize';
const TOKEN_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';
const FETCH_TIMEOUT_MS = 15_000;

export interface CalendarEventInput {
  summary: string;
  description?: string;
  start: string;   // ISO datetime
  end: string;     // ISO datetime
  location?: string;
  timeZone?: string;
}

export interface TokenSet {
  access_token: string;
  refresh_token: string;
  expiry_date: number;
}

function getConfig() {
  const clientId = process.env.OUTLOOK_CLIENT_ID;
  const clientSecret = process.env.OUTLOOK_CLIENT_SECRET;
  const callbackUrl = process.env.OUTLOOK_CALLBACK_URL;
  if (!clientId || !clientSecret || !callbackUrl) {
    const missing = [
      !clientId && 'OUTLOOK_CLIENT_ID',
      !clientSecret && 'OUTLOOK_CLIENT_SECRET',
      !callbackUrl && 'OUTLOOK_CALLBACK_URL',
    ].filter(Boolean);
    console.warn(`[outlookCalendar] Not configured — missing env vars: ${missing.join(', ')}`);
    return null;
  }
  return { clientId, clientSecret, callbackUrl };
}

/** Returns true if Outlook Calendar integration is configured */
export function isOutlookCalendarEnabled(): boolean {
  return getConfig() !== null;
}

/**
 * Build the Microsoft OAuth consent URL.
 * State param is a signed JWT containing the tenantId for CSRF protection.
 */
export function getAuthUrl(tenantId: string): string | null {
  const config = getConfig();
  if (!config) return null;

  const jwtSecret = process.env.JWT_SECRET || 'dev-jwt-secret-change-in-production';
  const state = jwt.sign({ tenantId, purpose: 'outlook-calendar-oauth' }, jwtSecret, { expiresIn: '10m' });

  const params = new URLSearchParams({
    client_id: config.clientId,
    response_type: 'code',
    redirect_uri: config.callbackUrl,
    scope: SCOPES,
    state,
    response_mode: 'query',
    prompt: 'consent',
  });

  return `${AUTHORIZE_URL}?${params.toString()}`;
}

/** Verify the state param from Microsoft callback, returns tenantId */
export function verifyState(state: string): string | null {
  const jwtSecret = process.env.JWT_SECRET || 'dev-jwt-secret-change-in-production';
  try {
    const decoded = jwt.verify(state, jwtSecret) as { tenantId: string; purpose: string };
    if (decoded.purpose !== 'outlook-calendar-oauth') return null;
    return decoded.tenantId;
  } catch {
    return null;
  }
}

/** Exchange authorization code for tokens */
export async function exchangeCodeForTokens(code: string): Promise<TokenSet> {
  const config = getConfig();
  if (!config) throw new Error('Outlook Calendar not configured — missing env vars (check OUTLOOK_CLIENT_ID, OUTLOOK_CLIENT_SECRET, OUTLOOK_CALLBACK_URL)');

  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code,
    redirect_uri: config.callbackUrl,
    grant_type: 'authorization_code',
    scope: SCOPES,
  });

  let res: Response;
  try {
    res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (networkErr: any) {
    throw new Error(`Outlook OAuth code exchange failed: network error reaching Microsoft token endpoint — ${networkErr.message}`);
  }

  if (!res.ok) {
    const errorBody = await res.text();
    throw new Error(`Outlook OAuth code exchange failed (${res.status}): ${errorBody}. This happens during initial OAuth authorization — the user may need to re-authorize from the dashboard.`);
  }

  const data = await res.json();
  if (!data.access_token || !data.refresh_token) {
    throw new Error('Outlook OAuth code exchange returned incomplete tokens (missing access_token or refresh_token). The user may need to re-authorize from the dashboard.');
  }

  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expiry_date: Date.now() + (data.expires_in || 3600) * 1000,
  };
}

/** Refresh an expired access token */
export async function refreshAccessToken(refreshToken: string): Promise<{ access_token: string; expiry_date: number }> {
  const config = getConfig();
  if (!config) throw new Error('Outlook Calendar not configured — missing env vars (check OUTLOOK_CLIENT_ID, OUTLOOK_CLIENT_SECRET, OUTLOOK_CALLBACK_URL)');

  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
    scope: SCOPES,
  });

  let res: Response;
  try {
    res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (networkErr: any) {
    throw new Error(`Outlook token refresh failed: network error reaching Microsoft token endpoint — ${networkErr.message}`);
  }

  if (!res.ok) {
    const errorBody = await res.text();
    throw new Error(`Outlook token refresh failed (${res.status}): ${errorBody}. The refresh token may be expired or revoked — the user should reconnect Outlook Calendar from the dashboard.`);
  }

  const data = await res.json();
  if (!data.access_token) {
    throw new Error('Outlook token refresh returned no access_token. The user should reconnect Outlook Calendar from the dashboard.');
  }

  return {
    access_token: data.access_token,
    expiry_date: Date.now() + (data.expires_in || 3600) * 1000,
  };
}

/**
 * Revoke a Microsoft OAuth token.
 *
 * WHY this is a no-op: Microsoft's identity platform does not expose a simple
 * token revocation endpoint for confidential (server-side) OAuth clients.
 * Unlike Google, there is no POST /revoke equivalent. The access token will
 * expire naturally (default: 1 hour), and the refresh token is invalidated by
 * removing the app consent in the user's Microsoft account. We keep this
 * function for interface parity with googleCalendar.ts so calendarSync.ts can
 * call `provider.revokeToken()` without branching.
 */
export async function revokeToken(_accessToken: string): Promise<void> {
  // Intentional no-op — see JSDoc above.
}

async function graphRequest(method: string, path: string, accessToken: string, body?: Record<string, unknown>): Promise<any> {
  let res: Response;
  try {
    res = await fetch(`${GRAPH_BASE}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (networkErr: any) {
    throw new Error(`Microsoft Graph API ${method} ${path} failed: network error — ${networkErr.message}`);
  }

  if (!res.ok) {
    const errorBody = await res.text();
    throw new Error(`Microsoft Graph API ${method} ${path} failed (${res.status}): ${errorBody}`);
  }

  // DELETE returns 204 No Content
  if (res.status === 204) return null;
  return res.json();
}

function buildGraphEvent(event: CalendarEventInput) {
  const timeZone = event.timeZone || 'America/Chicago';
  return {
    subject: event.summary,
    body: event.description ? { contentType: 'text', content: event.description } : undefined,
    start: { dateTime: event.start, timeZone },
    end: { dateTime: event.end, timeZone },
    location: event.location ? { displayName: event.location } : undefined,
  };
}

/** Create an event in Outlook Calendar, returns the event ID */
export async function createEvent(
  accessToken: string,
  _refreshToken: string,
  calendarId: string,
  event: CalendarEventInput
): Promise<string> {
  const path = calendarId === 'primary'
    ? '/me/events'
    : `/me/calendars/${calendarId}/events`;

  const data = await graphRequest('POST', path, accessToken, buildGraphEvent(event));

  if (!data?.id) throw new Error('Outlook Calendar did not return an event ID');
  return data.id;
}

/** Update an existing Outlook Calendar event */
export async function updateEvent(
  accessToken: string,
  _refreshToken: string,
  _calendarId: string,
  eventId: string,
  event: CalendarEventInput
): Promise<void> {
  await graphRequest('PATCH', `/me/events/${eventId}`, accessToken, buildGraphEvent(event));
}

/** Delete an event from Outlook Calendar */
export async function deleteEvent(
  accessToken: string,
  _refreshToken: string,
  _calendarId: string,
  eventId: string
): Promise<void> {
  await graphRequest('DELETE', `/me/events/${eventId}`, accessToken);
}
