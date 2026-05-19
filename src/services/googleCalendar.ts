import { google } from 'googleapis';
import { signOAuthState, verifyOAuthState } from './oauthStateJwt';

const SCOPES = ['https://www.googleapis.com/auth/calendar.events'];

export interface CalendarEventInput {
  summary: string;
  description?: string;
  start: string; // ISO datetime
  end: string; // ISO datetime
  location?: string;
  timeZone?: string;
}

export interface TokenSet {
  access_token: string;
  refresh_token: string;
  expiry_date: number;
}

function getConfig() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const callbackUrl = process.env.GOOGLE_CALLBACK_URL;
  if (!clientId || !clientSecret || !callbackUrl) return null;
  return { clientId, clientSecret, callbackUrl };
}

function createOAuth2Client() {
  const config = getConfig();
  if (!config) return null;
  return new google.auth.OAuth2(config.clientId, config.clientSecret, config.callbackUrl);
}

/** Returns true if Google Calendar integration is configured */
export function isGoogleCalendarEnabled(): boolean {
  return getConfig() !== null;
}

/**
 * Build the Google OAuth consent URL.
 * State param is a signed JWT containing the tenantId for CSRF protection.
 */
export function getAuthUrl(tenantId: string): string | null {
  const client = createOAuth2Client();
  if (!client) return null;

  const state = signOAuthState({ tenantId, purpose: 'google-calendar-oauth' });

  return client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES,
    state,
  });
}

/** Verify the state param from Google callback, returns tenantId */
export function verifyState(state: string): string | null {
  return verifyOAuthState({ state, expectedPurpose: 'google-calendar-oauth' });
}

/** Exchange authorization code for tokens */
export async function exchangeCodeForTokens(code: string): Promise<TokenSet> {
  const client = createOAuth2Client();
  if (!client) throw new Error('Google Calendar not configured');

  const { tokens } = await client.getToken(code);
  if (!tokens.access_token || !tokens.refresh_token) {
    throw new Error('Failed to get tokens from Google');
  }

  return {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expiry_date: tokens.expiry_date || Date.now() + 3600 * 1000,
  };
}

/** Refresh an expired access token */
export async function refreshAccessToken(
  refreshToken: string
): Promise<{ access_token: string; expiry_date: number }> {
  const client = createOAuth2Client();
  if (!client) throw new Error('Google Calendar not configured');

  client.setCredentials({ refresh_token: refreshToken });
  const { credentials } = await client.refreshAccessToken();

  if (!credentials.access_token) {
    throw new Error('Failed to refresh Google access token');
  }

  return {
    access_token: credentials.access_token,
    expiry_date: credentials.expiry_date || Date.now() + 3600 * 1000,
  };
}

/** Revoke a Google OAuth token (best-effort) */
export async function revokeToken(accessToken: string): Promise<void> {
  const client = createOAuth2Client();
  if (!client) return;
  try {
    await client.revokeToken(accessToken);
  } catch {
    // Best-effort — token may already be expired/revoked
  }
}

function getAuthedCalendar(accessToken: string, refreshToken: string) {
  const client = createOAuth2Client();
  if (!client) throw new Error('Google Calendar not configured');
  client.setCredentials({ access_token: accessToken, refresh_token: refreshToken });
  return google.calendar({ version: 'v3', auth: client });
}

/** Create an event in Google Calendar, returns the event ID */
export async function createEvent(
  accessToken: string,
  refreshToken: string,
  calendarId: string,
  event: CalendarEventInput
): Promise<string> {
  const calendar = getAuthedCalendar(accessToken, refreshToken);
  const timeZone = event.timeZone || 'America/Chicago';

  const res = await calendar.events.insert({
    calendarId,
    requestBody: {
      summary: event.summary,
      description: event.description,
      location: event.location,
      start: { dateTime: event.start, timeZone },
      end: { dateTime: event.end, timeZone },
    },
  });

  if (!res.data.id) throw new Error('Google Calendar did not return an event ID');
  return res.data.id;
}

/** Update an existing Google Calendar event */
export async function updateEvent(
  accessToken: string,
  refreshToken: string,
  calendarId: string,
  eventId: string,
  event: CalendarEventInput
): Promise<void> {
  const calendar = getAuthedCalendar(accessToken, refreshToken);
  const timeZone = event.timeZone || 'America/Chicago';

  await calendar.events.update({
    calendarId,
    eventId,
    requestBody: {
      summary: event.summary,
      description: event.description,
      location: event.location,
      start: { dateTime: event.start, timeZone },
      end: { dateTime: event.end, timeZone },
    },
  });
}

/** Delete an event from Google Calendar */
export async function deleteEvent(
  accessToken: string,
  refreshToken: string,
  calendarId: string,
  eventId: string
): Promise<void> {
  const calendar = getAuthedCalendar(accessToken, refreshToken);
  await calendar.events.delete({ calendarId, eventId });
}
