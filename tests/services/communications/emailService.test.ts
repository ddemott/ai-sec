/**
 * Unit tests for EmailService constructor simulation-mode guard.
 *
 * WHO:   EmailService constructor
 * WHAT:  one-time console.warn when EMAIL_USER/EMAIL_PASS are absent in non-test env
 * WHEN:  during service instantiation
 * WHERE: src/services/communications/emailService.ts
 * WHY:   silent mock fallback in production was the same failure mode fixed for SMS
 *        (PR #23); the warn must fire exactly once to avoid log spam from multiple
 *        service instances, and must stay silent in NODE_ENV=test so test output
 *        stays clean.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { InMemoryTenantConfigService } from '../../../src/services/tenants/index.js';

const mockConfigService = new InMemoryTenantConfigService();

// Helper to reset the static flag between tests so each can observe the
// first-construction behavior independently.
function resetSimulationFlag() {
  // Access the static field via the class — TypeScript allows this.
   
  (EmailService as any).simulationNoticeLogged = false;
}

// Imported after we do env manipulation in the tests — vitest reuses the
// same module across tests in the same file so the static flag persists.
// We import at the top and reset the flag manually.
import { EmailService } from '../../../src/services/communications/emailService.js';

describe('EmailService — simulation mode guard', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalEmailUser = process.env.EMAIL_USER;
  const originalEmailPass = process.env.EMAIL_PASS;

  afterEach(() => {
    // Restore env after each test.
    process.env.NODE_ENV = originalNodeEnv;
    process.env.EMAIL_USER = originalEmailUser;
    process.env.EMAIL_PASS = originalEmailPass;
    resetSimulationFlag();
    vi.restoreAllMocks();
  });

  it('HAPPY: no warning in NODE_ENV=test even without creds', () => {
    // WHO: EmailService in test environment (no EMAIL_USER/EMAIL_PASS)
    // WHAT: constructor must not call console.warn
    // WHY:  mock transporter is correct in tests — warning would pollute output
    process.env.NODE_ENV = 'test';
    delete process.env.EMAIL_USER;
    delete process.env.EMAIL_PASS;

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    new EmailService(mockConfigService);

    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('HAPPY: warning emitted once when creds absent outside test env', () => {
    // WHO: EmailService in production without email credentials
    // WHAT: exactly one console.warn on first construction
    // WHY:  silence was the original bug — prod sent 0 emails with 0 errors
    process.env.NODE_ENV = 'production';
    delete process.env.EMAIL_USER;
    delete process.env.EMAIL_PASS;

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    new EmailService(mockConfigService);

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain('EMAIL_USER');
    expect(warnSpy.mock.calls[0][0]).toContain('simulation mode');
  });

  it('HAPPY: warning emitted only once across multiple constructions', () => {
    // WHO: multiple EmailService instances (e.g. CommunicationService + AppointmentService)
    // WHAT: second construction must NOT re-log
    // WHY:  class-level flag prevents log spam in a multi-instance server boot
    process.env.NODE_ENV = 'production';
    delete process.env.EMAIL_USER;
    delete process.env.EMAIL_PASS;

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    new EmailService(mockConfigService);
    new EmailService(mockConfigService);
    new EmailService(mockConfigService);

    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it('HAPPY: no warning when EMAIL_USER and EMAIL_PASS are both set', () => {
    // WHO: EmailService in production with real credentials
    // WHAT: real nodemailer transporter created, no warn
    process.env.NODE_ENV = 'production';
    process.env.EMAIL_USER = 'test@example.com';
    process.env.EMAIL_PASS = 'secret';

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // This would attempt to create a real nodemailer transport; it won't try
    // to connect until sendMail is called, so construction is safe in tests.
    new EmailService(mockConfigService);

    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('SAD: warning fires in dev env (not just production) when creds absent', () => {
    // WHO: EmailService in development without email credentials
    // WHAT: warn fires regardless of which non-test NODE_ENV value is used
    process.env.NODE_ENV = 'development';
    delete process.env.EMAIL_USER;
    delete process.env.EMAIL_PASS;

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    new EmailService(mockConfigService);

    expect(warnSpy).toHaveBeenCalledTimes(1);
  });
});
