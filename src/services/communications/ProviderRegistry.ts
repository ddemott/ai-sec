import { type TelephonyProvider } from './TelephonyProvider.interface.js';
import { TwilioAdapter } from './TwilioAdapter.js';
import { TelnyxSmsAdapter } from './TelnyxSmsAdapter.js';
import { MockAdapter } from './MockAdapter.js';

export class ProviderRegistry {
  private providers: Map<string, TelephonyProvider> = new Map();
  private defaultProviderName: string;

  constructor() {
    // Register available providers
    const twilio = new TwilioAdapter();
    const telnyx = new TelnyxSmsAdapter();
    const mock = new MockAdapter();

    this.registerProvider(twilio);
    this.registerProvider(telnyx);
    this.registerProvider(mock);

    // Determine default provider
    if (this.shouldUseSimulationMode()) {
      this.defaultProviderName = 'mock';
    } else {
      this.defaultProviderName = process.env.TELEPHONY_PROVIDER || 'twilio';
    }
  }

  private shouldUseSimulationMode(): boolean {
    if (
      process.env.TELEPHONY_SIMULATION_MODE === 'true' ||
      process.env.SMS_SIMULATION_MODE === 'true'
    ) {
      return true;
    }

    const nodeEnv = (process.env.NODE_ENV || '').toLowerCase();
    if (nodeEnv === 'test') {
      return true;
    }

    if (process.env.VITEST || process.env.VITEST_WORKER_ID || process.env.JEST_WORKER_ID) {
      return true;
    }

    // Fallback to mock if the selected provider has no credentials
    const provider = process.env.TELEPHONY_PROVIDER || 'twilio';
    if (provider === 'telnyx') {
      return !process.env.TELNYX_API_KEY;
    }
    return !process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN;
  }

  registerProvider(provider: TelephonyProvider): void {
    this.providers.set(provider.getName(), provider);
  }

  getProvider(name?: string): TelephonyProvider {
    const providerName = name || this.defaultProviderName;
    const provider = this.providers.get(providerName);

    if (!provider) {
      console.warn(`Telephony provider '${providerName}' not found, falling back to default`);
      return this.providers.get(this.defaultProviderName)!;
    }

    return provider;
  }

  getDefaultProvider(): TelephonyProvider {
    return this.getProvider(this.defaultProviderName);
  }
}

// Export a singleton instance
export const providerRegistry = new ProviderRegistry();
