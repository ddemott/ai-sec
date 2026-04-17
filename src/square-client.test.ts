import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import jwt from "jsonwebtoken";
import crypto from "crypto";

// --- Mock global fetch before importing the module under test ---
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import {
  isSquareEnabled,
  getAuthUrl,
  verifyState,
  exchangeCodeForTokens,
  refreshAccessToken,
  apiRequest,
  verifyWebhookSignature,
  listCustomers,
  getCustomer,
  createCustomer,
  updateCustomer,
  listBookings,
  createBooking,
  updateBooking,
  cancelBooking,
} from "./services/squareClient";

const JWT_SECRET = "test-jwt-secret";
const TENANT_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

const originalEnv = process.env;

beforeEach(() => {
  process.env = { ...originalEnv };
  vi.clearAllMocks();
});

afterAll(() => {
  process.env = originalEnv;
});

function setSquareEnv() {
  process.env.SQUARE_CLIENT_ID = "test-client-id";
  process.env.SQUARE_CLIENT_SECRET = "test-client-secret";
  process.env.SQUARE_CALLBACK_URL = "http://localhost:4001/square/auth/callback";
  process.env.JWT_SECRET = JWT_SECRET;
}

// ---------------------------------------------------------------------------
// isSquareEnabled
// ---------------------------------------------------------------------------
describe("isSquareEnabled", () => {
  it("returns true when all env vars are set", () => {
    // WHO: squareClient.ts isSquareEnabled()
    // WHAT: all three SQUARE_* env vars plus JWT_SECRET are present
    // WHEN: checking if Square integration is available for a tenant
    // WHERE: src/services/squareClient.ts isSquareEnabled()
    // WHY: without this, the CRM settings page would show the Square connect button even when the server lacks credentials, leading to a broken OAuth flow
    setSquareEnv();
    expect(isSquareEnabled()).toBe(true);
  });

  it("returns false when SQUARE_CLIENT_ID is missing", () => {
    // WHO: squareClient.ts isSquareEnabled()
    // WHAT: SQUARE_CLIENT_ID env var is absent while others are present
    // WHEN: checking if Square integration is available
    // WHERE: src/services/squareClient.ts isSquareEnabled()
    // WHY: without this guard, OAuth redirect would fail at Square's end with an invalid_client error, confusing the tenant admin
    setSquareEnv();
    delete process.env.SQUARE_CLIENT_ID;
    expect(isSquareEnabled()).toBe(false);
  });

  it("returns false when SQUARE_CLIENT_SECRET is missing", () => {
    // WHO: squareClient.ts isSquareEnabled()
    // WHAT: SQUARE_CLIENT_SECRET env var is absent while others are present
    // WHEN: checking if Square integration is available
    // WHERE: src/services/squareClient.ts isSquareEnabled()
    // WHY: without the secret, token exchange would fail silently — better to disable the integration upfront
    setSquareEnv();
    delete process.env.SQUARE_CLIENT_SECRET;
    expect(isSquareEnabled()).toBe(false);
  });

  it("returns false when SQUARE_CALLBACK_URL is missing", () => {
    // WHO: squareClient.ts isSquareEnabled()
    // WHAT: SQUARE_CALLBACK_URL env var is absent while others are present
    // WHEN: checking if Square integration is available
    // WHERE: src/services/squareClient.ts isSquareEnabled()
    // WHY: without the callback URL, OAuth redirect_uri would be undefined, causing Square to reject the auth request
    setSquareEnv();
    delete process.env.SQUARE_CALLBACK_URL;
    expect(isSquareEnabled()).toBe(false);
  });

  it("returns false when all Square env vars are missing", () => {
    // WHO: squareClient.ts isSquareEnabled()
    // WHAT: no Square env vars are set at all (fresh deploy without Square config)
    // WHEN: checking if Square integration is available
    // WHERE: src/services/squareClient.ts isSquareEnabled()
    // WHY: ensures tenants on deployments without Square credentials don't see a broken integration option in the CRM settings UI
    delete process.env.SQUARE_CLIENT_ID;
    delete process.env.SQUARE_CLIENT_SECRET;
    delete process.env.SQUARE_CALLBACK_URL;
    expect(isSquareEnabled()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getAuthUrl
// ---------------------------------------------------------------------------
describe("getAuthUrl", () => {
  it("returns a URL string when configured", () => {
    // WHO: squareClient.ts getAuthUrl()
    // WHAT: all env vars set, generating OAuth authorization URL for a tenant
    // WHEN: tenant admin clicks "Connect Square" in CRM settings
    // WHERE: src/services/squareClient.ts getAuthUrl()
    // WHY: if this regressed, the connect button would produce a null URL and the frontend would crash or show a blank page
    setSquareEnv();
    const url = getAuthUrl(TENANT_ID);
    expect(url).not.toBeNull();
    expect(url).toContain("connect.squareup.com");
  });

  it("includes correct query params", () => {
    // WHO: squareClient.ts getAuthUrl()
    // WHAT: verifying client_id, response_type, redirect_uri, and OAuth scopes in the generated URL
    // WHEN: tenant admin clicks "Connect Square" in CRM settings
    // WHERE: src/services/squareClient.ts getAuthUrl()
    // WHY: wrong scopes would cause Square to grant insufficient permissions — sync would silently fail on customer reads/writes or booking operations
    setSquareEnv();
    const url = getAuthUrl(TENANT_ID)!;
    const parsed = new URL(url);
    expect(parsed.searchParams.get("client_id")).toBe("test-client-id");
    expect(parsed.searchParams.get("response_type")).toBe("code");
    expect(parsed.searchParams.get("redirect_uri")).toBe(
      "http://localhost:4001/square/auth/callback"
    );
    expect(parsed.searchParams.get("scope")).toContain("CUSTOMERS_READ");
    expect(parsed.searchParams.get("scope")).toContain("CUSTOMERS_WRITE");
    expect(parsed.searchParams.get("scope")).toContain("APPOINTMENTS_READ");
    expect(parsed.searchParams.get("scope")).toContain("APPOINTMENTS_WRITE");
  });

  it("includes a signed JWT state param with tenantId and purpose", () => {
    // WHO: squareClient.ts getAuthUrl()
    // WHAT: state param is a JWT containing tenantId and purpose="square-oauth"
    // WHEN: generating the OAuth URL before redirecting the tenant admin to Square
    // WHERE: src/services/squareClient.ts getAuthUrl()
    // WHY: without a signed state param, an attacker could forge the OAuth callback and link their Square account to a victim's tenant (CSRF attack)
    setSquareEnv();
    const url = getAuthUrl(TENANT_ID)!;
    const parsed = new URL(url);
    const state = parsed.searchParams.get("state")!;
    const decoded = jwt.verify(state, JWT_SECRET) as any;
    expect(decoded.tenantId).toBe(TENANT_ID);
    expect(decoded.purpose).toBe("square-oauth");
  });

  it("returns null when Square is not configured", () => {
    // WHO: squareClient.ts getAuthUrl()
    // WHAT: no Square env vars set — integration disabled
    // WHEN: tenant admin requests OAuth URL on a deploy without Square credentials
    // WHERE: src/services/squareClient.ts getAuthUrl()
    // WHY: without this null return, the function would throw or produce a malformed URL, crashing the CRM settings page
    delete process.env.SQUARE_CLIENT_ID;
    delete process.env.SQUARE_CLIENT_SECRET;
    delete process.env.SQUARE_CALLBACK_URL;
    expect(getAuthUrl(TENANT_ID)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// verifyState
// ---------------------------------------------------------------------------
describe("verifyState", () => {
  it("returns tenantId for a valid state JWT", () => {
    // WHO: squareClient.ts verifyState()
    // WHAT: valid JWT with correct tenantId, purpose, and expiry
    // WHEN: Square redirects back to our callback with the state param
    // WHERE: src/services/squareClient.ts verifyState()
    // WHY: if verification regressed, the callback would reject valid OAuth completions and tenants could never finish connecting Square
    setSquareEnv();
    const state = jwt.sign(
      { tenantId: TENANT_ID, purpose: "square-oauth" },
      JWT_SECRET,
      { expiresIn: "10m" }
    );
    expect(verifyState(state)).toBe(TENANT_ID);
  });

  it("returns null for an expired state JWT", () => {
    // WHO: squareClient.ts verifyState()
    // WHAT: JWT that has already expired (created with -1s expiry)
    // WHEN: Square callback arrives after the user waited too long (>10 min)
    // WHERE: src/services/squareClient.ts verifyState()
    // WHY: without expiry validation, a replayed stale OAuth callback could link Square to the wrong tenant if the user has since switched accounts
    setSquareEnv();
    const state = jwt.sign(
      { tenantId: TENANT_ID, purpose: "square-oauth" },
      JWT_SECRET,
      { expiresIn: "-1s" }
    );
    expect(verifyState(state)).toBeNull();
  });

  it("returns null when purpose doesn't match", () => {
    // WHO: squareClient.ts verifyState()
    // WHAT: JWT with wrong purpose field (e.g., "wrong-purpose" instead of "square-oauth")
    // WHEN: a state JWT from a different OAuth flow (e.g., HubSpot) is replayed against Square callback
    // WHERE: src/services/squareClient.ts verifyState()
    // WHY: without purpose checking, a Jobber/HubSpot OAuth state could be replayed against the Square callback, linking the wrong CRM
    setSquareEnv();
    const state = jwt.sign(
      { tenantId: TENANT_ID, purpose: "wrong-purpose" },
      JWT_SECRET,
      { expiresIn: "10m" }
    );
    expect(verifyState(state)).toBeNull();
  });

  it("returns null for a completely invalid token", () => {
    // WHO: squareClient.ts verifyState()
    // WHAT: garbage string that is not a valid JWT at all
    // WHEN: attacker sends a crafted callback with a random state value
    // WHERE: src/services/squareClient.ts verifyState()
    // WHY: without this, jwt.verify would throw an unhandled error, crashing the callback handler instead of returning null gracefully
    setSquareEnv();
    expect(verifyState("not-a-jwt")).toBeNull();
  });

  it("returns null for a token signed with a different secret", () => {
    // WHO: squareClient.ts verifyState()
    // WHAT: JWT signed with "wrong-secret" instead of the server's JWT_SECRET
    // WHEN: attacker forges a state JWT with a known tenantId but different signing key
    // WHERE: src/services/squareClient.ts verifyState()
    // WHY: without signature verification, an attacker could craft a state JWT targeting any tenantId and hijack their Square integration
    setSquareEnv();
    const state = jwt.sign(
      { tenantId: TENANT_ID, purpose: "square-oauth" },
      "wrong-secret",
      { expiresIn: "10m" }
    );
    expect(verifyState(state)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// exchangeCodeForTokens
// ---------------------------------------------------------------------------
describe("exchangeCodeForTokens", () => {
  it("returns token set on success (ISO expiry)", async () => {
    // WHO: squareClient.ts exchangeCodeForTokens()
    // WHAT: Square returns access_token, refresh_token, and ISO expires_at after valid auth code exchange
    // WHEN: OAuth callback handler receives the authorization code from Square
    // WHERE: src/services/squareClient.ts exchangeCodeForTokens()
    // WHY: if token parsing regressed, tokens would be stored incorrectly in tenant_integration_settings and all subsequent API calls would fail with 401
    setSquareEnv();
    const expiresAt = new Date(Date.now() + 28 * 24 * 3600 * 1000).toISOString();
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: "access-123",
        refresh_token: "refresh-456",
        expires_at: expiresAt,
      }),
    });

    const tokens = await exchangeCodeForTokens("auth-code-789");

    expect(tokens.access_token).toBe("access-123");
    expect(tokens.refresh_token).toBe("refresh-456");
    expect(tokens.expiry_date).toBe(new Date(expiresAt).getTime());

    // Verify fetch was called with correct URL
    expect(mockFetch).toHaveBeenCalledWith(
      "https://connect.squareup.com/oauth2/token",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("defaults to 28-day expiry when expires_at is missing", async () => {
    // WHO: squareClient.ts exchangeCodeForTokens()
    // WHAT: Square response omits expires_at field entirely
    // WHEN: Square API changes response format or field is optional
    // WHERE: src/services/squareClient.ts exchangeCodeForTokens()
    // WHY: without a fallback expiry, the token would appear expired immediately (expiry_date=0), triggering constant unnecessary token refreshes
    setSquareEnv();
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: "access-123",
        refresh_token: "refresh-456",
      }),
    });

    const before = Date.now();
    const tokens = await exchangeCodeForTokens("auth-code");

    // Should default to ~28 days
    expect(tokens.expiry_date).toBeGreaterThanOrEqual(before + 27 * 24 * 3600 * 1000);
  });

  it("throws when access_token is missing", async () => {
    // WHO: squareClient.ts exchangeCodeForTokens()
    // WHAT: Square returns null access_token (possible API error or partial response)
    // WHEN: OAuth code exchange succeeds HTTP-wise but response body is incomplete
    // WHERE: src/services/squareClient.ts exchangeCodeForTokens()
    // WHY: without this check, a null access_token would be stored and every subsequent Square API call would send "Bearer null", silently failing
    setSquareEnv();
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: null, refresh_token: "refresh-456" }),
    });

    await expect(exchangeCodeForTokens("auth-code")).rejects.toThrow(
      "incomplete tokens"
    );
  });

  it("throws when refresh_token is missing", async () => {
    // WHO: squareClient.ts exchangeCodeForTokens()
    // WHAT: Square returns null refresh_token (possible API error or partial response)
    // WHEN: OAuth code exchange succeeds HTTP-wise but response body is incomplete
    // WHERE: src/services/squareClient.ts exchangeCodeForTokens()
    // WHY: without a refresh_token, the integration would work for 28 days then permanently break — tenant would need to re-authorize manually
    setSquareEnv();
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: "access-123", refresh_token: null }),
    });

    await expect(exchangeCodeForTokens("auth-code")).rejects.toThrow(
      "incomplete tokens"
    );
  });

  it("throws when HTTP response is not ok", async () => {
    // WHO: squareClient.ts exchangeCodeForTokens()
    // WHAT: Square token endpoint returns HTTP 400 (invalid or expired auth code)
    // WHEN: auth code is stale (user took too long) or was already used
    // WHERE: src/services/squareClient.ts exchangeCodeForTokens()
    // WHY: without this check, the code would try to parse a non-JSON error body as tokens, producing garbage credentials in the database
    setSquareEnv();
    mockFetch.mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => "Bad Request",
    });

    await expect(exchangeCodeForTokens("auth-code")).rejects.toThrow(
      "Square OAuth code exchange failed"
    );
  });

  it("throws on network error", async () => {
    // WHO: squareClient.ts exchangeCodeForTokens()
    // WHAT: fetch rejects with ECONNREFUSED (Square API unreachable)
    // WHEN: network partition or Square outage during OAuth flow
    // WHERE: src/services/squareClient.ts exchangeCodeForTokens()
    // WHY: without wrapping fetch errors, an unhandled promise rejection would crash the route handler instead of returning a user-friendly error
    setSquareEnv();
    mockFetch.mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(exchangeCodeForTokens("auth-code")).rejects.toThrow(
      "network error"
    );
  });

  it("throws when Square is not configured", async () => {
    // WHO: squareClient.ts exchangeCodeForTokens()
    // WHAT: no SQUARE_* env vars are set
    // WHEN: code exchange is attempted on a deploy that doesn't have Square credentials
    // WHERE: src/services/squareClient.ts exchangeCodeForTokens()
    // WHY: without this early guard, the function would send undefined client_id/secret to Square, getting a confusing 400 error instead of a clear message
    delete process.env.SQUARE_CLIENT_ID;
    delete process.env.SQUARE_CLIENT_SECRET;
    delete process.env.SQUARE_CALLBACK_URL;

    await expect(exchangeCodeForTokens("auth-code")).rejects.toThrow(
      "Square not configured"
    );
  });
});

