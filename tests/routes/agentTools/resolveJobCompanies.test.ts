/**
 * resolveJobCompanies — DERIVE represents_company from the two company NAMES, not the
 * model's boolean.
 *
 * WHY (WHO/WHAT/WHEN/WHERE/WHY): the live-LLM-caller E2E (2026-07-15) caught the voice
 * model setting represents_company=true for a recruiter placing a role with a *different*
 * client (Northern Trust) than the agency they called from (TEKsystems) — the owner would
 * be told the caller works for the client when they do not. The model reliably reports the
 * two names it HEARD but flips the boolean, so whether the two are the same company is
 * computed here, not trusted from the model.
 */
import { describe, it, expect } from 'vitest';
import { resolveJobCompanies } from '../../../src/routes/agentTools/messaging';

describe('resolveJobCompanies — represents_company is derived from the names', () => {
  it('SAD: agency placing with a DIFFERENT client → false, even if the model said true', () => {
    // The exact E2E failure: model flipped the flag to true.
    const r = resolveJobCompanies({
      caller_company: 'TEKsystems',
      client_company: 'Northern Trust',
      represents_company: true, // model is WRONG
    });
    expect(r.representsCompany).toBe(false);
    expect(r.callerCompany).toBe('TEKsystems');
    expect(r.clientCompany).toBe('Northern Trust');
  });

  it('HAPPY: same company under both → in-house (true), even if the model said false', () => {
    const r = resolveJobCompanies({
      caller_company: 'Globex',
      client_company: 'Globex',
      represents_company: false, // model is WRONG the other way
    });
    expect(r.representsCompany).toBe(true);
  });

  it('same company but different casing/spacing still reads as in-house', () => {
    const r = resolveJobCompanies({
      caller_company: '  globex ',
      client_company: 'Globex',
      represents_company: null,
    });
    expect(r.representsCompany).toBe(true);
    expect(r.callerCompany).toBe('globex'); // trimmed
    expect(r.clientCompany).toBe('Globex');
  });

  it('in-house said ONCE (only one name) + flag true → fill the other from it', () => {
    const r = resolveJobCompanies({
      caller_company: 'Globex',
      client_company: null,
      represents_company: true,
    });
    expect(r.representsCompany).toBe(true);
    expect(r.clientCompany).toBe('Globex');
    expect(r.callerCompany).toBe('Globex');
  });

  it('in-house said once, name only in client_company → fills caller_company', () => {
    const r = resolveJobCompanies({
      caller_company: null,
      client_company: 'Globex',
      represents_company: true,
    });
    expect(r.clientCompany).toBe('Globex');
    expect(r.callerCompany).toBe('Globex');
  });

  it('agency with only the client named (no agency name) → keep as-is, false', () => {
    const r = resolveJobCompanies({
      caller_company: null,
      client_company: 'Blue Cross',
      represents_company: false,
    });
    expect(r.representsCompany).toBe(false);
    expect(r.clientCompany).toBe('Blue Cross');
    expect(r.callerCompany).toBeNull();
  });

  it('blank/whitespace company strings are treated as absent', () => {
    const r = resolveJobCompanies({
      caller_company: '   ',
      client_company: '',
      represents_company: null,
    });
    expect(r.callerCompany).toBeNull();
    expect(r.clientCompany).toBeNull();
    expect(r.representsCompany).toBeNull();
  });

  it('nothing provided → all null, no crash', () => {
    const r = resolveJobCompanies({});
    expect(r).toEqual({ clientCompany: null, callerCompany: null, representsCompany: null });
  });
});
