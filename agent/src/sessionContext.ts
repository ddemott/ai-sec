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
}

/**
 * Parse a room's metadata string. Returns null (not throws) if the string
 * is missing, malformed JSON, or lacks a tenant_id — the caller decides
 * what to do (greet anyway vs. abandon the call).
 */
export function parseRoomMetadata(metadata: string | null | undefined): { tenantId: string } | null {
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
 * Build a session context from raw inputs. Returns null if tenant_id is
 * missing — the entry point treats this as a misconfigured dispatch rule
 * and ends the call with a safe message.
 */
export function buildSessionContext(args: {
  roomMetadata: string | null | undefined;
  participantAttributes: Record<string, string> | null | undefined;
}): SessionContext | null {
  const meta = parseRoomMetadata(args.roomMetadata);
  if (!meta) return null;
  const caller = extractCallerInfo(args.participantAttributes);
  return {
    tenantId: meta.tenantId,
    callerPhone: caller.callerPhone,
    callId: caller.callId,
  };
}
