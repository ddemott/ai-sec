/**
 * Tenant Configuration Service.
 * Database-backed implementation for communications and reminder services.
 *
 * Reads tenant configuration from the existing `tenants` table.
 */

import { Pool, PoolClient } from 'pg';
import { getPool } from '../../database/index.js';

/**
 * Tenant configuration interface
 */
export interface TenantConfig {
  id: string | number;
  name: string;
  businessName?: string;
  email?: string;
  phone?: string;
  timezone?: string;
  settings?: {
    smsEnabled?: boolean;
    emailEnabled?: boolean;
    reminderHours?: number[];
    defaultProvider?: string;
  };
}

/**
 * Notification preferences for a tenant
 */
export interface NotificationPreferences {
  smsEnabled: boolean;
  emailEnabled: boolean;
  reminderHours: number[];
  contactInfo?: {
    phone?: string;
    email?: string;
    address?: string;
  };
}

/**
 * Interface for tenant configuration service
 */
export interface TenantConfigService {
  getTenantConfig(tenantId: string | number): TenantConfig | null;
  getTenantConfigs(): TenantConfig[];
  updateTenantConfig(tenantId: string | number, config: Partial<TenantConfig>): TenantConfig | null;
  getBusinessName(tenantId: string | number): Promise<string>;
  getNotificationPreferences(tenantId: string | number): Promise<NotificationPreferences>;
}

/**
 * In-memory tenant configuration service implementation.
 * Used for testing and as a fallback.
 */
export class InMemoryTenantConfigService implements TenantConfigService {
  private configs: Map<string, TenantConfig> = new Map();

  constructor(initialConfigs?: TenantConfig[]) {
    if (initialConfigs) {
      for (const config of initialConfigs) {
        this.configs.set(String(config.id), config);
      }
    }
  }

  getTenantConfig(tenantId: string | number): TenantConfig | null {
    return this.configs.get(String(tenantId)) || null;
  }

  getTenantConfigs(): TenantConfig[] {
    return Array.from(this.configs.values());
  }

  updateTenantConfig(
    tenantId: string | number,
    updates: Partial<TenantConfig>
  ): TenantConfig | null {
    const existing = this.configs.get(String(tenantId));
    if (!existing) {
      return null;
    }
    const updated = { ...existing, ...updates };
    this.configs.set(String(tenantId), updated);
    return updated;
  }

  /**
   * Add a tenant configuration
   */
  addTenantConfig(config: TenantConfig): void {
    this.configs.set(String(config.id), config);
  }

  /**
   * Remove a tenant configuration
   */
  removeTenantConfig(tenantId: string | number): boolean {
    return this.configs.delete(String(tenantId));
  }

  /**
   * Get business name for a tenant
   */
  async getBusinessName(tenantId: string | number): Promise<string> {
    const config = this.getTenantConfig(tenantId);
    return config?.businessName || config?.name || 'Business';
  }

  /**
   * Get notification preferences for a tenant
   */
  async getNotificationPreferences(tenantId: string | number): Promise<NotificationPreferences> {
    const config = this.getTenantConfig(tenantId);
    return {
      smsEnabled: config?.settings?.smsEnabled ?? true,
      emailEnabled: config?.settings?.emailEnabled ?? true,
      reminderHours: config?.settings?.reminderHours ?? [72, 24, 2],
      contactInfo: {
        phone: config?.phone,
        email: config?.email,
      },
    };
  }
}

/**
 * Database-backed tenant configuration service.
 * Reads tenant config from the tenants table.
 */
export class PostgresTenantConfigService implements TenantConfigService {
  private pool: Pool;
  private cache: Map<string, TenantConfig> = new Map();
  private cacheExpiry: Map<string, number> = new Map();
  private readonly cacheTTL = 60000; // 1 minute cache

  constructor(pool?: Pool) {
    this.pool = pool || getPool();
  }

