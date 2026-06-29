/**
 * Session context extraction.
 *
 * The LiveKit dispatch rule (Phase 1a) populates room metadata with
 * `{"tenant_id": "<uuid>"}`. The SIP participant that represents the
 * caller exposes attributes like `sip.phoneNumber` (caller-ID) and
 * `sip.callID` (carrier-assigned call identifier). This module parses
 * those and bundles them into a strongly-typed context every tool
 * handler receives.
 *
 * Framework-agnostic on purpose: takes plain objects, not LiveKit types,
 * so tests don't need a LiveKit runtime.
 */

export interface SessionContext {
  tenantId: string;
  /** E.164-ish caller-ID phone, or `null` if blocked/missing. */
  callerPhone: string | null;
  /** Carrier-assigned call identifier — carried into tool calls for later
   *  correlation (transcript linking, owner-notification SMS). */
  callId: string | null;
  /** LiveKit room name — needed to cold-transfer the live call (SIP REFER). */
  roomName: string | null;
  /** SIP participant identity — the handle LiveKit's transferSipParticipant
   *  uses to target the caller leg. Null when the participant never joined. */
  participantIdentity: string | null;
}

/**
 * Parse a room's metadata string. Returns null (not throws) if the string
 * is missing, malformed JSON, or lacks a tenant_id — the caller decides
 * what to do (greet anyway vs. abandon the call).
 */
export function parseRoomMetadata(
  metadata: string | null | undefined
): { tenantId: string } | null {
  if (!metadata) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(metadata);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const obj = parsed as Record<string, unknown>;
  const tenantId = obj.tenant_id ?? obj.tenantId;
  if (typeof tenantId !== 'string' || tenantId.length === 0) return null;
  return { tenantId };
}

/**
 * Extract caller phone + call_id from SIP participant attributes.
 * Attribute names follow LiveKit SIP conventions (`sip.phoneNumber`,
 * `sip.callID`). Anonymous callers typically arrive with the phone
 * attribute absent or set to `"anonymous"` — both normalize to null.
 */
export function extractCallerInfo(attributes: Record<string, string> | null | undefined): {
  callerPhone: string | null;
  callId: string | null;
} {
  if (!attributes) return { callerPhone: null, callId: null };

  const rawPhone = attributes['sip.phoneNumber'] ?? attributes['sip.from'] ?? null;
  const callerPhone = rawPhone && !isAnonymousMarker(rawPhone) ? rawPhone : null;

  const callId = attributes['sip.callID'] ?? attributes['sip.callId'] ?? null;

  return { callerPhone, callId };
}

/**
 * Reduce a phone string to its 10 US digits for equality comparison: strip all
 * non-digit characters, then drop a leading country-code 1 if that leaves 10.
 * Returns null when the result isn't a clean 10-digit number, so partial or
 * garbage input never compares equal.
 *
 * Intentionally STRICTER than shared/phone.ts normalizePhone (which prepends +1,
 * accepts 11+ digit strings, and preserves international numbers for E.164
 * storage): this is a US-line equality reducer, not a normalizer — it accepts
 * ONLY a US 10-digit number (optionally 1-prefixed) and rejects everything else,
 * because the forward-number match is a same-line check. Kept local rather than
 * importing shared/ because the agent build (rootDir: src) doesn't include it.
 */
function tenDigits(phone: string | null | undefined): string | null {
  if (!phone) return null;
  let digits = phone.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1);
  return digits.length === 10 ? digits : null;
}

/**
 * True when the SIP caller-ID is the tenant's OWN forward number — i.e. the
 * call was forwarded from the owner's line, so the caller-ID is the forwarding
 * line, NOT the actual customer. The entry point nulls callerPhone in this case
 * so the agent collects the customer's real number verbally (and saves it to
 * the CRM) instead of mis-keying the call/contact on the owner's forwarding
 * number. A different (good) caller-ID returns false and is kept — the agent
 * then only needs the caller's name. Either side null/blank/non-10-digit →
 * false (nothing to match). Origin: Dale's forwarded business line (2026-06-29).
 */
export function callerIdIsForwardNumber(
  callerPhone: string | null | undefined,
  forwardPhone: string | null | undefined
): boolean {
  const caller = tenDigits(callerPhone);
  const forward = tenDigits(forwardPhone);
  return caller !== null && caller === forward;
}

/** Known markers carriers send for blocked/withheld caller-ID. */
function isAnonymousMarker(phone: string): boolean {
  const lower = phone.trim().toLowerCase();
  return (
    lower === '' ||
    lower === 'anonymous' ||
    lower === 'unavailable' ||
    lower === 'restricted' ||
    lower === 'private' ||
    lower === 'unknown' ||
    lower === '+1' ||
    lower === '+0' ||
    /^\+?0+$/.test(lower) // "+00000000000" etc.
  );
}

/**
 * Build a session context from raw inputs. Tries job (dispatch) metadata
 * first, then room metadata — LiveKit puts our tenant_id JSON on whichever
 * the dispatch rule's "Dispatch metadata" field maps to at runtime, and
 * we want to be robust to either. Returns null if neither carries a
 * tenant_id; entry point treats that as a misconfigured dispatch rule.
 */
export function buildSessionContext(args: {
  jobMetadata?: string | null | undefined;
  roomMetadata: string | null | undefined;
  participantAttributes: Record<string, string> | null | undefined;
  roomName?: string | null | undefined;
  participantIdentity?: string | null | undefined;
}): SessionContext | null {
  const meta = parseRoomMetadata(args.jobMetadata) ?? parseRoomMetadata(args.roomMetadata);
  if (!meta) return null;
  const caller = extractCallerInfo(args.participantAttributes);
  // Fall back to the room name when the carrier call-ID attribute is missing.
  // LiveKit attaches `sip.callID` asynchronously, so it can be absent at the
  // instant we read participant attributes (a race). Call-logging is gated on
  // a non-null callId — without this fallback, a call whose attribute arrives
  // late never creates a voice_sessions row (no Calls-tab entry, no transcript
  // saved on hangup). The room name is unique per call, so it's a safe key for
  // session correlation when the carrier id isn't available.
  const callId = caller.callId ?? (args.roomName ? `room:${args.roomName}` : null);
  return {
    tenantId: meta.tenantId,
    callerPhone: caller.callerPhone,
    callId,
    roomName: args.roomName ?? null,
    participantIdentity: args.participantIdentity ?? null,
  };
}