// ---------------------------------------------------------------------------
// refreshAccessToken
// ---------------------------------------------------------------------------
describe("refreshAccessToken", () => {
  it("returns refreshed credentials on success", async () => {
    // WHO: tokenManagement.ts calling squareClient.refreshAccessToken()
    // WHAT: Square returns a new access_token and expires_at after a valid refresh
    // WHEN: token refresh triggered by tokenManagement.ts 5-min-before-expiry buffer check
    // WHERE: src/services/squareClient.ts refreshAccessToken()
    // WHY: if refresh parsing regressed, the new token wouldn't be stored correctly and the integration would break after the first token expiry
    setSquareEnv();
    const expiresAt = new Date(Date.now() + 28 * 24 * 3600 * 1000).toISOString();
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: "new-access-token",
        expires_at: expiresAt,
      }),
    });

    const result = await refreshAccessToken("old-refresh-token");

    expect(result.access_token).toBe("new-access-token");
    expect(result.expiry_date).toBe(new Date(expiresAt).getTime());
  });

  it("throws when HTTP response is not ok", async () => {
    // WHO: tokenManagement.ts calling squareClient.refreshAccessToken()
    // WHAT: Square token endpoint returns HTTP 401 (refresh token revoked or expired)
    // WHEN: tenant revoked app access in Square dashboard, or refresh token exceeded its lifetime
    // WHERE: src/services/squareClient.ts refreshAccessToken()
    // WHY: without this error, stale credentials would persist in tenant_integration_settings and sync would silently fail until someone noticed
    setSquareEnv();
    mockFetch.mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => "Unauthorized",
    });

    await expect(refreshAccessToken("old-refresh-token")).rejects.toThrow(
      "Square token refresh failed"
    );
  });

  it("throws when access_token is missing from response", async () => {
    // WHO: tokenManagement.ts calling squareClient.refreshAccessToken()
    // WHAT: Square returns 200 OK but with null access_token in body
    // WHEN: unexpected Square API behavior or response format change
    // WHERE: src/services/squareClient.ts refreshAccessToken()
    // WHY: without this check, a null token would overwrite the valid old token, immediately breaking all Square API calls for this tenant
    setSquareEnv();
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: null }),
    });

    await expect(refreshAccessToken("old-refresh-token")).rejects.toThrow(
      "Square token refresh returned no access_token"
    );
  });

  it("throws on network error", async () => {
    // WHO: tokenManagement.ts calling squareClient.refreshAccessToken()
    // WHAT: fetch rejects with ETIMEDOUT (Square API unreachable)
    // WHEN: network partition or Square outage during token refresh
    // WHERE: src/services/squareClient.ts refreshAccessToken()
    // WHY: without wrapping fetch errors, an unhandled rejection would crash the sync worker instead of allowing retry logic to kick in
    setSquareEnv();
    mockFetch.mockRejectedValue(new Error("ETIMEDOUT"));

    await expect(refreshAccessToken("old-refresh-token")).rejects.toThrow(
      "network error"
    );
  });

  it("throws when Square is not configured", async () => {
    // WHO: tokenManagement.ts calling squareClient.refreshAccessToken()
    // WHAT: no SQUARE_* env vars set
    // WHEN: token refresh attempted on a deploy without Square credentials
    // WHERE: src/services/squareClient.ts refreshAccessToken()
    // WHY: without this guard, the function would send undefined client_id/secret to Square, producing a confusing HTTP error instead of a clear message
    delete process.env.SQUARE_CLIENT_ID;
    delete process.env.SQUARE_CLIENT_SECRET;
    delete process.env.SQUARE_CALLBACK_URL;

    await expect(refreshAccessToken("old-refresh-token")).rejects.toThrow(
      "Square not configured"
    );
  });
});

