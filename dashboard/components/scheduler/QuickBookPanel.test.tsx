import React from 'react';
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

const { mockApi } = vi.hoisted(() => ({
  mockApi: {
    appointments: { create: vi.fn() },
    mappings: {
      listServiceEmployee: vi.fn(),
      listServiceResource: vi.fn(),
    },
  },
}));

vi.mock('../../lib/api', () => ({ Api: mockApi }));
vi.mock('@/lib/SessionContext', () => ({
  useActiveTenantId: () => 'tenant-1',
}));
vi.mock('@/lib/VocabularyContext', () => ({
  useVocabulary: () => ({
    employee_label: 'Tech',
    employee_plural: 'Techs',
    resource_label: 'Bay',
    resource_plural: 'Bays',
    booking_label: 'Appointment',
  }),
}));

// Imported after mocks.
import { QuickBookPanel } from './QuickBookPanel';

const customers = [{ id: 'c-1', name: 'Alice', phone: '+15555550001' }];
const employees = [
  { id: 'emp-mike', name: 'Mike' },
  { id: 'emp-dana', name: 'Dana' },
];
const resources = [
  { id: 'bay-1', name: 'Bay 1' },
  { id: 'bay-3', name: 'Bay 3' },
];
const services = [
  { id: 'svc-tire', name: 'Tire Mount', duration_minutes: 60 },
  { id: 'svc-open', name: 'Inspection', duration_minutes: 30 },
];

beforeEach(() => {
  mockApi.appointments.create.mockReset().mockResolvedValue({ success: true });
  // Tire Mount → only Mike + only Bay 1 are valid.
  mockApi.mappings.listServiceEmployee.mockReset().mockResolvedValue([
    { service_id: 'svc-tire', employee_id: 'emp-mike', tenant_id: 'tenant-1' },
  ]);
  mockApi.mappings.listServiceResource.mockReset().mockResolvedValue([
    { service_id: 'svc-tire', resource_id: 'bay-1', tenant_id: 'tenant-1' },
  ]);
});

function renderPanel(overrides: Partial<React.ComponentProps<typeof QuickBookPanel>> = {}) {
  return render(
    <QuickBookPanel
      isOpen={true}
      onClose={vi.fn()}
      tenantId="tenant-1"
      customers={customers}
      employees={employees}
      resources={resources}
      services={services}
      onBooked={vi.fn()}
      {...overrides}
    />
  );
}

