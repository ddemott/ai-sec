/**
 * Transfer-loop guard — re-export from the canonical shared/ implementation.
 *
 * The logic moved into `shared/phone.ts` (2026-07-23) so the AGENT package and
 * the dashboard can apply the identical rule; `src/services/` is not reachable
 * from either. This file stays as the name the backend already imports, exactly
 * like `phoneUtils.ts` does for the phone helpers.
 *
 * All new code should import `isTransferLoop` / `canTransfer` directly from
 * '../../shared/phone'. There is ONE implementation — a second copy of a rule
 * this specific is how the rule and its enforcement drift apart.
 */
export { isTransferLoop as phonesWouldLoop, canTransfer } from '../../shared/phone';
