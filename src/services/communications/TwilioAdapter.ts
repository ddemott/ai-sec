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
    options: any,
  ): string {
    const response = new twilio.twiml.VoiceResponse();

    switch (action) {
      case 'say':
        response.say(
          {
            voice: options.voice || 'Polly.Joanna',
            language: options.language || 'en-US',
          },
          options.text,
        );
        break;
      case 'gather':
        const gather = response.gather(options);
        if (options.say) {
          gather.say(
            {
              voice: options.voice || 'Polly.Joanna',
              language: options.language || 'en-US',
            },
            options.say,
          );
        }
        break;
      case 'record':
        response.record(options);
        break;
      case 'hangup':
        response.hangup();
        break;
      case 'dial':
        response.dial(options.phoneNumber);
        break;
      case 'redirect':
        response.redirect(options.url);
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

  generateInstruction(action: 'say' | 'gather' | 'record' | 'hangup', options: any): string {
    const instruction = this.createInstruction(action, options);
    return this.wrapResponse(instruction);
  }
}
