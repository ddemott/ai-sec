import {
  type TelephonyProvider,
  type TelephonyCallRequest,
  type TelephonySMSRequest,
} from './TelephonyProvider.interface.js';

export class TelnyxSmsAdapter implements TelephonyProvider {
  private apiKey: string;

  constructor() {
    this.apiKey = process.env.TELNYX_API_KEY || '';
  }

  getName(): string {
    return 'telnyx';
  }

  makeCall(_request: TelephonyCallRequest): Promise<{ callSid: string }> {
    return Promise.reject(
      new Error('TelnyxSmsAdapter: voice calls are handled by LiveKit, not this adapter')
    );
  }

  async sendSMS(request: TelephonySMSRequest): Promise<{ messageSid: string }> {
    if (!this.apiKey) {
      throw new Error('TELNYX_API_KEY not configured');
    }

    // Attach per-message webhook_url (delivery receipts) when a backend public
    // base URL is configured, same pattern as TwilioAdapter.statusCallback.
    // tenant_id rides on the query param so the webhook can attribute the row.
    const baseUrl = process.env.BACKEND_PUBLIC_URL;
    const webhookUrl =
      baseUrl && baseUrl.trim() !== ''
        ? `${baseUrl.replace(/\/$/, '')}/communications/telnyx/status?tenant_id=${encodeURIComponent(
            request.tenantId
          )}`
        : undefined;

    const response = await fetch('https://api.telnyx.com/v2/messages', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: request.from,
        to: request.to,
        text: request.body,
        ...(webhookUrl ? { webhook_url: webhookUrl } : {}),
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Telnyx SMS failed ${response.status}: ${body}`);
    }

    const data = (await response.json()) as { data: { id: string } };
    return { messageSid: data.data.id };
  }

  createInstruction(
    _action: 'say' | 'gather' | 'record' | 'hangup' | 'dial' | 'redirect',
    _options: Record<string, unknown>
  ): string {
    throw new Error('TelnyxSmsAdapter: createInstruction not supported — use LiveKit for voice');
  }

  wrapResponse(_instructions: string): string {
    throw new Error('TelnyxSmsAdapter: wrapResponse not supported — use LiveKit for voice');
  }

  generateInstruction(
    _action: 'say' | 'gather' | 'record' | 'hangup',
    _options: Record<string, unknown>
  ): string {
    throw new Error('TelnyxSmsAdapter: generateInstruction not supported — use LiveKit for voice');
  }
}
