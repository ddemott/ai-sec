import { type TelephonyProvider, type TelephonySMSRequest } from './TelephonyProvider.interface.js';

export class TelnyxSmsAdapter implements TelephonyProvider {
  private apiKey: string;

  constructor() {
    this.apiKey = process.env.TELNYX_API_KEY || '';
  }

  getName(): string {
    return 'telnyx';
  }

  async sendSMS(request: TelephonySMSRequest): Promise<{ messageSid: string }> {
    if (!this.apiKey) {
      throw new Error('TELNYX_API_KEY not configured');
    }

    // Attach per-message webhook_url (delivery receipts) when a backend public
    // base URL is configured.
    // tenant_id rides on the query param so the webhook can attribute the row.
    const baseUrl = process.env.BACKEND_PUBLIC_URL;
    const webhookUrl =
      baseUrl && baseUrl.trim() !== ''
        ? `${baseUrl.replace(/\/$/, '')}/communications/telnyx/status?tenant_id=${encodeURIComponent(
            request.tenantId
          )}`
        : undefined;

    // Bounded, and this one matters most: THIS is the reminder worker's send
    // path. The worker guards its 60s tick with an `isRunning` flag and sends
    // sequentially, so an unbounded fetch means one hung socket to Telnyx pins
    // that flag true forever — every later tick returns early and ALL reminders
    // stop, silently, until someone redeploys. `/health` stays green throughout,
    // because nothing has crashed; the process is just waiting for a reply that
    // never comes. A timeout converts a permanent silent stall into a loud,
    // retryable error.
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
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Telnyx SMS failed ${response.status}: ${body}`);
    }

    const data = (await response.json()) as { data: { id: string } };
    return { messageSid: data.data.id };
  }
}
