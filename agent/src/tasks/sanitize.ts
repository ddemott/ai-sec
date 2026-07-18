/**
 * Caller-derived text that will be INTERPOLATED INTO PROMPTS (volunteered name/number
 * from begin_call) gets flattened first: control characters and newlines become spaces,
 * whitespace collapses, and the value is length-capped. A "name" is one short line — a
 * multi-line name is not a name, it is instruction smuggling (review on #289). Returns
 * undefined for empty/blank input so callers can use it as a direct assignment guard.
 *
 * Leaf module on purpose: both callPlan (state write) and identityTask (interpolation
 * site) use it, and those two already import each other's neighbors.
 */
export function sanitizeVolunteered(
  value: string | undefined,
  maxLen: number
): string | undefined {
  if (!value) return undefined;
  const flat = value
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen)
    .trim();
  return flat.length > 0 ? flat : undefined;
}
