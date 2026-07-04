/**
 * Collects startup warnings for missing-but-optional environment variables.
 *
 * Pure function so it's trivially testable — index.ts calls it at boot
 * and emits each string via console.warn. Separating the decision from
 * the side-effect means a new contributor who adds a warning can't
 * accidentally forget a test, and the existing ones can't silently rot.
 *
 * 2026-07-04: the underlying env-var conditions (and the warning strings)
 * now live in featureReadiness.ts so the boot warnings and the structured
 * feature-readiness report (GET /admin/feature-readiness) can never drift
 * apart — this module is a thin flatMap over the shared evaluations.
 */
import { evaluateCapabilities, type FeatureReadinessContext } from './featureReadiness';

export type EnvWarningContext = FeatureReadinessContext;

export function collectStartupWarnings(ctx: EnvWarningContext): string[] {
  return evaluateCapabilities(ctx).flatMap((capability) => capability.warnings);
}
