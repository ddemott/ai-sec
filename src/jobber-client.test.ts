import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import jwt from "jsonwebtoken";
import crypto from "crypto";

// --- Mock global fetch before importing the module under test ---
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import {
  isJobberEnabled,
  getAuthUrl,
  verifyState,
  exchangeCodeForTokens,
  refreshAccessToken,
  graphql,
  verifyWebhookSignature,
  QUERIES,
} from "./services/jobberClient";

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

function setJobberEnv() {
  process.env.JOBBER_CLIENT_ID = "test-client-id";
  process.env.JOBBER_CLIENT_SECRET = "test-client-secret";
  process.env.JOBBER_CALLBACK_URL = "http://localhost:3000/calendar/auth/jobber/callback";
  process.env.JWT_SECRET = JWT_SECRET;
}

// ---------------------------------------------------------------------------
// isJobberEnabled
// ---------------------------------------------------------------------------
describe("isJobberEnabled", () => {
  it("returns true when all env vars are set", () => {
    setJobberEnv();
    expect(isJobberEnabled()).toBe(true);
  });

  it("returns false when JOBBER_CLIENT_ID is missing", () => {
    setJobberEnv();
    delete process.env.JOBBER_CLIENT_ID;
    expect(isJobberEnabled()).toBe(false);
  });

  it("returns false when JOBBER_CLIENT_SECRET is missing", () => {
    setJobberEnv();
    delete process.env.JOBBER_CLIENT_SECRET;
    expect(isJobberEnabled()).toBe(false);
  });

  it("returns false when JOBBER_CALLBACK_URL is missing", () => {
    setJobberEnv();
    delete process.env.JOBBER_CALLBACK_URL;
    expect(isJobberEnabled()).toBe(false);
  });

  it("returns false when all Jobber env vars are missing", () => {
    delete process.env.JOBBER_CLIENT_ID;
    delete process.env.JOBBER_CLIENT_SECRET;
    delete process.env.JOBBER_CALLBACK_URL;
    expect(isJobberEnabled()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getAuthUrl
// ---------------------------------------------------------------------------
describe("getAuthUrl", () => {
  it("returns a URL string when configured", () => {
    setJobberEnv();
    const url = getAuthUrl(TENANT_ID);
    expect(url).not.toBeNull();
    expect(url).toContain("api.getjobber.com");
  });

  it("includes correct query params", () => {
    setJobberEnv();
    const url = getAuthUrl(TENANT_ID)!;
    const parsed = new URL(url);
    expect(parsed.searchParams.get("client_id")).toBe("test-client-id");
    expect(parsed.searchParams.get("response_type")).toBe("code");
    expect(parsed.searchParams.get("redirect_uri")).toBe(
      "http://localhost:3000/calendar/auth/jobber/callback"
    );
    expect(parsed.searchParams.get("scope")).toContain("read_clients");
    expect(parsed.searchParams.get("scope")).toContain("write_clients");
    expect(parsed.searchParams.get("scope")).toContain("read_jobs");
    expect(parsed.searchParams.get("scope")).toContain("write_jobs");
    expect(parsed.searchParams.get("scope")).toContain("read_visits");
    expect(parsed.searchParams.get("scope")).toContain("write_visits");
  });

  it("includes a signed JWT state param with tenantId and purpose", () => {
    setJobberEnv();
    const url = getAuthUrl(TENANT_ID)!;
    const parsed = new URL(url);
    const state = parsed.searchParams.get("state")!;
    const decoded = jwt.verify(state, JWT_SECRET) as any;
    expect(decoded.tenantId).toBe(TENANT_ID);
    expect(decoded.purpose).toBe("jobber-oauth");
  });

  it("returns null when Jobber is not configured", () => {
    delete process.env.JOBBER_CLIENT_ID;
    delete process.env.JOBBER_CLIENT_SECRET;
    delete process.env.JOBBER_CALLBACK_URL;
    expect(getAuthUrl(TENANT_ID)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// verifyState
// ---------------------------------------------------------------------------
describe("verifyState", () => {
  it("returns tenantId for a valid state JWT", () => {
    setJobberEnv();
    const state = jwt.sign(
      { tenantId: TENANT_ID, purpose: "jobber-oauth" },
      JWT_SECRET,
      { expiresIn: "10m" }
    );
    expect(verifyState(state)).toBe(TENANT_ID);
  });

  it("returns null for an expired state JWT", () => {
    setJobberEnv();
    const state = jwt.sign(
      { tenantId: TENANT_ID, purpose: "jobber-oauth" },
      JWT_SECRET,
      { expiresIn: "-1s" }
    );
    expect(verifyState(state)).toBeNull();
  });

  it("returns null when purpose doesn't match", () => {
    setJobberEnv();
    const state = jwt.sign(
      { tenantId: TENANT_ID, purpose: "wrong-purpose" },
      JWT_SECRET,
      { expiresIn: "10m" }
    );
    expect(verifyState(state)).toBeNull();
  });

  it("returns null for a completely invalid token", () => {
    setJobberEnv();
    expect(verifyState("not-a-jwt")).toBeNull();
  });

  it("returns null for a token signed with a different secret", () => {
    setJobberEnv();
    const state = jwt.sign(
      { tenantId: TENANT_ID, purpose: "jobber-oauth" },
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
    setJobberEnv();
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
      "https://api.getjobber.com/api/oauth/token",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("throws when access_token is missing", async () => {
    setJobberEnv();
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: null, refresh_token: "refresh-456" }),
    });

    await expect(exchangeCodeForTokens("auth-code")).rejects.toThrow(
      "incomplete tokens"
    );
  });

  it("throws when refresh_token is missing", async () => {
    setJobberEnv();
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: "access-123", refresh_token: null }),
    });

    await expect(exchangeCodeForTokens("auth-code")).rejects.toThrow(
      "incomplete tokens"
    );
  });

  it("throws when HTTP response is not ok", async () => {
    setJobberEnv();
    mockFetch.mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => "Bad Request",
    });

    await expect(exchangeCodeForTokens("auth-code")).rejects.toThrow(
      "Jobber OAuth code exchange failed"
    );
  });

  it("throws on network error", async () => {
    setJobberEnv();
    mockFetch.mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(exchangeCodeForTokens("auth-code")).rejects.toThrow(
      "network error"
    );
  });

  it("throws when Jobber is not configured", async () => {
    delete process.env.JOBBER_CLIENT_ID;
    delete process.env.JOBBER_CLIENT_SECRET;
    delete process.env.JOBBER_CALLBACK_URL;

    await expect(exchangeCodeForTokens("auth-code")).rejects.toThrow(
      "Jobber not configured"
    );
  });
});

// ---------------------------------------------------------------------------
// refreshAccessToken
// ---------------------------------------------------------------------------
describe("refreshAccessToken", () => {
  it("returns refreshed credentials on success", async () => {
    setJobberEnv();
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
    setJobberEnv();
    mockFetch.mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => "Unauthorized",
    });

    await expect(refreshAccessToken("old-refresh-token")).rejects.toThrow(
      "Jobber token refresh failed"
    );
  });

  it("throws when access_token is missing from response", async () => {
    setJobberEnv();
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: null }),
    });

    await expect(refreshAccessToken("old-refresh-token")).rejects.toThrow(
      "Jobber token refresh returned no access_token"
    );
  });

  it("throws on network error", async () => {
    setJobberEnv();
    mockFetch.mockRejectedValue(new Error("ETIMEDOUT"));

    await expect(refreshAccessToken("old-refresh-token")).rejects.toThrow(
      "network error"
    );
  });

  it("throws when Jobber is not configured", async () => {
    delete process.env.JOBBER_CLIENT_ID;
    delete process.env.JOBBER_CLIENT_SECRET;
    delete process.env.JOBBER_CALLBACK_URL;

    await expect(refreshAccessToken("old-refresh-token")).rejects.toThrow(
      "Jobber not configured"
    );
  });
});

