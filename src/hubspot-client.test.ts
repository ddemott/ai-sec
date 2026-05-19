import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';

// --- Mock global fetch before importing the module under test ---
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import {
  isHubSpotEnabled,
  getAuthUrl,
  verifyState,
  exchangeCodeForTokens,
  refreshAccessToken,
  apiRequest,
  verifyWebhookSignature,
  listContacts,
  getContact,
  createContact,
  updateContact,
  createMeeting,
  updateMeeting,
  associateMeetingToContact,
} from './services/hubspotClient';

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

function setHubSpotEnv() {
  process.env.HUBSPOT_CLIENT_ID = 'test-client-id';
  process.env.HUBSPOT_CLIENT_SECRET = 'test-client-secret';
  process.env.HUBSPOT_CALLBACK_URL = 'http://localhost:4001/calendar/auth/hubspot/callback';
  process.env.JWT_SECRET = JWT_SECRET;
}

// ---------------------------------------------------------------------------
// isHubSpotEnabled
// ---------------------------------------------------------------------------
describe('isHubSpotEnabled', () => {
  it('returns true when all env vars are set', () => {
    // WHO: hubspotClient.ts isHubSpotEnabled()
    // WHAT: all three HUBSPOT_* env vars plus JWT_SECRET are present
    // WHEN: checking if HubSpot integration is available for a tenant
    // WHERE: src/services/hubspotClient.ts isHubSpotEnabled()
    // WHY: without this, the CRM settings page would show the HubSpot connect button even when the server lacks credentials, leading to a broken OAuth flow
    setHubSpotEnv();
    expect(isHubSpotEnabled()).toBe(true);
  });

  it('returns false when HUBSPOT_CLIENT_ID is missing', () => {
    // WHO: hubspotClient.ts isHubSpotEnabled()
    // WHAT: HUBSPOT_CLIENT_ID env var is absent while others are present
    // WHEN: checking if HubSpot integration is available
    // WHERE: src/services/hubspotClient.ts isHubSpotEnabled()
    // WHY: without this guard, OAuth redirect would fail at HubSpot's end with an invalid_client error, confusing the tenant admin
    setHubSpotEnv();
    delete process.env.HUBSPOT_CLIENT_ID;
    expect(isHubSpotEnabled()).toBe(false);
  });

  it('returns false when HUBSPOT_CLIENT_SECRET is missing', () => {
    // WHO: hubspotClient.ts isHubSpotEnabled()
    // WHAT: HUBSPOT_CLIENT_SECRET env var is absent while others are present
    // WHEN: checking if HubSpot integration is available
    // WHERE: src/services/hubspotClient.ts isHubSpotEnabled()
    // WHY: without the secret, token exchange would fail silently — better to disable the integration upfront
    setHubSpotEnv();
    delete process.env.HUBSPOT_CLIENT_SECRET;
    expect(isHubSpotEnabled()).toBe(false);
  });

  it('returns false when HUBSPOT_CALLBACK_URL is missing', () => {
    // WHO: hubspotClient.ts isHubSpotEnabled()
    // WHAT: HUBSPOT_CALLBACK_URL env var is absent while others are present
    // WHEN: checking if HubSpot integration is available
    // WHERE: src/services/hubspotClient.ts isHubSpotEnabled()
    // WHY: without the callback URL, OAuth redirect_uri would be undefined, causing HubSpot to reject the auth request
    setHubSpotEnv();
    delete process.env.HUBSPOT_CALLBACK_URL;
    expect(isHubSpotEnabled()).toBe(false);
  });

  it('returns false when all HubSpot env vars are missing', () => {
    // WHO: hubspotClient.ts isHubSpotEnabled()
    // WHAT: no HubSpot env vars are set at all (fresh deploy without HubSpot config)
    // WHEN: checking if HubSpot integration is available
    // WHERE: src/services/hubspotClient.ts isHubSpotEnabled()
    // WHY: ensures tenants on deployments without HubSpot credentials don't see a broken integration option in the CRM settings UI
    delete process.env.HUBSPOT_CLIENT_ID;
    delete process.env.HUBSPOT_CLIENT_SECRET;
    delete process.env.HUBSPOT_CALLBACK_URL;
    expect(isHubSpotEnabled()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getAuthUrl
// ---------------------------------------------------------------------------
describe('getAuthUrl', () => {
  it('returns a URL string when configured', () => {
    // WHO: hubspotClient.ts getAuthUrl()
    // WHAT: all env vars set, generating OAuth authorization URL for a tenant
    // WHEN: tenant admin clicks "Connect HubSpot" in CRM settings
    // WHERE: src/services/hubspotClient.ts getAuthUrl()
    // WHY: if this regressed, the connect button would produce a null URL and the frontend would crash or show a blank page
    setHubSpotEnv();
    const url = getAuthUrl(TENANT_ID);
    expect(url).not.toBeNull();
    expect(url).toContain('app.hubspot.com');
  });

  it('includes correct query params', () => {
    // WHO: hubspotClient.ts getAuthUrl()
    // WHAT: verifying client_id, response_type, redirect_uri, and OAuth scopes for contacts+meetings
    // WHEN: tenant admin clicks "Connect HubSpot" in CRM settings
    // WHERE: src/services/hubspotClient.ts getAuthUrl()
    // WHY: wrong scopes would cause HubSpot to grant insufficient permissions — sync would fail on contact reads/writes or meeting creation
    setHubSpotEnv();
    const url = getAuthUrl(TENANT_ID)!;
    const parsed = new URL(url);
    expect(parsed.searchParams.get('client_id')).toBe('test-client-id');
    expect(parsed.searchParams.get('response_type')).toBe('code');
    expect(parsed.searchParams.get('redirect_uri')).toBe(
      'http://localhost:4001/calendar/auth/hubspot/callback'
    );
    expect(parsed.searchParams.get('scope')).toContain('crm.objects.contacts.read');
    expect(parsed.searchParams.get('scope')).toContain('crm.objects.contacts.write');
    expect(parsed.searchParams.get('scope')).toContain('crm.objects.meetings.read');
    expect(parsed.searchParams.get('scope')).toContain('crm.objects.meetings.write');
  });

  it('includes a signed JWT state param with tenantId and purpose', () => {
    // WHO: hubspotClient.ts getAuthUrl()
    // WHAT: state param is a JWT containing tenantId and purpose="hubspot-oauth"
    // WHEN: generating the OAuth URL before redirecting the tenant admin to HubSpot
    // WHERE: src/services/hubspotClient.ts getAuthUrl()
    // WHY: without a signed state param, an attacker could forge the OAuth callback and link their HubSpot account to a victim's tenant (CSRF attack)
    setHubSpotEnv();
    const url = getAuthUrl(TENANT_ID)!;
    const parsed = new URL(url);
    const state = parsed.searchParams.get('state')!;
    const decoded = jwt.verify(state, JWT_SECRET) as { tenantId: string; purpose: string };
    expect(decoded.tenantId).toBe(TENANT_ID);
    expect(decoded.purpose).toBe('hubspot-oauth');
  });

  it('returns null when HubSpot is not configured', () => {
    // WHO: hubspotClient.ts getAuthUrl()
    // WHAT: no HubSpot env vars set — integration disabled
    // WHEN: tenant admin requests OAuth URL on a deploy without HubSpot credentials
    // WHERE: src/services/hubspotClient.ts getAuthUrl()
    // WHY: without this null return, the function would throw or produce a malformed URL, crashing the CRM settings page
    delete process.env.HUBSPOT_CLIENT_ID;
    delete process.env.HUBSPOT_CLIENT_SECRET;
    delete process.env.HUBSPOT_CALLBACK_URL;
    expect(getAuthUrl(TENANT_ID)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// verifyState
// ---------------------------------------------------------------------------
describe('verifyState', () => {
  it('returns tenantId for a valid state JWT', () => {
    // WHO: hubspotClient.ts verifyState()
    // WHAT: valid JWT with correct tenantId, purpose="hubspot-oauth", and unexpired
    // WHEN: HubSpot redirects back to our callback with the state param
    // WHERE: src/services/hubspotClient.ts verifyState()
    // WHY: if verification regressed, the callback would reject valid OAuth completions and tenants could never finish connecting HubSpot
    setHubSpotEnv();
    const state = jwt.sign({ tenantId: TENANT_ID, purpose: 'hubspot-oauth' }, JWT_SECRET, {
      expiresIn: '10m',
    });
    expect(verifyState(state)).toBe(TENANT_ID);
  });

  it('returns null for an expired state JWT', () => {
    // WHO: hubspotClient.ts verifyState()
    // WHAT: JWT that has already expired (created with -1s expiry)
    // WHEN: HubSpot callback arrives after the user waited too long (>10 min)
    // WHERE: src/services/hubspotClient.ts verifyState()
    // WHY: without expiry validation, a replayed stale OAuth callback could link HubSpot to the wrong tenant if the user has since switched accounts
    setHubSpotEnv();
    const state = jwt.sign({ tenantId: TENANT_ID, purpose: 'hubspot-oauth' }, JWT_SECRET, {
      expiresIn: '-1s',
    });
    expect(verifyState(state)).toBeNull();
  });

  it("returns null when purpose doesn't match", () => {
    // WHO: hubspotClient.ts verifyState()
    // WHAT: JWT with wrong purpose field (e.g., "wrong-purpose" instead of "hubspot-oauth")
    // WHEN: a state JWT from a different OAuth flow (e.g., Jobber) is replayed against HubSpot callback
    // WHERE: src/services/hubspotClient.ts verifyState()
    // WHY: without purpose checking, a Jobber/Square OAuth state could be replayed against the HubSpot callback, linking the wrong CRM
    setHubSpotEnv();
    const state = jwt.sign({ tenantId: TENANT_ID, purpose: 'wrong-purpose' }, JWT_SECRET, {
      expiresIn: '10m',
    });
    expect(verifyState(state)).toBeNull();
  });

  it('returns null for a completely invalid token', () => {
    // WHO: hubspotClient.ts verifyState()
    // WHAT: garbage string that is not a valid JWT at all
    // WHEN: attacker sends a crafted callback with a random state value
    // WHERE: src/services/hubspotClient.ts verifyState()
    // WHY: without this, jwt.verify would throw an unhandled error, crashing the callback handler instead of returning null gracefully
    setHubSpotEnv();
    expect(verifyState('not-a-jwt')).toBeNull();
  });

  it('returns null for a token signed with a different secret', () => {
    // WHO: hubspotClient.ts verifyState()
    // WHAT: JWT signed with "wrong-secret" instead of the server's JWT_SECRET
    // WHEN: attacker forges a state JWT with a known tenantId but different signing key
    // WHERE: src/services/hubspotClient.ts verifyState()
    // WHY: without signature verification, an attacker could craft a state JWT targeting any tenantId and hijack their HubSpot integration
    setHubSpotEnv();
    const state = jwt.sign({ tenantId: TENANT_ID, purpose: 'hubspot-oauth' }, 'wrong-secret', {
      expiresIn: '10m',
    });
    expect(verifyState(state)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// exchangeCodeForTokens
// ---------------------------------------------------------------------------
describe('exchangeCodeForTokens', () => {
  it('returns token set on success (30 min expiry)', async () => {
    // WHO: oauthCallbackFactory.ts calling hubspotClient.exchangeCodeForTokens()
    // WHAT: HubSpot returns access_token, refresh_token, and expires_in=1800 after valid auth code exchange
    // WHEN: OAuth callback handler receives the authorization code from HubSpot
    // WHERE: src/services/hubspotClient.ts exchangeCodeForTokens()
    // WHY: if token parsing regressed, tokens would be stored incorrectly in tenant_integration_settings and all subsequent HubSpot API calls would fail with 401
    setHubSpotEnv();
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: 'access-123',
        refresh_token: 'refresh-456',
        expires_in: 1800,
      }),
    });

    const before = Date.now();
    const tokens = await exchangeCodeForTokens('auth-code-789');

    expect(tokens.access_token).toBe('access-123');
    expect(tokens.refresh_token).toBe('refresh-456');
    expect(tokens.expiry_date).toBeGreaterThanOrEqual(before + 1800 * 1000);

    // Verify fetch was called with correct URL
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.hubapi.com/oauth/v1/token',
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('defaults to 1800s expiry when expires_in is missing', async () => {
    // WHO: oauthCallbackFactory.ts calling hubspotClient.exchangeCodeForTokens()
    // WHAT: HubSpot response omits expires_in field entirely
    // WHEN: HubSpot API changes response format or field is optional
    // WHERE: src/services/hubspotClient.ts exchangeCodeForTokens()
    // WHY: without a fallback expiry, the token would appear expired immediately (expiry_date=NaN), triggering constant token refreshes every request
    setHubSpotEnv();
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: 'access-123',
        refresh_token: 'refresh-456',
      }),
    });

    const before = Date.now();
    const tokens = await exchangeCodeForTokens('auth-code');

    // Should default to 1800 seconds (30 min)
    expect(tokens.expiry_date).toBeGreaterThanOrEqual(before + 1800 * 1000);
    expect(tokens.expiry_date).toBeLessThanOrEqual(Date.now() + 1800 * 1000 + 1000);
  });

  it('throws when access_token is missing', async () => {
    // WHO: oauthCallbackFactory.ts calling hubspotClient.exchangeCodeForTokens()
    // WHAT: HubSpot returns null access_token (possible API error or partial response)
    // WHEN: OAuth code exchange succeeds HTTP-wise but response body is incomplete
    // WHERE: src/services/hubspotClient.ts exchangeCodeForTokens()
    // WHY: without this check, a null access_token would be stored and every subsequent HubSpot API call would send "Bearer null", silently failing
    setHubSpotEnv();
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: null, refresh_token: 'refresh-456' }),
    });

    await expect(exchangeCodeForTokens('auth-code')).rejects.toThrow('incomplete tokens');
  });

  it('throws when refresh_token is missing', async () => {
    // WHO: oauthCallbackFactory.ts calling hubspotClient.exchangeCodeForTokens()
    // WHAT: HubSpot returns null refresh_token
    // WHEN: OAuth code exchange succeeds HTTP-wise but response body is incomplete
    // WHERE: src/services/hubspotClient.ts exchangeCodeForTokens()
    // WHY: without a refresh_token, the integration would work for 30 minutes then permanently break — tenant would need to re-authorize manually
    setHubSpotEnv();
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: 'access-123', refresh_token: null }),
    });

    await expect(exchangeCodeForTokens('auth-code')).rejects.toThrow('incomplete tokens');
  });

  it('throws when HTTP response is not ok', async () => {
    // WHO: oauthCallbackFactory.ts calling hubspotClient.exchangeCodeForTokens()
    // WHAT: HubSpot token endpoint returns HTTP 400 (invalid or expired auth code)
    // WHEN: auth code is stale (user took too long) or was already used
    // WHERE: src/services/hubspotClient.ts exchangeCodeForTokens()
    // WHY: without this check, the code would try to parse a non-JSON error body as tokens, producing garbage credentials in the database
    setHubSpotEnv();
    mockFetch.mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => 'Bad Request',
    });

    await expect(exchangeCodeForTokens('auth-code')).rejects.toThrow(
      'HubSpot OAuth code exchange failed'
    );
  });

  it('throws on network error', async () => {
    // WHO: oauthCallbackFactory.ts calling hubspotClient.exchangeCodeForTokens()
    // WHAT: fetch rejects with ECONNREFUSED (HubSpot API unreachable)
    // WHEN: network partition or HubSpot outage during OAuth flow
    // WHERE: src/services/hubspotClient.ts exchangeCodeForTokens()
    // WHY: without wrapping fetch errors, an unhandled promise rejection would crash the route handler instead of returning a user-friendly error
    setHubSpotEnv();
    mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(exchangeCodeForTokens('auth-code')).rejects.toThrow('network error');
  });

  it('throws when HubSpot is not configured', async () => {
    // WHO: oauthCallbackFactory.ts calling hubspotClient.exchangeCodeForTokens()
    // WHAT: no HUBSPOT_* env vars are set
    // WHEN: code exchange is attempted on a deploy that doesn't have HubSpot credentials
    // WHERE: src/services/hubspotClient.ts exchangeCodeForTokens()
    // WHY: without this early guard, the function would send undefined client_id/secret to HubSpot, getting a confusing 400 error instead of a clear message
    delete process.env.HUBSPOT_CLIENT_ID;
    delete process.env.HUBSPOT_CLIENT_SECRET;
    delete process.env.HUBSPOT_CALLBACK_URL;

    await expect(exchangeCodeForTokens('auth-code')).rejects.toThrow('HubSpot not configured');
  });
});

