import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import jwt from "jsonwebtoken";

// --- Mock global fetch before importing the module under test ---
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import {
  isServiceTitanEnabled,
  getAuthUrl,
  verifyState,
  exchangeCodeForTokens,
  refreshAccessToken,
  apiRequest,
  listCustomers,
  getCustomer,
  createCustomer,
  updateCustomer,
  listJobs,
  createJob,
  updateJob,
  cancelJob,
} from "./services/servicetitanClient";

const JWT_SECRET = "test-jwt-secret";
const TENANT_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const TENANT_SID = "123456789";
const APP_KEY = "test-app-key";

const originalEnv = process.env;

beforeEach(() => {
  process.env = { ...originalEnv };
  vi.clearAllMocks();
});

afterAll(() => {
  process.env = originalEnv;
});

function setServiceTitanEnv() {
  process.env.SERVICETITAN_CLIENT_ID = "test-client-id";
  process.env.SERVICETITAN_CLIENT_SECRET = "test-client-secret";
  process.env.SERVICETITAN_CALLBACK_URL = "http://localhost:3000/servicetitan/auth/callback";
  process.env.SERVICETITAN_APP_KEY = APP_KEY;
  process.env.JWT_SECRET = JWT_SECRET;
}

// ---------------------------------------------------------------------------
// isServiceTitanEnabled
// ---------------------------------------------------------------------------
describe("isServiceTitanEnabled", () => {
  it("returns true when all env vars are set", () => {
    setServiceTitanEnv();
    expect(isServiceTitanEnabled()).toBe(true);
  });

  it("returns false when SERVICETITAN_CLIENT_ID is missing", () => {
    setServiceTitanEnv();
    delete process.env.SERVICETITAN_CLIENT_ID;
    expect(isServiceTitanEnabled()).toBe(false);
  });

  it("returns false when SERVICETITAN_CLIENT_SECRET is missing", () => {
    setServiceTitanEnv();
    delete process.env.SERVICETITAN_CLIENT_SECRET;
    expect(isServiceTitanEnabled()).toBe(false);
  });

  it("returns false when SERVICETITAN_CALLBACK_URL is missing", () => {
    setServiceTitanEnv();
    delete process.env.SERVICETITAN_CALLBACK_URL;
    expect(isServiceTitanEnabled()).toBe(false);
  });

  it("returns false when SERVICETITAN_APP_KEY is missing", () => {
    setServiceTitanEnv();
    delete process.env.SERVICETITAN_APP_KEY;
    expect(isServiceTitanEnabled()).toBe(false);
  });

  it("returns false when all ServiceTitan env vars are missing", () => {
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
describe("getAuthUrl", () => {
  it("returns a URL string when configured", () => {
    setServiceTitanEnv();
    const url = getAuthUrl(TENANT_ID);
    expect(url).not.toBeNull();
    expect(url).toContain("auth.servicetitan.io");
  });

  it("includes correct query params", () => {
    setServiceTitanEnv();
    const url = getAuthUrl(TENANT_ID)!;
    const parsed = new URL(url);
    expect(parsed.searchParams.get("client_id")).toBe("test-client-id");
    expect(parsed.searchParams.get("response_type")).toBe("code");
    expect(parsed.searchParams.get("redirect_uri")).toBe(
      "http://localhost:3000/servicetitan/auth/callback"
    );
    expect(parsed.searchParams.get("scope")).toContain("customers");
    expect(parsed.searchParams.get("scope")).toContain("jobs");
  });

  it("includes a signed JWT state param with tenantId and purpose", () => {
    setServiceTitanEnv();
    const url = getAuthUrl(TENANT_ID)!;
    const parsed = new URL(url);
    const state = parsed.searchParams.get("state")!;
    const decoded = jwt.verify(state, JWT_SECRET) as any;
    expect(decoded.tenantId).toBe(TENANT_ID);
    expect(decoded.purpose).toBe("servicetitan-oauth");
  });

  it("returns null when ServiceTitan is not configured", () => {
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
describe("verifyState", () => {
  it("returns tenantId for a valid state JWT", () => {
    setServiceTitanEnv();
    const state = jwt.sign(
      { tenantId: TENANT_ID, purpose: "servicetitan-oauth" },
      JWT_SECRET,
      { expiresIn: "10m" }
    );
    expect(verifyState(state)).toBe(TENANT_ID);
  });

  it("returns null for an expired state JWT", () => {
    setServiceTitanEnv();
    const state = jwt.sign(
      { tenantId: TENANT_ID, purpose: "servicetitan-oauth" },
      JWT_SECRET,
      { expiresIn: "-1s" }
    );
    expect(verifyState(state)).toBeNull();
  });

  it("returns null when purpose doesn't match", () => {
    setServiceTitanEnv();
    const state = jwt.sign(
      { tenantId: TENANT_ID, purpose: "wrong-purpose" },
      JWT_SECRET,
      { expiresIn: "10m" }
    );
    expect(verifyState(state)).toBeNull();
  });

  it("returns null for a completely invalid token", () => {
    setServiceTitanEnv();
    expect(verifyState("not-a-jwt")).toBeNull();
  });

  it("returns null for a token signed with a different secret", () => {
    setServiceTitanEnv();
    const state = jwt.sign(
      { tenantId: TENANT_ID, purpose: "servicetitan-oauth" },
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
  it("returns token set on success", async () => {
    setServiceTitanEnv();
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: "access-123",
        refresh_token: "refresh-456",
        expires_in: 3600,
      }),
    });

    const before = Date.now();
    const tokens = await exchangeCodeForTokens("auth-code-789");

    expect(tokens.access_token).toBe("access-123");
    expect(tokens.refresh_token).toBe("refresh-456");
    expect(tokens.expiry_date).toBeGreaterThanOrEqual(before + 3600 * 1000);

    // Verify fetch was called with correct URL
    expect(mockFetch).toHaveBeenCalledWith(
      "https://auth.servicetitan.io/connect/token",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("defaults to 3600s expiry when expires_in is missing", async () => {
    setServiceTitanEnv();
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: "access-123",
        refresh_token: "refresh-456",
      }),
    });

    const before = Date.now();
    const tokens = await exchangeCodeForTokens("auth-code");

    expect(tokens.expiry_date).toBeGreaterThanOrEqual(before + 3600 * 1000);
    expect(tokens.expiry_date).toBeLessThanOrEqual(Date.now() + 3600 * 1000 + 1000);
  });

  it("throws when access_token is missing", async () => {
    setServiceTitanEnv();
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: null, refresh_token: "refresh-456" }),
    });

    await expect(exchangeCodeForTokens("auth-code")).rejects.toThrow(
      "incomplete tokens"
    );
  });

  it("throws when refresh_token is missing", async () => {
    setServiceTitanEnv();
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: "access-123", refresh_token: null }),
    });

    await expect(exchangeCodeForTokens("auth-code")).rejects.toThrow(
      "incomplete tokens"
    );
  });

  it("throws when HTTP response is not ok", async () => {
    setServiceTitanEnv();
    mockFetch.mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => "Bad Request",
    });

    await expect(exchangeCodeForTokens("auth-code")).rejects.toThrow(
      "ServiceTitan OAuth code exchange failed"
    );
  });

  it("throws on network error", async () => {
    setServiceTitanEnv();
    mockFetch.mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(exchangeCodeForTokens("auth-code")).rejects.toThrow(
      "network error"
    );
  });

  it("throws when ServiceTitan is not configured", async () => {
    delete process.env.SERVICETITAN_CLIENT_ID;
    delete process.env.SERVICETITAN_CLIENT_SECRET;
    delete process.env.SERVICETITAN_CALLBACK_URL;
    delete process.env.SERVICETITAN_APP_KEY;

    await expect(exchangeCodeForTokens("auth-code")).rejects.toThrow(
      "ServiceTitan not configured"
    );
  });
});

