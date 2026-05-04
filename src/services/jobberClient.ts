import crypto from 'crypto';
import { signOAuthState, verifyOAuthState } from './oauthStateJwt';

const AUTHORIZE_URL = 'https://api.getjobber.com/api/oauth/authorize';
const TOKEN_URL = 'https://api.getjobber.com/api/oauth/token';
const GRAPHQL_URL = 'https://api.getjobber.com/api/graphql';
const SCOPES = 'read_clients write_clients read_jobs write_jobs read_visits write_visits';
const FETCH_TIMEOUT_MS = 15_000;

export interface TokenSet {
  access_token: string;
  refresh_token: string;
  expiry_date: number;
}

export interface JobberClient {
  id: string;
  firstName: string | null;
  lastName: string | null;
  companyName: string | null;
  isCompany: boolean;
  phones: Array<{ number: string; primary: boolean }>;
  emails: Array<{ address: string; primary: boolean }>;
  billingAddress: {
    street1?: string;
    city?: string;
    province?: string;
    postalCode?: string;
  } | null;
  createdAt: string;
  updatedAt: string;
}

export interface JobberVisit {
  id: string;
  title: string | null;
  startAt: string;
  endAt: string;
  status: string;
  completedAt: string | null;
  job: { id: string; title: string | null; client: { id: string } };
  assignedServiceMembers: { nodes: Array<{ id: string; name: string }> };
  createdAt: string;
  updatedAt: string;
}

export interface GraphQLResponse<T = any> {
  data?: T;
  errors?: Array<{ message: string; path?: string[] }>;
}

function getConfig() {
  const clientId = process.env.JOBBER_CLIENT_ID;
  const clientSecret = process.env.JOBBER_CLIENT_SECRET;
  const callbackUrl = process.env.JOBBER_CALLBACK_URL;
  if (!clientId || !clientSecret || !callbackUrl) {
    const missing = [
      !clientId && 'JOBBER_CLIENT_ID',
      !clientSecret && 'JOBBER_CLIENT_SECRET',
      !callbackUrl && 'JOBBER_CALLBACK_URL',
    ].filter(Boolean);
    console.warn(`[jobberClient] Not configured — missing env vars: ${missing.join(', ')}`);
    return null;
  }
  return { clientId, clientSecret, callbackUrl };
}

/** Returns true if Jobber integration is configured */
export function isJobberEnabled(): boolean {
  return getConfig() !== null;
}

/**
 * Build the Jobber OAuth consent URL.
 * State param is a signed JWT containing the tenantId for CSRF protection.
 */
export function getAuthUrl(tenantId: string): string | null {
  const config = getConfig();
  if (!config) return null;

  const state = signOAuthState({ tenantId, purpose: 'jobber-oauth' });

  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.callbackUrl,
    response_type: 'code',
    scope: SCOPES,
    state,
  });

  return `${AUTHORIZE_URL}?${params.toString()}`;
}

/** Verify the state param from Jobber callback, returns tenantId */
export function verifyState(state: string): string | null {
  return verifyOAuthState({ state, expectedPurpose: 'jobber-oauth' });
}

/** Exchange authorization code for tokens */
export async function exchangeCodeForTokens(code: string): Promise<TokenSet> {
  const config = getConfig();
  if (!config) throw new Error('Jobber not configured — missing env vars (check JOBBER_CLIENT_ID, JOBBER_CLIENT_SECRET, JOBBER_CALLBACK_URL)');

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: config.callbackUrl,
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
    throw new Error(`Jobber OAuth code exchange failed: network error reaching Jobber token endpoint — ${msg}`);
  }

  if (!res.ok) {
    const errorBody = await res.text();
    throw new Error(`Jobber OAuth code exchange failed (${res.status}): ${errorBody}. The user may need to re-authorize from the dashboard.`);
  }

  const data = await res.json();
  if (!data.access_token || !data.refresh_token) {
    throw new Error('Jobber OAuth code exchange returned incomplete tokens (missing access_token or refresh_token).');
  }

  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expiry_date: Date.now() + (data.expires_in || 7200) * 1000,
  };
}

