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
