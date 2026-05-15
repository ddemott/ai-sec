export interface ReminderSchedule {
  reminder_schedule_id: number;
  appointment_id: string;
  tenant_id: string;
  customer_email: string;
  customer_phone?: string;
  reminder_type: 'confirmation' | '72h' | '24h' | '2h';
  scheduled_for: string; // ISO date string
  sent_at?: string;
  status: 'scheduled' | 'sent' | 'failed' | 'cancelled';
  error?: string;
}

export interface ReminderData {
  appointment_id: string;
  tenant_id: string;
  customer_email: string;
  customer_phone?: string;
  reminder_type: 'confirmation' | '72h' | '24h' | '2h';
  scheduled_for: string;
}