describe('QuickBookPanel — alignment filter (audit P1 #4 follow-up)', () => {
  test('Tech and Bay dropdowns show every option BEFORE a service is picked', async () => {
    renderPanel();
    await waitFor(() => expect(mockApi.mappings.listServiceEmployee).toHaveBeenCalled());
    const techSelect = screen.getByTestId('quick-book-employee') as HTMLSelectElement;
    const bayLabels = Array.from(techSelect.options).map((o) => o.text);
    expect(bayLabels).toContain('Mike');
    expect(bayLabels).toContain('Dana');
    const resSelect = screen.getByTestId('quick-book-resource') as HTMLSelectElement;
    const resLabels = Array.from(resSelect.options).map((o) => o.text);
    expect(resLabels).toContain('Bay 1');
    expect(resLabels).toContain('Bay 3');
    // WHO: front-desk operator who hasn't picked a service yet | WHAT: dropdowns are unrestricted before service selection | WHEN: panel just opened | WHERE: QuickBookPanel filter null-guard | WHY: filtering before service is picked traps the operator into picking service first; falling open preserves the "any order" UX while still enforcing alignment once service IS chosen
  });

  test('picking a mapped service narrows Tech to qualified staff and Bay to permitted resources', async () => {
    renderPanel();
    await waitFor(() => expect(mockApi.mappings.listServiceEmployee).toHaveBeenCalled());
    fireEvent.change(screen.getByTestId('quick-book-service'), { target: { value: 'svc-tire' } });
    await waitFor(() => {
      const tech = Array.from((screen.getByTestId('quick-book-employee') as HTMLSelectElement).options).map((o) => o.text);
      expect(tech).toContain('Mike');
      expect(tech).not.toContain('Dana');
    });
    const res = Array.from((screen.getByTestId('quick-book-resource') as HTMLSelectElement).options).map((o) => o.text);
    expect(res).toEqual(['Bay 1']);
    // WHO: front-desk operator picking Tire Mount | WHAT: Dana drops from Tech dropdown (no skill); Bay 3 drops from Bay dropdown (no resource permission) | WHEN: service chosen, before booking | WHERE: QuickBookPanel filter on serviceId change | WHY: this is the headline UX win — pre-fix, the operator could pick Dana + Bay 3 + Tire Mount, hit Book Now, and only then learn Dana doesn't know how. Filtering up front matches the system's design contract: book only when employee+skill+resource align
  });

  test('picking an open-service (no mapping rows) keeps every Tech and Bay selectable', async () => {
    renderPanel();
    await waitFor(() => expect(mockApi.mappings.listServiceEmployee).toHaveBeenCalled());
    fireEvent.change(screen.getByTestId('quick-book-service'), { target: { value: 'svc-open' } });
    await waitFor(() => {
      const tech = Array.from((screen.getByTestId('quick-book-employee') as HTMLSelectElement).options).map((o) => o.text);
      expect(tech).toContain('Mike');
      expect(tech).toContain('Dana');
    });
    expect(screen.queryByTestId('quick-book-alignment-blocked')).not.toBeInTheDocument();
    // WHO: tenant with a service configured but not yet mapped to staff/resources | WHAT: all options remain selectable, no blocking message | WHEN: service has zero rows in service_employee/service_resource | WHERE: QuickBookPanel open-service branch | WHY: matches the booking RPC's behavior when required-skills/capabilities are empty arrays — the constraint is skipped. Forcing every new service to be skill-mapped before first booking would block the common "configure later" onboarding flow
  });

  test('shows inline blocking message + disables Book Now when service has zero qualified staff', async () => {
    // Tire Mount mapped to NOBODY in employees list — simulate orphaned mapping.
    mockApi.mappings.listServiceEmployee.mockResolvedValueOnce([
      { service_id: 'svc-tire', employee_id: 'emp-no-such-employee', tenant_id: 'tenant-1' },
    ]);
    renderPanel();
    await waitFor(() => expect(mockApi.mappings.listServiceEmployee).toHaveBeenCalled());
    fireEvent.change(screen.getByTestId('quick-book-service'), { target: { value: 'svc-tire' } });

    await waitFor(() => {
      expect(screen.getByTestId('quick-book-alignment-blocked')).toBeInTheDocument();
    });
    expect(screen.getByTestId('quick-book-alignment-blocked').textContent).toMatch(/no tech is configured/i);
    // Book button is disabled.
    expect(screen.getByTestId('quick-book-confirm')).toBeDisabled();
    // WHO: front-desk operator who picked a service whose only mapped staff member has been deactivated/deleted | WHAT: explicit block message + disabled Book button | WHEN: service has assignments but none of them resolve to an active employee | WHERE: QuickBookPanel alignmentBlocked branch | WHY: the RPC would reject this with NO_SKILLED_EMPLOYEE on submit — blocking up-front saves the operator from filling in the customer name only to fail; the message points them to the fix (Service Assignments) rather than leaving them stuck
  });

  test('switching from a mapped service back to no-service-picked clears the inline message', async () => {
    renderPanel();
    await waitFor(() => expect(mockApi.mappings.listServiceEmployee).toHaveBeenCalled());

    // Pick mapped service first.
    fireEvent.change(screen.getByTestId('quick-book-service'), { target: { value: 'svc-tire' } });
    await waitFor(() => {
      const tech = Array.from((screen.getByTestId('quick-book-employee') as HTMLSelectElement).options).map((o) => o.text);
      expect(tech).not.toContain('Dana');
    });

    // Back to walk-in (no service).
    fireEvent.change(screen.getByTestId('quick-book-service'), { target: { value: '' } });
    await waitFor(() => {
      const tech = Array.from((screen.getByTestId('quick-book-employee') as HTMLSelectElement).options).map((o) => o.text);
      expect(tech).toContain('Dana');
    });
    expect(screen.queryByTestId('quick-book-alignment-blocked')).not.toBeInTheDocument();
    // WHO: operator changing their mind about which service to book | WHAT: the form recovers — all options return, message clears | WHEN: serviceId set then cleared back to '' | WHERE: QuickBookPanel reactive filter | WHY: pin reactivity. A naive useEffect that only narrows on first set (without clearing on re-set to '') would leave the dropdown stuck in the narrow state, trapping the operator. Confirms the filter is a derivation, not a one-time effect
  });
});
