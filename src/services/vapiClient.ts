import fs from 'node:fs';
import path from 'node:path';

const VAPI_BASE_URL = 'https://api.vapi.ai';

interface TenantConfig {
  id: string;
  name: string;
  business_type: string;
  voice_id: string;
  system_prompt: string;
  first_message: string;
  default_resource_id: string;
}

interface CreateAssistantResult {
  id: string;
}

interface CreatePhoneNumberResult {
  id: string;
  number: string;
}

export class VapiClient {
  constructor(
    private apiKey: string,
    private serverUrl: string,
    private serverUrlSecret: string
  ) {}

  private async request<T>(method: string, endpoint: string, body?: unknown): Promise<T> {
    const res = await fetch(`${VAPI_BASE_URL}${endpoint}`, {
      method,
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Vapi API ${method} ${endpoint} failed (${res.status}): ${text}`);
    }

    if (method === 'DELETE') return {} as T;
    return res.json() as Promise<T>;
  }

  buildAssistantPayload(tenant: TenantConfig): Record<string, unknown> {
    // Read template
    const templatePath = path.resolve(__dirname, '..', '..', 'vapi', 'agent.template.json');
    const toolsPath = path.resolve(__dirname, '..', '..', 'vapi', 'tools.json');

    let template = fs.readFileSync(templatePath, 'utf-8');
    const tools = JSON.parse(fs.readFileSync(toolsPath, 'utf-8'));

    // Determine voice provider from voice_id pattern
    const voiceProvider = tenant.voice_id?.includes('-') ? 'cartesia' : '11labs';

    // Service description from business type
    const serviceDescriptions: Record<string, string> = {
      'mobile-tire': 'mobile tire services including tire rotations, flat repairs, and new tire installations',
      'auto-shop': 'automotive repair and maintenance services',
      'salon': 'hair styling, coloring, and beauty services',
      'barber': 'haircuts, shaves, and grooming services',
      'nail-salon': 'manicures, pedicures, and nail art services',
      'spa': 'massage, facial, and wellness services',
      'hvac': 'heating, ventilation, and air conditioning services',
      'plumbing': 'plumbing repair and installation services',
      'electrical': 'electrical repair and installation services',
      'cleaning': 'residential and commercial cleaning services',
      'fitness': 'personal training, classes, and fitness services',
      'yoga': 'yoga classes and private sessions',
      'restaurant': 'dining reservations and catering services',
      'cafe': 'coffee and food service',
      'pet-grooming': 'pet grooming, bathing, and styling services',
      'pet-boarding': 'pet boarding and daycare services',
    };
    const serviceDescription = serviceDescriptions[tenant.business_type] || 'services';

    // Template variable substitution
    const replacements: Record<string, string> = {
      '{{TENANT_NAME}}': tenant.name,
      '{{TENANT_ID}}': tenant.id,
      '{{BUSINESS_TYPE}}': tenant.business_type,
      '{{RESOURCE_ID}}': tenant.default_resource_id,
      '{{CURRENT_DATE}}': new Date().toISOString().split('T')[0],
      '{{VOICE_PROVIDER}}': voiceProvider,
      '{{VOICE_ID}}': tenant.voice_id,
      '{{SERVER_URL}}': this.serverUrl,
      '{{SERVER_URL_SECRET}}': this.serverUrlSecret,
      '{{SERVICE_DESCRIPTION}}': serviceDescription,
    };

    for (const [key, value] of Object.entries(replacements)) {
      template = template.split(key).join(value);
    }

    const payload = JSON.parse(template);

    // Replace tool name references with full tool definitions
    if (payload.model?.tools) {
      payload.model.tools = tools;
    }

    return payload;
  }

  async createAssistant(tenant: TenantConfig): Promise<CreateAssistantResult> {
    const payload = this.buildAssistantPayload(tenant);
    return this.request<CreateAssistantResult>('POST', '/assistant', payload);
  }

  async deleteAssistant(id: string): Promise<void> {
    await this.request('DELETE', `/assistant/${id}`);
  }

  async createPhoneNumber(assistantId: string, areaCode?: string): Promise<CreatePhoneNumberResult> {
    const body: Record<string, unknown> = {
      assistantId,
      provider: 'vapi',
    };
    if (areaCode) {
      body.numberDesiredAreaCode = areaCode;
    }
    return this.request<CreatePhoneNumberResult>('POST', '/phone-number', body);
  }

  async deletePhoneNumber(id: string): Promise<void> {
    await this.request('DELETE', `/phone-number/${id}`);
  }
}
