import { BaseCRMAdapter, TokenManagerInterface } from '../types';
import type {
  CRMConfig,
  CRMCustomer,
  CRMAppointment,
  CRMService,
  CRMStaff,
  CRMWebhookPayload,
} from '../types';

export class BooksyAdapter extends BaseCRMAdapter {
  constructor(config: CRMConfig, tokenManager?: TokenManagerInterface) {
    super(config, tokenManager);
  }

  getProvider(): 'booksy' {
    return 'booksy';
  }

  async testConnection(): Promise<boolean> {
    return false;
  }

  async getCustomers(_since?: string): Promise<CRMCustomer[]> {
    throw new Error('Booksy adapter not yet implemented');
  }

  async createCustomer(
    _customer: Omit<CRMCustomer, 'id' | 'externalId' | 'lastModified'>,
  ): Promise<CRMCustomer> {
    throw new Error('Booksy adapter not yet implemented');
  }

  async updateCustomer(_id: string, _customer: Partial<CRMCustomer>): Promise<CRMCustomer> {
    throw new Error('Booksy adapter not yet implemented');
  }

  async deleteCustomer(_id: string): Promise<boolean> {
    throw new Error('Booksy adapter not yet implemented');
  }

  async getAppointments(_startDate: string, _endDate: string): Promise<CRMAppointment[]> {
    throw new Error('Booksy adapter not yet implemented');
  }

  async createAppointment(
    _appointment: Omit<CRMAppointment, 'id' | 'externalId' | 'lastModified'>,
  ): Promise<CRMAppointment> {
    throw new Error('Booksy adapter not yet implemented');
  }

  async updateAppointment(
    _id: string,
    _appointment: Partial<CRMAppointment>,
  ): Promise<CRMAppointment> {
    throw new Error('Booksy adapter not yet implemented');
  }

  async cancelAppointment(_id: string, _reason?: string): Promise<boolean> {
    throw new Error('Booksy adapter not yet implemented');
  }

  async getServices(): Promise<CRMService[]> {
    throw new Error('Booksy adapter not yet implemented');
  }

  async createService(
    _service: Omit<CRMService, 'id' | 'externalId' | 'lastModified'>,
  ): Promise<CRMService> {
    throw new Error('Booksy adapter not yet implemented');
  }

  async updateService(_id: string, _service: Partial<CRMService>): Promise<CRMService> {
    throw new Error('Booksy adapter not yet implemented');
  }

  async getStaff(): Promise<CRMStaff[]> {
    throw new Error('Booksy adapter not yet implemented');
  }

  async createStaff(
    _staff: Omit<CRMStaff, 'id' | 'externalId' | 'lastModified'>,
  ): Promise<CRMStaff> {
    throw new Error('Booksy adapter not yet implemented');
  }

  async updateStaff(_id: string, _staff: Partial<CRMStaff>): Promise<CRMStaff> {
    throw new Error('Booksy adapter not yet implemented');
  }

  async handleWebhook(_payload: CRMWebhookPayload): Promise<void> {
    throw new Error('Booksy adapter not yet implemented');
  }

  async getLastModified(
    _entity: 'customers' | 'appointments' | 'services' | 'staff',
  ): Promise<string> {
    throw new Error('Booksy adapter not yet implemented');
  }

  protected async refreshAccessToken(): Promise<string | null> {
    return null;
  }
}