// ---------------------------------------------------------------------------
// refreshAccessToken
// ---------------------------------------------------------------------------
describe('refreshAccessToken', () => {
  it('returns refreshed credentials on success', async () => {
    // WHO: tokenManagement.ts calling hubspotClient.refreshAccessToken()
    // WHAT: HubSpot returns a new access_token and expires_in after valid refresh
    // WHEN: token refresh triggered by tokenManagement.ts 5-min-before-expiry buffer check
    // WHERE: src/services/hubspotClient.ts refreshAccessToken()
    // WHY: HubSpot tokens expire every 30 min — if refresh parsing regressed, the integration would break within 30 minutes of connecting
    setHubSpotEnv();
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: 'new-access-token',
        expires_in: 1800,
      }),
    });

    const before = Date.now();
    const result = await refreshAccessToken('old-refresh-token');

    expect(result.access_token).toBe('new-access-token');
    expect(result.expiry_date).toBeGreaterThanOrEqual(before + 1800 * 1000);
  });

  it('throws when HTTP response is not ok', async () => {
    // WHO: tokenManagement.ts calling hubspotClient.refreshAccessToken()
    // WHAT: HubSpot token endpoint returns HTTP 401 (refresh token revoked or expired)
    // WHEN: tenant revoked app access in HubSpot settings, or refresh token exceeded its lifetime
    // WHERE: src/services/hubspotClient.ts refreshAccessToken()
    // WHY: without this error, stale credentials would persist in tenant_integration_settings and sync would silently fail until someone noticed
    setHubSpotEnv();
    mockFetch.mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => 'Unauthorized',
    });

    await expect(refreshAccessToken('old-refresh-token')).rejects.toThrow(
      'HubSpot token refresh failed'
    );
  });

  it('throws when access_token is missing from response', async () => {
    // WHO: tokenManagement.ts calling hubspotClient.refreshAccessToken()
    // WHAT: HubSpot returns 200 OK but with null access_token in body
    // WHEN: unexpected HubSpot API behavior or response format change
    // WHERE: src/services/hubspotClient.ts refreshAccessToken()
    // WHY: without this check, a null token would overwrite the valid old token, immediately breaking all HubSpot API calls for this tenant
    setHubSpotEnv();
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: null }),
    });

    await expect(refreshAccessToken('old-refresh-token')).rejects.toThrow(
      'HubSpot token refresh returned no access_token'
    );
  });

  it('throws on network error', async () => {
    // WHO: tokenManagement.ts calling hubspotClient.refreshAccessToken()
    // WHAT: fetch rejects with ETIMEDOUT (HubSpot API unreachable)
    // WHEN: network partition or HubSpot outage during token refresh
    // WHERE: src/services/hubspotClient.ts refreshAccessToken()
    // WHY: without wrapping fetch errors, an unhandled rejection would crash the sync worker instead of allowing retry logic to kick in
    setHubSpotEnv();
    mockFetch.mockRejectedValue(new Error('ETIMEDOUT'));

    await expect(refreshAccessToken('old-refresh-token')).rejects.toThrow('network error');
  });

  it('throws when HubSpot is not configured', async () => {
    // WHO: tokenManagement.ts calling hubspotClient.refreshAccessToken()
    // WHAT: no HUBSPOT_* env vars set
    // WHEN: token refresh attempted on a deploy without HubSpot credentials
    // WHERE: src/services/hubspotClient.ts refreshAccessToken()
    // WHY: without this guard, the function would send undefined client_id/secret to HubSpot, producing a confusing HTTP error instead of a clear message
    delete process.env.HUBSPOT_CLIENT_ID;
    delete process.env.HUBSPOT_CLIENT_SECRET;
    delete process.env.HUBSPOT_CALLBACK_URL;

    await expect(refreshAccessToken('old-refresh-token')).rejects.toThrow('HubSpot not configured');
  });
});

