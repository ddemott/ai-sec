import type { TelnyxProvisioningConfig } from '../routes/provisioning';
import type { TelnyxNumbersClient } from './telnyxNumbers';

/**
 * Zero-network stand-in for TelnyxProvisioningConfig, active only when
 * PROVISIONING_E2E_STUB=1 (strict opt-in, same discipline as
 * KNOWLEDGE_IMPORT_E2E_STUB). activatePhone() itself short-circuits before
 * ever calling telnyx.client's methods (see provisioningService.ts) — this
 * object exists so any OTHER code path that touches it (deactivatePhone's
 * release(), for instance) degrades safely instead of making a real,
 * doomed-to-fail HTTP call with no configured API key.
 *
 * The cast below is deliberate: TelnyxNumbersClient has a private `apiKey`
 * field, which makes it nominally typed — no plain object literal can ever
 * satisfy it structurally, regardless of how its public methods line up.
 * (Test files sidestep this too, but only because `*.test.ts` is excluded
 * from tsconfig.json's type-checked `include` — vitest transpiles without
 * type-checking. This file has no such exclusion, so the cast is required
 * here.) Every method below is called out explicitly so a signature drift
 * on the real TelnyxNumbersClient is at least visible in a diff here, even
 * without the compiler enforcing it structurally.
 */
export function buildStubTelnyxProvisioning(): TelnyxProvisioningConfig {
  const client = {
    searchAvailable: (areaCode?: string) =>
      Promise.resolve({
        phone_number: `+1${areaCode || '555'}${Date.now().toString().slice(-7)}`,
      }),
    orderNumber: (phoneNumber: string) =>
      Promise.resolve({ id: `stub-order-${Date.now()}`, phone_number: phoneNumber }),
    findPhoneNumberIdByNumber: (_phoneNumber: string) => Promise.resolve(`stub-pn-${Date.now()}`),
    getPhoneNumber: (phoneNumberId: string) =>
      Promise.resolve({
        id: phoneNumberId,
        phone_number: '+15555550000',
        connection_id: 'stub-sip-connection',
        status: 'active',
      }),
    assignToConnection: (_phoneNumberId: string, _connectionId: string) =>
      Promise.resolve(undefined), // no-op — nothing to assign against
    release: (_phoneNumberId: string) => Promise.resolve(undefined), // no-op — nothing to release
  } as unknown as TelnyxNumbersClient;

  return { sipConnectionId: 'stub-sip-connection', client };
}
