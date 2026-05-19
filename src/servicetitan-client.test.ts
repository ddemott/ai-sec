import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import jwt from 'jsonwebtoken';

// --- Mock global fetch before importing the module under test ---
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import {
  isServiceTitanEnabled,
  getAuthUrl,
  verifyState,
  exchangeCodeForTokens,
  refreshAccessToken,
  apiRequest,
  listCustomers,
  _getCustomer,
  createCustomer,
  updateCustomer,
  listJobs,
  createJob,
  updateJob,
  cancelJob,
} from './services/servicetitanClient';

const JWT_SECRET = 'test-jwt-secret';
const TENANT_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const TENANT_SID = '123456789';
const APP_KEY = 'test-app-key';

const originalEnv = process.env;

beforeEach(() => {
  process.env = { ...originalEnv };
  vi.clearAllMocks();
});

afterAll(() => {
  process.env = originalEnv;
});

function setServiceTitanEnv() {
  process.env.SERVICETITAN_CLIENT_ID = 'test-client-id';
  process.env.SERVICETITAN_CLIENT_SECRET = 'test-client-secret';
  process.env.SERVICETITAN_CALLBACK_URL = 'http://localhost:4001/servicetitan/auth/callback';
  process.env.SERVICETITAN_APP_KEY = APP_KEY;
  process.env.JWT_SECRET = JWT_SECRET;
}