// ---------------------------------------------------------------------------
// apiRequest
// ---------------------------------------------------------------------------
describe("apiRequest", () => {
  it("sends correct method, path, auth header, and Square-Version", async () => {
    // WHO: squareSync.ts calling squareClient.apiRequest()
    // WHAT: GET request with Bearer token, Square-Version header, and correct base URL
    // WHEN: any Square API call (customer fetch, booking list, etc.)
    // WHERE: src/services/squareClient.ts apiRequest()
    // WHY: if the Square-Version header or base URL regressed, Square would return 400 or use a deprecated API version with different response shapes
    setSquareEnv();
    const responseData = { customer: { id: "123", given_name: "Dale" } };
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => responseData,
    });

    const result = await apiRequest("GET", "/customers/123", "my-token");

    expect(result).toEqual(responseData);
    expect(mockFetch).toHaveBeenCalledWith(
      "https://connect.squareup.com/v2/customers/123",
      expect.objectContaining({
        method: "GET",
        headers: {
          Authorization: "Bearer my-token",
          "Square-Version": "2024-01-18",
          "Content-Type": "application/json",
        },
      })
    );
  });

  it("sends JSON body for POST requests", async () => {
    // WHO: squareSync.ts calling squareClient.apiRequest() for customer creation
    // WHAT: POST request with JSON-serialized body
    // WHEN: pushing a new customer to Square during bidirectional sync
    // WHERE: src/services/squareClient.ts apiRequest()
    // WHY: if the body wasn't JSON-serialized, Square would return 400 and the customer push would silently fail
    setSquareEnv();
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ customer: { id: "456" } }),
    });

    await apiRequest("POST", "/customers", "my-token", {
      given_name: "Test",
    });

    const callArgs = mockFetch.mock.calls[0][1];
    expect(JSON.parse(callArgs.body)).toEqual({
      given_name: "Test",
    });
  });

  it("returns null for 204 responses", async () => {
    // WHO: squareSync.ts calling squareClient.apiRequest() for DELETE operations
    // WHAT: server returns 204 No Content (successful deletion, no body)
    // WHEN: deleting a customer or canceling a booking in Square
    // WHERE: src/services/squareClient.ts apiRequest()
    // WHY: without handling 204, calling .json() on a bodyless response would throw a parse error, making deletions appear to fail
    setSquareEnv();
    mockFetch.mockResolvedValue({
      ok: true,
      status: 204,
    });

    const result = await apiRequest("DELETE", "/customers/123", "my-token");
    expect(result).toBeNull();
  });

  it("throws when HTTP response is not ok (401)", async () => {
    // WHO: squareSync.ts calling squareClient.apiRequest()
    // WHAT: Square returns 401 Unauthorized (expired or revoked token)
    // WHEN: access token has expired and refresh hasn't happened yet
    // WHERE: src/services/squareClient.ts apiRequest()
    // WHY: without throwing on 401, the sync would process an error body as valid data, corrupting local records with Square error objects
    setSquareEnv();
    mockFetch.mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => "Unauthorized",
    });

    await expect(
      apiRequest("GET", "/customers", "my-token")
    ).rejects.toThrow("Square API GET /customers failed (401)");
  });

  it("throws when HTTP response is not ok (429)", async () => {
    // WHO: squareSync.ts calling squareClient.apiRequest()
    // WHAT: Square returns 429 Rate Limited
    // WHEN: too many API calls in a short window during a full sync pull
    // WHERE: src/services/squareClient.ts apiRequest()
    // WHY: without surfacing 429 errors, the sync would silently skip records and produce an incomplete customer/booking list
    setSquareEnv();
    mockFetch.mockResolvedValue({
      ok: false,
      status: 429,
      text: async () => "Rate Limited",
    });

    await expect(
      apiRequest("GET", "/customers", "my-token")
    ).rejects.toThrow("Square API GET /customers failed (429)");
  });

  it("throws when HTTP response is not ok (500)", async () => {
    // WHO: squareSync.ts calling squareClient.apiRequest()
    // WHAT: Square returns 500 Internal Server Error
    // WHEN: Square API is experiencing an outage or internal issue
    // WHERE: src/services/squareClient.ts apiRequest()
    // WHY: without throwing on 500, the sync would treat an error page as valid JSON, potentially corrupting the entity_sync_map
    setSquareEnv();
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => "Internal Server Error",
    });

    await expect(
      apiRequest("GET", "/customers", "my-token")
    ).rejects.toThrow("Square API GET /customers failed (500)");
  });

  it("throws on network error", async () => {
    // WHO: squareSync.ts calling squareClient.apiRequest()
    // WHAT: fetch rejects with ECONNRESET (connection dropped mid-request)
    // WHEN: network instability or Square API connection reset
    // WHERE: src/services/squareClient.ts apiRequest()
    // WHY: without wrapping network errors, an unhandled rejection would crash the sync worker instead of allowing the caller to handle the failure
    setSquareEnv();
    mockFetch.mockRejectedValue(new Error("ECONNRESET"));

    await expect(
      apiRequest("GET", "/customers", "my-token")
    ).rejects.toThrow("network error");
  });
});

