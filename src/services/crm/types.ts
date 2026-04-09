/**
 * CRM Adapter Types
 *
 * Provides a unified interface for integrating with various CRM and scheduling platforms.
 * Adapters implement this interface to provide consistent data access across providers.
 *
 * Migrated from ai-secretary project - these adapters complement the existing
 * provider-specific clients (hubspotClient, jobberClient, etc.) by providing
 * a consistent interface pattern.
 */

// Minimal entity interfaces for CRM adapter transformations
// These are simplified versions - full entities are in the database layer
export interface LocalAppointment {
  id: number;
  tenantId: number;
  customerId?: number;
  customerName: string;
  customerEmail?: string;
  customerPhone?: string;
  serviceId: number;
  serviceName: string;
  staffId: number;
  staffName: string;
  dateTime: string;
  duration: number;
  price?: number;
  status: 'confirmed' | 'cancelled' | 'completed';
  attributes?: Record<string, any>;
  createdAt: string;
  updatedAt: string;
}

export interface LocalCustomer {
  id?: number;
  tenantId: number;
  firstName: string;
  lastName: string;
  name: string;
  email?: string;
  phone?: string;
  attributes?: Record<string, any>;
  createdAt: string;
  updatedAt: string;
}

export interface LocalService {
  id: number;
  tenantId: number;
  name: string;
  durationMin: number;
  staff: Array<number | string>;
  createdAt: string;
  updatedAt: string;
}

export interface LocalStaff {
  id: number;
  tenantId: number;
  firstName: string;
  lastName: string;
  name: string;
  role: string;
  availability: Record<string, { start: string; end: string }>;
  createdAt: string;
  updatedAt: string;
}

// Token manager interface - simplified version that adapters can use
export interface TokenManagerInterface {
  getToken(tenantId: number | undefined, provider: string): Promise<string | null>;
  getRefreshToken?(tenantId: number | undefined, provider: string): Promise<string | null>;
  storeToken?(
    tenantId: number,
    provider: string,
    tokens: { accessToken: string; refreshToken?: string; expiresIn?: number }
  ): Promise<void>;
}

export interface CRMConfig {
  provider: CRMProvider;
  tenantId?: number;
  /** @deprecated Use TokenManager instead */
  apiKey?: string;
  /** @deprecated Use TokenManager instead */
  apiSecret?: string;
  /** @deprecated Use TokenManager instead */
  accessToken?: string;
  /** @deprecated Use TokenManager instead */
  refreshToken?: string;
  baseUrl?: string;
  locationId?: string;
  businessId?: string;
  webhookUrl?: string;
  syncEnabled: boolean;
  syncDirection: 'import' | 'export' | 'bidirectional';
  lastSync?: string;
}

export type CRMProvider =
  | 'google_calendar'
  | 'outlook_calendar'
  | 'gohighlevel'
  | 'hubspot'
  | 'square'
  | 'booksy'
  | 'acuity'
  | 'calendly'
  | 'simplybook'
  | 'setmore'
  | 'seventeenhats'
  | 'honeybook'
  | 'jobber'
  | 'servicem8'
  | 'housecallpro'
  | 'salesforce'
  | 'pipedrive'
  | 'zoho'
  | 'millennium'
  | 'dentrix'
  | 'eaglesoft'
  | 'mindbody'
  | 'zenoti'
  | 'vagaro'
  | 'fresha'
  | 'glossgenius'
  | 'servicetitan';

export interface CRMAppointment {
  id: string;
  customerId: string;
  customerName: string;
  customerEmail?: string;
  customerPhone?: string;
  serviceId: string;
  serviceName: string;
  staffId: string;
  staffName: string;
  startTime: string;
  endTime: string;
  status: 'confirmed' | 'cancelled' | 'completed' | 'no_show';
  notes?: string;
  price?: number;
  externalId?: string;
  lastModified: string;
}

export interface CRMCustomer {
  id: string;
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  dateOfBirth?: string;
  notes?: string;
  tags?: string[];
  externalId?: string;
  lastModified: string;
}

export interface CRMService {
  id: string;
  name: string;
  description?: string;
  duration: number; // minutes
  price: number;
  category?: string;
  active: boolean;
  externalId?: string;
  lastModified: string;
}

export interface CRMStaff {
  id: string;
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  role: string;
  services?: string[]; // service IDs they can perform
  active: boolean;
  externalId?: string;
  lastModified: string;
}

export interface CRMSyncResult {
  success: boolean;
  syncedRecords: number;
  errors: string[];
  lastSync: string;
}

export interface CRMWebhookPayload {
  event: string;
  data: any;
  timestamp: string;
}

/**
 * Base class for CRM adapters.
 * Provides a consistent interface for all CRM integrations.
 */
export abstract class BaseCRMAdapter {
  constructor(
    protected config: CRMConfig,
    protected tokenManager?: TokenManagerInterface,
  ) {}

  abstract getProvider(): CRMProvider;