// ---------------------------------------------------------------------------
// isServiceTitanEnabled
// ---------------------------------------------------------------------------
describe('isServiceTitanEnabled', () => {
  it('returns true when all env vars are set', () => {
    // WHO: servicetitanClient.ts isServiceTitanEnabled()
    // WHAT: all four SERVICETITAN_* env vars plus JWT_SECRET are present
    // WHEN: checking if ServiceTitan integration is available for a tenant
    // WHERE: src/services/servicetitanClient.ts isServiceTitanEnabled()
    // WHY: without this, the CRM settings page would show the ServiceTitan connect button even when credentials are missing, leading to a broken OAuth flow
    setServiceTitanEnv();
    expect(isServiceTitanEnabled()).toBe(true);
  });

  it('returns false when SERVICETITAN_CLIENT_ID is missing', () => {
    // WHO: servicetitanClient.ts isServiceTitanEnabled()
    // WHAT: SERVICETITAN_CLIENT_ID env var is absent while others are present
    // WHEN: checking if ServiceTitan integration is available
    // WHERE: src/services/servicetitanClient.ts isServiceTitanEnabled()
    // WHY: without this guard, OAuth redirect would fail at ServiceTitan's end with an invalid_client error
    setServiceTitanEnv();
    delete process.env.SERVICETITAN_CLIENT_ID;
    expect(isServiceTitanEnabled()).toBe(false);
  });

  it('returns false when SERVICETITAN_CLIENT_SECRET is missing', () => {
    // WHO: servicetitanClient.ts isServiceTitanEnabled()
    // WHAT: SERVICETITAN_CLIENT_SECRET env var is absent while others are present
    // WHEN: checking if ServiceTitan integration is available
    // WHERE: src/services/servicetitanClient.ts isServiceTitanEnabled()
    // WHY: without the secret, token exchange would fail — better to disable the integration upfront than show a broken connect button
    setServiceTitanEnv();
    delete process.env.SERVICETITAN_CLIENT_SECRET;
    expect(isServiceTitanEnabled()).toBe(false);
  });

  it('returns false when SERVICETITAN_CALLBACK_URL is missing', () => {
    // WHO: servicetitanClient.ts isServiceTitanEnabled()
    // WHAT: SERVICETITAN_CALLBACK_URL env var is absent while others are present
    // WHEN: checking if ServiceTitan integration is available
    // WHERE: src/services/servicetitanClient.ts isServiceTitanEnabled()
    // WHY: without the callback URL, OAuth redirect_uri would be undefined, causing ServiceTitan to reject the auth request
    setServiceTitanEnv();
    delete process.env.SERVICETITAN_CALLBACK_URL;
    expect(isServiceTitanEnabled()).toBe(false);
  });

  it('returns false when SERVICETITAN_APP_KEY is missing', () => {
    // WHO: servicetitanClient.ts isServiceTitanEnabled()
    // WHAT: SERVICETITAN_APP_KEY env var is absent while others are present
    // WHEN: checking if ServiceTitan integration is available
    // WHERE: src/services/servicetitanClient.ts isServiceTitanEnabled()
    // WHY: ServiceTitan requires ST-App-Key header on all API calls — without it, every API request would return 403 even with valid OAuth tokens
    setServiceTitanEnv();
    delete process.env.SERVICETITAN_APP_KEY;
    expect(isServiceTitanEnabled()).toBe(false);
  });

  it('returns false when all ServiceTitan env vars are missing', () => {
    // WHO: servicetitanClient.ts isServiceTitanEnabled()
    // WHAT: no ServiceTitan env vars are set (fresh deploy without ST config)
    // WHEN: checking if ServiceTitan integration is available
    // WHERE: src/services/servicetitanClient.ts isServiceTitanEnabled()
    // WHY: ensures tenants on deployments without ServiceTitan credentials don't see a broken integration option in CRM settings
    delete process.env.SERVICETITAN_CLIENT_ID;
    delete process.env.SERVICETITAN_CLIENT_SECRET;
    delete process.env.SERVICETITAN_CALLBACK_URL;
    delete process.env.SERVICETITAN_APP_KEY;
    expect(isServiceTitanEnabled()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getAuthUrl
// ---------------------------------------------------------------------------
describe('getAuthUrl', () => {
  it('returns a URL string when configured', () => {
    // WHO: servicetitanClient.ts getAuthUrl()
    // WHAT: all env vars set, generating OAuth authorization URL for a tenant
    // WHEN: tenant admin clicks "Connect ServiceTitan" in CRM settings
    // WHERE: src/services/servicetitanClient.ts getAuthUrl()
    // WHY: if this regressed, the connect button would produce a null URL and the frontend would crash or show a blank page
    setServiceTitanEnv();
    const url = getAuthUrl(TENANT_ID);
    expect(url).not.toBeNull();
    expect(url).toContain('auth.servicetitan.io');
  });

  it('includes correct query params', () => {
    // WHO: servicetitanClient.ts getAuthUrl()
    // WHAT: verifying client_id, response_type, redirect_uri, and OAuth scopes for customers+jobs
    // WHEN: tenant admin clicks "Connect ServiceTitan" in CRM settings
    // WHERE: src/services/servicetitanClient.ts getAuthUrl()
    // WHY: wrong scopes would cause ServiceTitan to grant insufficient permissions — sync would fail on customer or job operations
    setServiceTitanEnv();
    const url = getAuthUrl(TENANT_ID)!;
    const parsed = new URL(url);
    expect(parsed.searchParams.get('client_id')).toBe('test-client-id');
    expect(parsed.searchParams.get('response_type')).toBe('code');
    expect(parsed.searchParams.get('redirect_uri')).toBe(
      'http://localhost:4001/servicetitan/auth/callback'
    );
    expect(parsed.searchParams.get('scope')).toContain('customers');
    expect(parsed.searchParams.get('scope')).toContain('jobs');
  });

  it('includes a signed JWT state param with tenantId and purpose', () => {
    // WHO: servicetitanClient.ts getAuthUrl()
    // WHAT: state param is a JWT containing tenantId and purpose="servicetitan-oauth"
    // WHEN: generating the OAuth URL before redirecting the tenant admin to ServiceTitan
    // WHERE: src/services/servicetitanClient.ts getAuthUrl()
    // WHY: without a signed state param, an attacker could forge the OAuth callback and link their ServiceTitan account to a victim's tenant (CSRF attack)
    setServiceTitanEnv();
    const url = getAuthUrl(TENANT_ID)!;
    const parsed = new URL(url);
    const state = parsed.searchParams.get('state')!;
    const decoded = jwt.verify(state, JWT_SECRET) as { tenantId: string; purpose: string };
    expect(decoded.tenantId).toBe(TENANT_ID);
    expect(decoded.purpose).toBe('servicetitan-oauth');
  });

  it('returns null when ServiceTitan is not configured', () => {
    // WHO: servicetitanClient.ts getAuthUrl()
    // WHAT: no ServiceTitan env vars set — integration disabled
    // WHEN: tenant admin requests OAuth URL on a deploy without ServiceTitan credentials
    // WHERE: src/services/servicetitanClient.ts getAuthUrl()
    // WHY: without this null return, the function would throw or produce a malformed URL, crashing the CRM settings page
    delete process.env.SERVICETITAN_CLIENT_ID;
    delete process.env.SERVICETITAN_CLIENT_SECRET;
    delete process.env.SERVICETITAN_CALLBACK_URL;
    delete process.env.SERVICETITAN_APP_KEY;
    expect(getAuthUrl(TENANT_ID)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// verifyState
// ---------------------------------------------------------------------------
describe('verifyState', () => {
  it('returns tenantId for a valid state JWT', () => {
    // WHO: servicetitanClient.ts verifyState()
    // WHAT: valid JWT with correct tenantId, purpose="servicetitan-oauth", and unexpired
    // WHEN: ServiceTitan redirects back to our callback with the state param
    // WHERE: src/services/servicetitanClient.ts verifyState()
    // WHY: if verification regressed, the callback would reject valid OAuth completions and tenants could never finish connecting ServiceTitan
    setServiceTitanEnv();
    const state = jwt.sign({ tenantId: TENANT_ID, purpose: 'servicetitan-oauth' }, JWT_SECRET, {
      expiresIn: '10m',
    });
    expect(verifyState(state)).toBe(TENANT_ID);
  });

  it('returns null for an expired state JWT', () => {
    // WHO: servicetitanClient.ts verifyState()
    // WHAT: JWT that has already expired (created with -1s expiry)
    // WHEN: ServiceTitan callback arrives after the user waited too long (>10 min)
    // WHERE: src/services/servicetitanClient.ts verifyState()
    // WHY: without expiry validation, a replayed stale OAuth callback could link ServiceTitan to the wrong tenant if the user has since switched accounts
    setServiceTitanEnv();
    const state = jwt.sign({ tenantId: TENANT_ID, purpose: 'servicetitan-oauth' }, JWT_SECRET, {
      expiresIn: '-1s',
    });
    expect(verifyState(state)).toBeNull();
  });

  it("returns null when purpose doesn't match", () => {
    // WHO: servicetitanClient.ts verifyState()
    // WHAT: JWT with wrong purpose field (e.g., "wrong-purpose" instead of "servicetitan-oauth")
    // WHEN: a state JWT from a different OAuth flow (e.g., Square) is replayed against ServiceTitan callback
    // WHERE: src/services/servicetitanClient.ts verifyState()
    // WHY: without purpose checking, a Square/HubSpot OAuth state could be replayed against the ServiceTitan callback, linking the wrong CRM
    setServiceTitanEnv();
    const state = jwt.sign({ tenantId: TENANT_ID, purpose: 'wrong-purpose' }, JWT_SECRET, {
      expiresIn: '10m',
    });
    expect(verifyState(state)).toBeNull();
  });

  it('returns null for a completely invalid token', () => {
    // WHO: servicetitanClient.ts verifyState()
    // WHAT: garbage string that is not a valid JWT at all
    // WHEN: attacker sends a crafted callback with a random state value
    // WHERE: src/services/servicetitanClient.ts verifyState()
    // WHY: without this, jwt.verify would throw an unhandled error, crashing the callback handler instead of returning null gracefully
    setServiceTitanEnv();
    expect(verifyState('not-a-jwt')).toBeNull();
  });

  it('returns null for a token signed with a different secret', () => {
    // WHO: servicetitanClient.ts verifyState()
    // WHAT: JWT signed with "wrong-secret" instead of the server's JWT_SECRET
    // WHEN: attacker forges a state JWT with a known tenantId but different signing key
    // WHERE: src/services/servicetitanClient.ts verifyState()
    // WHY: without signature verification, an attacker could craft a state JWT targeting any tenantId and hijack their ServiceTitan integration
    setServiceTitanEnv();
    const state = jwt.sign({ tenantId: TENANT_ID, purpose: 'servicetitan-oauth' }, 'wrong-secret', {
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
    // WHO: oauthCallbackFactory.ts calling servicetitanClient.exchangeCodeForTokens()
    // WHAT: ServiceTitan returns access_token, refresh_token, and expires_in after valid auth code exchange
    // WHEN: OAuth callback handler receives the authorization code from ServiceTitan
    // WHERE: src/services/servicetitanClient.ts exchangeCodeForTokens()
    // WHY: if token parsing regressed, tokens would be stored incorrectly in tenant_integration_settings and all subsequent ST API calls would fail with 401
    setServiceTitanEnv();
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
      'https://auth.servicetitan.io/connect/token',
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('defaults to 3600s expiry when expires_in is missing', async () => {
    // WHO: oauthCallbackFactory.ts calling servicetitanClient.exchangeCodeForTokens()
    // WHAT: ServiceTitan response omits expires_in field entirely
    // WHEN: ServiceTitan API changes response format or field is optional
    // WHERE: src/services/servicetitanClient.ts exchangeCodeForTokens()
    // WHY: without a fallback expiry, the token would appear expired immediately (expiry_date=NaN), triggering constant unnecessary token refreshes
    setServiceTitanEnv();
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: 'access-123',
        refresh_token: 'refresh-456',
      }),
    });

    const before = Date.now();
    const tokens = await exchangeCodeForTokens('auth-code');

    expect(tokens.expiry_date).toBeGreaterThanOrEqual(before + 3600 * 1000);
    expect(tokens.expiry_date).toBeLessThanOrEqual(Date.now() + 3600 * 1000 + 1000);
  });

  it('throws when access_token is missing', async () => {
    // WHO: oauthCallbackFactory.ts calling servicetitanClient.exchangeCodeForTokens()
    // WHAT: ServiceTitan returns null access_token (possible API error or partial response)
    // WHEN: OAuth code exchange succeeds HTTP-wise but response body is incomplete
    // WHERE: src/services/servicetitanClient.ts exchangeCodeForTokens()
    // WHY: without this check, a null access_token would be stored and every subsequent ST API call would send "Bearer null", silently failing
    setServiceTitanEnv();
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: null, refresh_token: 'refresh-456' }),
    });

    await expect(exchangeCodeForTokens('auth-code')).rejects.toThrow('incomplete tokens');
  });

  it('throws when refresh_token is missing', async () => {
    // WHO: oauthCallbackFactory.ts calling servicetitanClient.exchangeCodeForTokens()
    // WHAT: ServiceTitan returns null refresh_token
    // WHEN: OAuth code exchange succeeds HTTP-wise but response body is incomplete
    // WHERE: src/services/servicetitanClient.ts exchangeCodeForTokens()
    // WHY: without a refresh_token, the integration would work for 1 hour then permanently break — tenant would need to re-authorize manually
    setServiceTitanEnv();
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: 'access-123', refresh_token: null }),
    });

    await expect(exchangeCodeForTokens('auth-code')).rejects.toThrow('incomplete tokens');
  });

  it('throws when HTTP response is not ok', async () => {
    // WHO: oauthCallbackFactory.ts calling servicetitanClient.exchangeCodeForTokens()
    // WHAT: ServiceTitan token endpoint returns HTTP 400 (invalid or expired auth code)
    // WHEN: auth code is stale (user took too long) or was already used
    // WHERE: src/services/servicetitanClient.ts exchangeCodeForTokens()
    // WHY: without this check, the code would try to parse a non-JSON error body as tokens, producing garbage credentials in the database
    setServiceTitanEnv();
    mockFetch.mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => 'Bad Request',
    });

    await expect(exchangeCodeForTokens('auth-code')).rejects.toThrow(
      'ServiceTitan OAuth code exchange failed'
    );
  });

  it('throws on network error', async () => {
    // WHO: oauthCallbackFactory.ts calling servicetitanClient.exchangeCodeForTokens()
    // WHAT: fetch rejects with ECONNREFUSED (ServiceTitan API unreachable)
    // WHEN: network partition or ServiceTitan outage during OAuth flow
    // WHERE: src/services/servicetitanClient.ts exchangeCodeForTokens()
    // WHY: without wrapping fetch errors, an unhandled promise rejection would crash the route handler instead of returning a user-friendly error
    setServiceTitanEnv();
    mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(exchangeCodeForTokens('auth-code')).rejects.toThrow('network error');
  });

  it('throws when ServiceTitan is not configured', async () => {
    // WHO: oauthCallbackFactory.ts calling servicetitanClient.exchangeCodeForTokens()
    // WHAT: no SERVICETITAN_* env vars are set
    // WHEN: code exchange is attempted on a deploy that doesn't have ServiceTitan credentials
    // WHERE: src/services/servicetitanClient.ts exchangeCodeForTokens()
    // WHY: without this early guard, the function would send undefined client_id/secret, getting a confusing 400 error instead of a clear message
    delete process.env.SERVICETITAN_CLIENT_ID;
    delete process.env.SERVICETITAN_CLIENT_SECRET;
    delete process.env.SERVICETITAN_CALLBACK_URL;
    delete process.env.SERVICETITAN_APP_KEY;

    await expect(exchangeCodeForTokens('auth-code')).rejects.toThrow('ServiceTitan not configured');
  });
});