// ---------------------------------------------------------------------------
// verifyWebhookSignature (SHA-256 HMAC of notificationUrl + body)
// ---------------------------------------------------------------------------
describe("verifyWebhookSignature", () => {
  const signatureKey = "square-webhook-key-123";
  const notificationUrl = "https://example.com/square/webhook";
  const body = '{"type":"customer.created","merchant_id":"M123"}';

  function computeSignature(
    b: string,
    url: string,
    key: string
  ): string {
    const payload = url + b;
    return crypto.createHmac("sha256", key).update(payload, "utf8").digest("base64");
  }

  it("returns true for valid signature", () => {
    // WHO: src/routes/square.ts webhook handler calling squareClient.verifyWebhookSignature()
    // WHAT: HMAC-SHA256 of notificationUrl+body matches the signature header from Square
    // WHEN: Square sends a webhook event (customer.created, booking.updated, etc.)
    // WHERE: src/services/squareClient.ts verifyWebhookSignature()
    // WHY: if valid signature verification regressed, we would reject all legitimate webhooks and miss real-time sync events from Square
    const signature = computeSignature(body, notificationUrl, signatureKey);
    expect(
      verifyWebhookSignature(body, signature, signatureKey, notificationUrl)
    ).toBe(true);
  });

  it("returns false for invalid signature (tampered body)", () => {
    // WHO: src/routes/square.ts webhook handler calling squareClient.verifyWebhookSignature()
    // WHAT: signature was computed against "tampered" body but webhook body is different
    // WHEN: attacker intercepts and modifies the webhook payload in transit
    // WHERE: src/services/squareClient.ts verifyWebhookSignature()
    // WHY: without body integrity checking, an attacker could inject fake customer data or booking changes into our system via forged webhooks
    const signature = computeSignature("tampered", notificationUrl, signatureKey);
    expect(
      verifyWebhookSignature(body, signature, signatureKey, notificationUrl)
    ).toBe(false);
  });

  it("returns false for signature computed with wrong key", () => {
    // WHO: src/routes/square.ts webhook handler calling squareClient.verifyWebhookSignature()
    // WHAT: signature computed with "wrong-key" instead of the correct webhook signing key
    // WHEN: attacker tries to forge a webhook using a guessed or leaked key from another integration
    // WHERE: src/services/squareClient.ts verifyWebhookSignature()
    // WHY: without key verification, any party who knows the URL could forge webhook events and manipulate customer/booking data
    const signature = computeSignature(body, notificationUrl, "wrong-key");
    expect(
      verifyWebhookSignature(body, signature, signatureKey, notificationUrl)
    ).toBe(false);
  });

  it("returns false for completely invalid signature", () => {
    // WHO: src/routes/square.ts webhook handler calling squareClient.verifyWebhookSignature()
    // WHAT: signature is a garbage string that is not valid base64 HMAC
    // WHEN: random probe or scanner hits the webhook endpoint with arbitrary headers
    // WHERE: src/services/squareClient.ts verifyWebhookSignature()
    // WHY: without gracefully handling non-base64 signatures, the HMAC comparison could throw instead of returning false
    expect(
      verifyWebhookSignature(body, "not-valid", signatureKey, notificationUrl)
    ).toBe(false);
  });

  it("returns false for different length signature (timingSafeEqual catch)", () => {
    // WHO: src/routes/square.ts webhook handler calling squareClient.verifyWebhookSignature()
    // WHAT: empty string signature (different buffer length than expected HMAC)
    // WHEN: webhook request arrives with missing or empty signature header
    // WHERE: src/services/squareClient.ts verifyWebhookSignature()
    // WHY: without length-mismatch handling, timingSafeEqual would throw "Input buffers must have the same byte length" and crash the webhook handler
    expect(
      verifyWebhookSignature(body, "", signatureKey, notificationUrl)
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Convenience methods: customers
// ---------------------------------------------------------------------------
describe("listCustomers", () => {
  it("calls correct endpoint", async () => {
    // WHO: squareSync.ts pullSquareCustomers() calling squareClient.listCustomers()
    // WHAT: GET /customers with limit=100 query param
    // WHEN: full sync pulls all Square customers to merge with local records
    // WHERE: src/services/squareClient.ts listCustomers()
    // WHY: if the endpoint or limit param regressed, sync would hit a 404 or fetch only default 10 records, missing most customers
    setSquareEnv();
    const response = { customers: [], cursor: undefined };
    mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => response });

    const result = await listCustomers("my-token");

    expect(result).toEqual(response);
    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain("/customers");
    expect(calledUrl).toContain("limit=100");
  });

  it("passes cursor param for pagination", async () => {
    // WHO: squareSync.ts pullSquareCustomers() calling squareClient.listCustomers() with cursor
    // WHAT: GET /customers with cursor query param for fetching next page
    // WHEN: Square has more than 100 customers and sync needs subsequent pages
    // WHERE: src/services/squareClient.ts listCustomers()
    // WHY: without cursor support, sync would only ever fetch the first 100 customers and silently drop all others
    setSquareEnv();
    mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ customers: [] }) });

    await listCustomers("my-token", "cursor-abc");

    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain("cursor=cursor-abc");
  });
});

