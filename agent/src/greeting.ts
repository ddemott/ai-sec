/**
 * Caller greeting composition.
 *
 * Every inbound call opens with three segments, in order:
 *
 *   1. OPENER    — tenant-controlled. Their "First Message", or a persona/name default.
 *   2. DISCLOSURE — fixed platform text. Not tenant-editable, never omitted.
 *   3. CLOSER    — fixed. Offers a human when the tenant has a transfer number.
 *
 * The disclosure is deliberately NOT part of the opener fallback chain. An
 * earlier design put the whole greeting behind `firstMessage` and spoke it
 * verbatim, which meant any owner who typed their own greeting silently
 * deleted the disclosure. A compliance line a customer can remove from a text
 * box is not a compliance line, so it is composed around their text instead.
 *
 * Wording rules — do not "improve" these without legal review. See
 * docs/legaldocs/AI_Secretary_Consent_and_Privacy_Language.md:
 *
 *   - "transcribed", never "recorded". The product stores a text transcript
 *     (transcript.ts → voice_sessions.transcript) and retains no audio. A
 *     disclosure that misdescribes the processing is worse than none.
 *   - "quality and service", never "training". Wiretap exposure for AI vendors
 *     turns on whether the vendor may use call contents for its own benefit
 *     (the Javier/Ambriz "capability" test); saying "training" concedes it.
 *   - The AI identity is disclosed even when a persona name is set. "Hi, this
 *     is Beth" implies a human, which is what keeps a CIPA §632 "confidential
 *     communication" claim alive.
 *   - The human opt-out is offered ONLY when forwardPhone is configured.
 *     Promising a transfer that cannot happen is worse than offering none.
 */

import type { TenantDisplayConfig } from './tenantConfig.js';

/**
 * The DEFAULT disclosure. Carries three things in one sentence: who the caller
 * reached, that it is an AI, and that call contents are captured, with a stated
 * purpose.
 *
 * This is the fallback used when a tenant has NOT set a custom `callDisclosure`.
 * A tenant may reword the disclosure (brand voice, another language, a
 * counsel-approved script) via the attestation-gated dashboard field; see
 * resolveDisclosure(). When they have not, or have cleared it, this compliant
 * default is spoken instead — the disclosure is never simply absent.
 *
 * The business name lives HERE rather than in the opener because the opener is
 * tenant-controlled — an owner who writes a custom "First Message" could
 * otherwise leave their own company name unsaid. Anchoring it to the default
 * disclosure guarantees every caller on the default is told which business
 * answered.
 */
export function buildDisclosure(businessName: string): string {
  return `I'm an AI assistant for ${businessName}, and this call is transcribed for quality and service.`;
}

/**
 * Resolve the disclosure actually spoken: the tenant's custom text when set and
 * non-blank, otherwise the platform default. A whitespace-only column counts as
 * unset — clearing the field returns the tenant to the safe default rather than
 * speaking an empty line.
 */
export function resolveDisclosure(config: TenantDisplayConfig): string {
  const custom = config.callDisclosure?.trim();
  return custom || buildDisclosure(config.name);
}

/**
 * Closer when the tenant has no transfer number.
 *
 * DELIBERATELY omits the "just stay on the line" consent trigger that
 * docs/legaldocs/AI_Secretary_Consent_and_Privacy_Language.md:31 recommends.
 * That clause costs ~3 seconds at the most latency-sensitive moment of the call
 * (see docs/VOICE_DEADAIR_RESEARCH.md and fallback.ts, which exist because
 * callers talk over a slow opener), and the greeting had already grown from 9
 * words to 34. Owner chose the shorter line 2026-07-10 accepting that implied
 * consent now rests on continued participation without being named aloud —
 * a weaker posture in all-party-consent states. Raise with counsel before
 * relying on it. Restoring the clause is a one-line change here.
 */
export const CLOSER_NO_TRANSFER = 'How can I help you today?';

/** Closer when a human transfer is actually available. A real opt-out strengthens consent. */
export const CLOSER_WITH_TRANSFER =
  'If you\'d rather speak with a person, just say "representative." Otherwise, how can I help you today?';

/**
 * Build the tenant-controlled opener.
 *
 * Priority: the owner's "First Message" → a persona-aware default that names
 * the assistant → a plain fallback. The persona default is computed at call
 * time rather than baked into a saved greeting so a renamed assistant does not
 * leave a stale name in the opener.
 *
 * The defaults deliberately omit the business name — buildDisclosure() speaks
 * it on the very next clause, and saying it twice in six seconds sounds like a
 * bug to a caller. A custom First Message may of course name the business; that
 * is the owner's choice and only costs a repeat.
 *
 * The opener also no longer carries "How can I help you today?" — that moved to
 * the closer, after the disclosure, so the caller is not invited to start
 * talking before they have been told what is happening.
 */
export function buildOpener(config: TenantDisplayConfig): string {
  const custom = config.firstMessage?.trim();
  if (custom) return custom;

  const personaName = config.personaName?.trim();
  return personaName ? `Hi, this is ${personaName}.` : 'Thanks for calling.';
}

/**
 * Compose the full opening line spoken to every caller.
 *
 * Joins the three segments with single spaces, collapsing any run of whitespace
 * a tenant's trailing punctuation might introduce. Guarantees the disclosure —
 * and with it the business name — is present exactly once, regardless of tenant
 * configuration.
 */
export function buildGreeting(config: TenantDisplayConfig): string {
  const closer = config.forwardPhone?.trim() ? CLOSER_WITH_TRANSFER : CLOSER_NO_TRANSFER;
  return [buildOpener(config), resolveDisclosure(config), closer]
    .join(' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}