// ---------------------------------------------------------------------------
// refreshAccessToken
// ---------------------------------------------------------------------------
describe('refreshAccessToken', () => {
  it('returns refreshed credentials on success', async () => {
    // WHO: tokenManagement.ts calling servicetitanClient.refreshAccessToken()
    // WHAT: ServiceTitan returns a new access_token and expires_in after valid refresh
    // WHEN: token refresh triggered by tokenManagement.ts 5-min-before-expiry buffer check
    // WHERE: src/services/servicetitanClient.ts refreshAccessToken()
    // WHY: if refresh parsing regressed, the new token wouldn't be stored correctly and the integration would break after the first token expiry (1 hour)
    setServiceTitanEnv();
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
    // WHO: tokenManagement.ts calling servicetitanClient.refreshAccessToken()
    // WHAT: ServiceTitan token endpoint returns HTTP 401 (refresh token revoked or expired)
    // WHEN: tenant revoked app access in ServiceTitan dashboard, or refresh token exceeded its lifetime
    // WHERE: src/services/servicetitanClient.ts refreshAccessToken()
    // WHY: without this error, stale credentials would persist in tenant_integration_settings and sync would silently fail
    setServiceTitanEnv();
    mockFetch.mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => 'Unauthorized',
    });

    await expect(refreshAccessToken('old-refresh-token')).rejects.toThrow(
      'ServiceTitan token refresh failed'
    );
  });

  it('throws when access_token is missing from response', async () => {
    // WHO: tokenManagement.ts calling servicetitanClient.refreshAccessToken()
    // WHAT: ServiceTitan returns 200 OK but with null access_token in body
    // WHEN: unexpected ServiceTitan API behavior or response format change
    // WHERE: src/services/servicetitanClient.ts refreshAccessToken()
    // WHY: without this check, a null token would overwrite the valid old token, immediately breaking all ServiceTitan API calls for this tenant
    setServiceTitanEnv();
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: null }),
    });

    await expect(refreshAccessToken('old-refresh-token')).rejects.toThrow(
      'ServiceTitan token refresh returned no access_token'
    );
  });

  it('throws on network error', async () => {
    // WHO: tokenManagement.ts calling servicetitanClient.refreshAccessToken()
    // WHAT: fetch rejects with ETIMEDOUT (ServiceTitan API unreachable)
    // WHEN: network partition or ServiceTitan outage during token refresh
    // WHERE: src/services/servicetitanClient.ts refreshAccessToken()
    // WHY: without wrapping fetch errors, an unhandled rejection would crash the sync worker instead of allowing retry logic to kick in
    setServiceTitanEnv();
    mockFetch.mockRejectedValue(new Error('ETIMEDOUT'));

    await expect(refreshAccessToken('old-refresh-token')).rejects.toThrow('network error');
  });

  it('throws when ServiceTitan is not configured', async () => {
    // WHO: tokenManagement.ts calling servicetitanClient.refreshAccessToken()
    // WHAT: no SERVICETITAN_* env vars set
    // WHEN: token refresh attempted on a deploy without ServiceTitan credentials
    // WHERE: src/services/servicetitanClient.ts refreshAccessToken()
    // WHY: without this guard, the function would send undefined client_id/secret, producing a confusing HTTP error instead of a clear message
    delete process.env.SERVICETITAN_CLIENT_ID;
    delete process.env.SERVICETITAN_CLIENT_SECRET;
    delete process.env.SERVICETITAN_CALLBACK_URL;
    delete process.env.SERVICETITAN_APP_KEY;

    await expect(refreshAccessToken('old-refresh-token')).rejects.toThrow(
      'ServiceTitan not configured'
    );
  });
});

