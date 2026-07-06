import { GoLivePanel } from '../phone/GoLivePanel';

/**
 * Thin wrapper — the actual go-live UX (provision → verify → fork) lives in
 * GoLivePanel so the wizard and AIConfigView share one implementation. See
 * docs/superpowers/specs/2026-07-05-wizard-phase-b-design.md §3.
 */
export function Step7GoLive() {
  return <GoLivePanel />;
}
