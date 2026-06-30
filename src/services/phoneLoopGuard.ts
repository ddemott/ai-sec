import { normalizePhone } from '../../shared/phone';

/**
 * True when forwardPhone (the live-transfer target) would loop a call back
 * into the assistant — i.e. it equals the forwarded-from line OR the AI's own
 * inbound DID. Numbers are compared after `normalizePhone()`, which yields
 * strict +1XXXXXXXXXX for US inputs (the product's scope) so format variants
 * collapse; an already-`+`-prefixed international number is passed through as
 * entered, so the match is exact for US numbers and best-effort for the rest.
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