// ---------------------------------------------------------------------------
// refreshAccessToken
// ---------------------------------------------------------------------------
describe("refreshAccessToken", () => {
  it("returns refreshed credentials on success", async () => {
    setServiceTitanEnv();
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: "new-access-token",
        expires_in: 3600,
      }),
    });

    const before = Date.now();
    const result = await refreshAccessToken("old-refresh-token");

    expect(result.access_token).toBe("new-access-token");
    expect(result.expiry_date).toBeGreaterThanOrEqual(before + 3600 * 1000);
  });

  it("throws when HTTP response is not ok", async () => {
    setServiceTitanEnv();
    mockFetch.mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => "Unauthorized",
    });

    await expect(refreshAccessToken("old-refresh-token")).rejects.toThrow(
      "ServiceTitan token refresh failed"
    );
  });

  it("throws when access_token is missing from response", async () => {
    setServiceTitanEnv();
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: null }),
    });

    await expect(refreshAccessToken("old-refresh-token")).rejects.toThrow(
      "ServiceTitan token refresh returned no access_token"
    );
  });

  it("throws on network error", async () => {
    setServiceTitanEnv();
    mockFetch.mockRejectedValue(new Error("ETIMEDOUT"));

    await expect(refreshAccessToken("old-refresh-token")).rejects.toThrow(
      "network error"
    );
  });

  it("throws when ServiceTitan is not configured", async () => {
    delete process.env.SERVICETITAN_CLIENT_ID;
    delete process.env.SERVICETITAN_CLIENT_SECRET;
    delete process.env.SERVICETITAN_CALLBACK_URL;
    delete process.env.SERVICETITAN_APP_KEY;

    await expect(refreshAccessToken("old-refresh-token")).rejects.toThrow(
      "ServiceTitan not configured"
    );
  });
});

