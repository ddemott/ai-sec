/**
 * Round a duration in minutes UP to the next 15-minute slot.
 *
 * The booking grid (and the agent's slot-suggestion algorithm) operates
 * on a 15-minute snap — a 22-minute service silently occupies the
 * 14:00–14:30 slot anyway, with 8 wasted minutes per appointment.
 * Rounding UP at save time aligns the stored duration with what the
 * booking engine actually allocates, so staff never feel rushed by a
 * rounded-DOWN value that the schedule grid still claims is 30 min.
 *
 * Edge cases:
 *   - 0 or negative → returns 0; the caller's "must be ≥ 1" validation
 *     runs upstream and would have rejected this already.
 *   - exactly on the snap (15, 30, 45, …) → unchanged.
 *   - NaN → 0 (defensive — parseInt() of an empty input yields NaN).
 *
 * Why round-up rather than nearest: nearest would silently shrink a
 * 22 → 15 service, leaving the customer feeling rushed.
 */
export function roundUpTo15(minutes: number | undefined | null): number {
  if (minutes == null || !Number.isFinite(minutes) || minutes <= 0) return 0;
  return Math.ceil(minutes / 15) * 15;
}

/**
 * Standard caption shown beneath a service-duration input. Centralized
 * so a future copy change happens in one place rather than four.
 */
export const DURATION_SNAP_HINT =
  'Scheduled in 15-minute slots — non-multiples are rounded up on save.';
