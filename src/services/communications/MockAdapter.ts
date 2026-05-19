import {
  type TelephonyProvider,
  type TelephonyCallRequest,
  type TelephonySMSRequest,
} from './TelephonyProvider.interface.js';

export class MockAdapter implements TelephonyProvider {
  getName(): string {
    return 'mock';
  }

  async makeCall(request: TelephonyCallRequest): Promise<{ callSid: string }> {
    console.log(`[Mock Telephony] Making call to ${request.to} for tenant ${request.tenantId}`);
    return { callSid: `mock_call_${Date.now()}` };
  }

  async sendSMS(request: TelephonySMSRequest): Promise<{ messageSid: string }> {
    console.log(
      `[Mock Telephony] Sending SMS to ${request.to} for tenant ${request.tenantId}: ${request.body}`,
    );
    return { messageSid: `mock_sms_${Date.now()}` };
  }

  createInstruction(action: string, options: Record<string, unknown>): string {
    const attrString = Object.entries(options)
      .filter(([key]) => !['text', 'say'].includes(key))
      .map(([key, value]) => `${key}="${value}"`)
      .join(' ');

    const openingTag = attrString ? `${action} ${attrString}` : action;
    const content = options.text || options.say || '';

    if (content) {
      return `<${openingTag}>${content}</${action}>`;
    }
    return `<${openingTag}/>`;
  }

  wrapResponse(instructions: string): string {
    return `<?xml version="1.0" encoding="UTF-8"?><Response>${instructions}</Response>`;
  }

  generateInstruction(action: 'say' | 'gather' | 'record' | 'hangup', options: Record<string, unknown>): string {
    return this.wrapResponse(this.createInstruction(action, options));
  }
}
