import { signOAuthState, verifyOAuthState } from './oauthStateJwt';

const AUTHORIZE_URL = 'https://auth.servicetitan.io/connect/authorize';
const TOKEN_URL = 'https://auth.servicetitan.io/connect/token';
const API_BASE = 'https://api.servicetitan.io';
const SCOPES = 'customers jobs';
const FETCH_TIMEOUT_MS = 15_000;

export interface TokenSet {
  access_token: string;
  refresh_token: string;
  expiry_date: number;
}

export interface ServiceTitanCustomer {
  id: number;
  name: string;
  email?: string;
  phoneNumber?: string;
  address?: {
    street?: string;
    city?: string;
    state?: string;
    zip?: string;
  };
  createdOn?: string;
  modifiedOn?: string;
}

export interface ServiceTitanJob {
  id: number;
  customerId: number;
  status?: string;
  summary?: string;
  scheduledDate?: string;
  completedOn?: string;
  createdOn?: string;
  modifiedOn?: string;
}

export interface ServiceTitanListResponse<T> {
  data: T[];
  page: number;
  pageSize: number;
  totalCount: number;
  hasMore: boolean;
}

function getConfig() {
  const clientId = process.env.SERVICETITAN_CLIENT_ID;
  const clientSecret = process.env.SERVICETITAN_CLIENT_SECRET;
  const callbackUrl = process.env.SERVICETITAN_CALLBACK_URL;
  const appKey = process.env.SERVICETITAN_APP_KEY;
  if (!clientId || !clientSecret || !callbackUrl || !appKey) {
    const missing = [
      !clientId && 'SERVICETITAN_CLIENT_ID',
      !clientSecret && 'SERVICETITAN_CLIENT_SECRET',
      !callbackUrl && 'SERVICETITAN_CALLBACK_URL',
      !appKey && 'SERVICETITAN_APP_KEY',
    ].filter(Boolean);
    console.warn(`[servicetitanClient] Not configured — missing env vars: ${missing.join(', ')}`);
    return null;
  }
  return { clientId, clientSecret, callbackUrl, appKey };
}

/** Returns true if ServiceTitan integration is configured */
export function isServiceTitanEnabled(): boolean {
  return getConfig() !== null;
}

/**
 * Build the ServiceTitan OAuth consent URL.
 * State param is a signed JWT containing the tenantId for CSRF protection.
 */
export function getAuthUrl(tenantId: string): string | null {
  const config = getConfig();
  if (!config) return null;

  const state = signOAuthState({ tenantId, purpose: 'servicetitan-oauth' });

  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.callbackUrl,
    scope: SCOPES,
    response_type: 'code',
    state,
  });

  return `${AUTHORIZE_URL}?${params.toString()}`;
}

/** Verify the state param from ServiceTitan callback, returns tenantId */
export function verifyState(state: string): string | null {
  return verifyOAuthState({ state, expectedPurpose: 'servicetitan-oauth' });
}

/** Exchange authorization code for tokens */
export async function exchangeCodeForTokens(code: string): Promise<TokenSet> {
  const config = getConfig();
  if (!config)
    throw new Error(
      'ServiceTitan not configured — missing env vars (check SERVICETITAN_CLIENT_ID, SERVICETITAN_CLIENT_SECRET, SERVICETITAN_CALLBACK_URL, SERVICETITAN_APP_KEY)'
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
      `ServiceTitan OAuth code exchange failed: network error reaching ServiceTitan token endpoint — ${msg}`
    );
  }

  if (!res.ok) {
    const errorBody = await res.text();
    throw new Error(
      `ServiceTitan OAuth code exchange failed (${res.status}): ${errorBody}. The user may need to re-authorize from the dashboard.`
    );
  }

  const data = await res.json();
  if (!data.access_token || !data.refresh_token) {
    throw new Error(
      'ServiceTitan OAuth code exchange returned incomplete tokens (missing access_token or refresh_token).'
    );
  }

  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expiry_date: Date.now() + (data.expires_in || 3600) * 1000, // ServiceTitan tokens expire in ~1 hour
  };
}

