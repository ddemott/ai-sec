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
  process.env.SQUARE_CALLBACK_URL = "http://localhost:3000/square/auth/callback";
  process.env.JWT_SECRET = JWT_SECRET;
}

// ---------------------------------------------------------------------------
// isSquareEnabled
// ---------------------------------------------------------------------------
describe("isSquareEnabled", () => {
  it("returns true when all env vars are set", () => {
    setSquareEnv();
    expect(isSquareEnabled()).toBe(true);
  });

  it("returns false when SQUARE_CLIENT_ID is missing", () => {
    setSquareEnv();
    delete process.env.SQUARE_CLIENT_ID;
    expect(isSquareEnabled()).toBe(false);
  });

  it("returns false when SQUARE_CLIENT_SECRET is missing", () => {
    setSquareEnv();
    delete process.env.SQUARE_CLIENT_SECRET;
    expect(isSquareEnabled()).toBe(false);
  });

  it("returns false when SQUARE_CALLBACK_URL is missing", () => {
    setSquareEnv();
    delete process.env.SQUARE_CALLBACK_URL;
    expect(isSquareEnabled()).toBe(false);
  });

  it("returns false when all Square env vars are missing", () => {
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
    setSquareEnv();
    const url = getAuthUrl(TENANT_ID);
    expect(url).not.toBeNull();
    expect(url).toContain("connect.squareup.com");
  });

  it("includes correct query params", () => {
    setSquareEnv();
    const url = getAuthUrl(TENANT_ID)!;
    const parsed = new URL(url);
    expect(parsed.searchParams.get("client_id")).toBe("test-client-id");
    expect(parsed.searchParams.get("response_type")).toBe("code");
    expect(parsed.searchParams.get("redirect_uri")).toBe(
      "http://localhost:3000/square/auth/callback"
    );
    expect(parsed.searchParams.get("scope")).toContain("CUSTOMERS_READ");
    expect(parsed.searchParams.get("scope")).toContain("CUSTOMERS_WRITE");
    expect(parsed.searchParams.get("scope")).toContain("APPOINTMENTS_READ");
    expect(parsed.searchParams.get("scope")).toContain("APPOINTMENTS_WRITE");
  });

  it("includes a signed JWT state param with tenantId and purpose", () => {
    setSquareEnv();
    const url = getAuthUrl(TENANT_ID)!;
    const parsed = new URL(url);
    const state = parsed.searchParams.get("state")!;
    const decoded = jwt.verify(state, JWT_SECRET) as any;
    expect(decoded.tenantId).toBe(TENANT_ID);
    expect(decoded.purpose).toBe("square-oauth");
  });

  it("returns null when Square is not configured", () => {
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
    setSquareEnv();
    const state = jwt.sign(
      { tenantId: TENANT_ID, purpose: "square-oauth" },
      JWT_SECRET,
      { expiresIn: "10m" }
    );
    expect(verifyState(state)).toBe(TENANT_ID);
  });

  it("returns null for an expired state JWT", () => {
    setSquareEnv();
    const state = jwt.sign(
      { tenantId: TENANT_ID, purpose: "square-oauth" },
      JWT_SECRET,
      { expiresIn: "-1s" }
    );
    expect(verifyState(state)).toBeNull();
  });

  it("returns null when purpose doesn't match", () => {
    setSquareEnv();
    const state = jwt.sign(
      { tenantId: TENANT_ID, purpose: "wrong-purpose" },
      JWT_SECRET,
      { expiresIn: "10m" }
    );
    expect(verifyState(state)).toBeNull();
  });

  it("returns null for a completely invalid token", () => {
    setSquareEnv();
    expect(verifyState("not-a-jwt")).toBeNull();
  });

  it("returns null for a token signed with a different secret", () => {
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
    setSquareEnv();
    mockFetch.mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(exchangeCodeForTokens("auth-code")).rejects.toThrow(
      "network error"
    );
  });

  it("throws when Square is not configured", async () => {
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
    setSquareEnv();
    mockFetch.mockRejectedValue(new Error("ETIMEDOUT"));

    await expect(refreshAccessToken("old-refresh-token")).rejects.toThrow(
      "network error"
    );
  });

  it("throws when Square is not configured", async () => {
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
    setSquareEnv();
    mockFetch.mockResolvedValue({
      ok: true,
      status: 204,
    });

    const result = await apiRequest("DELETE", "/customers/123", "my-token");
    expect(result).toBeNull();
  });

  it("throws when HTTP response is not ok (401)", async () => {
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
    const signature = computeSignature(body, notificationUrl, signatureKey);
    expect(
      verifyWebhookSignature(body, signature, signatureKey, notificationUrl)
    ).toBe(true);
  });

  it("returns false for invalid signature (tampered body)", () => {
    const signature = computeSignature("tampered", notificationUrl, signatureKey);
    expect(
      verifyWebhookSignature(body, signature, signatureKey, notificationUrl)
    ).toBe(false);
  });

  it("returns false for signature computed with wrong key", () => {
    const signature = computeSignature(body, notificationUrl, "wrong-key");
    expect(
      verifyWebhookSignature(body, signature, signatureKey, notificationUrl)
    ).toBe(false);
  });

  it("returns false for completely invalid signature", () => {
    expect(
      verifyWebhookSignature(body, "not-valid", signatureKey, notificationUrl)
    ).toBe(false);
  });

  it("returns false for different length signature (timingSafeEqual catch)", () => {
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
    setSquareEnv();
    mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ customers: [] }) });

    await listCustomers("my-token", "cursor-abc");

    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain("cursor=cursor-abc");
  });
});

describe("getCustomer", () => {
  it("calls correct endpoint with customer ID", async () => {
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
    setSquareEnv();
    mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ bookings: [] }) });

    await listBookings("my-token", "cursor-xyz");

    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain("cursor=cursor-xyz");
  });
});

describe("createBooking", () => {
  it("POSTs to bookings endpoint with booking data", async () => {
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