  /**
   * Helper to get a valid access token.
   * Adapters should use this instead of this.config.apiKey
   */
  protected async getAccessToken(): Promise<string> {
    if (this.tokenManager) {
      const token = await this.tokenManager.getToken(this.config.tenantId, this.getProvider());
      if (token) return token;

      // If token is missing or expired, attempt refresh
      console.log(
        `[BaseCRMAdapter] Token for ${this.getProvider()} expired or missing. Attempting refresh...`,
      );
      try {
        const refreshed = await this.refreshAccessToken();
        if (refreshed) return refreshed;
      } catch (error) {
        console.error(`[BaseCRMAdapter] Failed to refresh token for ${this.getProvider()}:`, error);
      }
    }
    // Fallback to legacy config for transition period
    return this.config.accessToken || this.config.apiKey || '';
  }

  /**
   * Refresh the access token using a refresh token.
   * Implementation is provider-specific.
   */
  protected abstract refreshAccessToken(): Promise<string | null>;

  // Customer operations
  abstract getCustomers(since?: string): Promise<CRMCustomer[]>;
  abstract createCustomer(
    customer: Omit<CRMCustomer, 'id' | 'externalId' | 'lastModified'>,
  ): Promise<CRMCustomer>;
  abstract updateCustomer(id: string, customer: Partial<CRMCustomer>): Promise<CRMCustomer>;
  abstract deleteCustomer(id: string): Promise<boolean>;

  // Appointment operations
  abstract getAppointments(startDate: string, endDate: string): Promise<CRMAppointment[]>;
  abstract createAppointment(
    appointment: Omit<CRMAppointment, 'id' | 'externalId' | 'lastModified'>,
  ): Promise<CRMAppointment>;
  abstract updateAppointment(
    id: string,
    appointment: Partial<CRMAppointment>,
  ): Promise<CRMAppointment>;
  abstract cancelAppointment(id: string, reason?: string): Promise<boolean>;

  // Service operations
  abstract getServices(): Promise<CRMService[]>;
  abstract createService(
    service: Omit<CRMService, 'id' | 'externalId' | 'lastModified'>,
  ): Promise<CRMService>;
  abstract updateService(id: string, service: Partial<CRMService>): Promise<CRMService>;

  // Staff operations
  abstract getStaff(): Promise<CRMStaff[]>;
  abstract createStaff(
    staff: Omit<CRMStaff, 'id' | 'externalId' | 'lastModified'>,
  ): Promise<CRMStaff>;
  abstract updateStaff(id: string, staff: Partial<CRMStaff>): Promise<CRMStaff>;

  // Webhook handling
  abstract handleWebhook(payload: CRMWebhookPayload): Promise<void>;

  // Utility methods
  abstract testConnection(): Promise<boolean>;
  abstract getLastModified(
    entity: 'customers' | 'appointments' | 'services' | 'staff',
  ): Promise<string>;

  // Data transformation helpers
  protected transformToLocalAppointment(crmAppointment: CRMAppointment): LocalAppointment {
    return {
      id: Number(crmAppointment.externalId ?? crmAppointment.id),
      tenantId: 0, // Will be set by caller
      customerId: Number(crmAppointment.customerId),
      customerName: crmAppointment.customerName,
      customerEmail: crmAppointment.customerEmail,
      customerPhone: crmAppointment.customerPhone,
      serviceId: Number(crmAppointment.serviceId),
      serviceName: crmAppointment.serviceName,
      staffId: Number(crmAppointment.staffId),
      staffName: crmAppointment.staffName,
      attributes: (crmAppointment as any).attributes ?? {},
      dateTime: crmAppointment.startTime,
      duration: Math.round(
        (new Date(crmAppointment.endTime).getTime() -
          new Date(crmAppointment.startTime).getTime()) /
          (1000 * 60),
      ),
      price: crmAppointment.price,
      status: crmAppointment.status === 'no_show' ? 'cancelled' : crmAppointment.status,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  protected transformToLocalCustomer(
    crmCustomer: CRMCustomer,
  ): Omit<LocalCustomer, 'id'> & { externalId: string } {
    return {
      externalId: crmCustomer.externalId || crmCustomer.id,
      tenantId: 0, // Will be set by caller
      firstName: crmCustomer.firstName,
      lastName: crmCustomer.lastName,
      name: `${crmCustomer.firstName} ${crmCustomer.lastName}`.trim(),
      email: crmCustomer.email,
      phone: crmCustomer.phone,
      attributes: (crmCustomer as any).attributes ?? {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  protected transformToLocalService(crmService: CRMService): LocalService {
    return {
      id: Number(crmService.externalId ?? crmService.id),
      tenantId: 0, // Will be set by caller
      name: crmService.name,
      durationMin: crmService.duration,
      staff: [], // Will be populated separately
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  protected transformToLocalStaff(crmStaff: CRMStaff): LocalStaff {
    return {
      id: Number(crmStaff.externalId ?? crmStaff.id),
      tenantId: 0, // Will be set by caller
      firstName: crmStaff.firstName,
      lastName: crmStaff.lastName,
      name: `${crmStaff.firstName} ${crmStaff.lastName}`.trim(),
      role: crmStaff.role,
      availability: {}, // Will be populated separately
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }
}
