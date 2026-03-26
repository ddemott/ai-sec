import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import jwt from "jsonwebtoken";
import crypto from "crypto";

// --- Mock global fetch before importing the module under test ---
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

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
} from "./services/hubspotClient";

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

function setHubSpotEnv() {
  process.env.HUBSPOT_CLIENT_ID = "test-client-id";
  process.env.HUBSPOT_CLIENT_SECRET = "test-client-secret";
  process.env.HUBSPOT_CALLBACK_URL = "http://localhost:3000/calendar/auth/hubspot/callback";
  process.env.JWT_SECRET = JWT_SECRET;
}

// ---------------------------------------------------------------------------
// isHubSpotEnabled
// ---------------------------------------------------------------------------
describe("isHubSpotEnabled", () => {
  it("returns true when all env vars are set", () => {
    setHubSpotEnv();
    expect(isHubSpotEnabled()).toBe(true);
  });

  it("returns false when HUBSPOT_CLIENT_ID is missing", () => {
    setHubSpotEnv();
    delete process.env.HUBSPOT_CLIENT_ID;
    expect(isHubSpotEnabled()).toBe(false);
  });

  it("returns false when HUBSPOT_CLIENT_SECRET is missing", () => {
    setHubSpotEnv();
    delete process.env.HUBSPOT_CLIENT_SECRET;
    expect(isHubSpotEnabled()).toBe(false);
  });

  it("returns false when HUBSPOT_CALLBACK_URL is missing", () => {
    setHubSpotEnv();
    delete process.env.HUBSPOT_CALLBACK_URL;
    expect(isHubSpotEnabled()).toBe(false);
  });

  it("returns false when all HubSpot env vars are missing", () => {
    delete process.env.HUBSPOT_CLIENT_ID;
    delete process.env.HUBSPOT_CLIENT_SECRET;
    delete process.env.HUBSPOT_CALLBACK_URL;
    expect(isHubSpotEnabled()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getAuthUrl
// ---------------------------------------------------------------------------
describe("getAuthUrl", () => {
  it("returns a URL string when configured", () => {
    setHubSpotEnv();
    const url = getAuthUrl(TENANT_ID);
    expect(url).not.toBeNull();
    expect(url).toContain("app.hubspot.com");
  });

  it("includes correct query params", () => {
    setHubSpotEnv();
    const url = getAuthUrl(TENANT_ID)!;
    const parsed = new URL(url);
    expect(parsed.searchParams.get("client_id")).toBe("test-client-id");
    expect(parsed.searchParams.get("response_type")).toBe("code");
    expect(parsed.searchParams.get("redirect_uri")).toBe(
      "http://localhost:3000/calendar/auth/hubspot/callback"
    );
    expect(parsed.searchParams.get("scope")).toContain("crm.objects.contacts.read");
    expect(parsed.searchParams.get("scope")).toContain("crm.objects.contacts.write");
    expect(parsed.searchParams.get("scope")).toContain("crm.objects.meetings.read");
    expect(parsed.searchParams.get("scope")).toContain("crm.objects.meetings.write");
  });

  it("includes a signed JWT state param with tenantId and purpose", () => {
    setHubSpotEnv();
    const url = getAuthUrl(TENANT_ID)!;
    const parsed = new URL(url);
    const state = parsed.searchParams.get("state")!;
    const decoded = jwt.verify(state, JWT_SECRET) as any;
    expect(decoded.tenantId).toBe(TENANT_ID);
    expect(decoded.purpose).toBe("hubspot-oauth");
  });

  it("returns null when HubSpot is not configured", () => {
    delete process.env.HUBSPOT_CLIENT_ID;
    delete process.env.HUBSPOT_CLIENT_SECRET;
    delete process.env.HUBSPOT_CALLBACK_URL;
    expect(getAuthUrl(TENANT_ID)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// verifyState
// ---------------------------------------------------------------------------
describe("verifyState", () => {
  it("returns tenantId for a valid state JWT", () => {
    setHubSpotEnv();
    const state = jwt.sign(
      { tenantId: TENANT_ID, purpose: "hubspot-oauth" },
      JWT_SECRET,
      { expiresIn: "10m" }
    );
    expect(verifyState(state)).toBe(TENANT_ID);
  });

  it("returns null for an expired state JWT", () => {
    setHubSpotEnv();
    const state = jwt.sign(
      { tenantId: TENANT_ID, purpose: "hubspot-oauth" },
      JWT_SECRET,
      { expiresIn: "-1s" }
    );
    expect(verifyState(state)).toBeNull();
  });

  it("returns null when purpose doesn't match", () => {
    setHubSpotEnv();
    const state = jwt.sign(
      { tenantId: TENANT_ID, purpose: "wrong-purpose" },
      JWT_SECRET,
      { expiresIn: "10m" }
    );
    expect(verifyState(state)).toBeNull();
  });

  it("returns null for a completely invalid token", () => {
    setHubSpotEnv();
    expect(verifyState("not-a-jwt")).toBeNull();
  });

  it("returns null for a token signed with a different secret", () => {
    setHubSpotEnv();
    const state = jwt.sign(
      { tenantId: TENANT_ID, purpose: "hubspot-oauth" },
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
  it("returns token set on success (30 min expiry)", async () => {
    setHubSpotEnv();
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: "access-123",
        refresh_token: "refresh-456",
        expires_in: 1800,
      }),
    });

    const before = Date.now();
    const tokens = await exchangeCodeForTokens("auth-code-789");

    expect(tokens.access_token).toBe("access-123");
    expect(tokens.refresh_token).toBe("refresh-456");
    expect(tokens.expiry_date).toBeGreaterThanOrEqual(before + 1800 * 1000);

    // Verify fetch was called with correct URL
    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.hubapi.com/oauth/v1/token",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("defaults to 1800s expiry when expires_in is missing", async () => {
    setHubSpotEnv();
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: "access-123",
        refresh_token: "refresh-456",
      }),
    });

    const before = Date.now();
    const tokens = await exchangeCodeForTokens("auth-code");

    // Should default to 1800 seconds (30 min)
    expect(tokens.expiry_date).toBeGreaterThanOrEqual(before + 1800 * 1000);
    expect(tokens.expiry_date).toBeLessThanOrEqual(Date.now() + 1800 * 1000 + 1000);
  });

  it("throws when access_token is missing", async () => {
    setHubSpotEnv();
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: null, refresh_token: "refresh-456" }),
    });

    await expect(exchangeCodeForTokens("auth-code")).rejects.toThrow(
      "incomplete tokens"
    );
  });

  it("throws when refresh_token is missing", async () => {
    setHubSpotEnv();
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: "access-123", refresh_token: null }),
    });

    await expect(exchangeCodeForTokens("auth-code")).rejects.toThrow(
      "incomplete tokens"
    );
  });

  it("throws when HTTP response is not ok", async () => {
    setHubSpotEnv();
    mockFetch.mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => "Bad Request",
    });

    await expect(exchangeCodeForTokens("auth-code")).rejects.toThrow(
      "HubSpot OAuth code exchange failed"
    );
  });

  it("throws on network error", async () => {
    setHubSpotEnv();
    mockFetch.mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(exchangeCodeForTokens("auth-code")).rejects.toThrow(
      "network error"
    );
  });

  it("throws when HubSpot is not configured", async () => {
    delete process.env.HUBSPOT_CLIENT_ID;
    delete process.env.HUBSPOT_CLIENT_SECRET;
    delete process.env.HUBSPOT_CALLBACK_URL;

    await expect(exchangeCodeForTokens("auth-code")).rejects.toThrow(
      "HubSpot not configured"
    );
  });
});

