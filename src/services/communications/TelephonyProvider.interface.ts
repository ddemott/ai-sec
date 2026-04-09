export interface TelephonyCallRequest {
  to: string;
  from: string;
  url: string; // The URL to fetch instructions (TwiML or equivalent)
  tenantId: string;
}

export interface TelephonySMSRequest {
  to: string;
  from: string;
  body: string;
  tenantId: string;
}

export interface TelephonyProvider {
  /**
   * Get the name of the provider
   */
  getName(): string;

  /**
   * Initiate an outbound call
   */
  makeCall(request: TelephonyCallRequest): Promise<{ callSid: string }>;

  /**
   * Send an SMS message
   */
  sendSMS(request: TelephonySMSRequest): Promise<{ messageSid: string }>;

  /**
   * Create a provider-specific instruction tag (e.g., <Say>)
   */
  createInstruction(
    action: 'say' | 'gather' | 'record' | 'hangup' | 'dial' | 'redirect',
    options: any,
  ): string;

  /**
   * Wrap multiple instructions into a final response (e.g., <Response>...</Response>)
   */
  wrapResponse(instructions: string): string;

  /**
   * Legacy method for generating a single instruction response
   */
  generateInstruction(action: 'say' | 'gather' | 'record' | 'hangup', options: any): string;
}
