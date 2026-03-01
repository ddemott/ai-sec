import type { Appointment } from './models';

export interface TelephonyProvider {
  // For now we only define notification SMS; full call handling comes later.
  sendSms(to: string, text: string): Promise<void>;
}

export interface NotificationProvider {
  notifyOwnerOfAppointment(appointment: Appointment): Promise<void>;
}

export interface LlmProvider {
  runSecretaryTurn(input: {
    tenantId: string;
    customerPhone: string;
    message: string;
  }): Promise<{ reply: string }>;
}
