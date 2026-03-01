import type { TelephonyProvider } from '../core/providers';

export class LoggingTelephonyProvider implements TelephonyProvider {
  async sendSms(to: string, text: string): Promise<void> {
    // In the PoC, just log instead of calling a real SMS API.
    // eslint-disable-next-line no-console
    console.log(`[Telephony] SMS to ${to}: ${text}`);
  }
}
