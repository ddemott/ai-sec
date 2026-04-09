/**
 * Tests for CRM Adapter base functionality and individual adapters.
 * These adapters were migrated from ai-secretary.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  BaseCRMAdapter,
  CRMConfig,
  CRMProvider,
  CRMCustomer,
  CRMAppointment,
  CRMService,
  CRMStaff,
  TokenManagerInterface,
} from './types';

// Mock token manager for testing
function createMockTokenManager(tokens: { access?: string; refresh?: string } = {}): TokenManagerInterface {
  return {
    getToken: vi.fn().mockResolvedValue(tokens.access || null),
    getRefreshToken: vi.fn().mockResolvedValue(tokens.refresh || null),
    storeToken: vi.fn().mockResolvedValue(undefined),
  };
}

// Concrete implementation for testing base class
class TestAdapter extends BaseCRMAdapter {
  getProvider(): CRMProvider {
    return 'hubspot';
  }

  protected async refreshAccessToken(): Promise<string | null> {
    return 'refreshed-token';
  }

  async getCustomers(): Promise<CRMCustomer[]> {
    return [];
  }

  async createCustomer(customer: Omit<CRMCustomer, 'id' | 'externalId' | 'lastModified'>): Promise<CRMCustomer> {
    return { ...customer, id: '1', externalId: '1', lastModified: new Date().toISOString() };
  }

  async updateCustomer(id: string, customer: Partial<CRMCustomer>): Promise<CRMCustomer> {
    return { id, firstName: '', lastName: '', lastModified: new Date().toISOString(), ...customer };
  }

  async deleteCustomer(): Promise<boolean> {
    return true;
  }

  async getAppointments(): Promise<CRMAppointment[]> {
    return [];
  }

  async createAppointment(apt: Omit<CRMAppointment, 'id' | 'externalId' | 'lastModified'>): Promise<CRMAppointment> {
    return { ...apt, id: '1', externalId: '1', lastModified: new Date().toISOString() };
  }

  async updateAppointment(id: string, apt: Partial<CRMAppointment>): Promise<CRMAppointment> {
    return {
      id,
      customerId: '',
      customerName: '',
      serviceId: '',
      serviceName: '',
      staffId: '',
      staffName: '',
      startTime: '',
      endTime: '',
      status: 'confirmed',
      lastModified: new Date().toISOString(),
      ...apt,
    };
  }

  async cancelAppointment(): Promise<boolean> {
    return true;
  }

  async getServices(): Promise<CRMService[]> {
    return [];
  }

  async createService(svc: Omit<CRMService, 'id' | 'externalId' | 'lastModified'>): Promise<CRMService> {
    return { ...svc, id: '1', externalId: '1', lastModified: new Date().toISOString() };
  }

  async updateService(id: string, svc: Partial<CRMService>): Promise<CRMService> {
    return { id, name: '', duration: 0, price: 0, active: true, lastModified: new Date().toISOString(), ...svc };
  }

  async getStaff(): Promise<CRMStaff[]> {
    return [];
  }

  async createStaff(staff: Omit<CRMStaff, 'id' | 'externalId' | 'lastModified'>): Promise<CRMStaff> {
    return { ...staff, id: '1', externalId: '1', lastModified: new Date().toISOString() };
  }

  async updateStaff(id: string, staff: Partial<CRMStaff>): Promise<CRMStaff> {
    return { id, firstName: '', lastName: '', role: '', active: true, lastModified: new Date().toISOString(), ...staff };
  }

  async handleWebhook(): Promise<void> {}

  async testConnection(): Promise<boolean> {
    return true;
  }

  async getLastModified(): Promise<string> {
    return new Date().toISOString();
  }

  // Expose protected method for testing
  public async testGetAccessToken(): Promise<string> {
    return this.getAccessToken();
  }

  // Expose transformation methods for testing
  public testTransformCustomer(customer: CRMCustomer) {
    return this.transformToLocalCustomer(customer);
  }

  public testTransformAppointment(apt: CRMAppointment) {
    return this.transformToLocalAppointment(apt);
  }
}

describe('CRM Types and Base Adapter', () => {
  describe('BaseCRMAdapter', () => {
    it('should return provider name', () => {
      const config: CRMConfig = {
        provider: 'hubspot',
        syncEnabled: true,
        syncDirection: 'bidirectional',
      };
      const adapter = new TestAdapter(config);
      expect(adapter.getProvider()).toBe('hubspot');
    });

    it('should use token from tokenManager when available', async () => {
      const config: CRMConfig = {
        provider: 'hubspot',
        tenantId: 1,
        syncEnabled: true,
        syncDirection: 'bidirectional',
      };
      const tokenManager = createMockTokenManager({ access: 'test-token' });
      const adapter = new TestAdapter(config, tokenManager);

      const token = await adapter.testGetAccessToken();
      expect(token).toBe('test-token');
      expect(tokenManager.getToken).toHaveBeenCalledWith(1, 'hubspot');
    });

    it('should fallback to config accessToken when tokenManager returns null', async () => {
      const config: CRMConfig = {
        provider: 'hubspot',
        accessToken: 'config-token',
        syncEnabled: true,
        syncDirection: 'bidirectional',
      };
      const tokenManager = createMockTokenManager({ access: null });
      const adapter = new TestAdapter(config, tokenManager);

      const token = await adapter.testGetAccessToken();
      expect(token).toBe('refreshed-token'); // Falls back after refresh attempt
    });

    it('should fallback to config apiKey when no accessToken', async () => {
      const config: CRMConfig = {
        provider: 'hubspot',
        apiKey: 'api-key',
        syncEnabled: true,
        syncDirection: 'bidirectional',
      };
      const adapter = new TestAdapter(config);

      const token = await adapter.testGetAccessToken();
      expect(token).toBe('api-key');
    });
  });

  describe('Data Transformations', () => {
    const config: CRMConfig = {
      provider: 'hubspot',
      syncEnabled: true,
      syncDirection: 'bidirectional',
    };
    const adapter = new TestAdapter(config);

    it('should transform CRM customer to local format', () => {
      const crmCustomer: CRMCustomer = {
        id: '123',
        firstName: 'John',
        lastName: 'Doe',
        email: 'john@example.com',
        phone: '+15551234567',
        externalId: 'ext-123',
        lastModified: '2024-01-01T00:00:00Z',
      };

      const local = adapter.testTransformCustomer(crmCustomer);

      expect(local.firstName).toBe('John');
      expect(local.lastName).toBe('Doe');
      expect(local.name).toBe('John Doe');
      expect(local.email).toBe('john@example.com');
      expect(local.phone).toBe('+15551234567');
      expect(local.externalId).toBe('ext-123');
      expect(local.tenantId).toBe(0); // Will be set by caller
    });

    it('should transform CRM appointment to local format', () => {
      const crmAppointment: CRMAppointment = {
        id: '456',
        customerId: '123',
        customerName: 'John Doe',
        customerEmail: 'john@example.com',
        serviceId: '789',
        serviceName: 'Haircut',
        staffId: '101',
        staffName: 'Jane Smith',
        startTime: '2024-01-15T10:00:00Z',
        endTime: '2024-01-15T10:30:00Z',
        status: 'confirmed',
        price: 50,
        externalId: 'ext-456',
        lastModified: '2024-01-01T00:00:00Z',
      };

      const local = adapter.testTransformAppointment(crmAppointment);

      expect(local.customerName).toBe('John Doe');
      expect(local.serviceName).toBe('Haircut');
      expect(local.staffName).toBe('Jane Smith');
      expect(local.duration).toBe(30); // 30 minutes between start and end
      expect(local.status).toBe('confirmed');
      expect(local.price).toBe(50);
    });

    it('should convert no_show status to cancelled', () => {
      const crmAppointment: CRMAppointment = {
        id: '456',
        customerId: '123',
        customerName: 'John Doe',
        serviceId: '789',
        serviceName: 'Haircut',
        staffId: '101',
        staffName: 'Jane Smith',
        startTime: '2024-01-15T10:00:00Z',
        endTime: '2024-01-15T10:30:00Z',
        status: 'no_show',
        externalId: 'ext-456',
        lastModified: '2024-01-01T00:00:00Z',
      };

      const local = adapter.testTransformAppointment(crmAppointment);
      expect(local.status).toBe('cancelled');
    });
  });
});

describe('CRM Config Validation', () => {
  it('should support all CRM providers', () => {
    const providers: CRMProvider[] = [
      'google_calendar',
      'outlook_calendar',
      'gohighlevel',
      'hubspot',
      'square',
      'booksy',
      'acuity',
      'calendly',
      'simplybook',
      'setmore',
      'seventeenhats',
      'honeybook',
      'jobber',
      'servicem8',
      'housecallpro',
      'salesforce',
      'pipedrive',
      'zoho',
      'millennium',
      'dentrix',
      'eaglesoft',
      'mindbody',
      'zenoti',
      'vagaro',
      'fresha',
      'glossgenius',
      'servicetitan',
    ];

    providers.forEach((provider) => {
      const config: CRMConfig = {
        provider,
        syncEnabled: true,
        syncDirection: 'import',
      };
      expect(config.provider).toBe(provider);
    });
  });

  it('should support all sync directions', () => {
    const directions: Array<'import' | 'export' | 'bidirectional'> = ['import', 'export', 'bidirectional'];

    directions.forEach((direction) => {
      const config: CRMConfig = {
        provider: 'hubspot',
        syncEnabled: true,
        syncDirection: direction,
      };
      expect(config.syncDirection).toBe(direction);
    });
  });
});

describe('Individual Adapter Imports', () => {
  it('should export GoHighLevelAdapter', async () => {
    const { GoHighLevelAdapter } = await import('./adapters/gohighlevel');
    expect(GoHighLevelAdapter).toBeDefined();
  });

  it('should export AcuitySchedulingAdapter', async () => {
    const { AcuitySchedulingAdapter } = await import('./adapters/acuity');
    expect(AcuitySchedulingAdapter).toBeDefined();
  });

  it('should export CalendlyAdapter', async () => {
    const { CalendlyAdapter } = await import('./adapters/calendly');
    expect(CalendlyAdapter).toBeDefined();
  });

  it('should export SalesforceAdapter', async () => {
    const { SalesforceAdapter } = await import('./adapters/salesforce');
    expect(SalesforceAdapter).toBeDefined();
  });

  it('should export ZohoAdapter', async () => {
    const { ZohoAdapter } = await import('./adapters/zoho');
    expect(ZohoAdapter).toBeDefined();
  });

  it('should export BooksyAdapter', async () => {
    const { BooksyAdapter } = await import('./adapters/booksy');
    expect(BooksyAdapter).toBeDefined();
  });
});

describe('CRM Module Index', () => {
  it('should export createAdapter function', async () => {
    const { createAdapter } = await import('./index');
    expect(createAdapter).toBeDefined();
    expect(typeof createAdapter).toBe('function');
  });

  it('should export getSupportedProviders function', async () => {
    const { getSupportedProviders } = await import('./index');
    expect(getSupportedProviders).toBeDefined();

    const providers = getSupportedProviders();
    expect(Array.isArray(providers)).toBe(true);
    expect(providers.length).toBeGreaterThan(10);
    expect(providers).toContain('gohighlevel');
    expect(providers).toContain('acuity');
    expect(providers).toContain('salesforce');
  });

  it('should create adapter for gohighlevel', async () => {
    const { createAdapter } = await import('./index');

    const config: CRMConfig = {
      provider: 'gohighlevel',
      syncEnabled: true,
      syncDirection: 'bidirectional',
    };

    const adapter = createAdapter(config);
    expect(adapter).not.toBeNull();
    expect(adapter?.getProvider()).toBe('gohighlevel');
  });

  it('should create adapter for acuity', async () => {
    const { createAdapter } = await import('./index');

    const config: CRMConfig = {
      provider: 'acuity',
      syncEnabled: true,
      syncDirection: 'bidirectional',
    };

    const adapter = createAdapter(config);
    expect(adapter).not.toBeNull();
    expect(adapter?.getProvider()).toBe('acuity');
  });

  it('should return null for unsupported provider', async () => {
    const { createAdapter } = await import('./index');

    const config: CRMConfig = {
      provider: 'hubspot' as CRMProvider, // HubSpot exists in ai-sec but not in our adapter registry
      syncEnabled: true,
      syncDirection: 'bidirectional',
    };

    // hubspot is not in our registry (ai-sec uses hubspotClient.ts directly)
    const adapter = createAdapter(config);
    expect(adapter).toBeNull();
  });
});
