/**
 * Shared OAuth state JWT helpers — sign + verify the `state` parameter
 * threaded through every OAuth authorize→callback round trip for CSRF
 * protection.
 *
 * Before this module landed, 6 files duplicated near-identical JWT sign +
 * verify logic with only the `purpose` string differing (`google-calendar-oauth`,
 * `outlook-calendar-oauth`, `jobber-oauth`, `hubspot-oauth`, `square-oauth`,
 * `servicetitan-oauth`). ~12 lines of duplicated machinery × 6 files =
 * ~72 lines, plus an identical JWT_SECRET fallback string repeated in each.
 *
 * The token refresh + code exchange logic is NOT extracted — Google uses the
 * `googleapis` SDK while Outlook uses raw `fetch`; the CRM clients each have
 * their own provider quirks. Parameterizing over those defeats the
 * abstraction (same disposition as the broader CRM sync skeleton in
 * NEEDS-REFACTORING #10's broader extraction).
 *
 * Origin: NEEDS-REFACTORING / TODO "Unify calendar token refresh" — the
 * verify-first found that the truly shared code was the state JWT, not the
 * token refresh.
 */

import jwt from 'jsonwebtoken';

/** Default JWT signing key used when `JWT_SECRET` is unset (dev environments). */
const DEFAULT_DEV_SECRET = 'dev-jwt-secret-change-in-production';
/** Default state-token TTL — keeps the OAuth round trip short. */
const DEFAULT_EXPIRES_IN = '10m';

function resolveSecret(override?: string): string {
  return override || process.env.JWT_SECRET || DEFAULT_DEV_SECRET;
}

/**
 * Sign an OAuth state JWT carrying the tenant id + a provider-specific
 * `purpose` discriminator. The `purpose` prevents a state token signed for
 * one provider from being accepted by another (e.g. a state from a Jobber
 * authorize round trip can't be replayed at the HubSpot callback).
 *
 * Used inside each provider's `getAuthUrl(tenantId)` to produce the `state`
 * URL parameter handed to the OAuth consent screen.
 */
export function signOAuthState(args: {
  tenantId: string;
  /** Provider-specific discriminator, e.g. `'jobber-oauth'`, `'google-calendar-oauth'`. */
  purpose: string;
  /** Optional override; defaults to `JWT_SECRET` env or the dev fallback. */
  jwtSecret?: string;
  /** Optional TTL string accepted by `jsonwebtoken`. Defaults to `'10m'`. */
  expiresIn?: string;
}): string {
  return jwt.sign(
    { tenantId: args.tenantId, purpose: args.purpose },
    resolveSecret(args.jwtSecret),
    { expiresIn: args.expiresIn || DEFAULT_EXPIRES_IN } as jwt.SignOptions,
  );
}

/**
 * Verify an OAuth state JWT received at the callback URL.
 *
 * Returns the tenant id on success; `null` on any failure (malformed token,
 * expired token, wrong purpose, missing fields). Returning `null` instead of
 * throwing matches the existing per-provider behavior — callers decide
 * whether the failure should produce a 4xx or a redirect.
 *
 * `expectedPurpose` MUST be the same string passed to `signOAuthState` for
 * this provider; mismatches return `null` to prevent cross-provider replay.
 */
export function verifyOAuthState(args: {
  state: string;
  expectedPurpose: string;
  jwtSecret?: string;
}): string | null {
  try {
    const decoded = jwt.verify(args.state, resolveSecret(args.jwtSecret)) as {
      tenantId: string;
      purpose: string;
    };
    if (decoded.purpose !== args.expectedPurpose) return null;
    return decoded.tenantId;
  } catch {
    return null;
  }
}