// ---------------------------------------------------------------------------
// apiRequest
// ---------------------------------------------------------------------------
describe('apiRequest', () => {
  it('sends correct method, path, auth header, and ST-App-Key', async () => {
    // WHO: servicetitanSync.ts calling servicetitanClient.apiRequest()
    // WHAT: GET request with Bearer token, ST-App-Key header, and correct base URL
    // WHEN: any ServiceTitan API call (customer fetch, job list, etc.)
    // WHERE: src/services/servicetitanClient.ts apiRequest()
    // WHY: ServiceTitan requires the ST-App-Key on every request — if this header regressed, all API calls would return 403 Forbidden
    setServiceTitanEnv();
    const responseData = { id: 123, name: 'Dale' };
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => responseData,
    });

    const result = await apiRequest('GET', '/crm/v2/tenant/123/customers/456', 'my-token', APP_KEY);

    expect(result).toEqual(responseData);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.servicetitan.io/crm/v2/tenant/123/customers/456',
      expect.objectContaining({
        method: 'GET',
        headers: {
          Authorization: 'Bearer my-token',
          'ST-App-Key': APP_KEY,
          'Content-Type': 'application/json',
        },
      })
    );
  });

  it('sends JSON body for POST requests', async () => {
    // WHO: servicetitanSync.ts calling servicetitanClient.apiRequest() for customer creation
    // WHAT: POST request with JSON-serialized body
    // WHEN: pushing a new customer to ServiceTitan during bidirectional sync
    // WHERE: src/services/servicetitanClient.ts apiRequest()
    // WHY: if the body wasn't JSON-serialized, ServiceTitan would return 400 and the customer push would silently fail
    setServiceTitanEnv();
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: 456 }),
    });

    await apiRequest('POST', '/crm/v2/tenant/123/customers', 'my-token', APP_KEY, {
      name: 'Test Customer',
    });

    const callArgs = mockFetch.mock.calls[0][1];
    expect(JSON.parse(callArgs.body)).toEqual({
      name: 'Test Customer',
    });
  });

  it('sends JSON body for PATCH requests', async () => {
    // WHO: servicetitanSync.ts calling servicetitanClient.apiRequest() for customer update
    // WHAT: PATCH request with JSON-serialized body (ServiceTitan uses PATCH, not PUT)
    // WHEN: updating an existing customer in ServiceTitan during bidirectional sync
    // WHERE: src/services/servicetitanClient.ts apiRequest()
    // WHY: ServiceTitan uses PATCH for updates — if the method was PUT, ST would return 405 Method Not Allowed
    setServiceTitanEnv();
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: 456 }),
    });

    await apiRequest('PATCH', '/crm/v2/tenant/123/customers/456', 'my-token', APP_KEY, {
      name: 'Updated',
    });

    const callArgs = mockFetch.mock.calls[0][1];
    expect(callArgs.method).toBe('PATCH');
    expect(JSON.parse(callArgs.body)).toEqual({ name: 'Updated' });
  });

  it('returns null for 204 responses', async () => {
    // WHO: servicetitanSync.ts calling servicetitanClient.apiRequest() for DELETE operations
    // WHAT: server returns 204 No Content (successful deletion, no body)
    // WHEN: deleting a customer or canceling a job in ServiceTitan
    // WHERE: src/services/servicetitanClient.ts apiRequest()
    // WHY: without handling 204, calling .json() on a bodyless response would throw a parse error, making deletions appear to fail
    setServiceTitanEnv();
    mockFetch.mockResolvedValue({
      ok: true,
      status: 204,
    });

    const result = await apiRequest(
      'DELETE',
      '/crm/v2/tenant/123/customers/456',
      'my-token',
      APP_KEY
    );
    expect(result).toBeNull();
  });

  it('throws when HTTP response is not ok (401)', async () => {
    // WHO: servicetitanSync.ts calling servicetitanClient.apiRequest()
    // WHAT: ServiceTitan returns 401 Unauthorized (expired or revoked token)
    // WHEN: access token has expired and refresh hasn't happened yet
    // WHERE: src/services/servicetitanClient.ts apiRequest()
    // WHY: without throwing on 401, the sync would process an error body as valid data, corrupting local records with ST error objects
    setServiceTitanEnv();
    mockFetch.mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => 'Unauthorized',
    });

    await expect(
      apiRequest('GET', '/crm/v2/tenant/123/customers', 'my-token', APP_KEY)
    ).rejects.toThrow('ServiceTitan API GET /crm/v2/tenant/123/customers failed (401)');
  });

  it('throws when HTTP response is not ok (429)', async () => {
    // WHO: servicetitanSync.ts calling servicetitanClient.apiRequest()
    // WHAT: ServiceTitan returns 429 Rate limit exceeded
    // WHEN: too many API calls in a short window during a full sync pull
    // WHERE: src/services/servicetitanClient.ts apiRequest()
    // WHY: without surfacing 429 errors, the sync would silently skip records and produce an incomplete customer/job list
    setServiceTitanEnv();
    mockFetch.mockResolvedValue({
      ok: false,
      status: 429,
      text: async () => 'Rate limit exceeded',
    });

    await expect(
      apiRequest('GET', '/crm/v2/tenant/123/customers', 'my-token', APP_KEY)
    ).rejects.toThrow('ServiceTitan API GET /crm/v2/tenant/123/customers failed (429)');
  });

  it('throws when HTTP response is not ok (500)', async () => {
    // WHO: servicetitanSync.ts calling servicetitanClient.apiRequest()
    // WHAT: ServiceTitan returns 500 Internal Server Error
    // WHEN: ServiceTitan API is experiencing an outage or internal issue
    // WHERE: src/services/servicetitanClient.ts apiRequest()
    // WHY: without throwing on 500, the sync would treat an error page as valid JSON, potentially corrupting the entity_sync_map
    setServiceTitanEnv();
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'Internal Server Error',
    });

    await expect(
      apiRequest('GET', '/crm/v2/tenant/123/customers', 'my-token', APP_KEY)
    ).rejects.toThrow('ServiceTitan API GET /crm/v2/tenant/123/customers failed (500)');
  });

  it('throws on network error', async () => {
    // WHO: servicetitanSync.ts calling servicetitanClient.apiRequest()
    // WHAT: fetch rejects with ECONNRESET (connection dropped mid-request)
    // WHEN: network instability or ServiceTitan API connection reset
    // WHERE: src/services/servicetitanClient.ts apiRequest()
    // WHY: without wrapping network errors, an unhandled rejection would crash the sync worker instead of allowing the caller to handle the failure
    setServiceTitanEnv();
    mockFetch.mockRejectedValue(new Error('ECONNRESET'));

    await expect(
      apiRequest('GET', '/crm/v2/tenant/123/customers', 'my-token', APP_KEY)
    ).rejects.toThrow('network error');
  });
});

