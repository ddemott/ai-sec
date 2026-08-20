export interface TelephonySMSRequest {
  to: string;
  from: string;
  body: string;
  tenantId: string;
}

/**
 * What a telephony provider must do here: identify itself, and send an SMS.
 *
 * This interface used to carry five methods. Four of them — `makeCall`,
 * `createInstruction`, `wrapResponse`, `generateInstruction` — were Twilio
 * residue: they existed to build TwiML, an XML dialect for a vendor this
 * product dropped months ago. The real adapter (`TelnyxSmsAdapter`) `throw`s on
 * all four, `MockAdapter` faithfully emitted `<Response>…</Response>` XML that
 * nothing could consume, and a repo-wide search for callers of any of them
 * returned ZERO. Voice is LiveKit; it does not go anywhere near this interface.
 *
 * Removed 2026-08-20 along with `TelephonyCallRequest`. If outbound calling is
 * ever built, it should be designed against whatever the provider actually
 * offers rather than resurrected from a Twilio-shaped stub.
 */
export interface TelephonyProvider {
  /** Provider name, used in logs and in the `provider` metric label. */
  getName(): string;

  /** Send an SMS. The only thing this interface has ever really done. */
  sendSMS(request: TelephonySMSRequest): Promise<{ messageSid: string }>;
}