// ---------------------------------------------------------------------------
// graphql
// ---------------------------------------------------------------------------
describe("graphql", () => {
  const testQuery = "query { me { id name } }";

  it("sends correct request and returns data", async () => {
    setJobberEnv();
    const responseData = { me: { id: "1", name: "Test User" } };
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ data: responseData }),
    });

    const result = await graphql("my-access-token", testQuery, { foo: "bar" });

    expect(result.data).toEqual(responseData);

    // Verify fetch was called correctly
    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.getjobber.com/api/graphql",
      expect.objectContaining({
        method: "POST",
        headers: {
          Authorization: "Bearer my-access-token",
          "Content-Type": "application/json",
        },
      })
    );

    // Verify request body
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.query).toBe(testQuery);
    expect(body.variables).toEqual({ foo: "bar" });
  });

  it("throws when HTTP response is not ok", async () => {
    setJobberEnv();
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => "Internal Server Error",
    });

    await expect(graphql("token", testQuery)).rejects.toThrow(
      "Jobber GraphQL API error (500)"
    );
  });

  it("throws when response contains GraphQL errors", async () => {
    setJobberEnv();
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: null,
        errors: [
          { message: "Field not found", path: ["me", "unknown"] },
          { message: "Unauthorized access" },
        ],
      }),
    });

    await expect(graphql("token", testQuery)).rejects.toThrow(
      "Jobber GraphQL errors: Field not found; Unauthorized access"
    );
  });

  it("throws on network error", async () => {
    setJobberEnv();
    mockFetch.mockRejectedValue(new Error("ECONNRESET"));

    await expect(graphql("token", testQuery)).rejects.toThrow(
      "network error"
    );
  });
});

// ---------------------------------------------------------------------------
// verifyWebhookSignature
// ---------------------------------------------------------------------------
describe("verifyWebhookSignature", () => {
  const webhookSecret = "whsec_test_secret_123";
  const payload = '{"event":"client.created","data":{"id":"123"}}';

  function computeSignature(body: string, secret: string): string {
    return crypto
      .createHmac("sha256", secret)
      .update(body, "utf8")
      .digest("hex");
  }

  it("returns true for valid signature", () => {
    const signature = computeSignature(payload, webhookSecret);
    expect(verifyWebhookSignature(payload, signature, webhookSecret)).toBe(true);
  });

  it("returns false for invalid signature", () => {
    const badSignature = computeSignature("tampered payload", webhookSecret);
    expect(verifyWebhookSignature(payload, badSignature, webhookSecret)).toBe(false);
  });

  it("returns false for signature computed with wrong secret", () => {
    const wrongSecretSig = computeSignature(payload, "wrong-secret");
    expect(verifyWebhookSignature(payload, wrongSecretSig, webhookSecret)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// QUERIES export
// ---------------------------------------------------------------------------
describe("QUERIES", () => {
  it("exports all expected query keys", () => {
    expect(QUERIES).toHaveProperty("listClients");
    expect(QUERIES).toHaveProperty("getClient");
    expect(QUERIES).toHaveProperty("listVisits");
    expect(QUERIES).toHaveProperty("createClient");
    expect(QUERIES).toHaveProperty("updateClient");
    expect(QUERIES).toHaveProperty("createJob");
  });

  it("queries are non-empty strings", () => {
    for (const [key, value] of Object.entries(QUERIES)) {
      expect(typeof value).toBe("string");
      expect(value.trim().length).toBeGreaterThan(0);
    }
  });
});