// ---------------------------------------------------------------------------
// Convenience methods: customers
// ---------------------------------------------------------------------------
describe('listCustomers', () => {
  it('calls correct endpoint with pageSize', async () => {
    // WHO: servicetitanSync.ts pullServiceTitanCustomers() calling servicetitanClient.listCustomers()
    // WHAT: GET /crm/v2/tenant/{tenantSid}/customers with pageSize=100 query param
    // WHEN: full sync pulls all ServiceTitan customers to merge with local records
    // WHERE: src/services/servicetitanClient.ts listCustomers()
    // WHY: if the tenant SID wasn't interpolated correctly, we'd hit a 404 or fetch another tenant's customers — a multi-tenancy data leak
    setServiceTitanEnv();
    const response = { data: [], page: 1, pageSize: 100, totalCount: 0, hasMore: false };
    mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => response });

    const result = await listCustomers('my-token', APP_KEY, TENANT_SID);

    expect(result).toEqual(response);
    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain(`/crm/v2/tenant/${TENANT_SID}/customers`);
    expect(calledUrl).toContain('pageSize=100');
  });

  it('passes page param for pagination', async () => {
    // WHO: servicetitanSync.ts pullServiceTitanCustomers() calling listCustomers() with page number
    // WHAT: GET /crm/v2/tenant/{tenantSid}/customers with page=2 query param
    // WHEN: ServiceTitan has more than 100 customers and sync needs subsequent pages
    // WHERE: src/services/servicetitanClient.ts listCustomers()
    // WHY: without pagination support, sync would only ever fetch the first 100 customers and silently drop all others
    setServiceTitanEnv();
    const response = {
      data: [{ id: 1, name: 'Test' }],
      page: 2,
      pageSize: 100,
      totalCount: 150,
      hasMore: false,
    };
    mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => response });

    await listCustomers('my-token', APP_KEY, TENANT_SID, 2);

    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain('page=2');
  });
});

