/**
 * Tests for session context extraction — pure unit, no LiveKit runtime.
 */
import { describe, it, expect } from 'vitest';
import {
  parseRoomMetadata,
  extractCallerInfo,
  buildSessionContext,
  callerIdIsForwardNumber,
} from './sessionContext.js';

const TENANT_ID = 'f234e471-0e60-4163-86c9-93cfd9338e3a';

describe('parseRoomMetadata', () => {
  it('HAPPY: well-formed dispatch-rule metadata yields tenantId', () => {
    // WHO: LiveKit dispatch rule populates room.metadata with the JSON
    //       we configured in Phase 1a
    // WHAT: Parse it and surface tenantId for downstream code
    // WHY: Every tool call is tenant-scoped; this is the ONLY place
    //       tenant_id enters the agent worker
    expect(parseRoomMetadata(JSON.stringify({ tenant_id: TENANT_ID }))).toEqual({
      tenantId: TENANT_ID,
    });
  });

  it('HAPPY: accepts camelCase tenantId variant (future-proof)', () => {
    // WHY: Not what we configure today, but dispatch rules are edited in
    //       a UI and typos happen; accepting both spellings is cheap
    //       defense
    expect(parseRoomMetadata(JSON.stringify({ tenantId: TENANT_ID }))).toEqual({
      tenantId: TENANT_ID,
    });
  });

  it('SAD: missing metadata returns null', () => {
    // WHO: Misconfigured dispatch rule — no metadata JSON set
    // WHAT: Return null so the entry point can end the call cleanly
    //        instead of crashing
    expect(parseRoomMetadata(null)).toBeNull();
    expect(parseRoomMetadata(undefined)).toBeNull();
    expect(parseRoomMetadata('')).toBeNull();
  });

  it('SAD: malformed JSON returns null (no throw)', () => {
    // WHO: Someone pasted YAML or a bare string into the metadata field
    // WHAT: Caller gets null, never an exception
    // WHY: An uncaught JSON parse error would crash the worker and
    //        disconnect every in-flight call
    expect(parseRoomMetadata('{ tenant_id: unquoted }')).toBeNull();
    expect(parseRoomMetadata('not-json-at-all')).toBeNull();
  });

  it('SAD: valid JSON but no tenant_id returns null', () => {
    // WHAT: JSON parses but the expected key is absent — treated as
    //        misconfiguration
    expect(parseRoomMetadata(JSON.stringify({ other_field: 'x' }))).toBeNull();
    expect(parseRoomMetadata(JSON.stringify({}))).toBeNull();
  });

  it('SAD: tenant_id is not a string returns null', () => {
    // WHO: Someone typed the UUID without quotes and JSON coerced it
    //       to a number (or left it as an array by mistake)
    expect(parseRoomMetadata(JSON.stringify({ tenant_id: 42 }))).toBeNull();
    expect(parseRoomMetadata(JSON.stringify({ tenant_id: [] }))).toBeNull();
    expect(parseRoomMetadata(JSON.stringify({ tenant_id: '' }))).toBeNull();
  });
});

describe('extractCallerInfo', () => {
  it('HAPPY: SIP attributes yield phone + callID', () => {
    // WHO: A normal inbound call with caller-ID intact
    // WHAT: Both fields surface so tools can pass them through
    expect(
      extractCallerInfo({
        'sip.phoneNumber': '+15551234567',
        'sip.callID': 'abc-123',
      })
    ).toEqual({ callerPhone: '+15551234567', callId: 'abc-123' });
  });

  it('HAPPY: accepts "sip.callId" spelling variant', () => {
    // WHY: LiveKit's SIP integration has used both `callID` and `callId`
    //        across versions — accept both so a version bump doesn't
    //        silently drop call_id in logs
    expect(
      extractCallerInfo({
        'sip.phoneNumber': '+15551234567',
        'sip.callId': 'abc-123',
      }).callId
    ).toBe('abc-123');
  });

  it('HAPPY: anonymous marker → callerPhone is null', () => {
    // WHO: Caller has their number blocked
    // WHAT: `"anonymous"` (and friends) collapse to null so the OTP flow
    //        correctly asks for a phone verbally
    // WHY: If we kept the string "anonymous" as the phone, isValidPhone
    //        would fail at the booking gate AND the /send-verification-
    //        code route would try to text the string "anonymous", which
    //        Telnyx would reject with a confusing error
    for (const marker of [
      'anonymous',
      'ANONYMOUS',
      'unavailable',
      'restricted',
      'private',
      'unknown',
      '+1',
      '+0',
      '+00000000000',
      '',
    ]) {
      expect(extractCallerInfo({ 'sip.phoneNumber': marker }).callerPhone).toBeNull();
    }
  });

  it('SAD: missing attributes → both null (no throw)', () => {
    // WHAT: Null-safe for completely missing input
    expect(extractCallerInfo(null)).toEqual({ callerPhone: null, callId: null });
    expect(extractCallerInfo(undefined)).toEqual({ callerPhone: null, callId: null });
    expect(extractCallerInfo({})).toEqual({ callerPhone: null, callId: null });
  });
});

