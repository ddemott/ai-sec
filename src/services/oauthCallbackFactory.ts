/**
 * Generic OAuth callback handler factory.
 *
 * Eliminates duplication across jobber.ts, hubspot.ts, square.ts, and servicetitan.ts
 * which all implement identical OAuth callback flows:
 *   1. Check for OAuth error param
 *   2. Validate code + state
 *   3. Verify state JWT → extract tenantId
 *   4. Exchange code for tokens
 *   5. Upsert to tenant_integration_settings
 *   6. Redirect to dashboard with success/error query param
 */

import type { Pool } from 'pg';
import { DASHBOARD_URL } from '../constants';

/** Token set returned by all provider exchange functions */
interface TokenSet {
  access_token: string;
  refresh_token: string;
  expiry_date: number;
}

/** Configuration for a specific OAuth provider */
export interface OAuthProviderConfig {
  /** Provider name used in DB and query params (e.g., 'jobber', 'hubspot') */
  provider: string;
  /** Function to verify JWT state and extract tenantId */
  verifyState: (state: string) => string | null;
  /** Function to exchange auth code for tokens */
  exchangeCodeForTokens: (code: string) => Promise<TokenSet>;
  /** Extra query params to extract (e.g., tenant_sid for ServiceTitan) */
  extraQueryParams?: string[];
  /** Extra data to store in the settings JSONB column (receives the req.query object) */
  buildExtraSettings?: (query: Record<string, string>) => Record<string, unknown> | null;
}

/**
 * Creates a Fastify route handler for an OAuth callback.
 *
 * Usage in route file:
 *   app.get('/jobber/auth/callback', createOAuthCallbackHandler(pool, app, {
 *     provider: 'jobber',
 *     verifyState: jobberClient.verifyState,
 *     exchangeCodeForTokens: jobberClient.exchangeCodeForTokens,
 *   }));
 */
export function createOAuthCallbackHandler(
  pool: Pool,
  app: { log: { info: (obj: Record<string, unknown>, msg: string) => void; error: (obj: Record<string, unknown>, msg: string) => void } },
  config: OAuthProviderConfig
) {
  const { provider, verifyState, exchangeCodeForTokens, buildExtraSettings } = config;
  const errorParam = `${provider}Error`;
  const connectedParam = `${provider}Connected`;
  const displayName = provider.charAt(0).toUpperCase() + provider.slice(1);

  return async (req: { query: Record<string, string> }, reply: { redirect: (url: string) => void }) => {
    const query = req.query as Record<string, string>;
    const { code, state, error: oauthError } = query;

    if (oauthError) {
      return reply.redirect(`${DASHBOARD_URL}/dashboard?${errorParam}=${encodeURIComponent(oauthError)}`);
    }

    if (!code || !state) {
      return reply.redirect(`${DASHBOARD_URL}/dashboard?${errorParam}=missing_params`);
    }

    const tenantId = verifyState(state);
    if (!tenantId) {
      return reply.redirect(`${DASHBOARD_URL}/dashboard?${errorParam}=invalid_state`);
    }

    try {
      const tokens = await exchangeCodeForTokens(code);
      const extraSettings = buildExtraSettings ? buildExtraSettings(query) : null;

      const client = await pool.connect();
      try {
        if (extraSettings) {
          await client.query(
            `INSERT INTO tenant_integration_settings
               (tenant_id, provider, access_token, refresh_token, token_expires_at, is_active, settings)
             VALUES ($1, $2, $3, $4, $5, true, $6)
             ON CONFLICT (tenant_id, provider) DO UPDATE SET
               access_token = $3, refresh_token = $4, token_expires_at = $5,
               is_active = true, settings = COALESCE($6, tenant_integration_settings.settings), updated_at = NOW()`,
            [tenantId, provider, tokens.access_token, tokens.refresh_token,
             new Date(tokens.expiry_date).toISOString(), JSON.stringify(extraSettings)]
          );
        } else {
          await client.query(
            `INSERT INTO tenant_integration_settings
               (tenant_id, provider, access_token, refresh_token, token_expires_at, is_active)
             VALUES ($1, $2, $3, $4, $5, true)
             ON CONFLICT (tenant_id, provider) DO UPDATE SET
               access_token = $3, refresh_token = $4, token_expires_at = $5,
               is_active = true, updated_at = NOW()`,
            [tenantId, provider, tokens.access_token, tokens.refresh_token,
             new Date(tokens.expiry_date).toISOString()]
          );
        }
      } finally {
        client.release();
      }

      app.log.info({ event: `${provider}_oauth_complete`, tenantId }, `${displayName} connected`);
      return reply.redirect(`${DASHBOARD_URL}/dashboard?${connectedParam}=true`);
    } catch (err) {
      app.log.error(
        { event: `${provider}_oauth_failed`, tenantId, error: (err as Error).message },
        `${displayName} OAuth failed`
      );
      return reply.redirect(`${DASHBOARD_URL}/dashboard?${errorParam}=token_exchange_failed`);
    }
  };
}
