export interface EmailMessage {
  to: string;
  subject?: string;
  text?: string;
  html?: string;
  template?: string;
  templateData?: Record<string, any>;
}

export interface SMSMessage {
  to: string;
  body?: string;
  template?: string;
  templateData?: Record<string, any>;
}

export interface CommunicationResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

export interface AppointmentData {
  customerName: string;
  serviceName: string;
  staffName: string;
  dateTime: string;
  duration: number;
  notes?: string;
}

export interface ReminderData extends AppointmentData {
  hoursUntilAppointment: number;
}