describe('buildSessionContext', () => {
  it('HAPPY: valid metadata + caller attributes yields full context', () => {
    // WHAT: End-to-end composition — this is what entry point uses
    const ctx = buildSessionContext({
      roomMetadata: JSON.stringify({ tenant_id: TENANT_ID }),
      participantAttributes: {
        'sip.phoneNumber': '+15551234567',
        'sip.callID': 'abc-123',
      },
    });
    expect(ctx).toEqual({
      tenantId: TENANT_ID,
      callerPhone: '+15551234567',
      callId: 'abc-123',
      roomName: null,
      participantIdentity: null,
    });
  });

  it('HAPPY: anonymous caller + valid tenant → context with null phone', () => {
    // WHO: Blocked caller-ID but dispatch rule correct
    // WHAT: Context still builds; the null phone will trigger the OTP
    //        flow at the booking gate
    const ctx = buildSessionContext({
      roomMetadata: JSON.stringify({ tenant_id: TENANT_ID }),
      participantAttributes: { 'sip.phoneNumber': 'anonymous' },
    });
    expect(ctx?.tenantId).toBe(TENANT_ID);
    expect(ctx?.callerPhone).toBeNull();
  });

  it('HAPPY: roomName + participantIdentity pass through for live transfer', () => {
    // WHO: entry point hands ctx.room.name + sipParticipant.identity in
    // WHAT: both surface on the context so transfer_call can SIP-REFER the leg
    // WHEN: every dispatched SIP call once the participant has joined
    // WHERE: agent/src/index.ts buildSessionContext call
    // WHY: cold transfer needs (roomName, participantIdentity) to target the caller
    const ctx = buildSessionContext({
      roomMetadata: JSON.stringify({ tenant_id: TENANT_ID }),
      participantAttributes: { 'sip.phoneNumber': '+15551234567' },
      roomName: 'sip-room-42',
      participantIdentity: 'sip_caller_42',
    });
    expect(ctx?.roomName).toBe('sip-room-42');
    expect(ctx?.participantIdentity).toBe('sip_caller_42');
  });

  it('HAPPY: callId falls back to room name when carrier sip.callID is missing', () => {
    // WHO: a real SIP call where LiveKit attaches sip.callID late (a race), so
    //       the attribute is absent the instant we read it
    // WHAT: no sip.callID in attributes, but roomName is present → callId uses
    //       the room name (prefixed) instead of staying null
    // WHY: call-logging (voice_sessions row + transcript-on-hangup) is gated on
    //       a non-null callId. Without this fallback a late-attribute call never
    //       records — no Calls-tab entry, nothing saved even when the caller
    //       hangs up. Room name is unique per call, a safe correlation key.
    const ctx = buildSessionContext({
      roomMetadata: JSON.stringify({ tenant_id: TENANT_ID }),
      participantAttributes: { 'sip.phoneNumber': '+15551234567' }, // no sip.callID
      roomName: 'call-_6085551234_xyz',
    });
    expect(ctx?.callId).toBe('room:call-_6085551234_xyz');
  });

  it('HAPPY: omitted room/identity default to null (participant not yet joined)', () => {
    // WHAT: the preliminary context (built before waitForParticipant) carries
    //       nulls so a missing participant degrades transfer gracefully
    const ctx = buildSessionContext({
      roomMetadata: JSON.stringify({ tenant_id: TENANT_ID }),
      participantAttributes: null,
    });
    expect(ctx?.roomName).toBeNull();
    expect(ctx?.participantIdentity).toBeNull();
  });

  it('SAD: missing tenant_id → null so entry point can end the call', () => {
    // WHO: Dispatch rule never set up or metadata blank
    // WHAT: Return null; caller handles end-of-call politely
    expect(
      buildSessionContext({
        roomMetadata: null,
        participantAttributes: { 'sip.phoneNumber': '+15551234567' },
      })
    ).toBeNull();
  });
});