  private async withClient<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      return await fn(client);
    } finally {
      client.release();
    }
  }

  private isCacheValid(tenantId: string): boolean {
    const expiry = this.cacheExpiry.get(tenantId);
    return expiry !== undefined && Date.now() < expiry;
  }

  private rowToConfig(row: any): TenantConfig {
    return {
      id: row.id,
      name: row.name,
      businessName: row.business_name,
      email: row.owner_email,
      phone: row.phone,
      timezone: row.timezone || 'America/Chicago',
      settings: {
        smsEnabled: row.sms_enabled !== false, // Default true
        emailEnabled: row.email_enabled !== false, // Default true
        reminderHours: [72, 24, 2], // Default reminder schedule
        defaultProvider: 'twilio',
      },
    };
  }

  getTenantConfig(tenantId: string | number): TenantConfig | null {
    const key = String(tenantId);
    if (this.isCacheValid(key)) {
      return this.cache.get(key) || null;
    }
    // Synchronous method can't wait for DB - return cached or null
    // The async version should be used in production
    return this.cache.get(key) || null;
  }

  /**
   * Async version for actual DB lookup
   */
  async getTenantConfigAsync(tenantId: string | number): Promise<TenantConfig | null> {
    const key = String(tenantId);
    if (this.isCacheValid(key)) {
      return this.cache.get(key) || null;
    }

    return this.withClient(async (client) => {
      const result = await client.query(
        `SELECT id, name, business_name, owner_email, phone, timezone, sms_enabled, email_enabled
         FROM tenants WHERE tenant_id = $1`,
        [tenantId]
      );

      if (result.rows.length === 0) {
        return null;
      }

      const config = this.rowToConfig(result.rows[0]);
      this.cache.set(key, config);
      this.cacheExpiry.set(key, Date.now() + this.cacheTTL);
      return config;
    });
  }

  getTenantConfigs(): TenantConfig[] {
    // Return cached configs for sync access
    return Array.from(this.cache.values());
  }

  /**
   * Async version for actual DB lookup
   */
  async getTenantConfigsAsync(): Promise<TenantConfig[]> {
    return this.withClient(async (client) => {
      const result = await client.query(
        `SELECT id, name, business_name, owner_email, phone, timezone, sms_enabled, email_enabled
         FROM tenants ORDER BY name`
      );

      const configs = result.rows.map((row) => this.rowToConfig(row));
      for (const config of configs) {
        const key = String(config.id);
        this.cache.set(key, config);
        this.cacheExpiry.set(key, Date.now() + this.cacheTTL);
      }
      return configs;
    });
  }

  updateTenantConfig(
    tenantId: string | number,
    updates: Partial<TenantConfig>
  ): TenantConfig | null {
    // Sync method updates cache only
    const key = String(tenantId);
    const existing = this.cache.get(key);
    if (!existing) {
      return null;
    }
    const updated = { ...existing, ...updates };
    this.cache.set(key, updated);
    return updated;
  }

  /**
   * Async version for actual DB update
   */
  async updateTenantConfigAsync(
    tenantId: string | number,
    updates: Partial<TenantConfig>
  ): Promise<TenantConfig | null> {
    return this.withClient(async (client) => {
      const fields: string[] = [];
      const values: unknown[] = [];
      let paramIndex = 1;

      if (updates.name !== undefined) {
        fields.push(`name = $${paramIndex++}`);
        values.push(updates.name);
      }
      if (updates.businessName !== undefined) {
        fields.push(`business_name = $${paramIndex++}`);
        values.push(updates.businessName);
      }
      if (updates.email !== undefined) {
        fields.push(`owner_email = $${paramIndex++}`);
        values.push(updates.email);
      }
      if (updates.phone !== undefined) {
        fields.push(`phone = $${paramIndex++}`);
        values.push(updates.phone);
      }
      if (updates.timezone !== undefined) {
        fields.push(`timezone = $${paramIndex++}`);
        values.push(updates.timezone);
      }

      if (fields.length === 0) {
        return this.getTenantConfigAsync(tenantId);
      }

      values.push(tenantId);
      const result = await client.query(
        `UPDATE tenants SET ${fields.join(', ')}, updated_at = NOW()
         WHERE tenant_id = $${paramIndex}
         RETURNING tenant_id AS id, name, business_name, owner_email, phone, timezone, sms_enabled, email_enabled`,
        values
      );

      if (result.rows.length === 0) {
        return null;
      }

      const config = this.rowToConfig(result.rows[0]);
      const key = String(tenantId);
      this.cache.set(key, config);
      this.cacheExpiry.set(key, Date.now() + this.cacheTTL);
      return config;
    });
  }

  /**
   * Clear the cache (for testing)
   */
  clearCache(): void {
    this.cache.clear();
    this.cacheExpiry.clear();
  }

  /**
   * Get business name for a tenant
   */
  async getBusinessName(tenantId: string | number): Promise<string> {
    const config = await this.getTenantConfigAsync(tenantId);
    return config?.businessName || config?.name || 'Business';
  }

  /**
   * Get notification preferences for a tenant
   */
  async getNotificationPreferences(tenantId: string | number): Promise<NotificationPreferences> {
    const config = await this.getTenantConfigAsync(tenantId);
    return {
      smsEnabled: config?.settings?.smsEnabled ?? true,
      emailEnabled: config?.settings?.emailEnabled ?? true,
      reminderHours: config?.settings?.reminderHours ?? [72, 24, 2],
      contactInfo: {
        phone: config?.phone,
        email: config?.email,
      },
    };
  }
}

// Export default instances
export const tenantConfigService = new InMemoryTenantConfigService([
  {
    id: '1',
    name: 'Demo Tenant',
    businessName: 'Demo Business',
    email: 'demo@example.com',
    timezone: 'America/New_York',
    settings: {
      smsEnabled: true,
      emailEnabled: true,
      reminderHours: [72, 24, 2],
    },
  },
]);

// Factory function for creating DB-backed service
export function createTenantConfigService(pool?: Pool): PostgresTenantConfigService {
  return new PostgresTenantConfigService(pool);
}
