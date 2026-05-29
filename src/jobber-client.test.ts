import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';

// --- Mock global fetch before importing the module under test ---
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import {
  isJobberEnabled,
  getAuthUrl,
  verifyState,
  exchangeCodeForTokens,
  refreshAccessToken,
  graphql,
  verifyWebhookSignature,
  QUERIES,
} from './services/crm/jobberClient';

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

function setJobberEnv() {
  process.env.JOBBER_CLIENT_ID = 'test-client-id';
  process.env.JOBBER_CLIENT_SECRET = 'test-client-secret';
  process.env.JOBBER_CALLBACK_URL = 'http://localhost:4001/calendar/auth/jobber/callback';
  process.env.JWT_SECRET = JWT_SECRET;
}

// ---------------------------------------------------------------------------
// isJobberEnabled
// ---------------------------------------------------------------------------
describe('isJobberEnabled', () => {
  it('returns true when all env vars are set', () => {
    // WHO: jobberClient.ts isJobberEnabled()
    // WHAT: all three JOBBER_* env vars plus JWT_SECRET are present
    // WHEN: checking if Jobber integration is available for a tenant
    // WHERE: src/services/jobberClient.ts isJobberEnabled()
    // WHY: without this, the CRM settings page would show the Jobber connect button even when the server lacks credentials, leading to a broken OAuth flow
    setJobberEnv();
    expect(isJobberEnabled()).toBe(true);
  });

  it('returns false when JOBBER_CLIENT_ID is missing', () => {
    // WHO: jobberClient.ts isJobberEnabled()
    // WHAT: JOBBER_CLIENT_ID env var is absent while others are present
    // WHEN: checking if Jobber integration is available
    // WHERE: src/services/jobberClient.ts isJobberEnabled()
    // WHY: without this guard, OAuth redirect would fail at Jobber's end with an invalid_client error, confusing the tenant admin
    setJobberEnv();
    delete process.env.JOBBER_CLIENT_ID;
    expect(isJobberEnabled()).toBe(false);
  });

  it('returns false when JOBBER_CLIENT_SECRET is missing', () => {
    // WHO: jobberClient.ts isJobberEnabled()
    // WHAT: JOBBER_CLIENT_SECRET env var is absent while others are present
    // WHEN: checking if Jobber integration is available
    // WHERE: src/services/jobberClient.ts isJobberEnabled()
    // WHY: without the secret, token exchange would fail silently — better to disable the integration upfront
    setJobberEnv();
    delete process.env.JOBBER_CLIENT_SECRET;
    expect(isJobberEnabled()).toBe(false);
  });

  it('returns false when JOBBER_CALLBACK_URL is missing', () => {
    // WHO: jobberClient.ts isJobberEnabled()
    // WHAT: JOBBER_CALLBACK_URL env var is absent while others are present
    // WHEN: checking if Jobber integration is available
    // WHERE: src/services/jobberClient.ts isJobberEnabled()
    // WHY: without the callback URL, OAuth redirect_uri would be undefined, causing Jobber to reject the auth request
    setJobberEnv();
    delete process.env.JOBBER_CALLBACK_URL;
    expect(isJobberEnabled()).toBe(false);
  });

  it('returns false when all Jobber env vars are missing', () => {
    // WHO: jobberClient.ts isJobberEnabled()
    // WHAT: no Jobber env vars are set at all (fresh deploy without Jobber config)
    // WHEN: checking if Jobber integration is available
    // WHERE: src/services/jobberClient.ts isJobberEnabled()
    // WHY: ensures tenants on deployments without Jobber credentials don't see a broken integration option in the CRM settings UI
    delete process.env.JOBBER_CLIENT_ID;
    delete process.env.JOBBER_CLIENT_SECRET;
    delete process.env.JOBBER_CALLBACK_URL;
    expect(isJobberEnabled()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getAuthUrl
// ---------------------------------------------------------------------------
describe('getAuthUrl', () => {
  it('returns a URL string when configured', () => {
    // WHO: jobberClient.ts getAuthUrl()
    // WHAT: all env vars set, generating OAuth authorization URL for a tenant
    // WHEN: tenant admin clicks "Connect Jobber" in CRM settings
    // WHERE: src/services/jobberClient.ts getAuthUrl()
    // WHY: if this regressed, the connect button would produce a null URL and the frontend would crash or show a blank page
    setJobberEnv();
    const url = getAuthUrl(TENANT_ID);
    expect(url).not.toBeNull();
    expect(url).toContain('api.getjobber.com');
  });

  it('includes correct query params', () => {
    // WHO: jobberClient.ts getAuthUrl()
    // WHAT: verifying client_id, response_type, redirect_uri, and OAuth scopes for clients+jobs+visits
    // WHEN: tenant admin clicks "Connect Jobber" in CRM settings
    // WHERE: src/services/jobberClient.ts getAuthUrl()
    // WHY: Jobber requires separate read/write scopes per resource — missing any scope would cause sync to silently fail on that resource type
    setJobberEnv();
    const url = getAuthUrl(TENANT_ID)!;
    const parsed = new URL(url);
    expect(parsed.searchParams.get('client_id')).toBe('test-client-id');
    expect(parsed.searchParams.get('response_type')).toBe('code');
    expect(parsed.searchParams.get('redirect_uri')).toBe(
      'http://localhost:4001/calendar/auth/jobber/callback'
    );
    expect(parsed.searchParams.get('scope')).toContain('read_clients');
    expect(parsed.searchParams.get('scope')).toContain('write_clients');
    expect(parsed.searchParams.get('scope')).toContain('read_jobs');
    expect(parsed.searchParams.get('scope')).toContain('write_jobs');
    expect(parsed.searchParams.get('scope')).toContain('read_visits');
    expect(parsed.searchParams.get('scope')).toContain('write_visits');
  });

  it('includes a signed JWT state param with tenantId and purpose', () => {
    // WHO: jobberClient.ts getAuthUrl()
    // WHAT: state param is a JWT containing tenantId and purpose="jobber-oauth"
    // WHEN: generating the OAuth URL before redirecting the tenant admin to Jobber
    // WHERE: src/services/jobberClient.ts getAuthUrl()
    // WHY: without a signed state param, an attacker could forge the OAuth callback and link their Jobber account to a victim's tenant (CSRF attack)
    setJobberEnv();
    const url = getAuthUrl(TENANT_ID)!;
    const parsed = new URL(url);
    const state = parsed.searchParams.get('state')!;
    const decoded = jwt.verify(state, JWT_SECRET) as { tenantId: string; purpose: string };
    expect(decoded.tenantId).toBe(TENANT_ID);
    expect(decoded.purpose).toBe('jobber-oauth');
  });

  it('returns null when Jobber is not configured', () => {
    // WHO: jobberClient.ts getAuthUrl()
    // WHAT: no Jobber env vars set — integration disabled
    // WHEN: tenant admin requests OAuth URL on a deploy without Jobber credentials
    // WHERE: src/services/jobberClient.ts getAuthUrl()
    // WHY: without this null return, the function would throw or produce a malformed URL, crashing the CRM settings page
    delete process.env.JOBBER_CLIENT_ID;
    delete process.env.JOBBER_CLIENT_SECRET;
    delete process.env.JOBBER_CALLBACK_URL;
    expect(getAuthUrl(TENANT_ID)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// verifyState
// ---------------------------------------------------------------------------
describe('verifyState', () => {
  it('returns tenantId for a valid state JWT', () => {
    // WHO: jobberClient.ts verifyState()
    // WHAT: valid JWT with correct tenantId, purpose="jobber-oauth", and unexpired
    // WHEN: Jobber redirects back to our callback with the state param
    // WHERE: src/services/jobberClient.ts verifyState()
    // WHY: if verification regressed, the callback would reject valid OAuth completions and tenants could never finish connecting Jobber
    setJobberEnv();
    const state = jwt.sign({ tenantId: TENANT_ID, purpose: 'jobber-oauth' }, JWT_SECRET, {
      expiresIn: '10m',
    });
    expect(verifyState(state)).toBe(TENANT_ID);
  });

  it('returns null for an expired state JWT', () => {
    // WHO: jobberClient.ts verifyState()
    // WHAT: JWT that has already expired (created with -1s expiry)
    // WHEN: Jobber callback arrives after the user waited too long (>10 min)
    // WHERE: src/services/jobberClient.ts verifyState()
    // WHY: without expiry validation, a replayed stale OAuth callback could link Jobber to the wrong tenant if the user has since switched accounts
    setJobberEnv();
    const state = jwt.sign({ tenantId: TENANT_ID, purpose: 'jobber-oauth' }, JWT_SECRET, {
      expiresIn: '-1s',
    });
    expect(verifyState(state)).toBeNull();
  });

  it("returns null when purpose doesn't match", () => {
    // WHO: jobberClient.ts verifyState()
    // WHAT: JWT with wrong purpose field (e.g., "wrong-purpose" instead of "jobber-oauth")
    // WHEN: a state JWT from a different OAuth flow (e.g., HubSpot) is replayed against Jobber callback
    // WHERE: src/services/jobberClient.ts verifyState()
    // WHY: without purpose checking, a HubSpot/Square OAuth state could be replayed against the Jobber callback, linking the wrong CRM
    setJobberEnv();
    const state = jwt.sign({ tenantId: TENANT_ID, purpose: 'wrong-purpose' }, JWT_SECRET, {
      expiresIn: '10m',
    });
    expect(verifyState(state)).toBeNull();
  });

  it('returns null for a completely invalid token', () => {
    // WHO: jobberClient.ts verifyState()
    // WHAT: garbage string that is not a valid JWT at all
    // WHEN: attacker sends a crafted callback with a random state value
    // WHERE: src/services/jobberClient.ts verifyState()
    // WHY: without this, jwt.verify would throw an unhandled error, crashing the callback handler instead of returning null gracefully
    setJobberEnv();
    expect(verifyState('not-a-jwt')).toBeNull();
  });

  it('returns null for a token signed with a different secret', () => {
    // WHO: jobberClient.ts verifyState()
    // WHAT: JWT signed with "wrong-secret" instead of the server's JWT_SECRET
    // WHEN: attacker forges a state JWT with a known tenantId but different signing key
    // WHERE: src/services/jobberClient.ts verifyState()
    // WHY: without signature verification, an attacker could craft a state JWT targeting any tenantId and hijack their Jobber integration
    setJobberEnv();
    const state = jwt.sign({ tenantId: TENANT_ID, purpose: 'jobber-oauth' }, 'wrong-secret', {
      expiresIn: '10m',
    });
    expect(verifyState(state)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// exchangeCodeForTokens
// ---------------------------------------------------------------------------
describe('exchangeCodeForTokens', () => {
  it('returns token set on success', async () => {
    // WHO: oauthCallbackFactory.ts calling jobberClient.exchangeCodeForTokens()
    // WHAT: Jobber returns access_token, refresh_token, and expires_in after valid auth code exchange
    // WHEN: OAuth callback handler receives the authorization code from Jobber
    // WHERE: src/services/jobberClient.ts exchangeCodeForTokens()
    // WHY: if token parsing regressed, tokens would be stored incorrectly in tenant_integration_settings and all subsequent GraphQL calls would fail with 401
    setJobberEnv();
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

    // Verify fetch was called with correct URL
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.getjobber.com/api/oauth/token',
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('throws when access_token is missing', async () => {
    // WHO: oauthCallbackFactory.ts calling jobberClient.exchangeCodeForTokens()
    // WHAT: Jobber returns null access_token (possible API error or partial response)
    // WHEN: OAuth code exchange succeeds HTTP-wise but response body is incomplete
    // WHERE: src/services/jobberClient.ts exchangeCodeForTokens()
    // WHY: without this check, a null access_token would be stored and every subsequent Jobber GraphQL call would send "Bearer null", silently failing
    setJobberEnv();
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: null, refresh_token: 'refresh-456' }),
    });

    await expect(exchangeCodeForTokens('auth-code')).rejects.toThrow('incomplete tokens');
  });

  it('throws when refresh_token is missing', async () => {
    // WHO: oauthCallbackFactory.ts calling jobberClient.exchangeCodeForTokens()
    // WHAT: Jobber returns null refresh_token
    // WHEN: OAuth code exchange succeeds HTTP-wise but response body is incomplete
    // WHERE: src/services/jobberClient.ts exchangeCodeForTokens()
    // WHY: without a refresh_token, the integration would work for 1 hour then permanently break — tenant would need to re-authorize manually
    setJobberEnv();
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: 'access-123', refresh_token: null }),
    });

    await expect(exchangeCodeForTokens('auth-code')).rejects.toThrow('incomplete tokens');
  });

  it('throws when HTTP response is not ok', async () => {
    // WHO: oauthCallbackFactory.ts calling jobberClient.exchangeCodeForTokens()
    // WHAT: Jobber token endpoint returns HTTP 400 (invalid or expired auth code)
    // WHEN: auth code is stale (user took too long) or was already used
    // WHERE: src/services/jobberClient.ts exchangeCodeForTokens()
    // WHY: without this check, the code would try to parse a non-JSON error body as tokens, producing garbage credentials in the database
    setJobberEnv();
    mockFetch.mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => 'Bad Request',
    });

    await expect(exchangeCodeForTokens('auth-code')).rejects.toThrow(
      'Jobber OAuth code exchange failed'
    );
  });

  it('throws on network error', async () => {
    // WHO: oauthCallbackFactory.ts calling jobberClient.exchangeCodeForTokens()
    // WHAT: fetch rejects with ECONNREFUSED (Jobber API unreachable)
    // WHEN: network partition or Jobber outage during OAuth flow
    // WHERE: src/services/jobberClient.ts exchangeCodeForTokens()
    // WHY: without wrapping fetch errors, an unhandled promise rejection would crash the route handler instead of returning a user-friendly error
    setJobberEnv();
    mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(exchangeCodeForTokens('auth-code')).rejects.toThrow('network error');
  });

  it('throws when Jobber is not configured', async () => {
    // WHO: oauthCallbackFactory.ts calling jobberClient.exchangeCodeForTokens()
    // WHAT: no JOBBER_* env vars are set
    // WHEN: code exchange is attempted on a deploy that doesn't have Jobber credentials
    // WHERE: src/services/jobberClient.ts exchangeCodeForTokens()
    // WHY: without this early guard, the function would send undefined client_id/secret to Jobber, getting a confusing 400 error instead of a clear message
    delete process.env.JOBBER_CLIENT_ID;
    delete process.env.JOBBER_CLIENT_SECRET;
    delete process.env.JOBBER_CALLBACK_URL;

    await expect(exchangeCodeForTokens('auth-code')).rejects.toThrow('Jobber not configured');
  });
});

// ---------------------------------------------------------------------------
// refreshAccessToken
// ---------------------------------------------------------------------------
describe('refreshAccessToken', () => {
  it('returns refreshed credentials on success', async () => {
    // WHO: tokenManagement.ts calling jobberClient.refreshAccessToken()
    // WHAT: Jobber returns a new access_token and expires_in after valid refresh
    // WHEN: token refresh triggered by tokenManagement.ts 5-min-before-expiry buffer check
    // WHERE: src/services/jobberClient.ts refreshAccessToken()
    // WHY: if refresh parsing regressed, the new token wouldn't be stored correctly and the integration would break after the first token expiry (1 hour)
    setJobberEnv();
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

  it('throws when HTTP response is not ok', async () => {
    // WHO: tokenManagement.ts calling jobberClient.refreshAccessToken()
    // WHAT: Jobber token endpoint returns HTTP 401 (refresh token revoked or expired)
    // WHEN: tenant revoked app access in Jobber settings, or refresh token exceeded its lifetime
    // WHERE: src/services/jobberClient.ts refreshAccessToken()
    // WHY: without this error, stale credentials would persist in tenant_integration_settings and sync would silently fail until someone noticed
    setJobberEnv();
    mockFetch.mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => 'Unauthorized',
    });

    await expect(refreshAccessToken('old-refresh-token')).rejects.toThrow(
      'Jobber token refresh failed'
    );
  });

  it('throws when access_token is missing from response', async () => {
    // WHO: tokenManagement.ts calling jobberClient.refreshAccessToken()
    // WHAT: Jobber returns 200 OK but with null access_token in body
    // WHEN: unexpected Jobber API behavior or response format change
    // WHERE: src/services/jobberClient.ts refreshAccessToken()
    // WHY: without this check, a null token would overwrite the valid old token, immediately breaking all Jobber GraphQL calls for this tenant
    setJobberEnv();
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: null }),
    });

    await expect(refreshAccessToken('old-refresh-token')).rejects.toThrow(
      'Jobber token refresh returned no access_token'
    );
  });

  it('throws on network error', async () => {
    // WHO: tokenManagement.ts calling jobberClient.refreshAccessToken()
    // WHAT: fetch rejects with ETIMEDOUT (Jobber API unreachable)
    // WHEN: network partition or Jobber outage during token refresh
    // WHERE: src/services/jobberClient.ts refreshAccessToken()
    // WHY: without wrapping fetch errors, an unhandled rejection would crash the sync worker instead of allowing retry logic to kick in
    setJobberEnv();
    mockFetch.mockRejectedValue(new Error('ETIMEDOUT'));

    await expect(refreshAccessToken('old-refresh-token')).rejects.toThrow('network error');
  });

  it('throws when Jobber is not configured', async () => {
    // WHO: tokenManagement.ts calling jobberClient.refreshAccessToken()
    // WHAT: no JOBBER_* env vars set
    // WHEN: token refresh attempted on a deploy without Jobber credentials
    // WHERE: src/services/jobberClient.ts refreshAccessToken()
    // WHY: without this guard, the function would send undefined client_id/secret to Jobber, producing a confusing HTTP error instead of a clear message
    delete process.env.JOBBER_CLIENT_ID;
    delete process.env.JOBBER_CLIENT_SECRET;
    delete process.env.JOBBER_CALLBACK_URL;

    await expect(refreshAccessToken('old-refresh-token')).rejects.toThrow('Jobber not configured');
  });
});

// ---------------------------------------------------------------------------
// graphql
// ---------------------------------------------------------------------------
describe('graphql', () => {
  const testQuery = 'query { me { id name } }';

  it('sends correct request and returns data', async () => {
    // WHO: jobberSync.ts calling jobberClient.graphql() for client/job queries
    // WHAT: POST to Jobber GraphQL endpoint with query, variables, and Bearer auth header
    // WHEN: any Jobber sync operation (pull clients, create jobs, list visits, etc.)
    // WHERE: src/services/jobberClient.ts graphql()
    // WHY: Jobber uses GraphQL instead of REST — if the endpoint or request structure regressed, all sync operations would fail silently
    setJobberEnv();
    const responseData = { me: { id: '1', name: 'Test User' } };
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ data: responseData }),
    });

    const result = await graphql('my-access-token', testQuery, { foo: 'bar' });

    expect(result.data).toEqual(responseData);

    // Verify fetch was called correctly
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.getjobber.com/api/graphql',
      expect.objectContaining({
        method: 'POST',
        headers: {
          Authorization: 'Bearer my-access-token',
          'Content-Type': 'application/json',
        },
      })
    );

    // Verify request body
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.query).toBe(testQuery);
    expect(body.variables).toEqual({ foo: 'bar' });
  });

  it('throws when HTTP response is not ok', async () => {
    // WHO: jobberSync.ts calling jobberClient.graphql()
    // WHAT: Jobber returns HTTP 500 Internal Server Error
    // WHEN: Jobber API is experiencing an outage or internal issue
    // WHERE: src/services/jobberClient.ts graphql()
    // WHY: without throwing on HTTP errors, the sync would try to parse an error page as GraphQL data, producing undefined results and corrupting local records
    setJobberEnv();
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'Internal Server Error',
    });

    await expect(graphql('token', testQuery)).rejects.toThrow('Jobber GraphQL API error (500)');
  });

  it('throws when response contains GraphQL errors', async () => {
    // WHO: jobberSync.ts calling jobberClient.graphql()
    // WHAT: Jobber returns HTTP 200 but with GraphQL errors array in response body
    // WHEN: query references a non-existent field, or token lacks required scope for the query
    // WHERE: src/services/jobberClient.ts graphql()
    // WHY: GraphQL returns 200 even on errors — without checking the errors array, sync would process null data as valid, overwriting local records with nulls
    setJobberEnv();
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: null,
        errors: [
          { message: 'Field not found', path: ['me', 'unknown'] },
          { message: 'Unauthorized access' },
        ],
      }),
    });

    await expect(graphql('token', testQuery)).rejects.toThrow(
      'Jobber GraphQL errors: Field not found; Unauthorized access'
    );
  });

  it('throws on network error', async () => {
    // WHO: jobberSync.ts calling jobberClient.graphql()
    // WHAT: fetch rejects with ECONNRESET (connection dropped mid-request)
    // WHEN: network instability or Jobber API connection reset
    // WHERE: src/services/jobberClient.ts graphql()
    // WHY: without wrapping network errors, an unhandled rejection would crash the sync worker instead of allowing the caller to handle the failure
    setJobberEnv();
    mockFetch.mockRejectedValue(new Error('ECONNRESET'));

    await expect(graphql('token', testQuery)).rejects.toThrow('network error');
  });
});