describe('callerIdIsForwardNumber', () => {
  // Origin: Dale's forwarded business line (2026-06-29). When he forwards his
  // personal cell (+1 608-217-5303) INTO the business, the SIP caller-ID is HIS
  // forwarding line, not the customer. The entry point nulls callerPhone on a
  // match so the agent collects the customer's real number verbally; a different
  // (good) caller-ID is kept and only the name is collected.
  const FORWARD = '+16082175303';

  it('HAPPY: caller-ID equals the forward number (same format) → true (forwarded call)', () => {
    // WHO: Dale forwards his cell into the AI; caller-ID arrives as the cell.
    // WHAT: a match means "this is the forwarding line, not the caller".
    // WHY: the agent must NOT key the call/contact on the forwarding number.
    expect(callerIdIsForwardNumber('+16082175303', FORWARD)).toBe(true);
  });

  it('HAPPY: match is format-insensitive (caller-ID and forward stored differently)', () => {
    // WHO: caller-ID may arrive bare-10-digit, 1-prefixed, or punctuated while
    //       forward_phone is stored E.164 — the comparison normalizes both.
    // WHY: a real caller-ID like "6082175303" must still match a stored
    //       "+16082175303"; otherwise the guard silently never fires.
    expect(callerIdIsForwardNumber('6082175303', FORWARD)).toBe(true);
    expect(callerIdIsForwardNumber('16082175303', FORWARD)).toBe(true);
    expect(callerIdIsForwardNumber('(608) 217-5303', FORWARD)).toBe(true);
    expect(callerIdIsForwardNumber('+16082175303', '608-217-5303')).toBe(true);
  });

  it('SAD: a different (good) caller-ID → false (real customer, keep caller-ID)', () => {
    // WHO: a customer who dialed the business number directly.
    // WHAT: their caller-ID is genuine — must be preserved, not nulled.
    // WHY: requirement — for a good caller-ID the agent uses it for the CRM and
    //       only collects the caller's name. A false here would null it wrongly.
    expect(callerIdIsForwardNumber('+15551234567', FORWARD)).toBe(false);
  });

  it('SAD: null/blank caller-ID or forward number → false (nothing to match)', () => {
    // WHO: anonymous caller (null caller-ID), or a tenant with no forward set.
    // WHY: a null forward number must never match a null caller-ID into a
    //       "forwarded" verdict — there is simply nothing to compare.
    expect(callerIdIsForwardNumber(null, FORWARD)).toBe(false);
    expect(callerIdIsForwardNumber('+16082175303', null)).toBe(false);
    expect(callerIdIsForwardNumber(null, null)).toBe(false);
    expect(callerIdIsForwardNumber('', '')).toBe(false);
  });

  it('SAD: partial/garbage caller-ID never matches', () => {
    // WHO: STT/carrier delivers a partial number.
    // WHY: tenDigits returns null for <10 digits, so a partial like "608217"
    //       must not coincidentally match anything.
    expect(callerIdIsForwardNumber('608217', '608217')).toBe(false);
    expect(callerIdIsForwardNumber('not-a-number', FORWARD)).toBe(false);
  });
});

/**
 * REGRESSION — the carrier's caller-ID must be normalized to E.164 at the boundary.
 *
 * On the 2026-07-13 call Telnyx sent "6082175303" — no +1 — and that raw string
 * went straight into voice_sessions.caller_phone.
 *
 * Every phone column in this database holds the E.164 form: customers.phone is
 * "+16082175303", consent_records.customer_phone is "+1…", phone_verifications.phone
 * is "+1…". So an un-normalized caller-ID matches NOTHING. A returning customer
 * looks brand new. Their consent looks absent (so the agent re-asks, or worse, a
 * confirmation is suppressed). The call never links to their record.
 *
 * And nothing errors. It just quietly forgets them — which is the failure mode that
 * survives longest, because it looks exactly like normal operation.
 */
describe('REGRESSION: caller-ID is normalized to E.164 at the boundary', () => {
  it('SAD: a bare 10-digit carrier value becomes +1XXXXXXXXXX (the 2026-07-13 shape)', () => {
    // WHO: every Telnyx caller. WHAT: "6082175303" → "+16082175303".
    // WHY: this exact string reached voice_sessions.caller_phone and matched no
    //      customer, no consent record, and no verification row.
    const { callerPhone } = extractCallerInfo({ 'sip.phoneNumber': '6082175303' });
    expect(callerPhone).toBe('+16082175303');
  });

  it('HAPPY: an already-E.164 value is unchanged (no double-prefixing)', () => {
    const { callerPhone } = extractCallerInfo({ 'sip.phoneNumber': '+16082175303' });
    expect(callerPhone).toBe('+16082175303');
  });

  it('HAPPY: an 11-digit 1-prefixed value normalizes too', () => {
    const { callerPhone } = extractCallerInfo({ 'sip.phoneNumber': '16082175303' });
    expect(callerPhone).toBe('+16082175303');
  });

  it('HAPPY: carrier formatting is stripped', () => {
    const { callerPhone } = extractCallerInfo({ 'sip.phoneNumber': '(608) 217-5303' });
    expect(callerPhone).toBe('+16082175303');
  });

  it('SAD: an anonymous/blocked marker still yields null, not a mangled number', () => {
    // WHY: normalization must not resurrect a blocked caller-ID as a fake number.
    expect(extractCallerInfo({ 'sip.phoneNumber': 'anonymous' }).callerPhone).toBeNull();
    expect(extractCallerInfo({ 'sip.phoneNumber': '' }).callerPhone).toBeNull();
  });

  it('the forwarded-line guard still matches across formats (it always did)', () => {
    // WHY: callerIdIsForwardNumber compares 10-digit reductions, so it matched
    //      "6082175303" against "+16082175303" correctly even BEFORE this fix.
    //      Normalizing must not break that — it is the guard that keeps a
    //      forwarded call from being mis-attributed to the forwarding line.
    expect(callerIdIsForwardNumber('+16082175303', '+16082175303')).toBe(true);
    expect(callerIdIsForwardNumber('+16082175303', '+16305550000')).toBe(false);
  });
});