// ---------------------------------------------------------------------------
// refreshAccessToken
// ---------------------------------------------------------------------------
describe("refreshAccessToken", () => {
  it("returns refreshed credentials on success", async () => {
    setHubSpotEnv();
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: "new-access-token",
        expires_in: 1800,
      }),
    });

    const before = Date.now();
    const result = await refreshAccessToken("old-refresh-token");

    expect(result.access_token).toBe("new-access-token");
    expect(result.expiry_date).toBeGreaterThanOrEqual(before + 1800 * 1000);
  });

  it("throws when HTTP response is not ok", async () => {
    setHubSpotEnv();
    mockFetch.mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => "Unauthorized",
    });

    await expect(refreshAccessToken("old-refresh-token")).rejects.toThrow(
      "HubSpot token refresh failed"
    );
  });

  it("throws when access_token is missing from response", async () => {
    setHubSpotEnv();
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: null }),
    });

    await expect(refreshAccessToken("old-refresh-token")).rejects.toThrow(
      "HubSpot token refresh returned no access_token"
    );
  });

  it("throws on network error", async () => {
    setHubSpotEnv();
    mockFetch.mockRejectedValue(new Error("ETIMEDOUT"));

    await expect(refreshAccessToken("old-refresh-token")).rejects.toThrow(
      "network error"
    );
  });

  it("throws when HubSpot is not configured", async () => {
    delete process.env.HUBSPOT_CLIENT_ID;
    delete process.env.HUBSPOT_CLIENT_SECRET;
    delete process.env.HUBSPOT_CALLBACK_URL;

    await expect(refreshAccessToken("old-refresh-token")).rejects.toThrow(
      "HubSpot not configured"
    );
  });
});