// ---------------------------------------------------------------------------
// apiRequest
// ---------------------------------------------------------------------------
describe("apiRequest", () => {
  it("sends correct method, path, auth header, and ST-App-Key", async () => {
    setServiceTitanEnv();
    const responseData = { id: 123, name: "Dale" };
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => responseData,
    });

    const result = await apiRequest("GET", "/crm/v2/tenant/123/customers/456", "my-token", APP_KEY);

    expect(result).toEqual(responseData);
    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.servicetitan.io/crm/v2/tenant/123/customers/456",
      expect.objectContaining({
        method: "GET",
        headers: {
          Authorization: "Bearer my-token",
          "ST-App-Key": APP_KEY,
          "Content-Type": "application/json",
        },
      })
    );
  });

  it("sends JSON body for POST requests", async () => {
    setServiceTitanEnv();
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: 456 }),
    });

    await apiRequest("POST", "/crm/v2/tenant/123/customers", "my-token", APP_KEY, {
      name: "Test Customer",
    });

    const callArgs = mockFetch.mock.calls[0][1];
    expect(JSON.parse(callArgs.body)).toEqual({
      name: "Test Customer",
    });
  });

  it("sends JSON body for PATCH requests", async () => {
    setServiceTitanEnv();
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: 456 }),
    });

    await apiRequest("PATCH", "/crm/v2/tenant/123/customers/456", "my-token", APP_KEY, {
      name: "Updated",
    });

    const callArgs = mockFetch.mock.calls[0][1];
    expect(callArgs.method).toBe("PATCH");
    expect(JSON.parse(callArgs.body)).toEqual({ name: "Updated" });
  });

  it("returns null for 204 responses", async () => {
    setServiceTitanEnv();
    mockFetch.mockResolvedValue({
      ok: true,
      status: 204,
    });

    const result = await apiRequest("DELETE", "/crm/v2/tenant/123/customers/456", "my-token", APP_KEY);
    expect(result).toBeNull();
  });

  it("throws when HTTP response is not ok (401)", async () => {
    setServiceTitanEnv();
    mockFetch.mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => "Unauthorized",
    });

    await expect(
      apiRequest("GET", "/crm/v2/tenant/123/customers", "my-token", APP_KEY)
    ).rejects.toThrow("ServiceTitan API GET /crm/v2/tenant/123/customers failed (401)");
  });

  it("throws when HTTP response is not ok (429)", async () => {
    setServiceTitanEnv();
    mockFetch.mockResolvedValue({
      ok: false,
      status: 429,
      text: async () => "Rate limit exceeded",
    });

    await expect(
      apiRequest("GET", "/crm/v2/tenant/123/customers", "my-token", APP_KEY)
    ).rejects.toThrow("ServiceTitan API GET /crm/v2/tenant/123/customers failed (429)");
  });

  it("throws when HTTP response is not ok (500)", async () => {
    setServiceTitanEnv();
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => "Internal Server Error",
    });

    await expect(
      apiRequest("GET", "/crm/v2/tenant/123/customers", "my-token", APP_KEY)
    ).rejects.toThrow("ServiceTitan API GET /crm/v2/tenant/123/customers failed (500)");
  });

  it("throws on network error", async () => {
    setServiceTitanEnv();
    mockFetch.mockRejectedValue(new Error("ECONNRESET"));

    await expect(
      apiRequest("GET", "/crm/v2/tenant/123/customers", "my-token", APP_KEY)
    ).rejects.toThrow("network error");
  });
});