describe('createCustomer', () => {
  it('POSTs to customers endpoint with payload', async () => {
    // WHO: servicetitanSync.ts pushServiceTitanCustomer() calling servicetitanClient.createCustomer()
    // WHAT: POST /crm/v2/tenant/{tenantSid}/customers with name and phoneNumber in body
    // WHEN: a new local customer needs to be pushed to ServiceTitan during bidirectional sync
    // WHERE: src/services/servicetitanClient.ts createCustomer()
    // WHY: if the tenant SID or body structure regressed, ST would reject the request and the customer would never appear in the merchant's ST dashboard
    setServiceTitanEnv();
    const created = { id: 99, name: 'New Customer', phoneNumber: '555-1234' };
    mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => created });

    const result = await createCustomer('my-token', APP_KEY, TENANT_SID, {
      name: 'New Customer',
      phoneNumber: '555-1234',
    });

    expect(result).toEqual(created);
    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain(`/crm/v2/tenant/${TENANT_SID}/customers`);
    const callArgs = mockFetch.mock.calls[0][1];
    expect(callArgs.method).toBe('POST');
    expect(JSON.parse(callArgs.body)).toEqual({
      name: 'New Customer',
      phoneNumber: '555-1234',
    });
  });
});

describe('updateCustomer', () => {
  it('PATCHes to customers endpoint with customer ID', async () => {
    // WHO: servicetitanSync.ts pushServiceTitanCustomer() calling servicetitanClient.updateCustomer()
    // WHAT: PATCH /crm/v2/tenant/{tenantSid}/customers/{id} with updated fields
    // WHEN: local customer record was modified and needs to be synced to ServiceTitan
    // WHERE: src/services/servicetitanClient.ts updateCustomer()
    // WHY: ServiceTitan uses PATCH for partial updates — using PUT would require sending all fields and could overwrite data with nulls
    setServiceTitanEnv();
    const updated = { id: 42, name: 'Updated Customer' };
    mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => updated });

    const result = await updateCustomer('my-token', APP_KEY, TENANT_SID, '42', {
      name: 'Updated Customer',
    });

    expect(result).toEqual(updated);
    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain(`/crm/v2/tenant/${TENANT_SID}/customers/42`);
    const callArgs = mockFetch.mock.calls[0][1];
    expect(callArgs.method).toBe('PATCH');
  });
});