// ---------------------------------------------------------------------------
// apiRequest
// ---------------------------------------------------------------------------
describe("apiRequest", () => {
  it("sends correct method, path, and auth header", async () => {
    setHubSpotEnv();
    const responseData = { id: "123", properties: { firstname: "Dale" } };
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => responseData,
    });

    const result = await apiRequest("GET", "/crm/v3/objects/contacts/123", "my-token");

    expect(result).toEqual(responseData);
    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.hubapi.com/crm/v3/objects/contacts/123",
      expect.objectContaining({
        method: "GET",
        headers: {
          Authorization: "Bearer my-token",
          "Content-Type": "application/json",
        },
      })
    );
  });

  it("sends JSON body for POST requests", async () => {
    setHubSpotEnv();
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: "456" }),
    });

    await apiRequest("POST", "/crm/v3/objects/contacts", "my-token", {
      properties: { firstname: "Test" },
    });

    const callArgs = mockFetch.mock.calls[0][1];
    expect(JSON.parse(callArgs.body)).toEqual({
      properties: { firstname: "Test" },
    });
  });

  it("returns null for 204 responses", async () => {
    setHubSpotEnv();
    mockFetch.mockResolvedValue({
      ok: true,
      status: 204,
    });

    const result = await apiRequest("DELETE", "/crm/v3/objects/contacts/123", "my-token");
    expect(result).toBeNull();
  });

  it("throws when HTTP response is not ok", async () => {
    setHubSpotEnv();
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => "Internal Server Error",
    });

    await expect(
      apiRequest("GET", "/crm/v3/objects/contacts", "my-token")
    ).rejects.toThrow("HubSpot API GET /crm/v3/objects/contacts failed (500)");
  });

  it("throws on network error", async () => {
    setHubSpotEnv();
    mockFetch.mockRejectedValue(new Error("ECONNRESET"));

    await expect(
      apiRequest("GET", "/crm/v3/objects/contacts", "my-token")
    ).rejects.toThrow("network error");
  });
});

// ---------------------------------------------------------------------------
// verifyWebhookSignature (v3: method + uri + body + timestamp HMAC-SHA256 base64)
// ---------------------------------------------------------------------------
describe("verifyWebhookSignature", () => {
  const secret = "hubspot-webhook-secret-123";
  const method = "POST";
  const uri = "https://example.com/webhook/hubspot";
  const body = '{"eventType":"contact.creation","objectId":"123"}';
  const timestamp = "1711234567";

  function computeSignatureV3(
    m: string,
    u: string,
    b: string,
    ts: string,
    s: string
  ): string {
    const sourceString = m + u + b + ts;
    return crypto.createHmac("sha256", s).update(sourceString, "utf8").digest("base64");
  }

  it("returns true for valid signature", () => {
    const signature = computeSignatureV3(method, uri, body, timestamp, secret);
    expect(
      verifyWebhookSignature(method, uri, body, timestamp, signature, secret)
    ).toBe(true);
  });

  it("returns false for invalid signature (tampered body)", () => {
    const signature = computeSignatureV3(method, uri, "tampered", timestamp, secret);
    expect(
      verifyWebhookSignature(method, uri, body, timestamp, signature, secret)
    ).toBe(false);
  });

  it("returns false for signature computed with wrong secret", () => {
    const signature = computeSignatureV3(method, uri, body, timestamp, "wrong-secret");
    expect(
      verifyWebhookSignature(method, uri, body, timestamp, signature, secret)
    ).toBe(false);
  });

  it("returns false for completely invalid signature", () => {
    expect(
      verifyWebhookSignature(method, uri, body, timestamp, "not-valid", secret)
    ).toBe(false);
  });

  it("returns false for different length signature (timingSafeEqual catch)", () => {
    expect(
      verifyWebhookSignature(method, uri, body, timestamp, "", secret)
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Convenience methods: contacts
// ---------------------------------------------------------------------------
describe("listContacts", () => {
  it("calls correct endpoint with properties", async () => {
    setHubSpotEnv();
    const response = { results: [], paging: undefined };
    mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => response });

    const result = await listContacts("my-token");

    expect(result).toEqual(response);
    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain("/crm/v3/objects/contacts");
    expect(calledUrl).toContain("limit=100");
    expect(calledUrl).toContain("firstname");
    expect(calledUrl).toContain("email");
  });

  it("passes after param for pagination", async () => {
    setHubSpotEnv();
    mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ results: [] }) });

    await listContacts("my-token", "cursor-abc");

    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain("after=cursor-abc");
  });
});

