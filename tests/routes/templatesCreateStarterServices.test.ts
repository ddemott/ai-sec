/**
 * POST /templates/create — the starter-service half of it.
 *
 * WHY THIS EXISTS
 * T-015 filled business_templates.example_services for all 31 live verticals,
 * because the setup wizard had been asking a new owner "what services do you
 * offer?" against a blank list. This route is the super-admin path that can
 * write that column — and it had no test at all, which is how three defects
 * shipped in it:
 *
 *   1. The upsert passed `JSON.stringify(body.example_services ?? [])`, so
 *      EXCLUDED.example_services was NEVER SQL NULL. The ON CONFLICT clause
 *      guards the column with COALESCE(EXCLUDED..., business_templates...),
 *      which therefore could never fire: any edit that did not resend the list
 *      — renaming a template, changing its voice — replaced that vertical's
 *      starter services with []. The guard was there; it was unreachable.
 *   2. The schema's own comment says a look_first row needs a description, and
 *      shared/starterServices.ts says "Exactly one row per vertical is
 *      is_default". The schema enforced neither.
 *   3. Duplicate names were accepted, which is also what let the dashboard's
 *      preview modal key its pills by name.
 *
 * WHO: a platform super-admin editing a business template.
 * WHAT: an omitted example_services preserves what is stored; a provided one
 *       must satisfy the invariants the starter-service catalogue relies on.
 * WHEN: every CI run.
 * WHERE: src/routes/tenants.ts (CreateTemplateSchema + the /templates/create
 *        upsert), dashboard/components/business/TemplatePreviewModal.tsx.
 * WHY: a template edit that silently empties a vertical's starter services is
 *      invisible until a new owner reaches the wizard and sees a blank list —
 *      the exact state T-015 was written to end.
 */
import { describe, it, expect } from 'vitest';
import { CreateTemplateSchema } from '../../src/routes/tenants';

describe('CreateTemplateSchema — starter service invariants', () => {
  const base = { business_type: 'auto-shop', display_name: 'Auto Shop', category: 'Auto & Vehicle' };

  it('HAPPY: accepts a well-formed starter list', () => {
    const parsed = CreateTemplateSchema.safeParse({
      ...base,
      example_services: [
        { name: 'Diagnostic visit', description: 'We find out why the light is on.', look_first: true, is_default: true },
        { name: 'Oil change', description: 'Standard oil and filter service.' },
      ],
    });
    expect(parsed.success, JSON.stringify(parsed.success ? [] : parsed.error.issues)).toBe(true);
  });

  it('HAPPY: omitting example_services entirely is still valid — that is how "leave it alone" is expressed', () => {
    const parsed = CreateTemplateSchema.safeParse(base);
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.example_services).toBeUndefined();
  });

  it('SAD: a look_first row without a description is rejected', () => {
    // WHY: resolveServiceForBooking's semantic step embeds name + subtitle +
    // description. Name-only was measured at ~0.30 against the production
    // INTENT_MATCH_THRESHOLD of 0.35, so the row the caller wanted is not found
    // and the tenant default is booked instead — silently, and wrongly.
    const parsed = CreateTemplateSchema.safeParse({
      ...base,
      example_services: [{ name: 'Diagnostic visit', look_first: true }],
    });
    expect(parsed.success).toBe(false);
    expect(JSON.stringify(parsed.success ? '' : parsed.error.issues)).toMatch(/non-blank description/);
  });

  it('SAD: a look_first row whose description is only whitespace is rejected too', () => {
    const parsed = CreateTemplateSchema.safeParse({
      ...base,
      example_services: [{ name: 'Diagnostic visit', description: '   ', look_first: true }],
    });
    expect(parsed.success).toBe(false);
  });

  it('SAD: two is_default rows are rejected', () => {
    // WHY: shared/starterServices.ts — "Exactly one row per vertical is
    // is_default. It becomes the tenant's default service." Two makes which one
    // wins an accident of row order.
    const parsed = CreateTemplateSchema.safeParse({
      ...base,
      example_services: [
        { name: 'Diagnostic visit', is_default: true },
        { name: 'Oil change', is_default: true },
      ],
    });
    expect(parsed.success).toBe(false);
    expect(JSON.stringify(parsed.success ? '' : parsed.error.issues)).toMatch(/exactly one starter service may be is_default/);
  });

  it('HAPPY: exactly one is_default is fine', () => {
    const parsed = CreateTemplateSchema.safeParse({
      ...base,
      example_services: [{ name: 'Diagnostic visit', is_default: true }, { name: 'Oil change' }],
    });
    expect(parsed.success).toBe(true);
  });

  it('SAD: duplicate names are rejected, case- and whitespace-insensitively', () => {
    const parsed = CreateTemplateSchema.safeParse({
      ...base,
      example_services: [{ name: 'Oil change' }, { name: '  OIL CHANGE ' }],
    });
    expect(parsed.success).toBe(false);
    expect(JSON.stringify(parsed.success ? '' : parsed.error.issues)).toMatch(/duplicate starter service name/);
  });
});
