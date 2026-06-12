/**
 * Session-scoped tracker for what HAPPENED on a call, so the shutdown hook can
 * report it to /agent-tools/voice-session-end. Mirrors TranscriptRecorder: one
 * instance per call, mutated by the tools as the call progresses, read once at
 * teardown.
 *
 * - recordBooking(id): a booking tool succeeded → outcome 'booked' + the
 *   appointment_id to back-link the call to the appointment.
 * - recordTransfer(): the live transfer succeeded → outcome 'transferred'.
 *
 * Default outcome is null (unclassified) — we never fabricate one. A call that
 * neither books nor transfers leaves outcome null rather than guessing
 * 'message'/'abandoned'; richer classification is a separate step.
 */
export class CallOutcomeTracker {
  private outcome: string | null = null;
  private appointmentId: string | null = null;

  /** A booking tool returned success with this appointment_id. */
  recordBooking(appointmentId: string): void {
    this.appointmentId = appointmentId;
    this.outcome = 'booked';
  }

  /** The live cold-transfer to a human succeeded. */
  recordTransfer(): void {
    this.outcome = 'transferred';
  }

  /** Snapshot for the session-end payload. */
  result(): { outcome: string | null; appointmentId: string | null } {
    return { outcome: this.outcome, appointmentId: this.appointmentId };
  }
}