/** Refresh an expired access token */
export async function refreshAccessToken(
  refreshToken: string
): Promise<{ access_token: string; expiry_date: number }> {
  const config = getConfig();
  if (!config)
    throw new Error(
      'ServiceTitan not configured — missing env vars (check SERVICETITAN_CLIENT_ID, SERVICETITAN_CLIENT_SECRET, SERVICETITAN_CALLBACK_URL, SERVICETITAN_APP_KEY)'
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
    throw new Error(`ServiceTitan token refresh failed: network error — ${msg}`);
  }

  if (!res.ok) {
    const errorBody = await res.text();
    throw new Error(
      `ServiceTitan token refresh failed (${res.status}): ${errorBody}. The user should reconnect ServiceTitan from the dashboard.`
    );
  }

  const data = await res.json();
  if (!data.access_token) {
    throw new Error(
      'ServiceTitan token refresh returned no access_token. The user should reconnect ServiceTitan from the dashboard.'
    );
  }

  return {
    access_token: data.access_token,
    expiry_date: Date.now() + (data.expires_in || 3600) * 1000,
  };
}

/** Make an authenticated REST call to ServiceTitan API */
export async function apiRequest<T = any>(
  method: string,
  path: string,
  accessToken: string,
  appKey: string,
  body?: Record<string, unknown>
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'ST-App-Key': appKey,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (networkErr: unknown) {
    const msg = networkErr instanceof Error ? networkErr.message : String(networkErr);
    throw new Error(`ServiceTitan API ${method} ${path} failed: network error — ${msg}`);
  }

  if (!res.ok) {
    const errorBody = await res.text();
    throw new Error(`ServiceTitan API ${method} ${path} failed (${res.status}): ${errorBody}`);
  }

  if (res.status === 204) return null as T;
  return res.json();
}

// -----------------------------------------------------------------------
// Convenience methods for customers and jobs
// -----------------------------------------------------------------------

export async function listCustomers(
  accessToken: string,
  appKey: string,
  tenantSid: string,
  page?: number
): Promise<ServiceTitanListResponse<ServiceTitanCustomer>> {
  const params = new URLSearchParams({ pageSize: '100' });
  if (page) params.set('page', String(page));
  return apiRequest(
    'GET',
    `/crm/v2/tenant/${tenantSid}/customers?${params.toString()}`,
    accessToken,
    appKey
  );
}

export async function getCustomer(
  accessToken: string,
  appKey: string,
  tenantSid: string,
  customerId: string
): Promise<ServiceTitanCustomer> {
  return apiRequest(
    'GET',
    `/crm/v2/tenant/${tenantSid}/customers/${customerId}`,
    accessToken,
    appKey
  );
}

export async function createCustomer(
  accessToken: string,
  appKey: string,
  tenantSid: string,
  customer: { name: string; email?: string; phoneNumber?: string; address?: Record<string, string> }
): Promise<ServiceTitanCustomer> {
  return apiRequest('POST', `/crm/v2/tenant/${tenantSid}/customers`, accessToken, appKey, customer);
}

export async function updateCustomer(
  accessToken: string,
  appKey: string,
  tenantSid: string,
  customerId: string,
  customer: {
    name?: string;
    email?: string;
    phoneNumber?: string;
    address?: Record<string, string>;
  }
): Promise<ServiceTitanCustomer> {
  return apiRequest(
    'PATCH',
    `/crm/v2/tenant/${tenantSid}/customers/${customerId}`,
    accessToken,
    appKey,
    customer
  );
}

export async function listJobs(
  accessToken: string,
  appKey: string,
  tenantSid: string,
  page?: number
): Promise<ServiceTitanListResponse<ServiceTitanJob>> {
  const params = new URLSearchParams({ pageSize: '100' });
  if (page) params.set('page', String(page));
  return apiRequest(
    'GET',
    `/jpm/v2/tenant/${tenantSid}/jobs?${params.toString()}`,
    accessToken,
    appKey
  );
}

export async function createJob(
  accessToken: string,
  appKey: string,
  tenantSid: string,
  job: { customerId: number; summary?: string; scheduledDate?: string }
): Promise<ServiceTitanJob> {
  return apiRequest('POST', `/jpm/v2/tenant/${tenantSid}/jobs`, accessToken, appKey, job);
}

export async function updateJob(
  accessToken: string,
  appKey: string,
  tenantSid: string,
  jobId: string,
  job: { summary?: string; scheduledDate?: string; status?: string }
): Promise<ServiceTitanJob> {
  return apiRequest('PATCH', `/jpm/v2/tenant/${tenantSid}/jobs/${jobId}`, accessToken, appKey, job);
}

export async function cancelJob(
  accessToken: string,
  appKey: string,
  tenantSid: string,
  jobId: string
): Promise<ServiceTitanJob> {
  return apiRequest('PATCH', `/jpm/v2/tenant/${tenantSid}/jobs/${jobId}`, accessToken, appKey, {
    status: 'Canceled',
  });
}
