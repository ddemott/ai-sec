/**
 * Human-friendly labels for freeform voice_sessions.outcome values written by
 * the agent, plus shared day-name constants. Extracted from AnalyticsView.tsx.
 */

export const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const OUTCOME_LABELS: Record<string, string> = {
  booked: 'Booked an appointment',
  appointment_booked: 'Booked an appointment',
  info_provided: 'Got information',
  transferred: 'Transferred to a person',
  message: 'Left a message',
  voicemail: 'Left a voicemail',
  no_outcome: 'No clear outcome',
  // WHY categories from the agent's post-call classifier (callClassify.ts)
  no_availability: "Wanted a time we couldn't offer",
  wrong_service: "Wanted a service we don't offer",
  price: 'Price concern',
  info: 'Asked a question',
};

export function labelForOutcome(outcome: string): string {
  return OUTCOME_LABELS[outcome] ?? outcome.replace(/_/g, ' ');
}
