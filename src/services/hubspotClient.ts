import crypto from 'crypto';
import { signOAuthState, verifyOAuthState } from './oauthStateJwt';

const AUTHORIZE_URL = 'https://app.hubspot.com/oauth/authorize';
const TOKEN_URL = 'https://api.hubapi.com/oauth/v1/token';
const API_BASE = 'https://api.hubapi.com';
const SCOPES =
  'crm.objects.contacts.read crm.objects.contacts.write crm.objects.meetings.read crm.objects.meetings.write';
const FETCH_TIMEOUT_MS = 15_000;

export interface TokenSet {
  access_token: string;
  refresh_token: string;
  expiry_date: number;
}

export interface HubSpotContact {
  id: string;
  properties: {
    firstname?: string;
    lastname?: string;
    email?: string;
    phone?: string;
    company?: string;
    createdate?: string;
    lastmodifieddate?: string;
  };
}

export interface HubSpotMeeting {
  id: string;
  properties: {
    hs_meeting_title?: string;
    hs_meeting_body?: string;
    hs_meeting_start_time?: string;
    hs_meeting_end_time?: string;
    hs_meeting_outcome?: string;
    hs_meeting_location?: string;
    hs_timestamp?: string;
    createdate?: string;
    lastmodifieddate?: string;
  };
}

export interface HubSpotListResponse<T> {
  results: T[];
  paging?: { next?: { after: string } };
}

function getConfig() {
  const clientId = process.env.HUBSPOT_CLIENT_ID;
  const clientSecret = process.env.HUBSPOT_CLIENT_SECRET;
  const callbackUrl = process.env.HUBSPOT_CALLBACK_URL;
  if (!clientId || !clientSecret || !callbackUrl) {
    const missing = [
      !clientId && 'HUBSPOT_CLIENT_ID',
      !clientSecret && 'HUBSPOT_CLIENT_SECRET',
      !callbackUrl && 'HUBSPOT_CALLBACK_URL',
    ].filter(Boolean);
    console.warn(`[hubspotClient] Not configured — missing env vars: ${missing.join(', ')}`);
    return null;
  }
  return { clientId, clientSecret, callbackUrl };
}

/** Returns true if HubSpot integration is configured */
export function isHubSpotEnabled(): boolean {
  return getConfig() !== null;
}

/**
 * Build the HubSpot OAuth consent URL.
 * State param is a signed JWT containing the tenantId for CSRF protection.
 */
export function getAuthUrl(tenantId: string): string | null {
  const config = getConfig();
  if (!config) return null;

  const state = signOAuthState({ tenantId, purpose: 'hubspot-oauth' });

  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.callbackUrl,
    scope: SCOPES,
    response_type: 'code',
    state,
  });

  return `${AUTHORIZE_URL}?${params.toString()}`;
}

/** Verify the state param from HubSpot callback, returns tenantId */
export function verifyState(state: string): string | null {
  return verifyOAuthState({ state, expectedPurpose: 'hubspot-oauth' });
}

/** Exchange authorization code for tokens */
export async function exchangeCodeForTokens(code: string): Promise<TokenSet> {
  const config = getConfig();
  if (!config)
    throw new Error(
      'HubSpot not configured — missing env vars (check HUBSPOT_CLIENT_ID, HUBSPOT_CLIENT_SECRET, HUBSPOT_CALLBACK_URL)'
    );

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: config.callbackUrl,
    code,
  });

  let res: Response;
  try {
    res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (networkErr: unknown) {
    const msg = networkErr instanceof Error ? networkErr.message : String(networkErr);
    throw new Error(
      `HubSpot OAuth code exchange failed: network error reaching HubSpot token endpoint — ${msg}`
    );
  }

  if (!res.ok) {
    const errorBody = await res.text();
    throw new Error(
      `HubSpot OAuth code exchange failed (${res.status}): ${errorBody}. The user may need to re-authorize from the dashboard.`
    );
  }

  const data = await res.json();
  if (!data.access_token || !data.refresh_token) {
    throw new Error(
      'HubSpot OAuth code exchange returned incomplete tokens (missing access_token or refresh_token).'
    );
  }

  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expiry_date: Date.now() + (data.expires_in || 1800) * 1000, // HubSpot tokens expire in 30 minutes
  };
}

