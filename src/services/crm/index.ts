/**
 * CRM Integration Module
 *
 * Provides a unified interface for integrating with various CRM and scheduling platforms.
 * This module was migrated from ai-secretary to complement ai-sec's existing
 * provider-specific clients (hubspotClient, jobberClient, etc.).
 *
 * Usage:
 * - Import specific adapters for direct use
 * - Or use the registry pattern to dynamically instantiate adapters
 */

// Re-export types
export * from './types';

// Export adapters - using actual class names from files
export { GoHighLevelAdapter } from './adapters/gohighlevel';
export { AcuitySchedulingAdapter } from './adapters/acuity';
export { BooksyAdapter } from './adapters/booksy';
export { CalendlyAdapter } from './adapters/calendly';
export { DentrixAdapter } from './adapters/dentrix';
export { EaglesoftAdapter } from './adapters/eaglesoft';
export { FreshaAdapter } from './adapters/fresha';
export { GlossGeniusAdapter } from './adapters/glossgenius';
export { HoneyBookAdapter } from './adapters/honeybook';
export { HousecallProAdapter } from './adapters/housecallpro';
export { MillenniumAdapter } from './adapters/millennium';
export { MindbodyAdapter } from './adapters/mindbody';
export { PipedriveAdapter } from './adapters/pipedrive';
export { SalesforceAdapter } from './adapters/salesforce';
export { ServiceM8Adapter } from './adapters/servicem8';
export { SetmoreAdapter } from './adapters/setmore';
export { SeventeenHatsAdapter } from './adapters/seventeenhats';
export { SimplyBookAdapter } from './adapters/simplybook';
export { VagaroAdapter } from './adapters/vagaro';
export { ZenotiAdapter } from './adapters/zenoti';
export { ZohoAdapter } from './adapters/zoho';

// Adapter registry for dynamic instantiation
import type { CRMProvider, CRMConfig, TokenManagerInterface, BaseCRMAdapter } from './types';
import { GoHighLevelAdapter } from './adapters/gohighlevel';
import { AcuitySchedulingAdapter } from './adapters/acuity';
import { BooksyAdapter } from './adapters/booksy';
import { CalendlyAdapter } from './adapters/calendly';
import { DentrixAdapter } from './adapters/dentrix';
import { EaglesoftAdapter } from './adapters/eaglesoft';
import { FreshaAdapter } from './adapters/fresha';
import { GlossGeniusAdapter } from './adapters/glossgenius';
import { HoneyBookAdapter } from './adapters/honeybook';
import { HousecallProAdapter } from './adapters/housecallpro';
import { MillenniumAdapter } from './adapters/millennium';
import { MindbodyAdapter } from './adapters/mindbody';
import { PipedriveAdapter } from './adapters/pipedrive';
import { SalesforceAdapter } from './adapters/salesforce';
import { ServiceM8Adapter } from './adapters/servicem8';
import { SetmoreAdapter } from './adapters/setmore';
import { SeventeenHatsAdapter } from './adapters/seventeenhats';
import { SimplyBookAdapter } from './adapters/simplybook';
import { VagaroAdapter } from './adapters/vagaro';
import { ZenotiAdapter } from './adapters/zenoti';
import { ZohoAdapter } from './adapters/zoho';

type AdapterConstructor = new (config: CRMConfig, tokenManager?: TokenManagerInterface) => BaseCRMAdapter;

const adapterRegistry: Partial<Record<CRMProvider, AdapterConstructor>> = {
  gohighlevel: GoHighLevelAdapter,
  acuity: AcuitySchedulingAdapter,
  booksy: BooksyAdapter,
  calendly: CalendlyAdapter,
  dentrix: DentrixAdapter,
  eaglesoft: EaglesoftAdapter,
  fresha: FreshaAdapter,
  glossgenius: GlossGeniusAdapter,
  honeybook: HoneyBookAdapter,
  housecallpro: HousecallProAdapter,
  millennium: MillenniumAdapter,
  mindbody: MindbodyAdapter,
  pipedrive: PipedriveAdapter,
  salesforce: SalesforceAdapter,
  servicem8: ServiceM8Adapter,
  setmore: SetmoreAdapter,
  seventeenhats: SeventeenHatsAdapter,
  simplybook: SimplyBookAdapter,
  vagaro: VagaroAdapter,
  zenoti: ZenotiAdapter,
  zoho: ZohoAdapter,
};

/**
 * Create a CRM adapter instance for the given provider
 */
export function createAdapter(
  config: CRMConfig,
  tokenManager?: TokenManagerInterface
): BaseCRMAdapter | null {
  const AdapterClass = adapterRegistry[config.provider];
  if (!AdapterClass) {
    console.warn(`[CRM] No adapter registered for provider: ${config.provider}`);
    return null;
  }
  return new AdapterClass(config, tokenManager);
}

/**
 * Get list of supported CRM providers
 */
export function getSupportedProviders(): CRMProvider[] {
  return Object.keys(adapterRegistry) as CRMProvider[];
}