// ---------------------------------------------------------------------------
// verifyWebhookSignature
// ---------------------------------------------------------------------------
describe('verifyWebhookSignature', () => {
  const webhookSecret = 'whsec_test_secret_123';
  const payload = '{"event":"client.created","data":{"id":"123"}}';

  function computeSignature(body: string, secret: string): string {
    return crypto.createHmac('sha256', secret).update(body, 'utf8').digest('hex');
  }

  it('returns true for valid signature', () => {
    // WHO: src/routes/jobber.ts webhook handler calling jobberClient.verifyWebhookSignature()
    // WHAT: HMAC-SHA256 hex digest of the body matches the X-Jobber-Hmac-SHA256 header
    // WHEN: Jobber sends a webhook event (client.created, job.updated, etc.)
    // WHERE: src/services/jobberClient.ts verifyWebhookSignature()
    // WHY: if valid signature verification regressed, we would reject all legitimate webhooks and miss real-time sync events from Jobber
    const signature = computeSignature(payload, webhookSecret);
    expect(verifyWebhookSignature(payload, signature, webhookSecret)).toBe(true);
  });

  it('returns false for invalid signature', () => {
    // WHO: src/routes/jobber.ts webhook handler calling jobberClient.verifyWebhookSignature()
    // WHAT: signature was computed against "tampered payload" but webhook body is different
    // WHEN: attacker intercepts and modifies the webhook payload in transit
    // WHERE: src/services/jobberClient.ts verifyWebhookSignature()
    // WHY: without body integrity checking, an attacker could inject fake client data or job changes into our system via forged webhooks
    const badSignature = computeSignature('tampered payload', webhookSecret);
    expect(verifyWebhookSignature(payload, badSignature, webhookSecret)).toBe(false);
  });

  it('returns false for signature computed with wrong secret', () => {
    // WHO: src/routes/jobber.ts webhook handler calling jobberClient.verifyWebhookSignature()
    // WHAT: signature computed with "wrong-secret" instead of the correct webhook secret
    // WHEN: attacker tries to forge a webhook using a guessed or leaked key from another integration
    // WHERE: src/services/jobberClient.ts verifyWebhookSignature()
    // WHY: without secret verification, any party who knows the webhook URL could forge events and manipulate client/job data in our system
    const wrongSecretSig = computeSignature(payload, 'wrong-secret');
    expect(verifyWebhookSignature(payload, wrongSecretSig, webhookSecret)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// QUERIES export
// ---------------------------------------------------------------------------
describe('QUERIES', () => {
  it('exports all expected query keys', () => {
    // WHO: jobberSync.ts importing QUERIES from jobberClient.ts
    // WHAT: QUERIES object contains all 6 required GraphQL query/mutation strings
    // WHEN: sync operations reference QUERIES.listClients, QUERIES.createJob, etc.
    // WHERE: src/services/jobberClient.ts QUERIES export
    // WHY: if a query key was removed or renamed, the sync code would crash at runtime with "Cannot read property of undefined" when building the GraphQL request
    expect(QUERIES).toHaveProperty('listClients');
    expect(QUERIES).toHaveProperty('getClient');
    expect(QUERIES).toHaveProperty('listVisits');
    expect(QUERIES).toHaveProperty('createClient');
    expect(QUERIES).toHaveProperty('updateClient');
    expect(QUERIES).toHaveProperty('createJob');
  });

  it('queries are non-empty strings', () => {
    // WHO: jobberSync.ts using QUERIES values in graphql() calls
    // WHAT: every value in QUERIES is a non-empty string (valid GraphQL query/mutation)
    // WHEN: any sync operation sends a query to the Jobber GraphQL endpoint
    // WHERE: src/services/jobberClient.ts QUERIES export
    // WHY: an empty or whitespace-only query string would cause Jobber to return a GraphQL parse error, silently breaking all sync operations for that resource
    for (const [_key, value] of Object.entries(QUERIES)) {
      expect(typeof value).toBe('string');
      expect(value.trim().length).toBeGreaterThan(0);
    }
  });
});