describe("getContact", () => {
  it("calls correct endpoint with contact ID and properties", async () => {
    setHubSpotEnv();
    const contact = { id: "42", properties: { firstname: "Dale" } };
    mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => contact });

    const result = await getContact("my-token", "42");

    expect(result).toEqual(contact);
    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain("/crm/v3/objects/contacts/42");
    expect(calledUrl).toContain("firstname");
  });
});

describe("createContact", () => {
  it("POSTs to contacts endpoint with properties", async () => {
    setHubSpotEnv();
    const created = { id: "99", properties: { firstname: "New" } };
    mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => created });

    const result = await createContact("my-token", { firstname: "New", email: "new@test.com" });

    expect(result).toEqual(created);
    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain("/crm/v3/objects/contacts");
    const callArgs = mockFetch.mock.calls[0][1];
    expect(callArgs.method).toBe("POST");
    expect(JSON.parse(callArgs.body)).toEqual({
      properties: { firstname: "New", email: "new@test.com" },
    });
  });
});

describe("updateContact", () => {
  it("PATCHes to contacts endpoint with contact ID", async () => {
    setHubSpotEnv();
    const updated = { id: "42", properties: { firstname: "Updated" } };
    mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => updated });

    const result = await updateContact("my-token", "42", { firstname: "Updated" });

    expect(result).toEqual(updated);
    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain("/crm/v3/objects/contacts/42");
    const callArgs = mockFetch.mock.calls[0][1];
    expect(callArgs.method).toBe("PATCH");
  });
});

// ---------------------------------------------------------------------------
// Convenience methods: meetings
// ---------------------------------------------------------------------------
describe("createMeeting", () => {
  it("POSTs to meetings endpoint with properties", async () => {
    setHubSpotEnv();
    const created = { id: "m1", properties: { hs_meeting_title: "Tire Change" } };
    mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => created });

    const result = await createMeeting("my-token", {
      hs_meeting_title: "Tire Change",
      hs_meeting_start_time: "2026-04-01T10:00:00Z",
    });

    expect(result).toEqual(created);
    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain("/crm/v3/objects/meetings");
    const callArgs = mockFetch.mock.calls[0][1];
    expect(callArgs.method).toBe("POST");
  });
});

describe("updateMeeting", () => {
  it("PATCHes to meetings endpoint with meeting ID", async () => {
    setHubSpotEnv();
    const updated = { id: "m1", properties: { hs_meeting_title: "Updated" } };
    mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => updated });

    const result = await updateMeeting("my-token", "m1", { hs_meeting_title: "Updated" });

    expect(result).toEqual(updated);
    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain("/crm/v3/objects/meetings/m1");
    const callArgs = mockFetch.mock.calls[0][1];
    expect(callArgs.method).toBe("PATCH");
  });
});

describe("associateMeetingToContact", () => {
  it("PUTs to v4 associations endpoint with correct IDs", async () => {
    setHubSpotEnv();
    mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });

    await associateMeetingToContact("my-token", "m1", "c1");

    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain("/crm/v4/objects/meetings/m1/associations/contacts/c1");
    const callArgs = mockFetch.mock.calls[0][1];
    expect(callArgs.method).toBe("PUT");
    const body = JSON.parse(callArgs.body);
    expect(body).toEqual([
      { associationCategory: "HUBSPOT_DEFINED", associationTypeId: 200 },
    ]);
  });
});
