/**
 * IS A TOOL ACTUALLY RUNNING RIGHT NOW?
 *
 * The watchdog needs to know, and until now it could not. It fires whenever the
 * agent has been 'thinking' for a couple of seconds with no audio — which is
 * cause-agnostic ON PURPOSE, and right: dead air is dead air whatever produced it.
 *
 * But WHAT IT SAYS was not cause-agnostic. It said:
 *
 *     "One moment while I check that for you."
 *
 * On the 2026-07-14 call it said that SEVEN TIMES, and the tools on that call ran
 * in 3 to 15 MILLISECONDS. Nothing was ever being checked. The agent was just slow
 * to think, and the runtime announced a lookup that was not happening. The caller
 * heard it, believed it, and asked — twice — "what are you checking?" and "what am
 * I waiting for?"
 *
 * That is the same defect this whole week has been about, wearing a different coat.
 * I removed the prompt line that let the MODEL claim work it had not done, and then
 * shipped a runtime that claims work IT is not doing. A machine lying on a schedule
 * is still lying.
 *
 * So the hold line becomes honest: say "let me check" only when there is genuinely
 * something being checked, and otherwise just ask for a moment. This module is how
 * the watchdog knows the difference.
 *
 * Deliberately a module-level counter and not a class: there is exactly one agent
 * session per worker process (LiveKit forks a job process per call), so there is
 * nothing to isolate, and threading an instance through wrapTool → buildTools →
 * every tool would be plumbing for its own sake.
 */

let inFlight = 0;

/** A tool's execute() has started. */
export function toolStarted(): void {
  inFlight += 1;
}

/** A tool's execute() has finished — success, failure, or timeout. */
export function toolFinished(): void {
  // Never below zero: a double-decrement (a timeout racing a late resolve) would
  // otherwise poison the count for the rest of the call, and a NEGATIVE count reads
  // as "no tool running" forever after — silently returning us to the lying line.
  inFlight = Math.max(0, inFlight - 1);
}

/** True while at least one tool is actually executing. */
export function isToolRunning(): boolean {
  return inFlight > 0;
}

/** Test seam — reset between cases. */
export function _resetToolActivityForTest(): void {
  inFlight = 0;
}
