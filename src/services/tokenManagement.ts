/**
 * Shared token management for all OAuth-based integrations.
 *
 * Eliminates duplication across jobberSync, hubspotSync, squareSync,
 * servicetitanSync, and calendarSync — all of which implemented identical
 * getTokensWithRefresh() logic.
 *
 * Pattern: SELECT FOR UPDATE → check expiry → refresh → update DB → handle failure
 */

import type { Pool } from 'pg';

/** Minimal logger interface used by all sync services */
export interface SyncLogger {
  warn: (msg: string) => void;
  error: (msg: string) => void;
  info: (msg: string) => void;
}

/** Default logger that writes to console (used when no logger is provided) */
export const defaultSyncLogger: SyncLogger = {
  warn: console.warn,
  error: console.error,
  info: console.info,
};

/** Token expiry buffer constants */
export const TOKEN_BUFFER_MS = {
  /** Standard 5-minute buffer for most integrations (Jobber, HubSpot, ServiceTitan, Calendar) */
  STANDARD: 5 * 60 * 1000,
  /** 24-hour buffer for Square (tokens expire in ~30 days) */
  SQUARE: 24 * 60 * 60 * 1000,
} as const;

/** Function that refreshes an access token given a refresh token */
type RefreshFn = (refreshToken: string) => Promise<{ access_token: string; expiry_date: number }>;

/** Base token result shared by all integrations */
export interface TokenResult {
  accessToken: string;
  refreshToken: string;
}

/**
 * Builds a standard sync log prefix: [provider-sync] tenant=UUID
 * Replaces the 5 identical ctx() functions across sync services.
 */
export function syncCtx(provider: string, tenantId: string, entityType?: string, action?: string): string {
  let prefix = `[${provider}-sync] tenant=${tenantId}`;
  if (entityType) prefix += ` entity=${entityType}`;
  if (action) prefix += ` action=${action}`;
  return prefix;
}

/**
 * Generic token refresh logic for integration settings (tenant_integration_settings table).
 *
 * Handles: row locking (FOR UPDATE), expiry check, token refresh, DB update, failure handling.
 *
 * @param pool - Database connection pool
 * @param tenantId - Tenant UUID
 * @param provider - Integration provider name ('jobber', 'hubspot', 'square', 'servicetitan')
 * @param refreshFn - Provider-specific token refresh function
 * @param bufferMs - How far before expiry to trigger refresh (default: 5 minutes)
 * @param logger - Optional structured logger
 * @param extraColumns - Additional columns to SELECT (e.g., 'settings' for ServiceTitan)
 */
export async function getIntegrationTokens(
  pool: Pool,
  tenantId: string,
  provider: string,
  refreshFn: RefreshFn,
  bufferMs: number = TOKEN_BUFFER_MS.STANDARD,
  logger?: SyncLogger,
  extraColumns?: string,
): Promise<{ accessToken: string; refreshToken: string; settings: Record<string, any> | null } | null> {
  const log = logger || defaultSyncLogger;
  const prefix = syncCtx(provider, tenantId);
  const client = await pool.connect();

  try {
    const cols = extraColumns
      ? `access_token, refresh_token, token_expires_at, is_active, ${extraColumns}`
      : 'access_token, refresh_token, token_expires_at, is_active';

    // FOR UPDATE locks the row to prevent concurrent token refresh races
    const res = await client.query(
      `SELECT ${cols} FROM tenant_integration_settings
       WHERE tenant_id = $1 AND provider = $2 FOR UPDATE`,
      [tenantId, provider]
    );

    const row = res.rows[0];
    if (!row) return null;

    if (!row.is_active) {
      log.warn(`${prefix} — skipped: integration inactive (user needs to reconnect)`);
      return null;
    }
    if (!row.access_token || !row.refresh_token) {
      log.warn(`${prefix} — skipped: missing tokens`);
      return null;
    }

    let accessToken = row.access_token;
    const expiresAt = row.token_expires_at ? new Date(row.token_expires_at).getTime() : 0;

    // Refresh if within buffer period
    if (Date.now() > expiresAt - bufferMs) {
      try {
        const refreshed = await refreshFn(row.refresh_token);
        accessToken = refreshed.access_token;
        await client.query(
          `UPDATE tenant_integration_settings SET access_token = $1, token_expires_at = $2, updated_at = NOW()
           WHERE tenant_id = $3 AND provider = $4`,
          [refreshed.access_token, new Date(refreshed.expiry_date).toISOString(), tenantId, provider]
        );
        log.info(`${prefix} — token refreshed`);
      } catch (err) {
        // Mark inactive so user sees "Reconnect" in dashboard
        await client.query(
          `UPDATE tenant_integration_settings SET is_active = false, updated_at = NOW()
           WHERE tenant_id = $1 AND provider = $2`,
          [tenantId, provider]
        );
        log.error(`${prefix} — token refresh FAILED, integration marked inactive (WHO: tenant=${tenantId} | WHAT: refreshAccessToken rejected | WHY: ${provider} OAuth grant likely revoked | HOW: user will see "Reconnect" in dashboard | ERROR: ${err})`);
        return null;
      }
    }

    return {
      accessToken,
      refreshToken: row.refresh_token,
      settings: row.settings || null,
    };
  } finally {
    client.release();
  }
}