// ---------------------------------------------------------------------------
// Convenience methods: jobs
// ---------------------------------------------------------------------------
describe('listJobs', () => {
  it('calls correct endpoint with pageSize', async () => {
    // WHO: servicetitanSync.ts pullServiceTitanJobs() calling servicetitanClient.listJobs()
    // WHAT: GET /jpm/v2/tenant/{tenantSid}/jobs with pageSize=100 query param
    // WHEN: full sync pulls all ServiceTitan jobs to merge with local appointments
    // WHERE: src/services/servicetitanClient.ts listJobs()
    // WHY: note the /jpm/ path prefix (Job Processing Module) — if it regressed to /crm/, the endpoint would 404 and job sync would break entirely
    setServiceTitanEnv();
    const response = { data: [], page: 1, pageSize: 100, totalCount: 0, hasMore: false };
    mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => response });

    const result = await listJobs('my-token', APP_KEY, TENANT_SID);

    expect(result).toEqual(response);
    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain(`/jpm/v2/tenant/${TENANT_SID}/jobs`);
    expect(calledUrl).toContain('pageSize=100');
  });

  it('passes page param for pagination', async () => {
    // WHO: servicetitanSync.ts pullServiceTitanJobs() calling listJobs() with page number
    // WHAT: GET /jpm/v2/tenant/{tenantSid}/jobs with page=3 query param
    // WHEN: ServiceTitan has more than 100 jobs and sync needs subsequent pages
    // WHERE: src/services/servicetitanClient.ts listJobs()
    // WHY: without pagination support, sync would only fetch the first page of jobs, silently dropping all older appointments
    setServiceTitanEnv();
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: [], hasMore: false }),
    });

    await listJobs('my-token', APP_KEY, TENANT_SID, 3);

    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain('page=3');
  });
});

