/**
 * Tests for session context extraction — pure unit, no LiveKit runtime.
 */
import { describe, it, expect } from 'vitest';
import { parseRoomMetadata, extractCallerInfo, buildSessionContext } from './sessionContext.js';

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
