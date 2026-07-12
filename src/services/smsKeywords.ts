/**
 * Canonical carrier SMS keywords — ONE source of truth.
 *
 * Deliberately not duplicated across the webhook classifier and ConsentService:
 * the whole class of bug this module exists to prevent is the two disagreeing
 * about what a word means. (PR #238 shipped exactly that: the webhook classified
 * START as an opt-IN, then handed it to a consent method that treated every
 * command it received as an opt-OUT.)
 */

/**
 * CTIA-standard opt-out keywords. CANCEL genuinely is one of them.
 *
 * NOTE for the Y/N appointment-confirmation flow (phases 2-3 of the SMS design):
 * a bare CANCEL from a number with a PENDING confirmation should mean "cancel my
 * appointment", not "opt me out of all messages" — so that branch must be
 * evaluated BEFORE this set is consulted. Until then, a bare CANCEL opts them
 * out, which is the standards-compliant reading.
 */
export const OPT_OUT_WORDS: ReadonlySet<string> = new Set([
  'stop',
  'stopall',
  'unsubscribe',
  'end',
  'quit',
  'cancel',
]);

/**
 * Standard opt-in keywords ONLY.
 *
 * "yes" is deliberately ABSENT. It is not a carrier opt-in word, and the SMS
 * design reserves Y/YES/YEAH/CONFIRM for confirming an appointment — treating
 * YES as an opt-in here would silently swallow a customer's booking confirmation.
 */
export const OPT_IN_WORDS: ReadonlySet<string> = new Set(['start', 'unstop']);

/** Normalize an inbound SMS body for keyword matching. */
export function normalizeKeyword(body: string | undefined | null): string {
  return (body ?? '')
    .trim()
    .toLowerCase()
    .replace(/[.!?,;:'"]+$/g, '')
    .trim();
}

export type SmsKeyword = 'opt_out' | 'opt_in' | 'other';

/**
 * Classify an inbound SMS body.
 *
 * Conservative on purpose: the message must BE the keyword, not merely contain
 * it. "Please don't stop texting me" is not an opt-out, and "cancel my 3pm" must
 * not be silently swallowed as one either.
 */
export function classifySmsKeyword(body: string | undefined | null): SmsKeyword {
  const normalized = normalizeKeyword(body);
  if (!normalized) return 'other';
  if (OPT_OUT_WORDS.has(normalized)) return 'opt_out';
  if (OPT_IN_WORDS.has(normalized)) return 'opt_in';
  return 'other';
}

export function isOptOutKeyword(command: string): boolean {
  return OPT_OUT_WORDS.has(normalizeKeyword(command));
}

/**
 * Thrown when something asks ConsentService to "process an opt-out" for a command
 * that is not an opt-out at all.
 *
 * This exists because the alternative — quietly recording an opt-out anyway — is
 * how a customer texting START to RESUME messages got opted out of everything.
 * A method named processOptOutCommand must refuse to do anything else.
 */
export class NotAnOptOutCommandError extends Error {
  statusCode = 400;
  constructor(command: string) {
    super(
      `"${command}" is not an opt-out keyword. Opt-out commands are: ${[...OPT_OUT_WORDS].join(', ')}. ` +
        `Opt-IN (START/UNSTOP) must go through recordConsent(), not processOptOutCommand().`
    );
    this.name = 'NotAnOptOutCommandError';
  }
}
