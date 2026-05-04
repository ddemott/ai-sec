/**
 * Tests for the shared OAuth state JWT helpers.
 * Happy + sad paths with 5W diagnostic context.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import jwt from 'jsonwebtoken';
import { signOAuthState, verifyOAuthState } from './oauthStateJwt';

const TEST_SECRET = 'test-secret-for-jwt';
const TENANT = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

describe('signOAuthState', () => {
  it('HAPPY: round-trips through verifyOAuthState with the same purpose', () => {
    // WHO: a provider's getAuthUrl(tenantId) → callback flow
    // WHAT: signed state decodes back to the same tenant id
    // WHEN: every OAuth authorize → callback round trip
    // WHERE: signOAuthState() → URL state param → verifyOAuthState()
    // WHY: this is the basic CSRF protection contract — tenant id survives
    //      a round trip through the OAuth provider intact
    const state = signOAuthState({
      tenantId: TENANT,
      purpose: 'jobber-oauth',
      jwtSecret: TEST_SECRET,
    });
    const decoded = verifyOAuthState({
      state,
      expectedPurpose: 'jobber-oauth',
      jwtSecret: TEST_SECRET,
    });
    expect(decoded).toBe(TENANT);
  });

  it('HAPPY: includes purpose + tenantId fields in the JWT payload', () => {
    // WHO: future readers of the helper checking payload shape
    // WHAT: payload has exactly the fields the existing per-provider code expected
    // WHY: changing the payload shape would silently break every provider's
    //      decoded.purpose / decoded.tenantId access pattern
    const state = signOAuthState({
      tenantId: TENANT,
      purpose: 'google-calendar-oauth',
      jwtSecret: TEST_SECRET,
    });
    const payload = jwt.verify(state, TEST_SECRET) as { tenantId: string; purpose: string };
    expect(payload.tenantId).toBe(TENANT);
    expect(payload.purpose).toBe('google-calendar-oauth');
  });

  it('HAPPY: uses JWT_SECRET env when no override given', () => {
    // WHO: production code paths that don't pass an explicit secret
    // WHAT: helper falls back to process.env.JWT_SECRET
    // WHY: matches the existing per-provider behavior (every file pulled
    //      from env with the same dev fallback string)
    const prev = process.env.JWT_SECRET;
    process.env.JWT_SECRET = 'env-secret-value';
    try {
      const state = signOAuthState({ tenantId: TENANT, purpose: 'test' });
      const payload = jwt.verify(state, 'env-secret-value') as { tenantId: string };
      expect(payload.tenantId).toBe(TENANT);
    } finally {
      if (prev === undefined) delete process.env.JWT_SECRET;
      else process.env.JWT_SECRET = prev;
    }
  });

  it('HAPPY: respects a custom expiresIn override', () => {
    // WHO: a future caller that needs a non-default TTL
    // WHAT: signed state has the requested expiry
    // WHY: keep the TTL configurable so the helper doesn't lock callers in
    const before = Math.floor(Date.now() / 1000);
    const state = signOAuthState({
      tenantId: TENANT,
      purpose: 'test',
      jwtSecret: TEST_SECRET,
      expiresIn: '60s',
    });
    const payload = jwt.verify(state, TEST_SECRET) as { exp: number };
    // expiry should be ~60s from now (allow ±5s drift)
    expect(payload.exp).toBeGreaterThanOrEqual(before + 55);
    expect(payload.exp).toBeLessThanOrEqual(before + 65);
  });
});

describe('verifyOAuthState', () => {
  it('HAPPY: returns tenantId when purpose matches', () => {
    // WHO: callback handler verifying a fresh state token
    // WHAT: tenantId returned for valid + matching-purpose state
    const state = signOAuthState({ tenantId: TENANT, purpose: 'jobber-oauth', jwtSecret: TEST_SECRET });
    expect(
      verifyOAuthState({ state, expectedPurpose: 'jobber-oauth', jwtSecret: TEST_SECRET }),
    ).toBe(TENANT);
  });

  it('SAD: returns null when purpose does NOT match (cross-provider replay defense)', () => {
    // WHO: an attacker (or a misconfigured callback URL) that captures a state
    //      token from a Jobber authorize round trip and tries to replay it at
    //      the HubSpot callback URL
    // WHAT: verify rejects the token because purpose='jobber-oauth' but caller
    //       expected 'hubspot-oauth' → null
    // WHEN: cross-provider replay attempt
    // WHERE: verifyOAuthState's purpose check
    // WHY: without this discriminator, any provider's state token would
    //      satisfy any other provider's verify — bypassing CSRF intent
    const state = signOAuthState({ tenantId: TENANT, purpose: 'jobber-oauth', jwtSecret: TEST_SECRET });
    expect(
      verifyOAuthState({ state, expectedPurpose: 'hubspot-oauth', jwtSecret: TEST_SECRET }),
    ).toBeNull();
  });

  it('SAD: returns null on signature mismatch (wrong secret)', () => {
    // WHO: a forged state token signed with a different secret
    // WHAT: jwt.verify throws → caught → returns null
    // WHY: signature verification is the core CSRF protection — a token
    //      signed with the wrong key must NEVER decode to a tenant id
    const state = signOAuthState({ tenantId: TENANT, purpose: 'test', jwtSecret: 'wrong-secret' });
    expect(
      verifyOAuthState({ state, expectedPurpose: 'test', jwtSecret: TEST_SECRET }),
    ).toBeNull();
  });

  it('SAD: returns null on malformed state', () => {
    // WHO: garbage or tampered state arriving at the callback URL
    // WHAT: jwt.verify throws on malformed input → caught → returns null
    // WHY: callback handlers expect a single null/non-null sentinel, not
    //       a thrown exception, so they can produce a clean 4xx redirect
    expect(
      verifyOAuthState({ state: 'not.a.jwt', expectedPurpose: 'test', jwtSecret: TEST_SECRET }),
    ).toBeNull();
  });

  it('SAD: returns null on expired state', async () => {
    // WHO: a state token whose 10-minute TTL has elapsed
    // WHAT: jwt.verify throws TokenExpiredError → caught → returns null
    // WHEN: user took longer than the TTL on the OAuth consent screen
    // WHY: stale state tokens should re-prompt rather than silently succeed
    const state = jwt.sign(
      { tenantId: TENANT, purpose: 'test' },
      TEST_SECRET,
      { expiresIn: '-1s' } as jwt.SignOptions, // already expired
    );
    expect(
      verifyOAuthState({ state, expectedPurpose: 'test', jwtSecret: TEST_SECRET }),
    ).toBeNull();
  });

  it('SAD: returns null when payload missing purpose field', () => {
    // WHO: a token signed by older code (or a defective client) without `purpose`
    // WHAT: undefined !== expectedPurpose → null
    // WHY: defense in depth — even a syntactically valid JWT signed with the
    //      right key must carry the discriminator we expect
    const state = jwt.sign({ tenantId: TENANT }, TEST_SECRET, { expiresIn: '5m' } as jwt.SignOptions);
    expect(
      verifyOAuthState({ state, expectedPurpose: 'test', jwtSecret: TEST_SECRET }),
    ).toBeNull();
  });
});
