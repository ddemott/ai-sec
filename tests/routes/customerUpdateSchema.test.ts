/**
 * "On the secretaryhq.com site, tried to update customer name but it failed."
 *   — the owner, in production, 2026-07-14
 *
 * The name was fine. The EMAIL was blank.
 *
 * The edit form submits every field it has, so a customer with no email on file sends
 * `email: ""`. An empty string is neither `undefined` nor `null`, so `.optional()` and
 * `.nullable()` both wave it through to `.email()` — which rejects it, and Zod fails the
 * WHOLE request. The rename dies because of a field the owner never touched, and the
 * error he sees is about email, which he cannot connect to what he was doing.
 *
 * This is the SAME TRAP as the `??` bug in the voice agent, wearing different clothes:
 * an empty string is not "absent". `??` does not fall through on `""`, and neither does
 * `.nullable()`. A UI produces empty strings constantly — it is the normal state of a
 * text box nobody typed in.
 */
import { describe, it, expect } from 'vitest';
import { CustomerUpdateSchema } from '../../src/routes/customers';

describe('PUT /customers/:id — a blank field must not fail an unrelated edit', () => {
  it('SAD: renaming a customer with NO EMAIL on file (the production bug)', () => {
    // WHO: the owner, renaming a customer in the CRM.
    // WHAT: the form sends the blank email box as "".
    // WHY: this exact payload 400'd in production and the rename was lost.
    const parsed = CustomerUpdateSchema.safeParse({
      name: 'Kyle Stevenson',
      phone: '+12624979039',
      email: '', // <- the blank box he never touched
    });

    expect(parsed.success, 'a blank email must not reject the request').toBe(true);
    if (parsed.success) {
      expect(parsed.data.name).toBe('Kyle Stevenson'); // the edit survives
      expect(parsed.data.email).toBeNull(); // "" means "no email", which is what he meant
    }
  });

  it('SAD: every optional text field survives being blank', () => {
    // WHY: email was merely the first one anyone hit. The same form sends "" for address,
    //      city, state, postcode and the rest, and each is one `.email()`-shaped rule away
    //      from doing the same thing. Normalise blanks once, at the boundary, for all of
    //      them — rather than waiting to be told about each in turn from production.
    const parsed = CustomerUpdateSchema.safeParse({
      name: 'Kyle Stevenson',
      email: '',
      first_name: '',
      last_name: '',
      address: '',
      address_line2: '',
      city: '',
      state: '',
      postal_code: '',
      timezone: '',
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      for (const [k, v] of Object.entries(parsed.data)) {
        if (k === 'name') continue;
        expect(v, `${k} should be null when blank`).toBeNull();
      }
    }
  });

  it('SAD: a blank NAME or PHONE means "unchanged", never "wipe it"', () => {
    // WHY: name and phone are the two fields that must not be emptied by an absent-minded
    //      form. A blank one is "I did not change this" — the handler preserves the
    //      current value for anything undefined — NOT "delete the customer's phone".
    //      Before this, "" hit `.min(1)` and 400'd the request instead.
    const parsed = CustomerUpdateSchema.safeParse({ name: '', phone: '', city: 'Chicago' });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.name).toBeUndefined(); // untouched, not blanked
      expect(parsed.data.phone).toBeUndefined();
      expect(parsed.data.city).toBe('Chicago');
    }
  });

  it('HAPPY: a genuinely malformed email is still rejected', () => {
    // WHY: the fix must not become "accept anything". Blank is absent; "not-an-email" is
    //      a mistake, and the owner needs to be told.
    const parsed = CustomerUpdateSchema.safeParse({ name: 'Kyle', email: 'not-an-email' });
    expect(parsed.success).toBe(false);
  });
});