/**
 * Token refresh for calendar settings (tenant_calendar_settings table).
 * Separate from integration settings because calendars use a different table.
 */
export async function getCalendarTokens(
  pool: Pool,
  tenantId: string,
  refreshFn: RefreshFn,
  providerName: string,
  logger?: SyncLogger,
): Promise<{
  accessToken: string;
  refreshToken: string;
  calendarId: string;
  provider: string;
} | null> {
  const log = logger || defaultSyncLogger;
  const prefix = `[calendar-sync] tenant=${tenantId}`;
  const client = await pool.connect();

  try {
    // FOR UPDATE locks the row to prevent concurrent token refresh races
    const settingsRes = await client.query(
      `SELECT provider, external_calendar_id, access_token, refresh_token, token_expires_at, is_active
       FROM tenant_calendar_settings WHERE tenant_id = $1
       FOR UPDATE`,
      [tenantId]
    );

    const settings = settingsRes.rows[0];
    if (!settings) return null;
    if (!settings.is_active) {
      log.warn(`${prefix} — skipped: calendar marked inactive`);
      return null;
    }
    if (settings.provider !== 'google' && settings.provider !== 'outlook') {
      log.warn(`${prefix} — skipped: provider="${settings.provider}" not supported`);
      return null;
    }
    if (!settings.access_token || !settings.refresh_token) {
      log.warn(`${prefix} — skipped: missing tokens`);
      return null;
    }

    let accessToken = settings.access_token;
    const expiresAt = settings.token_expires_at ? new Date(settings.token_expires_at).getTime() : 0;

    if (Date.now() > expiresAt - TOKEN_BUFFER_MS.STANDARD) {
      try {
        const refreshed = await refreshFn(settings.refresh_token);
        accessToken = refreshed.access_token;
        await client.query(
          `UPDATE tenant_calendar_settings SET access_token = $1, token_expires_at = $2, updated_at = NOW()
           WHERE tenant_id = $3`,
          [refreshed.access_token, new Date(refreshed.expiry_date).toISOString(), tenantId]
        );
        log.info(`${prefix} — ${providerName} token refreshed`);
      } catch (err) {
        await client.query(
          `UPDATE tenant_calendar_settings SET is_active = false, updated_at = NOW() WHERE tenant_id = $1`,
          [tenantId]
        );
        log.error(`${prefix} — ${providerName} token refresh FAILED, calendar marked inactive (WHO: tenant=${tenantId} | WHAT: refreshAccessToken rejected | WHY: ${providerName} OAuth grant likely revoked | HOW: is_active set to false | ERROR: ${err})`);
        return null;
      }
    }

    return {
      accessToken,
      refreshToken: settings.refresh_token,
      calendarId: settings.external_calendar_id,
      provider: settings.provider,
    };
  } finally {
    client.release();
  }
}