/** Refresh an expired access token */
export async function refreshAccessToken(
  refreshToken: string
): Promise<{ access_token: string; expiry_date: number }> {
  const config = getConfig();
  if (!config)
    throw new Error(
      'HubSpot not configured — missing env vars (check HUBSPOT_CLIENT_ID, HUBSPOT_CLIENT_SECRET, HUBSPOT_CALLBACK_URL)'
    );

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: config.clientId,
    client_secret: config.clientSecret,
    refresh_token: refreshToken,
  });

  let res: Response;
  try {
    res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (networkErr: unknown) {
    const msg = networkErr instanceof Error ? networkErr.message : String(networkErr);
    throw new Error(`HubSpot token refresh failed: network error — ${msg}`);
  }

  if (!res.ok) {
    const errorBody = await res.text();
    throw new Error(
      `HubSpot token refresh failed (${res.status}): ${errorBody}. The user should reconnect HubSpot from the dashboard.`
    );
  }

  const data = await res.json();
  if (!data.access_token) {
    throw new Error(
      'HubSpot token refresh returned no access_token. The user should reconnect HubSpot from the dashboard.'
    );
  }

  return {
    access_token: data.access_token,
    expiry_date: Date.now() + (data.expires_in || 1800) * 1000,
  };
}

/** Make an authenticated REST call to HubSpot API */
export async function apiRequest<T = any>(
  method: string,
  path: string,
  accessToken: string,
  body?: unknown
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (networkErr: unknown) {
    const msg = networkErr instanceof Error ? networkErr.message : String(networkErr);
    throw new Error(`HubSpot API ${method} ${path} failed: network error — ${msg}`);
  }

  if (!res.ok) {
    const errorBody = await res.text();
    throw new Error(`HubSpot API ${method} ${path} failed (${res.status}): ${errorBody}`);
  }

  if (res.status === 204) return null as T;
  return res.json();
}

/**
 * Verify HubSpot webhook signature (v3).
 * Concatenates: requestMethod + requestUri + requestBody + timestamp
 * HMAC-SHA256 with client secret, then base64 encode.
 */
export function verifyWebhookSignature(
  method: string,
  uri: string,
  body: string,
  timestamp: string,
  signature: string,
  secret: string
): boolean {
  const sourceString = method + uri + body + timestamp;
  const expected = crypto
    .createHmac('sha256', secret)
    .update(sourceString, 'utf8')
    .digest('base64');

  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

// -----------------------------------------------------------------------
// Convenience methods for contacts and meetings
// -----------------------------------------------------------------------

const CONTACT_PROPS = 'firstname,lastname,email,phone,company,createdate,lastmodifieddate';
const MEETING_PROPS =
  'hs_meeting_title,hs_meeting_body,hs_meeting_start_time,hs_meeting_end_time,hs_meeting_outcome,hs_meeting_location,hs_timestamp,createdate,lastmodifieddate';

export async function listContacts(
  accessToken: string,
  after?: string
): Promise<HubSpotListResponse<HubSpotContact>> {
  const params = new URLSearchParams({ limit: '100', properties: CONTACT_PROPS });
  if (after) params.set('after', after);
  return apiRequest('GET', `/crm/v3/objects/contacts?${params.toString()}`, accessToken);
}

export async function getContact(accessToken: string, contactId: string): Promise<HubSpotContact> {
  return apiRequest(
    'GET',
    `/crm/v3/objects/contacts/${contactId}?properties=${CONTACT_PROPS}`,
    accessToken
  );
}

export async function createContact(
  accessToken: string,
  properties: Record<string, string>
): Promise<HubSpotContact> {
  return apiRequest('POST', '/crm/v3/objects/contacts', accessToken, { properties });
}

export async function updateContact(
  accessToken: string,
  contactId: string,
  properties: Record<string, string>
): Promise<HubSpotContact> {
  return apiRequest('PATCH', `/crm/v3/objects/contacts/${contactId}`, accessToken, { properties });
}

export async function listMeetings(
  accessToken: string,
  after?: string
): Promise<HubSpotListResponse<HubSpotMeeting>> {
  const params = new URLSearchParams({ limit: '100', properties: MEETING_PROPS });
  if (after) params.set('after', after);
  return apiRequest('GET', `/crm/v3/objects/meetings?${params.toString()}`, accessToken);
}

export async function createMeeting(
  accessToken: string,
  properties: Record<string, string>
): Promise<HubSpotMeeting> {
  return apiRequest('POST', '/crm/v3/objects/meetings', accessToken, { properties });
}

export async function updateMeeting(
  accessToken: string,
  meetingId: string,
  properties: Record<string, string>
): Promise<HubSpotMeeting> {
  return apiRequest('PATCH', `/crm/v3/objects/meetings/${meetingId}`, accessToken, { properties });
}

export async function associateMeetingToContact(
  accessToken: string,
  meetingId: string,
  contactId: string
): Promise<void> {
  await apiRequest(
    'PUT',
    `/crm/v4/objects/meetings/${meetingId}/associations/contacts/${contactId}`,
    accessToken,
    [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 200 }]
  );
}
