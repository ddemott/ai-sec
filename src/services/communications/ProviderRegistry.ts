import { type TelephonyProvider } from './TelephonyProvider.interface.js';
import { TelnyxSmsAdapter } from './TelnyxSmsAdapter.js';
import { MockAdapter } from './MockAdapter.js';

export class ProviderRegistry {
  private providers: Map<string, TelephonyProvider> = new Map();
  private defaultProviderName: string;

  constructor() {
    // Register available providers
    const telnyx = new TelnyxSmsAdapter();
    const mock = new MockAdapter();

    this.registerProvider(telnyx);
    this.registerProvider(mock);

    // Determine default provider. Validate against the registered set: a stale
    // TELEPHONY_PROVIDER (e.g. 'twilio' after Twilio removal) must NOT become the
    // default, or getProvider()'s fallback `.get(defaultProviderName)!` returns
    // undefined and crashes. Unknown values fall back to 'telnyx'.
    if (this.shouldUseSimulationMode()) {
      this.defaultProviderName = 'mock';
    } else {
      const requested = process.env.TELEPHONY_PROVIDER || 'telnyx';
      this.defaultProviderName = this.providers.has(requested) ? requested : 'telnyx';
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
    return !process.env.TELNYX_API_KEY;
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
