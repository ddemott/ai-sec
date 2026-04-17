import { BaseCRMAdapter, TokenManagerInterface } from '../types';
import type {
  CRMConfig,
  CRMCustomer,
  CRMAppointment,
  CRMService,
  CRMStaff,
  CRMWebhookPayload,
} from '../types';

export class GoHighLevelAdapter extends BaseCRMAdapter {
  private baseUrl = 'https://rest.gohighlevel.com/v1';

  constructor(config: CRMConfig, tokenManager?: TokenManagerInterface) {
    super(config, tokenManager);
  }

  getProvider(): 'gohighlevel' {
    return 'gohighlevel';
  }

  async refreshAccessToken(): Promise<string | null> {
    if (!this.tokenManager) return null;

    const refreshToken = await this.tokenManager.getRefreshToken!(
      this.config.tenantId,
      this.getProvider(),
    );
    if (!refreshToken) return null;

    const clientId = process.env.GHL_CLIENT_ID;
    const clientSecret = process.env.GHL_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      throw new Error('GHL_CLIENT_ID or GHL_CLIENT_SECRET not configured');
    }

    try {
      const response = await fetch('https://services.leadconnectorhq.com/oauth/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          refresh_token: refreshToken,
          client_id: clientId,
          client_secret: clientSecret,
          grant_type: 'refresh_token',
        }),
      });

      if (!response.ok) {
        throw new Error(`GHL token refresh failed: ${response.status}`);
      }

      const data = await response.json();

      await this.tokenManager.storeToken!(this.config.tenantId!, this.getProvider(), {
        accessToken: data.access_token,
        refreshToken: data.refresh_token, // GHL returns a new refresh token
        expiresIn: data.expires_in,
      });

      return data.access_token;
    } catch (error) {
      console.error('[GoHighLevelAdapter] Refresh Error:', error);
      return null;
    }
  }

  getAuthUrl(state: string): string {
    const clientId = process.env.GHL_CLIENT_ID;
    if (!clientId) throw new Error('GHL_CLIENT_ID not configured');

    const params = new URLSearchParams({
      client_id: clientId,
      response_type: 'code',
      redirect_uri: process.env.GHL_REDIRECT_URI || '',
      scope: 'contacts.readonly contacts.write calendars.readonly calendars.write',
      state,
    });

    return `https://services.leadconnectorhq.com/oauth/chooselocation?${params.toString()}`;
  }

  async exchangeCode(
    code: string,
  ): Promise<{ accessToken: string; refreshToken?: string; expiresIn: number; scope: string }> {
    const response = await fetch('https://services.leadconnectorhq.com/oauth/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: process.env.GHL_CLIENT_ID || '',
        client_secret: process.env.GHL_CLIENT_SECRET || '',
        grant_type: 'authorization_code',
        code,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`GHL code exchange failed: ${error}`);
    }

    const data = await response.json();
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in,
      scope: data.scope,
    };
  }

  async testConnection(): Promise<boolean> {
    try {
      const token = await this.getAccessToken();
      const response = await fetch(`${this.baseUrl}/contacts`, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });
      return response.ok;
    } catch (error) {
      console.error('GoHighLevel connection test failed:', error);
      return false;
    }
  }

  async getCustomers(since?: string): Promise<CRMCustomer[]> {
    try {
      const token = await this.getAccessToken();
      const url = since
        ? `${this.baseUrl}/contacts?updatedAt=${since}`
        : `${this.baseUrl}/contacts`;

      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`GoHighLevel API error: ${response.status}`);
      }

      const data = await response.json();
      return data.contacts.map(this.transformGoHighLevelContact.bind(this));
    } catch (error) {
      console.error('Error fetching GoHighLevel customers:', error);
      throw error; // Re-throw error so CRMService can handle it
    }
  }

  async createCustomer(
    customer: Omit<CRMCustomer, 'id' | 'externalId' | 'lastModified'>,
  ): Promise<CRMCustomer> {
    try {
      const token = await this.getAccessToken();
      const payload = {
        firstName: customer.firstName,
        lastName: customer.lastName,
        email: customer.email,
        phone: customer.phone,
        tags: customer.tags,
        customField: {
          notes: customer.notes,
        },
      };

      const response = await fetch(`${this.baseUrl}/contacts`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error(`GoHighLevel API error: ${response.status}`);
      }

      const data = await response.json();
      return this.transformGoHighLevelContact(data.contact);
    } catch (error) {
      console.error('Error creating GoHighLevel customer:', error);
      throw error;
    }
  }

  async updateCustomer(id: string, customer: Partial<CRMCustomer>): Promise<CRMCustomer> {
    try {
      const token = await this.getAccessToken();
      const payload: any = {};
      if (customer.firstName) payload.firstName = customer.firstName;
      if (customer.lastName) payload.lastName = customer.lastName;
      if (customer.email) payload.email = customer.email;
      if (customer.phone) payload.phone = customer.phone;
      if (customer.tags) payload.tags = customer.tags;
      if (customer.notes) payload.customField = { notes: customer.notes };

      const response = await fetch(`${this.baseUrl}/contacts/${id}`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error(`GoHighLevel API error: ${response.status}`);
      }

      const data = await response.json();
      return this.transformGoHighLevelContact(data.contact);
    } catch (error) {
      console.error('Error updating GoHighLevel customer:', error);
      throw error;
    }
  }

  async deleteCustomer(id: string): Promise<boolean> {
    try {
      const token = await this.getAccessToken();
      const response = await fetch(`${this.baseUrl}/contacts/${id}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      return response.ok;
    } catch (error) {
      console.error('Error deleting GoHighLevel customer:', error);
      return false;
    }
  }

  async getAppointments(startDate: string, endDate: string): Promise<CRMAppointment[]> {
    try {
      const token = await this.getAccessToken();
      const url = `${this.baseUrl}/appointments?startDate=${startDate}&endDate=${endDate}`;

      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`GoHighLevel API error: ${response.status}`);
      }

      const data = await response.json();
      return data.appointments.map(this.transformGoHighLevelAppointment.bind(this));
    } catch (error) {
      console.error('Error fetching GoHighLevel appointments:', error);
      return [];
    }
  }

  async createAppointment(
    appointment: Omit<CRMAppointment, 'id' | 'externalId' | 'lastModified'>,
  ): Promise<CRMAppointment> {
    try {
      const token = await this.getAccessToken();
      const payload = {
        contactId: appointment.customerId,
        calendarId: this.config.locationId,
        title: `${appointment.serviceName} with ${appointment.staffName}`,
        startTime: appointment.startTime,
        endTime: appointment.endTime,
        notes: appointment.notes,
        status: appointment.status,
      };

      const response = await fetch(`${this.baseUrl}/appointments`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error(`GoHighLevel API error: ${response.status}`);
      }

      const data = await response.json();
      return this.transformGoHighLevelAppointment(data.appointment);
    } catch (error) {
      console.error('Error creating GoHighLevel appointment:', error);
      throw error;
    }
  }

  async updateAppointment(
    id: string,
    appointment: Partial<CRMAppointment>,
  ): Promise<CRMAppointment> {
    try {
      const token = await this.getAccessToken();
      const payload: any = {};
      if (appointment.startTime) payload.startTime = appointment.startTime;
      if (appointment.endTime) payload.endTime = appointment.endTime;
      if (appointment.notes) payload.notes = appointment.notes;
      if (appointment.status) payload.status = appointment.status;

      const response = await fetch(`${this.baseUrl}/appointments/${id}`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error(`GoHighLevel API error: ${response.status}`);
      }

      const data = await response.json();
      return this.transformGoHighLevelAppointment(data.appointment);
    } catch (error) {
      console.error('Error updating GoHighLevel appointment:', error);
      throw error;
    }
  }

  async cancelAppointment(id: string, reason?: string): Promise<boolean> {
    try {
      const token = await this.getAccessToken();
      const payload = {
        status: 'cancelled',
        notes: reason ? `Cancelled: ${reason}` : 'Cancelled',
      };

      const response = await fetch(`${this.baseUrl}/appointments/${id}`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
      return response.ok;
    } catch (error) {
      console.error('Error cancelling GoHighLevel appointment:', error);
      return false;
    }
  }

  async getServices(): Promise<CRMService[]> {
    try {
      const token = await this.getAccessToken();
      const response = await fetch(`${this.baseUrl}/products?type=service`, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`GoHighLevel API error: ${response.status}`);
      }

      const data = await response.json();
      return data.products.map(this.transformGoHighLevelService.bind(this));
    } catch (error) {
      console.error('Error fetching GoHighLevel services:', error);
      return [];
    }
  }

  async createService(
    _service: Omit<CRMService, 'id' | 'externalId' | 'lastModified'>,
  ): Promise<CRMService> {
    // GoHighLevel services are typically managed through their UI
    throw new Error('Creating services via API not supported in GoHighLevel');
  }

  async updateService(_id: string, _service: Partial<CRMService>): Promise<CRMService> {
    // GoHighLevel services are typically managed through their UI
    throw new Error('Updating services via API not supported in GoHighLevel');
  }

  async getStaff(): Promise<CRMStaff[]> {
    try {
      const response = await fetch(`${this.baseUrl}/users`, {
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`GoHighLevel API error: ${response.status}`);
      }

      const data = await response.json();
      return data.users.map(this.transformGoHighLevelStaff.bind(this));
    } catch (error) {
      console.error('Error fetching GoHighLevel staff:', error);
      return [];
    }
  }

  async createStaff(
    _staff: Omit<CRMStaff, 'id' | 'externalId' | 'lastModified'>,
  ): Promise<CRMStaff> {
    // Staff management typically done through GoHighLevel UI
    throw new Error('Creating staff via API not supported in GoHighLevel');
  }

  async updateStaff(_id: string, _staff: Partial<CRMStaff>): Promise<CRMStaff> {
    // Staff management typically done through GoHighLevel UI
    throw new Error('Updating staff via API not supported in GoHighLevel');
  }

  async handleWebhook(payload: CRMWebhookPayload): Promise<void> {
    // Handle GoHighLevel webhooks for real-time sync
    console.log('GoHighLevel webhook received:', payload.event, payload.data);
    // Implementation would depend on webhook setup
  }

  async getLastModified(
    _entity: 'customers' | 'appointments' | 'services' | 'staff',
  ): Promise<string> {
    // GoHighLevel doesn't provide a direct way to get last modified timestamps
    // This would need to be tracked locally or use webhooks
    return new Date().toISOString();
  }

  // Private transformation methods
  private transformGoHighLevelContact(contact: any): CRMCustomer {
    return {
      id: contact.id,
      firstName: contact.firstName || '',
      lastName: contact.lastName || '',
      email: contact.email,
      phone: contact.phone,
      dateOfBirth: contact.dateOfBirth,
      notes: contact.customField?.notes,
      tags: contact.tags || [],
      externalId: contact.id,
      lastModified: contact.updatedAt || contact.createdAt,
    };
  }

  private transformGoHighLevelAppointment(appointment: any): CRMAppointment {
    return {
      id: appointment.id,
      customerId: appointment.contactId,
      customerName: appointment.contactName || '',
      customerEmail: appointment.contactEmail,
      customerPhone: appointment.contactPhone,
      serviceId: appointment.serviceId || '',
      serviceName: appointment.title || '',
      staffId: appointment.userId || '',
      staffName: appointment.userName || '',
      startTime: appointment.startTime,
      endTime: appointment.endTime,
      status: this.mapGoHighLevelStatus(appointment.status),
      notes: appointment.notes,
      price: appointment.price,
      externalId: appointment.id,
      lastModified: appointment.updatedAt || appointment.createdAt,
    };
  }

  private transformGoHighLevelService(service: any): CRMService {
    return {
      id: service.id,
      name: service.name,
      description: service.description,
      duration: service.duration || 60, // Default 60 minutes
      price: service.price || 0,
      category: service.category,
      active: service.active !== false,
      externalId: service.id,
      lastModified: service.updatedAt || service.createdAt,
    };
  }

  private transformGoHighLevelStaff(user: any): CRMStaff {
    return {
      id: user.id,
      firstName: user.firstName || '',
      lastName: user.lastName || '',
      email: user.email,
      phone: user.phone,
      role: user.role || 'staff',
      services: user.services || [],
      active: user.active !== false,
      externalId: user.id,
      lastModified: user.updatedAt || user.createdAt,
    };
  }

  private mapGoHighLevelStatus(
    status: string,
  ): 'confirmed' | 'cancelled' | 'completed' | 'no_show' {
    switch (status?.toLowerCase()) {
      case 'confirmed':
      case 'scheduled':
        return 'confirmed';
      case 'cancelled':
      case 'canceled':
        return 'cancelled';
      case 'completed':
      case 'done':
        return 'completed';
      case 'no_show':
      case 'no-show':
        return 'no_show';
      default:
        return 'confirmed';
    }
  }
}