describe('createJob', () => {
  it('POSTs to jobs endpoint with payload', async () => {
    // WHO: servicetitanSync.ts pushServiceTitanJob() calling servicetitanClient.createJob()
    // WHAT: POST /jpm/v2/tenant/{tenantSid}/jobs with customerId, summary, and scheduledDate
    // WHEN: a new local appointment needs to be pushed to ServiceTitan during bidirectional sync
    // WHERE: src/services/servicetitanClient.ts createJob()
    // WHY: if the POST body structure regressed, ST would reject the request and the appointment would never appear in the technician's schedule
    setServiceTitanEnv();
    const created = { id: 100, customerId: 42, summary: 'Oil Change' };
    mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => created });

    const result = await createJob('my-token', APP_KEY, TENANT_SID, {
      customerId: 42,
      summary: 'Oil Change',
      scheduledDate: '2026-04-01T10:00:00Z',
    });

    expect(result).toEqual(created);
    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain(`/jpm/v2/tenant/${TENANT_SID}/jobs`);
    const callArgs = mockFetch.mock.calls[0][1];
    expect(callArgs.method).toBe('POST');
  });
});

describe('updateJob', () => {
  it('PATCHes to jobs endpoint with job ID', async () => {
    // WHO: servicetitanSync.ts pushServiceTitanJob() calling servicetitanClient.updateJob()
    // WHAT: PATCH /jpm/v2/tenant/{tenantSid}/jobs/{id} with updated summary
    // WHEN: local appointment was modified and needs to sync to ServiceTitan
    // WHERE: src/services/servicetitanClient.ts updateJob()
    // WHY: if the method was POST instead of PATCH, ST would create a duplicate job instead of updating the existing one
    setServiceTitanEnv();
    const updated = { id: 100, summary: 'Updated Job' };
    mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => updated });

    const result = await updateJob('my-token', APP_KEY, TENANT_SID, '100', {
      summary: 'Updated Job',
    });

    expect(result).toEqual(updated);
    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain(`/jpm/v2/tenant/${TENANT_SID}/jobs/100`);
    const callArgs = mockFetch.mock.calls[0][1];
    expect(callArgs.method).toBe('PATCH');
  });
});

describe('cancelJob', () => {
  it('PATCHes job with status Canceled', async () => {
    // WHO: servicetitanSync.ts calling servicetitanClient.cancelJob()
    // WHAT: PATCH /jpm/v2/tenant/{tenantSid}/jobs/{id} with { status: "Canceled" }
    // WHEN: local appointment is cancelled and needs to reflect in ServiceTitan
    // WHERE: src/services/servicetitanClient.ts cancelJob()
    // WHY: ServiceTitan uses PATCH with status field for cancellation — using DELETE would return 405, and wrong status string would leave the job active
    setServiceTitanEnv();
    const canceled = { id: 100, status: 'Canceled' };
    mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => canceled });

    const result = await cancelJob('my-token', APP_KEY, TENANT_SID, '100');

    expect(result).toEqual(canceled);
    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain(`/jpm/v2/tenant/${TENANT_SID}/jobs/100`);
    const callArgs = mockFetch.mock.calls[0][1];
    expect(callArgs.method).toBe('PATCH');
    expect(JSON.parse(callArgs.body)).toEqual({ status: 'Canceled' });
  });
});