// ---------------------------------------------------------------------------
// apiRequest
// ---------------------------------------------------------------------------
describe('apiRequest', () => {
  it('sends correct method, path, and auth header', async () => {
    // WHO: hubspotSync.ts calling hubspotClient.apiRequest()
    // WHAT: GET request with Bearer token, Content-Type header, and correct HubSpot API base URL
    // WHEN: any HubSpot API call (contact fetch, meeting creation, etc.)
    // WHERE: src/services/hubspotClient.ts apiRequest()
    // WHY: if the base URL regressed from api.hubapi.com to something else, all HubSpot API calls would 404 and sync would break entirely
    setHubSpotEnv();
    const responseData = { id: '123', properties: { firstname: 'Dale' } };
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => responseData,
    });

    const result = await apiRequest('GET', '/crm/v3/objects/contacts/123', 'my-token');

    expect(result).toEqual(responseData);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.hubapi.com/crm/v3/objects/contacts/123',
      expect.objectContaining({
        method: 'GET',
        headers: {
          Authorization: 'Bearer my-token',
          'Content-Type': 'application/json',
        },
      })
    );
  });

  it('sends JSON body for POST requests', async () => {
    // WHO: hubspotSync.ts calling hubspotClient.apiRequest() for contact creation
    // WHAT: POST request with JSON-serialized body containing HubSpot properties
    // WHEN: pushing a new contact to HubSpot during bidirectional sync
    // WHERE: src/services/hubspotClient.ts apiRequest()
    // WHY: if the body wasn't JSON-serialized, HubSpot would return 400 and the contact push would silently fail
    setHubSpotEnv();
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: '456' }),
    });

    await apiRequest('POST', '/crm/v3/objects/contacts', 'my-token', {
      properties: { firstname: 'Test' },
    });

    const callArgs = mockFetch.mock.calls[0][1];
    expect(JSON.parse(callArgs.body)).toEqual({
      properties: { firstname: 'Test' },
    });
  });

  it('returns null for 204 responses', async () => {
    // WHO: hubspotSync.ts calling hubspotClient.apiRequest() for DELETE operations
    // WHAT: server returns 204 No Content (successful deletion, no body)
    // WHEN: deleting a contact or meeting in HubSpot
    // WHERE: src/services/hubspotClient.ts apiRequest()
    // WHY: without handling 204, calling .json() on a bodyless response would throw a parse error, making deletions appear to fail
    setHubSpotEnv();
    mockFetch.mockResolvedValue({
      ok: true,
      status: 204,
    });

    const result = await apiRequest('DELETE', '/crm/v3/objects/contacts/123', 'my-token');
    expect(result).toBeNull();
  });

  it('throws when HTTP response is not ok', async () => {
    // WHO: hubspotSync.ts calling hubspotClient.apiRequest()
    // WHAT: HubSpot returns 500 Internal Server Error
    // WHEN: HubSpot API is experiencing an outage or internal issue
    // WHERE: src/services/hubspotClient.ts apiRequest()
    // WHY: without throwing on error status codes, the sync would treat an error body as valid contact/meeting data, corrupting the entity_sync_map
    setHubSpotEnv();
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'Internal Server Error',
    });

    await expect(apiRequest('GET', '/crm/v3/objects/contacts', 'my-token')).rejects.toThrow(
      'HubSpot API GET /crm/v3/objects/contacts failed (500)'
    );
  });

  it('throws on network error', async () => {
    // WHO: hubspotSync.ts calling hubspotClient.apiRequest()
    // WHAT: fetch rejects with ECONNRESET (connection dropped mid-request)
    // WHEN: network instability or HubSpot API connection reset
    // WHERE: src/services/hubspotClient.ts apiRequest()
    // WHY: without wrapping network errors, an unhandled rejection would crash the sync worker instead of allowing the caller to handle the failure
    setHubSpotEnv();
    mockFetch.mockRejectedValue(new Error('ECONNRESET'));

    await expect(apiRequest('GET', '/crm/v3/objects/contacts', 'my-token')).rejects.toThrow(
      'network error'
    );
  });
});