describe("getCustomer", () => {
  it("calls correct endpoint with customer ID", async () => {
    // WHO: squareSync.ts calling squareClient.getCustomer() for single-record fetch
    // WHAT: GET /customers/{id} with specific customer ID in the path
    // WHEN: webhook triggers a single-customer sync or manual refresh
    // WHERE: src/services/squareClient.ts getCustomer()
    // WHY: if the ID wasn't interpolated into the path correctly, we'd fetch the wrong customer or get a 404, corrupting the entity_sync_map
    setSquareEnv();
    const customer = { customer: { id: "42", given_name: "Dale" } };
    mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => customer });

    const result = await getCustomer("my-token", "42");

    expect(result).toEqual(customer);
    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain("/customers/42");
  });
});

describe("createCustomer", () => {
  it("POSTs to customers endpoint with data", async () => {
    // WHO: squareSync.ts pushSquareCustomer() calling squareClient.createCustomer()
    // WHAT: POST /customers with given_name and email_address in request body
    // WHEN: a new local customer needs to be pushed to Square during bidirectional sync
    // WHERE: src/services/squareClient.ts createCustomer()
    // WHY: if the POST body wasn't structured correctly, Square would reject the request and the customer would never appear in the merchant's Square dashboard
    setSquareEnv();
    const created = { customer: { id: "99", given_name: "New" } };
    mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => created });

    const result = await createCustomer("my-token", { given_name: "New", email_address: "new@test.com" });

    expect(result).toEqual(created);
    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain("/customers");
    const callArgs = mockFetch.mock.calls[0][1];
    expect(callArgs.method).toBe("POST");
    expect(JSON.parse(callArgs.body)).toEqual({
      given_name: "New",
      email_address: "new@test.com",
    });
  });
});