// ---------------------------------------------------------------------------
// Convenience methods: customers
// ---------------------------------------------------------------------------
describe("listCustomers", () => {
  it("calls correct endpoint with pageSize", async () => {
    setServiceTitanEnv();
    const response = { data: [], page: 1, pageSize: 100, totalCount: 0, hasMore: false };
    mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => response });

    const result = await listCustomers("my-token", APP_KEY, TENANT_SID);

    expect(result).toEqual(response);
    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain(`/crm/v2/tenant/${TENANT_SID}/customers`);
    expect(calledUrl).toContain("pageSize=100");
  });

  it("passes page param for pagination", async () => {
    setServiceTitanEnv();
    const response = { data: [{ id: 1, name: "Test" }], page: 2, pageSize: 100, totalCount: 150, hasMore: false };
    mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => response });

    await listCustomers("my-token", APP_KEY, TENANT_SID, 2);

    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain("page=2");
  });
});

describe("createCustomer", () => {
  it("POSTs to customers endpoint with payload", async () => {
    setServiceTitanEnv();
    const created = { id: 99, name: "New Customer", phoneNumber: "555-1234" };
    mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => created });

    const result = await createCustomer("my-token", APP_KEY, TENANT_SID, {
      name: "New Customer",
      phoneNumber: "555-1234",
    });

    expect(result).toEqual(created);
    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain(`/crm/v2/tenant/${TENANT_SID}/customers`);
    const callArgs = mockFetch.mock.calls[0][1];
    expect(callArgs.method).toBe("POST");
    expect(JSON.parse(callArgs.body)).toEqual({
      name: "New Customer",
      phoneNumber: "555-1234",
    });
  });
});

describe("updateCustomer", () => {
  it("PATCHes to customers endpoint with customer ID", async () => {
    setServiceTitanEnv();
    const updated = { id: 42, name: "Updated Customer" };
    mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => updated });

    const result = await updateCustomer("my-token", APP_KEY, TENANT_SID, "42", {
      name: "Updated Customer",
    });

    expect(result).toEqual(updated);
    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain(`/crm/v2/tenant/${TENANT_SID}/customers/42`);
    const callArgs = mockFetch.mock.calls[0][1];
    expect(callArgs.method).toBe("PATCH");
  });
});

// ---------------------------------------------------------------------------
// Convenience methods: jobs
// ---------------------------------------------------------------------------
describe("listJobs", () => {
  it("calls correct endpoint with pageSize", async () => {
    setServiceTitanEnv();
    const response = { data: [], page: 1, pageSize: 100, totalCount: 0, hasMore: false };
    mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => response });

    const result = await listJobs("my-token", APP_KEY, TENANT_SID);

    expect(result).toEqual(response);
    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain(`/jpm/v2/tenant/${TENANT_SID}/jobs`);
    expect(calledUrl).toContain("pageSize=100");
  });

  it("passes page param for pagination", async () => {
    setServiceTitanEnv();
    mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: [], hasMore: false }) });

    await listJobs("my-token", APP_KEY, TENANT_SID, 3);

    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain("page=3");
  });
});

describe("createJob", () => {
  it("POSTs to jobs endpoint with payload", async () => {
    setServiceTitanEnv();
    const created = { id: 100, customerId: 42, summary: "Oil Change" };
    mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => created });

    const result = await createJob("my-token", APP_KEY, TENANT_SID, {
      customerId: 42,
      summary: "Oil Change",
      scheduledDate: "2026-04-01T10:00:00Z",
    });

    expect(result).toEqual(created);
    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain(`/jpm/v2/tenant/${TENANT_SID}/jobs`);
    const callArgs = mockFetch.mock.calls[0][1];
    expect(callArgs.method).toBe("POST");
  });
});

describe("updateJob", () => {
  it("PATCHes to jobs endpoint with job ID", async () => {
    setServiceTitanEnv();
    const updated = { id: 100, summary: "Updated Job" };
    mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => updated });

    const result = await updateJob("my-token", APP_KEY, TENANT_SID, "100", {
      summary: "Updated Job",
    });

    expect(result).toEqual(updated);
    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain(`/jpm/v2/tenant/${TENANT_SID}/jobs/100`);
    const callArgs = mockFetch.mock.calls[0][1];
    expect(callArgs.method).toBe("PATCH");
  });
});

describe("cancelJob", () => {
  it("PATCHes job with status Canceled", async () => {
    setServiceTitanEnv();
    const canceled = { id: 100, status: "Canceled" };
    mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => canceled });

    const result = await cancelJob("my-token", APP_KEY, TENANT_SID, "100");

    expect(result).toEqual(canceled);
    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain(`/jpm/v2/tenant/${TENANT_SID}/jobs/100`);
    const callArgs = mockFetch.mock.calls[0][1];
    expect(callArgs.method).toBe("PATCH");
    expect(JSON.parse(callArgs.body)).toEqual({ status: "Canceled" });
  });
});
