import { type Appointment, type Customer } from './types';

// Helper to get a fixed time for tomorrow or day after
const getFixedDate = (daysOut: number, hours: number, minutes: number) => {
  const d = new Date();
  d.setDate(d.getDate() + daysOut);
  d.setHours(hours, minutes, 0, 0);
  return d.toISOString();
};

export const MOCK_TENANT = {
  // Bella's Hair Studio — always present after DB seed; safe fallback when
  // the real tenant config fetch fails. Previously pointed at DynaTire
  // (removed 2026-06-03), which caused a 404 → forceLogout cascade.
  tenant_id: 'b3e1aaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
  name: "Bella's Hair Studio",
  business_type: 'salon_v1',
  system_prompt: "You are a professional, helpful secretary for Bella's Hair Studio...",
  first_message: null,
  voice_id: 'ba124806-6962-4354-94a0-7607775952f4',
};

export const MOCK_CUSTOMERS: Customer[] = [
  {
    customer_id: '207b25bb-ef55-4df8-ac89-252f9dcd80b9',
    tenant_id: MOCK_TENANT.tenant_id,
    phone: '+15551112222',
    name: 'Bob Smith',
    email: 'bob@example.com',
    address: '123 Main St, New York, NY',
    metadata: { vehicle: '2022 Honda Civic', notes: 'Prefers morning appointments' },
  },
  {
    customer_id: '97704486-04d4-40ba-85f8-7a82e47e1611',
    tenant_id: MOCK_TENANT.tenant_id,
    phone: '+15550001111',
    name: 'Alice Johnson',
    email: 'alice@example.com',
    address: '456 Elm St, Brooklyn, NY',
    metadata: { vehicle: '2021 Tesla Model 3', notes: 'Has a slow leak in front left tire' },
  },
];

export const MOCK_APPOINTMENTS: Appointment[] = [
  {
    appointment_id: 'ffaf8ae5-7577-4951-86f3-3ff5c9dd9fd8',
    tenant_id: MOCK_TENANT.tenant_id,
    resource_id: '18288e57-a958-41e4-be5f-e95a8539a06b',
    customer_id: MOCK_CUSTOMERS[0].customer_id,
    start_time: getFixedDate(1, 9, 0), // Tomorrow at 9:00 AM
    end_time: getFixedDate(1, 10, 0),
    description: 'Standard Maintenance',
    location: '123 Main St, New York, NY',
    status: 'scheduled',
    customers: { name: 'Bob Smith', phone: '+15551112222' },
    resources: { name: 'Service Truck 1' },
  },
  {
    appointment_id: 'f92d33d3-007e-4508-a5ca-eb1a483c0b07',
    tenant_id: MOCK_TENANT.tenant_id,
    resource_id: '18288e57-a958-41e4-be5f-e95a8539a06b',
    customer_id: MOCK_CUSTOMERS[1].customer_id,
    start_time: getFixedDate(2, 13, 30), // Day after tomorrow at 1:30 PM
    end_time: getFixedDate(2, 14, 30),
    description: 'Flat Tire Repair',
    location: '456 Elm St, Brooklyn, NY',
    status: 'scheduled',
    customers: { name: 'Alice Johnson', phone: '+15550001111' },
    resources: { name: 'Service Truck 1' },
  },
];

export const MOCK_SUMMARIES = [
  {
    call_summary_id: 's1',
    customer_id: MOCK_CUSTOMERS[0].customer_id,
    summary: 'Bob called to ask about pricing for winter tires.',
    created_at: new Date(Date.now() - 86400000).toISOString(),
  },
];