describe("updateCustomer", () => {
  it("PUTs to customers endpoint with customer ID", async () => {
    // WHO: squareSync.ts pushSquareCustomer() calling squareClient.updateCustomer()
    // WHAT: PUT /customers/{id} with updated fields in request body
    // WHEN: local customer record was modified and needs to be synced to Square
    // WHERE: src/services/squareClient.ts updateCustomer()
    // WHY: if the method was POST instead of PUT, Square would create a duplicate customer instead of updating the existing one
    setSquareEnv();
    const updated = { customer: { id: "42", given_name: "Updated" } };
    mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => updated });

    const result = await updateCustomer("my-token", "42", { given_name: "Updated" });

    expect(result).toEqual(updated);
    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain("/customers/42");
    const callArgs = mockFetch.mock.calls[0][1];
    expect(callArgs.method).toBe("PUT");
  });
});

// ---------------------------------------------------------------------------
// Convenience methods: bookings
// ---------------------------------------------------------------------------
describe("listBookings", () => {
  it("calls correct endpoint", async () => {
    // WHO: squareSync.ts pullSquareBookings() calling squareClient.listBookings()
    // WHAT: GET /bookings with limit=100 query param
    // WHEN: full sync pulls all Square bookings to merge with local appointments
    // WHERE: src/services/squareClient.ts listBookings()
    // WHY: if the endpoint regressed to /appointments or wrong path, sync would get 404s and never pull booking data
    setSquareEnv();
    const response = { bookings: [], cursor: undefined };
    mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => response });

    const result = await listBookings("my-token");

    expect(result).toEqual(response);
    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain("/bookings");
    expect(calledUrl).toContain("limit=100");
  });

  it("passes cursor param for pagination", async () => {
    // WHO: squareSync.ts pullSquareBookings() calling squareClient.listBookings() with cursor
    // WHAT: GET /bookings with cursor query param for fetching next page
    // WHEN: Square has more than 100 bookings and sync needs subsequent pages
    // WHERE: src/services/squareClient.ts listBookings()
    // WHY: without cursor support, sync would only fetch the first page of bookings, silently dropping all older appointments
    setSquareEnv();
    mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ bookings: [] }) });

    await listBookings("my-token", "cursor-xyz");

    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain("cursor=cursor-xyz");
  });
});

