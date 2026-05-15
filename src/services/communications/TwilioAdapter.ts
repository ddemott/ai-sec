import twilio from 'twilio';
import {
  TelephonyProvider,
  TelephonyCallRequest,
  TelephonySMSRequest,
} from './TelephonyProvider.interface.js';

export class TwilioAdapter implements TelephonyProvider {
  private client?: twilio.Twilio;

  constructor() {
    if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
      this.client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    }
  }

  getName(): string {
    return 'twilio';
  }

  async makeCall(request: TelephonyCallRequest): Promise<{ callSid: string }> {
    if (!this.client) {
      throw new Error('Twilio client not configured');
    }

    const result = await this.client.calls.create({
      to: request.to,
      from: request.from,
      url: request.url,
    });

    return { callSid: result.sid };
  }

  async sendSMS(request: TelephonySMSRequest): Promise<{ messageSid: string }> {
    if (!this.client) {
      throw new Error('Twilio client not configured');
    }

    const result = await this.client.messages.create({
      to: request.to,
      from: request.from,
      body: request.body,
    });

    return { messageSid: result.sid };
  }

  createInstruction(
    action: 'say' | 'gather' | 'record' | 'hangup' | 'dial' | 'redirect',
    options: Record<string, unknown>,
  ): string {
    const response = new twilio.twiml.VoiceResponse();

    // Twilio's *Attributes types (SayAttributes, GatherAttributes, RecordAttributes)
    // are structural literal unions (e.g. SayVoice has 800+ values). At this adapter
    // boundary we trust the caller passes the right keys for the action; the SDK
    // surfaces runtime errors if not. Cast the full options bag per branch.
    type SayAttrs = Parameters<typeof response.say>[0];
    type GatherAttrs = Parameters<typeof response.gather>[0];
    type RecordAttrs = Parameters<typeof response.record>[0];
    switch (action) {
      case 'say':
        response.say(
          { voice: 'Polly.Joanna', language: 'en-US', ...options } as SayAttrs,
          options.text as string,
        );
        break;
      case 'gather': {
        const gather = response.gather(options as GatherAttrs);
        if (options.say) {
          gather.say(
            { voice: 'Polly.Joanna', language: 'en-US', ...options } as SayAttrs,
            options.say as string,
          );
        }
        break;
      }
      case 'record':
        response.record(options as RecordAttrs);
        break;
      case 'hangup':
        response.hangup();
        break;
      case 'dial':
        response.dial(options.phoneNumber as string);
        break;
      case 'redirect':
        response.redirect(options.url as string);
        break;
    }

    // Extract only the inner XML tag
    const fullXml = response.toString();
    return fullXml
      .replace('<?xml version="1.0" encoding="UTF-8"?><Response>', '')
      .replace('</Response>', '');
  }

  wrapResponse(instructions: string): string {
    return `<?xml version="1.0" encoding="UTF-8"?><Response>${instructions}</Response>`;
  }

  generateInstruction(action: 'say' | 'gather' | 'record' | 'hangup', options: Record<string, unknown>): string {
    const instruction = this.createInstruction(action, options);
    return this.wrapResponse(instruction);
  }
}
