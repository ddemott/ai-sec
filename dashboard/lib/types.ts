export interface Appointment {
  id: string;
  tenant_id: string;
  resource_id: string;
  customer_id: string;
  start_time: string;
  end_time: string;
  status: 'scheduled' | 'completed' | 'canceled';
  description: string;
  location?: string; // New field
  customers?: {
    name: string;
    phone: string;
  };
  resources?: {
    name: string;
  };
}

export interface Customer {
  id: string;
  tenant_id: string;
  phone: string;
  name: string;
  email: string;
  address: string;
  metadata: any;
}

export interface Tenant {
  id: string;
  name: string;
  business_type: string;
  system_prompt: string;
  voice_id: string;
  first_message: string;
}

export interface BusinessTemplate {
  business_type: string;
  display_name: string;
  system_prompt_template: string;
  first_message: string;
  voice_id: string;
  default_resource_name: string;
  default_resource_description: string;
}