describe("createBooking", () => {
  it("POSTs to bookings endpoint with booking data", async () => {
    // WHO: squareSync.ts pushSquareBooking() calling squareClient.createBooking()
    // WHAT: POST /bookings with nested booking object containing start_at, customer_id, location_id, and appointment_segments
    // WHEN: a new local appointment needs to be pushed to Square during bidirectional sync
    // WHERE: src/services/squareClient.ts createBooking()
    // WHY: Square expects the booking data nested inside a { booking: {...} } wrapper — without this structure, the API returns 400 and the appointment never syncs
    setSquareEnv();
    const created = { booking: { id: "b1", start_at: "2026-04-01T10:00:00Z" } };
    mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => created });

    const result = await createBooking("my-token", {
      start_at: "2026-04-01T10:00:00Z",
      customer_id: "c1",
      location_id: "loc1",
      appointment_segments: [{ duration_minutes: 60 }],
    });

    expect(result).toEqual(created);
    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain("/bookings");
    const callArgs = mockFetch.mock.calls[0][1];
    expect(callArgs.method).toBe("POST");
    const body = JSON.parse(callArgs.body);
    expect(body.booking.start_at).toBe("2026-04-01T10:00:00Z");
    expect(body.booking.customer_id).toBe("c1");
  });
});