// ---------------------------------------------------------------------------
// verifyWebhookSignature (v3: method + uri + body + timestamp HMAC-SHA256 base64)
// ---------------------------------------------------------------------------
describe('verifyWebhookSignature', () => {
  const secret = 'hubspot-webhook-secret-123';
  const method = 'POST';
  const uri = 'https://example.com/webhook/hubspot';
  const body = '{"eventType":"contact.creation","objectId":"123"}';
  const timestamp = '1711234567';

  function computeSignatureV3(m: string, u: string, b: string, ts: string, s: string): string {
    const sourceString = m + u + b + ts;
    return crypto.createHmac('sha256', s).update(sourceString, 'utf8').digest('base64');
  }

  it('returns true for valid signature', () => {
    // WHO: src/routes/hubspot.ts webhook handler calling hubspotClient.verifyWebhookSignature()
    // WHAT: HMAC-SHA256 of method+uri+body+timestamp matches the X-HubSpot-Signature-V3 header
    // WHEN: HubSpot sends a webhook event (contact.creation, contact.propertyChange, etc.)
    // WHERE: src/services/hubspotClient.ts verifyWebhookSignature()
    // WHY: if valid signature verification regressed, we would reject all legitimate webhooks and miss real-time sync events from HubSpot
    const signature = computeSignatureV3(method, uri, body, timestamp, secret);
    expect(verifyWebhookSignature(method, uri, body, timestamp, signature, secret)).toBe(true);
  });

  it('returns false for invalid signature (tampered body)', () => {
    // WHO: src/routes/hubspot.ts webhook handler calling hubspotClient.verifyWebhookSignature()
    // WHAT: signature was computed against "tampered" body but webhook body is different
    // WHEN: attacker intercepts and modifies the webhook payload in transit
    // WHERE: src/services/hubspotClient.ts verifyWebhookSignature()
    // WHY: without body integrity checking, an attacker could inject fake contact data or property changes into our system via forged webhooks
    const signature = computeSignatureV3(method, uri, 'tampered', timestamp, secret);
    expect(verifyWebhookSignature(method, uri, body, timestamp, signature, secret)).toBe(false);
  });

  it('returns false for signature computed with wrong secret', () => {
    // WHO: src/routes/hubspot.ts webhook handler calling hubspotClient.verifyWebhookSignature()
    // WHAT: signature computed with "wrong-secret" instead of the correct webhook secret
    // WHEN: attacker tries to forge a webhook using a guessed or leaked key from another integration
    // WHERE: src/services/hubspotClient.ts verifyWebhookSignature()
    // WHY: without secret verification, any party who knows the URL could forge webhook events and manipulate contact/meeting data
    const signature = computeSignatureV3(method, uri, body, timestamp, 'wrong-secret');
    expect(verifyWebhookSignature(method, uri, body, timestamp, signature, secret)).toBe(false);
  });

  it('returns false for completely invalid signature', () => {
    // WHO: src/routes/hubspot.ts webhook handler calling hubspotClient.verifyWebhookSignature()
    // WHAT: signature is a garbage string that is not valid base64 HMAC
    // WHEN: random probe or scanner hits the webhook endpoint with arbitrary headers
    // WHERE: src/services/hubspotClient.ts verifyWebhookSignature()
    // WHY: without gracefully handling non-base64 signatures, the HMAC comparison could throw instead of returning false
    expect(verifyWebhookSignature(method, uri, body, timestamp, 'not-valid', secret)).toBe(false);
  });

  it('returns false for different length signature (timingSafeEqual catch)', () => {
    // WHO: src/routes/hubspot.ts webhook handler calling hubspotClient.verifyWebhookSignature()
    // WHAT: empty string signature (different buffer length than expected HMAC)
    // WHEN: webhook request arrives with missing or empty X-HubSpot-Signature-V3 header
    // WHERE: src/services/hubspotClient.ts verifyWebhookSignature()
    // WHY: without length-mismatch handling, timingSafeEqual would throw "Input buffers must have the same byte length" and crash the webhook handler
    expect(verifyWebhookSignature(method, uri, body, timestamp, '', secret)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Convenience methods: contacts
// ---------------------------------------------------------------------------
describe('listContacts', () => {
  it('calls correct endpoint with properties', async () => {
    // WHO: hubspotSync.ts pullHubSpotContacts() calling hubspotClient.listContacts()
    // WHAT: GET /crm/v3/objects/contacts with limit=100, properties include firstname and email
    // WHEN: full sync pulls all HubSpot contacts to merge with local customer records
    // WHERE: src/services/hubspotClient.ts listContacts()
    // WHY: without requesting specific properties, HubSpot returns only the ID — sync would overwrite local names/emails with empty strings
    setHubSpotEnv();
    const response = { results: [], paging: undefined };
    mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => response });

    const result = await listContacts('my-token');

    expect(result).toEqual(response);
    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain('/crm/v3/objects/contacts');
    expect(calledUrl).toContain('limit=100');
    expect(calledUrl).toContain('firstname');
    expect(calledUrl).toContain('email');
  });

  it('passes after param for pagination', async () => {
    // WHO: hubspotSync.ts pullHubSpotContacts() calling listContacts() with cursor
    // WHAT: GET /crm/v3/objects/contacts with after=cursor-abc for next page
    // WHEN: HubSpot has more than 100 contacts and sync needs subsequent pages
    // WHERE: src/services/hubspotClient.ts listContacts()
    // WHY: without pagination support, sync would only fetch the first 100 contacts and silently drop all others
    setHubSpotEnv();
    mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ results: [] }) });

    await listContacts('my-token', 'cursor-abc');

    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain('after=cursor-abc');
  });
});

