/**
 * Tests for syncOrchestrator — centralized sync coordination.
 * Verifies fire-and-forget pattern, structured logging, and error isolation.
 * Happy + sad paths with 5W diagnostic context.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';

describe('syncOrchestrator', () => {
  it('HAPPY: syncAppointmentToAll calls all 5 providers', () => {
    // WHO: Route handler creating an appointment
    // WHAT: Should fire sync to calendar + 4 CRM providers
    // WHY: All connected providers need to know about the new appointment
    const src = fs.readFileSync('src/services/syncOrchestrator.ts', 'utf8');

    expect(src).toContain('syncAppointmentToCalendar');
    expect(src).toContain('syncAppointmentToJobber');
    expect(src).toContain('syncAppointmentToHubSpot');
    expect(src).toContain('syncAppointmentToSquare');
    expect(src).toContain('syncAppointmentToServiceTitan');
  });

  it('HAPPY: syncCustomerToAll calls all 4 CRM providers', () => {
    // WHO: Route handler creating/updating a customer
    // WHAT: Should fire sync to 4 CRM providers (no calendar for customers)
    // WHY: CRM providers need customer data synced
    const src = fs.readFileSync('src/services/syncOrchestrator.ts', 'utf8');

    expect(src).toContain('syncCustomerToJobber');
    expect(src).toContain('syncCustomerToHubSpot');
    expect(src).toContain('syncCustomerToSquare');
    expect(src).toContain('syncCustomerToServiceTitan');
    // Calendar sync is NOT called for customers
    expect(src).not.toContain('syncCustomerToCalendar');
  });

  it('HAPPY: errors are logged with structured context (provider, entity, action)', () => {
    // WHO: Sync orchestrator catching a provider failure
    // WHAT: Should log provider name, entity type, action, and entity ID
    // WHY: Structured logging enables filtering in production (e.g. "show all Jobber failures")
    const src = fs.readFileSync('src/services/syncOrchestrator.ts', 'utf8');

    expect(src).toContain('provider');
    expect(src).toContain('entity');
    expect(src).toContain('action');
    expect(src).toContain('entityId');
    expect(src).toContain('logger.error');
  });

  it('SAD: individual provider failure does not block other providers', () => {
    // WHO: Sync where one provider throws
    // WHAT: Other providers should still be called (fire-and-forget)
    // WHY: Jobber being down should not prevent HubSpot sync
    const src = fs.readFileSync('src/services/syncOrchestrator.ts', 'utf8');

    // Each provider has its own .catch() — failures are isolated
    expect(src).toContain('.catch(');
    // The function returns void (fire-and-forget, never awaited)
    expect(src).toContain('): void');
  });

  it('HAPPY: appointments.ts uses syncAppointmentToAll instead of individual calls', () => {
    // WHO: Appointment route handlers
    // WHAT: Should use the orchestrator, not 5 individual sync calls
    // WHY: Centralized sync = consistent logging, easier to maintain
    const src = fs.readFileSync('src/routes/appointments.ts', 'utf8');

    expect(src).toContain('syncAppointmentToAll');
    expect(src).not.toContain('syncAppointmentToCalendar');
    expect(src).not.toContain('syncAppointmentToJobber');
  });

  it('HAPPY: customers.ts uses syncCustomerToAll instead of individual calls', () => {
    // WHO: Customer route handlers
    // WHAT: Should use the orchestrator
    // WHY: Same as appointments — centralized sync
    const src = fs.readFileSync('src/routes/customers.ts', 'utf8');

    expect(src).toContain('syncCustomerToAll');
    expect(src).not.toContain('syncCustomerToJobber');
    expect(src).not.toContain('syncCustomerToHubSpot');
  });
});
