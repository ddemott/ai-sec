/**
 * Happy + sad path tests for the OAuth callback factory.
 *
 * Tests cover:
 * - Happy: successful code exchange → token upsert → redirect with ?connected=true
 * - Happy: with extra settings (e.g., ServiceTitan tenant_sid)
 * - Sad: OAuth error param → redirect with error
 * - Sad: missing code or state → redirect with missing_params
 * - Sad: invalid state JWT → redirect with invalid_state
 * - Sad: token exchange failure → redirect with token_exchange_failed
 * - Sad: DB error during upsert → redirect with token_exchange_failed
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createOAuthCallbackHandler } from "./services/oauthCallbackFactory";

// ── Mock helpers ─────────────────────────────────────────────────────

function createMockClient() {
  return {
    query: vi.fn(async () => ({ rows: [], rowCount: 1 })),
    release: vi.fn(),
  };
}

function createMockPool(mockClient: any) {
  return { connect: vi.fn(async () => mockClient) } as any;
}

function createMockApp() {
  return {
    log: {
      info: vi.fn(),
      error: vi.fn(),
    },
  };
}

function createMockReply() {
  const reply = {
    redirectUrl: null as string | null,
    redirect: vi.fn((url: string) => { reply.redirectUrl = url; }),
  };
  return reply;
}

function createMockReq(query: Record<string, string>) {
  return { query };
}

const TENANT_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

const validTokens = {
  access_token: "new-access-token",
  refresh_token: "new-refresh-token",
  expiry_date: Date.now() + 3600_000,
};

beforeEach(() => vi.clearAllMocks());

// ═══════════════════════════════════════════════════════════════════════
// HAPPY PATHS
// ═══════════════════════════════════════════════════════════════════════

describe("createOAuthCallbackHandler — happy paths", () => {
  it("exchanges code for tokens and redirects with ?connected=true", async () => {
    const mockClient = createMockClient();
    const pool = createMockPool(mockClient);
    const app = createMockApp();
    const reply = createMockReply();

    const handler = createOAuthCallbackHandler(pool, app, {
      provider: "jobber",
      verifyState: () => TENANT_ID,
      exchangeCodeForTokens: vi.fn().mockResolvedValue(validTokens),
    });

    await handler(createMockReq({ code: "auth-code", state: "valid-jwt" }), reply);

    // Should redirect to dashboard with success
    expect(reply.redirectUrl).toContain("jobberConnected=true");

    // Should have upserted tokens
    expect(mockClient.query).toHaveBeenCalledOnce();
    const queryText = mockClient.query.mock.calls[0][0];
    expect(queryText).toContain("INSERT INTO tenant_integration_settings");
    expect(queryText).toContain("ON CONFLICT");

    // Should log success
    expect(app.log.info).toHaveBeenCalledWith(
      expect.objectContaining({ event: "jobber_oauth_complete", tenantId: TENANT_ID }),
      "Jobber connected"
    );

    expect(mockClient.release).toHaveBeenCalledOnce();
  });

  it("includes extra settings when buildExtraSettings is provided (e.g., ServiceTitan tenant_sid)", async () => {
    const mockClient = createMockClient();
    const pool = createMockPool(mockClient);
    const app = createMockApp();
    const reply = createMockReply();

    const handler = createOAuthCallbackHandler(pool, app, {
      provider: "servicetitan",
      verifyState: () => TENANT_ID,
      exchangeCodeForTokens: vi.fn().mockResolvedValue(validTokens),
      buildExtraSettings: (query) => ({ tenant_sid: query.tenant_sid }),
    });

    await handler(
      createMockReq({ code: "auth-code", state: "valid-jwt", tenant_sid: "999888" }),
      reply
    );

    expect(reply.redirectUrl).toContain("servicetitanConnected=true");

    // Should use the settings-aware INSERT
    const queryText = mockClient.query.mock.calls[0][0];
    expect(queryText).toContain("settings");
    const queryParams = mockClient.query.mock.calls[0][1];
    expect(queryParams).toContain(JSON.stringify({ tenant_sid: "999888" }));
  });

  it("works for all provider names (hubspot, square)", async () => {
    for (const provider of ["hubspot", "square"]) {
      const mockClient = createMockClient();
      const pool = createMockPool(mockClient);
      const app = createMockApp();
      const reply = createMockReply();

      const handler = createOAuthCallbackHandler(pool, app, {
        provider,
        verifyState: () => TENANT_ID,
        exchangeCodeForTokens: vi.fn().mockResolvedValue(validTokens),
      });

      await handler(createMockReq({ code: "auth-code", state: "valid-jwt" }), reply);

      expect(reply.redirectUrl).toContain(`${provider}Connected=true`);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════
// SAD PATHS
// ═══════════════════════════════════════════════════════════════════════

describe("createOAuthCallbackHandler — sad paths", () => {
  it("redirects with error when OAuth provider returns error param (WHO: OAuth provider, WHAT: access_denied, WHERE: callback, HOW: user denied consent)", async () => {
    const pool = createMockPool(createMockClient());
    const app = createMockApp();
    const reply = createMockReply();

    const handler = createOAuthCallbackHandler(pool, app, {
      provider: "jobber",
      verifyState: () => TENANT_ID,
      exchangeCodeForTokens: vi.fn(),
    });

    await handler(createMockReq({ error: "access_denied" }), reply);

    expect(reply.redirectUrl).toContain("jobberError=access_denied");
  });

  it("redirects with missing_params when code is absent (WHO: callback caller, WHAT: missing code, WHERE: /jobber/auth/callback, HOW: code param not in query string)", async () => {
    const pool = createMockPool(createMockClient());
    const app = createMockApp();
    const reply = createMockReply();

    const handler = createOAuthCallbackHandler(pool, app, {
      provider: "hubspot",
      verifyState: () => TENANT_ID,
      exchangeCodeForTokens: vi.fn(),
    });

    await handler(createMockReq({ state: "valid-jwt" }), reply);

    expect(reply.redirectUrl).toContain("hubspotError=missing_params");
  });

  it("redirects with missing_params when state is absent", async () => {
    const pool = createMockPool(createMockClient());
    const app = createMockApp();
    const reply = createMockReply();

    const handler = createOAuthCallbackHandler(pool, app, {
      provider: "square",
      verifyState: () => TENANT_ID,
      exchangeCodeForTokens: vi.fn(),
    });

    await handler(createMockReq({ code: "auth-code" }), reply);

    expect(reply.redirectUrl).toContain("squareError=missing_params");
  });

  it("redirects with invalid_state when JWT verification fails (WHO: callback caller, WHAT: state JWT invalid, WHERE: verifyState, HOW: expired or forged JWT)", async () => {
    const pool = createMockPool(createMockClient());
    const app = createMockApp();
    const reply = createMockReply();

    const handler = createOAuthCallbackHandler(pool, app, {
      provider: "jobber",
      verifyState: () => null, // JWT verification fails
      exchangeCodeForTokens: vi.fn(),
    });

    await handler(createMockReq({ code: "auth-code", state: "bad-jwt" }), reply);

    expect(reply.redirectUrl).toContain("jobberError=invalid_state");
  });

  it("redirects with token_exchange_failed when exchangeCodeForTokens throws (WHO: tenant, WHAT: token exchange, WHERE: provider API, WHY: invalid code or network error)", async () => {
    const pool = createMockPool(createMockClient());
    const app = createMockApp();
    const reply = createMockReply();

    const handler = createOAuthCallbackHandler(pool, app, {
      provider: "hubspot",
      verifyState: () => TENANT_ID,
      exchangeCodeForTokens: vi.fn().mockRejectedValue(new Error("Token exchange failed: 401")),
    });

    await handler(createMockReq({ code: "expired-code", state: "valid-jwt" }), reply);

    expect(reply.redirectUrl).toContain("hubspotError=token_exchange_failed");

    // Should log the error with context
    expect(app.log.error).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "hubspot_oauth_failed",
        tenantId: TENANT_ID,
        error: "Token exchange failed: 401",
      }),
      "Hubspot OAuth failed"
    );
  });

  it("redirects with token_exchange_failed when DB upsert throws (WHO: system, WHAT: DB write, WHERE: tenant_integration_settings, HOW: connection error)", async () => {
    const mockClient = createMockClient();
    mockClient.query.mockRejectedValueOnce(new Error("Connection refused"));
    const pool = createMockPool(mockClient);
    const app = createMockApp();
    const reply = createMockReply();

    const handler = createOAuthCallbackHandler(pool, app, {
      provider: "square",
      verifyState: () => TENANT_ID,
      exchangeCodeForTokens: vi.fn().mockResolvedValue(validTokens),
    });

    await handler(createMockReq({ code: "auth-code", state: "valid-jwt" }), reply);

    expect(reply.redirectUrl).toContain("squareError=token_exchange_failed");
    expect(mockClient.release).toHaveBeenCalledOnce(); // Client always released
  });

  it("always releases DB client even on error (WHO: system, WHAT: cleanup, WHERE: finally block, HOW: try/finally pattern)", async () => {
    const mockClient = createMockClient();
    mockClient.query.mockRejectedValueOnce(new Error("DB down"));
    const pool = createMockPool(mockClient);
    const app = createMockApp();
    const reply = createMockReply();

    const handler = createOAuthCallbackHandler(pool, app, {
      provider: "jobber",
      verifyState: () => TENANT_ID,
      exchangeCodeForTokens: vi.fn().mockResolvedValue(validTokens),
    });

    await handler(createMockReq({ code: "auth-code", state: "valid-jwt" }), reply);

    expect(mockClient.release).toHaveBeenCalledOnce();
  });
});