describe('getContact', () => {
  it('calls correct endpoint with contact ID and properties', async () => {
    // WHO: hubspotSync.ts calling hubspotClient.getContact() for single-record fetch
    // WHAT: GET /crm/v3/objects/contacts/{id} with properties query param including firstname
    // WHEN: webhook triggers a single-contact sync or manual refresh
    // WHERE: src/services/hubspotClient.ts getContact()
    // WHY: without requesting properties, the response would only contain the ID, making the fetched data useless for merge
    setHubSpotEnv();
    const contact = { id: '42', properties: { firstname: 'Dale' } };
    mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => contact });

    const result = await getContact('my-token', '42');

    expect(result).toEqual(contact);
    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain('/crm/v3/objects/contacts/42');
    expect(calledUrl).toContain('firstname');
  });
});

describe('createContact', () => {
  it('POSTs to contacts endpoint with properties', async () => {
    // WHO: hubspotSync.ts pushHubSpotContact() calling hubspotClient.createContact()
    // WHAT: POST /crm/v3/objects/contacts with { properties: { firstname, email } } body
    // WHEN: a new local customer needs to be pushed to HubSpot during bidirectional sync
    // WHERE: src/services/hubspotClient.ts createContact()
    // WHY: HubSpot requires a { properties: {...} } wrapper — without it, the API returns 400 and the contact would never appear in the CRM
    setHubSpotEnv();
    const created = { id: '99', properties: { firstname: 'New' } };
    mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => created });

    const result = await createContact('my-token', { firstname: 'New', email: 'new@test.com' });

    expect(result).toEqual(created);
    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain('/crm/v3/objects/contacts');
    const callArgs = mockFetch.mock.calls[0][1];
    expect(callArgs.method).toBe('POST');
    expect(JSON.parse(callArgs.body)).toEqual({
      properties: { firstname: 'New', email: 'new@test.com' },
    });
  });
});

