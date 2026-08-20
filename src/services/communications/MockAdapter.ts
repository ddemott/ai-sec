import { type TelephonyProvider, type TelephonySMSRequest } from './TelephonyProvider.interface.js';

/**
 * The no-credentials provider. Selected by ProviderRegistry when no Telnyx key
 * is configured, so local and CI runs exercise the full send path without
 * touching a carrier.
 *
 * It used to also implement four TwiML-building methods (see the interface for
 * why those are gone). It never made a real call and nothing ever read the XML.
 */
export class MockAdapter implements TelephonyProvider {
  getName(): string {
    return 'mock';
  }

  sendSMS(request: TelephonySMSRequest): Promise<{ messageSid: string }> {
    console.log(
      `[Mock Telephony] Sending SMS to ${request.to} for tenant ${request.tenantId}: ${request.body}`
    );
    return Promise.resolve({ messageSid: `mock_sms_${Date.now()}` });
  }
}