describe("updateBooking", () => {
  it("PUTs to bookings endpoint with booking ID", async () => {
    // WHO: squareSync.ts pushSquareBooking() calling squareClient.updateBooking()
    // WHAT: PUT /bookings/{id} with updated booking fields
    // WHEN: local appointment was rescheduled and needs to sync to Square
    // WHERE: src/services/squareClient.ts updateBooking()
    // WHY: if the method was POST instead of PUT, Square would create a duplicate booking instead of updating the existing one
    setSquareEnv();
    const updated = { booking: { id: "b1", start_at: "2026-04-01T11:00:00Z" } };
    mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => updated });

    const result = await updateBooking("my-token", "b1", { start_at: "2026-04-01T11:00:00Z" });

    expect(result).toEqual(updated);
    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain("/bookings/b1");
    const callArgs = mockFetch.mock.calls[0][1];
    expect(callArgs.method).toBe("PUT");
  });
});

describe("cancelBooking", () => {
  it("POSTs to bookings cancel endpoint", async () => {
    // WHO: squareSync.ts calling squareClient.cancelBooking()
    // WHAT: POST /bookings/{id}/cancel to cancel a booking in Square
    // WHEN: local appointment is cancelled and needs to reflect in Square
    // WHERE: src/services/squareClient.ts cancelBooking()
    // WHY: Square uses POST to /cancel instead of DELETE — using the wrong method would return 405 and leave the Square booking active, causing a scheduling conflict
    setSquareEnv();
    const canceled = { booking: { id: "b1", status: "CANCELLED_BY_SELLER" } };
    mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => canceled });

    const result = await cancelBooking("my-token", "b1");

    expect(result).toEqual(canceled);
    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain("/bookings/b1/cancel");
    const callArgs = mockFetch.mock.calls[0][1];
    expect(callArgs.method).toBe("POST");
  });
});