describe('updateContact', () => {
  it('PATCHes to contacts endpoint with contact ID', async () => {
    // WHO: hubspotSync.ts pushHubSpotContact() calling hubspotClient.updateContact()
    // WHAT: PATCH /crm/v3/objects/contacts/{id} with updated properties
    // WHEN: local customer record was modified and needs to be synced to HubSpot
    // WHERE: src/services/hubspotClient.ts updateContact()
    // WHY: HubSpot uses PATCH for partial updates — using POST would create a duplicate contact instead of updating the existing one
    setHubSpotEnv();
    const updated = { id: '42', properties: { firstname: 'Updated' } };
    mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => updated });

    const result = await updateContact('my-token', '42', { firstname: 'Updated' });

    expect(result).toEqual(updated);
    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain('/crm/v3/objects/contacts/42');
    const callArgs = mockFetch.mock.calls[0][1];
    expect(callArgs.method).toBe('PATCH');
  });
});

// ---------------------------------------------------------------------------
// Convenience methods: meetings
// ---------------------------------------------------------------------------
describe('createMeeting', () => {
  it('POSTs to meetings endpoint with properties', async () => {
    // WHO: hubspotSync.ts pushHubSpotMeeting() calling hubspotClient.createMeeting()
    // WHAT: POST /crm/v3/objects/meetings with { properties: { hs_meeting_title, hs_meeting_start_time } }
    // WHEN: a new local appointment needs to be pushed to HubSpot as a meeting during sync
    // WHERE: src/services/hubspotClient.ts createMeeting()
    // WHY: if the endpoint regressed from /meetings to /appointments, HubSpot would return 404 and appointment sync would break entirely
    setHubSpotEnv();
    const created = { id: 'm1', properties: { hs_meeting_title: 'Tire Change' } };
    mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => created });

    const result = await createMeeting('my-token', {
      hs_meeting_title: 'Tire Change',
      hs_meeting_start_time: '2026-04-01T10:00:00Z',
    });

    expect(result).toEqual(created);
    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain('/crm/v3/objects/meetings');
    const callArgs = mockFetch.mock.calls[0][1];
    expect(callArgs.method).toBe('POST');
  });
});

