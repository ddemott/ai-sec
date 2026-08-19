/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument */
/**
 * no-unsafe-* rules disabled: this is an external API client for Square.
 * All responses from Square's OAuth and API endpoints are treated as dynamic.
 *
 * Part of ESLint debt reduction (historical REFACTORING_TODO.md item 10; see RESOLVED.md).
 */

import crypto from 'crypto';
import { signOAuthState, verifyOAuthState } from '../oauthStateJwt';

const AUTHORIZE_URL = 'https://connect.squareup.com/oauth2/authorize';
const TOKEN_URL = 'https://connect.squareup.com/oauth2/token';
const API_BASE = 'https://connect.squareup.com/v2';
const SCOPES = 'CUSTOMERS_READ CUSTOMERS_WRITE APPOINTMENTS_READ APPOINTMENTS_WRITE';
const SQUARE_VERSION = '2024-01-18';
const FETCH_TIMEOUT_MS = 15_000;

export interface TokenSet {
  access_token: string;
  refresh_token: string;
  expiry_date: number;
}

export interface SquareCustomer {
  id: string;
  given_name?: string;
  family_name?: string;
  email_address?: string;
  phone_number?: string;
  created_at?: string;
  updated_at?: string;
}

export interface SquareBooking {
  id: string;
  start_at?: string;
  status?: string;
  customer_id?: string;
  location_id?: string;
  appointment_segments?: Array<{
    duration_minutes?: number;
    team_member_id?: string;
    service_variation_id?: string;
    service_variation_version?: number;
  }>;
  created_at?: string;
  updated_at?: string;
}

export interface SquareListResponse<T> {
  customers?: T[];
  bookings?: T[];
  cursor?: string;
}

function getConfig() {
  const clientId = process.env.SQUARE_CLIENT_ID;
  const clientSecret = process.env.SQUARE_CLIENT_SECRET;
  const callbackUrl = process.env.SQUARE_CALLBACK_URL;
  if (!clientId || !clientSecret || !callbackUrl) {
    const missing = [
      !clientId && 'SQUARE_CLIENT_ID',
      !clientSecret && 'SQUARE_CLIENT_SECRET',
      !callbackUrl && 'SQUARE_CALLBACK_URL',
    ].filter(Boolean);
    console.warn(`[squareClient] Not configured — missing env vars: ${missing.join(', ')}`);
    return null;
  }
  return { clientId, clientSecret, callbackUrl };
}

/** Returns true if Square integration is configured */
export function isSquareEnabled(): boolean {
  return getConfig() !== null;
}

/**
 * Build the Square OAuth consent URL.
 * State param is a signed JWT containing the tenantId for CSRF protection.
 */
export function getAuthUrl(tenantId: string): string | null {
  const config = getConfig();
  if (!config) return null;

  const state = signOAuthState({ tenantId, purpose: 'square-oauth' });

  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.callbackUrl,
    scope: SCOPES,
    response_type: 'code',
    state,
  });

  return `${AUTHORIZE_URL}?${params.toString()}`;
}

/** Verify the state param from Square callback, returns tenantId */
export function verifyState(state: string): string | null {
  return verifyOAuthState({ state, expectedPurpose: 'square-oauth' });
}

/** Exchange authorization code for tokens */
export async function exchangeCodeForTokens(code: string): Promise<TokenSet> {
  const config = getConfig();
  if (!config)
    throw new Error(
      'Square not configured — missing env vars (check SQUARE_CLIENT_ID, SQUARE_CLIENT_SECRET, SQUARE_CALLBACK_URL)'
    );

  const body = {
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: config.callbackUrl,
    grant_type: 'authorization_code',
    code,
  };

  let res: Response;
  try {
    res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (networkErr: unknown) {
    const msg = networkErr instanceof Error ? networkErr.message : String(networkErr);
    throw new Error(
      `Square OAuth code exchange failed: network error reaching Square token endpoint — ${msg}`
    );
  }

  if (!res.ok) {
    const errorBody = await res.text();
    throw new Error(
      `Square OAuth code exchange failed (${res.status}): ${errorBody}. The user may need to re-authorize from the dashboard.`
    );
  }

  const data = await res.json();
  if (!data.access_token || !data.refresh_token) {
    throw new Error(
      'Square OAuth code exchange returned incomplete tokens (missing access_token or refresh_token).'
    );
  }

  // Square returns expires_at as ISO string
  const expiryDate = data.expires_at
    ? new Date(data.expires_at).getTime()
    : Date.now() + 28 * 24 * 3600 * 1000; // Square tokens expire in ~30 days

  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expiry_date: expiryDate,
  };
}

