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
/**
 * Fill the Handlebars-style placeholders a tenant's First Message may contain,
 * and strip any we don't recognise.
 *
 * WHY (a real call, 2026-07-13): Thinking Hammer's saved First Message was
 *
 *     "Hi, thank you for calling {{business_name}}! How can I help you today?"
 *
 * and buildOpener returned it VERBATIM. So the very first thing every caller
 * heard was the assistant saying the words "curly brace business name". The
 * owner's reaction — "sounded very broken" — was the correct one.
 *
 * The placeholders came from the seeded business templates, where that syntax is
 * real: the comms templates (email/SMS) are rendered through Handlebars. The
 * spoken greeting is not, and nobody noticed the two had different contracts.
 *
 * Two rules, both load-bearing:
 *   1. SUBSTITUTE what we know ({{business_name}}, {{persona_name}}).
 *   2. STRIP what we don't. An unknown placeholder must never reach TTS — a
 *      missing name is survivable, reading punctuation aloud is not. Failing
 *      silently is right here: the caller hears a slightly plainer sentence
 *      instead of a bug.
 */
function fillPlaceholders(text: string, config: TenantDisplayConfig): string {
  return (
    text
      .replace(/\{\{\s*business_name\s*\}\}/gi, config.name?.trim() || 'us')
      .replace(/\{\{\s*persona_name\s*\}\}/gi, config.personaName?.trim() || 'your assistant')
      // Anything still in braces is unknown — drop it rather than speak it.
      .replace(/\{\{[^}]*\}\}/g, '')
      .replace(/\s{2,}/g, ' ')
      .trim()
  );
}

export function buildOpener(config: TenantDisplayConfig): string {
  const custom = config.firstMessage?.trim();
  if (custom) return fillPlaceholders(custom, config);

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
  const opener = buildOpener(config);
  const closer = config.forwardPhone?.trim() ? CLOSER_WITH_TRANSFER : CLOSER_NO_TRANSFER;

  // Don't ask the same question twice.
  //
  // The 2026-07-13 call opened with: "Hi, thank you for calling {{business_name}}!
  // How can I help you today? I'm an AI assistant for Thinking Hammer LLC, and
  // this call is transcribed for quality and service. How can I help you today?"
  //
  // The owner's saved First Message already ends with the question, and the closer
  // appends it again — so the assistant asked it, disclosed, and asked it AGAIN.
  // The module header even documents the intent ("the opener no longer carries
  // 'How can I help you today?' — that moved to the closer"), but that was only
  // ever true of the DEFAULT opener. A custom First Message was free to end with
  // the same question and nothing checked.
  //
  // The disclosure must still land BETWEEN them (it is the legal bit, and it must
  // not be the last thing before the caller starts talking), so we drop the
  // question from the OPENER and keep the closer — rather than the reverse.
  const openerWithoutClosingQuestion = /how can i help you( today)?\s*[?!.]?\s*$/i.test(opener)
    ? opener.replace(/how can i help you( today)?\s*[?!.]?\s*$/i, '').trim()
    : opener;

  return [openerWithoutClosingQuestion, resolveDisclosure(config), closer]
    .join(' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}
