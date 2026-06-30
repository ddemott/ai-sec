import { normalizePhone } from '../../shared/phone';

/**
 * True when forwardPhone (the live-transfer target) would loop a call back
 * into the assistant — i.e. it equals the forwarded-from line OR the AI's own
 * inbound DID. Comparison is on strict E.164 so format variants collapse.
 * A null/blank/un-normalizable forwardPhone can never loop.
 */
export function phonesWouldLoop(
  forwardPhone: string | null | undefined,
  forwardedFromPhone: string | null | undefined,
  inboundPhone: string | null | undefined
): boolean {
  const forward = normalizePhone(forwardPhone);
  if (!forward) return false;
  const forwardedFrom = normalizePhone(forwardedFromPhone);
  const inbound = normalizePhone(inboundPhone);
  return forward === forwardedFrom || forward === inbound;
}