/** Refresh an expired access token */
export async function refreshAccessToken(
  refreshToken: string
): Promise<{ access_token: string; expiry_date: number }> {
  const config = getConfig();
  if (!config)
    throw new Error(
      'Square not configured — missing env vars (check SQUARE_CLIENT_ID, SQUARE_CLIENT_SECRET, SQUARE_CALLBACK_URL)'
    );

  const body = {
    client_id: config.clientId,
    client_secret: config.clientSecret,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  };

  let res: Response;
  try {
    res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (networkErr: unknown) {
    const msg = networkErr instanceof Error ? networkErr.message : String(networkErr);
    throw new Error(`Square token refresh failed: network error — ${msg}`);
  }

  if (!res.ok) {
    const errorBody = await res.text();
    throw new Error(
      `Square token refresh failed (${res.status}): ${errorBody}. The user should reconnect Square from the dashboard.`
    );
  }

  const data = await res.json();
  if (!data.access_token) {
    throw new Error(
      'Square token refresh returned no access_token. The user should reconnect Square from the dashboard.'
    );
  }

  const expiryDate = data.expires_at
    ? new Date(data.expires_at).getTime()
    : Date.now() + 28 * 24 * 3600 * 1000;

  return {
    access_token: data.access_token,
    expiry_date: expiryDate,
  };
}

/** Make an authenticated REST call to Square API */
export async function apiRequest<T = unknown>(
  method: string,
  path: string,
  accessToken: string,
  body?: Record<string, unknown>
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Square-Version': SQUARE_VERSION,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (networkErr: unknown) {
    const msg = networkErr instanceof Error ? networkErr.message : String(networkErr);
    throw new Error(`Square API ${method} ${path} failed: network error — ${msg}`);
  }

  if (!res.ok) {
    const errorBody = await res.text();
    throw new Error(`Square API ${method} ${path} failed (${res.status}): ${errorBody}`);
  }

  if (res.status === 204) return null as T;
  return res.json();
}

/**
 * Verify Square webhook signature.
 * Square uses SHA-256 HMAC of (notification URL + body), compared to X-Square-Hmacsha256-Signature.
 */
export function verifyWebhookSignature(
  body: string,
  signature: string,
  signatureKey: string,
  notificationUrl: string
): boolean {
  const payload = notificationUrl + body;
  const expected = crypto
    .createHmac('sha256', signatureKey)
    .update(payload, 'utf8')
    .digest('base64');

  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

// -----------------------------------------------------------------------
// Convenience methods for customers and bookings
// -----------------------------------------------------------------------

export async function listCustomers(
  accessToken: string,
  cursor?: string
): Promise<SquareListResponse<SquareCustomer>> {
  const params = new URLSearchParams({ limit: '100' });
  if (cursor) params.set('cursor', cursor);
  return apiRequest('GET', `/customers?${params.toString()}`, accessToken);
}

export async function getCustomer(
  accessToken: string,
  customerId: string
): Promise<{ customer: SquareCustomer }> {
  return apiRequest('GET', `/customers/${customerId}`, accessToken);
}

export async function createCustomer(
  accessToken: string,
  customer: {
    given_name?: string;
    family_name?: string;
    email_address?: string;
    phone_number?: string;
  }
): Promise<{ customer: SquareCustomer }> {
  return apiRequest('POST', '/customers', accessToken, customer);
}

export async function updateCustomer(
  accessToken: string,
  customerId: string,
  customer: {
    given_name?: string;
    family_name?: string;
    email_address?: string;
    phone_number?: string;
  }
): Promise<{ customer: SquareCustomer }> {
  return apiRequest('PUT', `/customers/${customerId}`, accessToken, customer);
}

export async function listBookings(
  accessToken: string,
  cursor?: string
): Promise<SquareListResponse<SquareBooking>> {
  const params = new URLSearchParams({ limit: '100' });
  if (cursor) params.set('cursor', cursor);
  return apiRequest('GET', `/bookings?${params.toString()}`, accessToken);
}

export async function createBooking(
  accessToken: string,
  booking: {
    start_at: string;
    customer_id?: string;
    location_id?: string;
    appointment_segments?: Array<{
      service_variation_id?: string;
      team_member_id?: string;
      duration_minutes?: number;
    }>;
  }
): Promise<{ booking: SquareBooking }> {
  return apiRequest('POST', '/bookings', accessToken, { booking });
}

export async function updateBooking(
  accessToken: string,
  bookingId: string,
  booking: {
    start_at?: string;
    customer_id?: string;
    location_id?: string;
    appointment_segments?: Array<{
      service_variation_id?: string;
      team_member_id?: string;
      duration_minutes?: number;
    }>;
  }
): Promise<{ booking: SquareBooking }> {
  return apiRequest('PUT', `/bookings/${bookingId}`, accessToken, { booking });
}

export async function cancelBooking(
  accessToken: string,
  bookingId: string
): Promise<{ booking: SquareBooking }> {
  return apiRequest('POST', `/bookings/${bookingId}/cancel`, accessToken, {});
}
