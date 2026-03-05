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
    // Structured name fields
    first_name?: string;
    last_name?: string;
    // Combined display name (legacy / convenience)
    name: string;
    name: string;
  };
}

export interface Customer {
  id: string;
  tenant_id: string;
  phone: string;
  name: string; // full name (legacy)
  email: string;
  address: string; // address line 1
  // Optional structured fields
  first_name?: string;
  last_name?: string;
  address_line2?: string;
  city?: string;
  state?: string;
  postal_code?: string;
  timezone?: string;
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