/** Refresh an expired access token */
export async function refreshAccessToken(refreshToken: string): Promise<{ access_token: string; expiry_date: number }> {
  const config = getConfig();
  if (!config) throw new Error('Jobber not configured — missing env vars (check JOBBER_CLIENT_ID, JOBBER_CLIENT_SECRET, JOBBER_CALLBACK_URL)');

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: config.clientId,
    client_secret: config.clientSecret,
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
    throw new Error(`Jobber token refresh failed: network error — ${msg}`);
  }

  if (!res.ok) {
    const errorBody = await res.text();
    throw new Error(`Jobber token refresh failed (${res.status}): ${errorBody}. The user should reconnect Jobber from the dashboard.`);
  }

  const data = await res.json();
  if (!data.access_token) {
    throw new Error('Jobber token refresh returned no access_token. The user should reconnect Jobber from the dashboard.');
  }

  return {
    access_token: data.access_token,
    expiry_date: Date.now() + (data.expires_in || 7200) * 1000,
  };
}

/** Execute a GraphQL query/mutation against the Jobber API */
export async function graphql<T = any>(
  accessToken: string,
  query: string,
  variables?: Record<string, any>
): Promise<GraphQLResponse<T>> {
  let res: Response;
  try {
    res = await fetch(GRAPHQL_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (networkErr: unknown) {
    const msg = networkErr instanceof Error ? networkErr.message : String(networkErr);
    throw new Error(`Jobber GraphQL request failed: network error — ${msg}`);
  }

  if (!res.ok) {
    const errorBody = await res.text();
    throw new Error(`Jobber GraphQL API error (${res.status}): ${errorBody}`);
  }

  const data: GraphQLResponse<T> = await res.json();
  if (data.errors && data.errors.length > 0) {
    const messages = data.errors.map(e => e.message).join('; ');
    throw new Error(`Jobber GraphQL errors: ${messages}`);
  }

  return data;
}

/** Verify webhook HMAC-SHA256 signature */
export function verifyWebhookSignature(payload: string, signature: string, secret: string): boolean {
  const expected = crypto
    .createHmac('sha256', secret)
    .update(payload, 'utf8')
    .digest('hex');
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

// -----------------------------------------------------------------------
// GraphQL query/mutation builders
// -----------------------------------------------------------------------

export const QUERIES = {
  listClients: `
    query ListClients($first: Int!, $after: String) {
      clients(first: $first, after: $after) {
        nodes {
          id firstName lastName companyName isCompany
          phones { number primary }
          emails { address primary }
          billingAddress { street1 city province postalCode }
          createdAt updatedAt
        }
        pageInfo { hasNextPage endCursor }
        totalCount
      }
    }
  `,

  getClient: `
    query GetClient($id: ID!) {
      client(id: $id) {
        id firstName lastName companyName isCompany
        phones { number primary }
        emails { address primary }
        billingAddress { street1 city province postalCode }
        createdAt updatedAt
      }
    }
  `,

  listVisits: `
    query ListVisits($first: Int!, $after: String) {
      visits(first: $first, after: $after) {
        nodes {
          id title startAt endAt status completedAt
          job { id title client { id } }
          assignedServiceMembers { nodes { id name } }
          createdAt updatedAt
        }
        pageInfo { hasNextPage endCursor }
        totalCount
      }
    }
  `,

  createClient: `
    mutation CreateClient($input: ClientCreateInput!) {
      clientCreate(input: $input) {
        client { id firstName lastName createdAt updatedAt }
        userErrors { message path }
      }
    }
  `,

  updateClient: `
    mutation UpdateClient($clientId: ID!, $input: ClientUpdateInput!) {
      clientUpdate(clientId: $clientId, input: $input) {
        client { id firstName lastName updatedAt }
        userErrors { message path }
      }
    }
  `,

  createJob: `
    mutation CreateJob($input: JobCreateInput!) {
      jobCreate(input: $input) {
        job {
          id jobNumber title
          visits(first: 1) { nodes { id startAt endAt } }
        }
        userErrors { message path }
      }
    }
  `,
};