describe('updateMeeting', () => {
  it('PATCHes to meetings endpoint with meeting ID', async () => {
    // WHO: hubspotSync.ts pushHubSpotMeeting() calling hubspotClient.updateMeeting()
    // WHAT: PATCH /crm/v3/objects/meetings/{id} with updated meeting properties
    // WHEN: local appointment was rescheduled and needs to sync to HubSpot
    // WHERE: src/services/hubspotClient.ts updateMeeting()
    // WHY: if the method was POST instead of PATCH, HubSpot would create a duplicate meeting instead of updating the existing one
    setHubSpotEnv();
    const updated = { id: 'm1', properties: { hs_meeting_title: 'Updated' } };
    mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => updated });

    const result = await updateMeeting('my-token', 'm1', { hs_meeting_title: 'Updated' });

    expect(result).toEqual(updated);
    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain('/crm/v3/objects/meetings/m1');
    const callArgs = mockFetch.mock.calls[0][1];
    expect(callArgs.method).toBe('PATCH');
  });
});

describe('associateMeetingToContact', () => {
  it('PUTs to v4 associations endpoint with correct IDs', async () => {
    // WHO: hubspotSync.ts calling hubspotClient.associateMeetingToContact() after creating a meeting
    // WHAT: PUT /crm/v4/objects/meetings/{meetingId}/associations/contacts/{contactId} with HUBSPOT_DEFINED association type 200
    // WHEN: after creating a meeting in HubSpot, linking it to the corresponding contact
    // WHERE: src/services/hubspotClient.ts associateMeetingToContact()
    // WHY: without the association, the meeting would be orphaned in HubSpot — it wouldn't appear on the contact's timeline, making the sync useless for the tenant
    setHubSpotEnv();
    mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });

    await associateMeetingToContact('my-token', 'm1', 'c1');

    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain('/crm/v4/objects/meetings/m1/associations/contacts/c1');
    const callArgs = mockFetch.mock.calls[0][1];
    expect(callArgs.method).toBe('PUT');
    const body = JSON.parse(callArgs.body);
    expect(body).toEqual([{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 200 }]);
  });
});
