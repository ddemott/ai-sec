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

const customers = [{ customer_id: 'c-1', name: 'Alice', phone: '+15555550001' }];
const employees = [
  { employee_id: 'emp-mike', name: 'Mike' },
  { employee_id: 'emp-dana', name: 'Dana' },
];
const resources = [
  { resource_id: 'bay-1', name: 'Bay 1' },
  { resource_id: 'bay-3', name: 'Bay 3' },
];
const services = [
  { service_id: 'svc-tire', name: 'Tire Mount', duration_minutes: 60 },
  { service_id: 'svc-open', name: 'Inspection', duration_minutes: 30 },
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
    const techSelect = screen.getByTestId<HTMLSelectElement>('quick-book-employee');
    const bayLabels = Array.from(techSelect.options).map((o) => o.text);
    expect(bayLabels).toContain('Mike');
    expect(bayLabels).toContain('Dana');
    const resSelect = screen.getByTestId<HTMLSelectElement>('quick-book-resource');
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
      const tech = Array.from((screen.getByTestId<HTMLSelectElement>('quick-book-employee')).options).map((o) => o.text);
      expect(tech).toContain('Mike');
      expect(tech).not.toContain('Dana');
    });
    const res = Array.from((screen.getByTestId<HTMLSelectElement>('quick-book-resource')).options).map((o) => o.text);
    expect(res).toEqual(['Bay 1']);
    // WHO: front-desk operator picking Tire Mount | WHAT: Dana drops from Tech dropdown (no skill); Bay 3 drops from Bay dropdown (no resource permission) | WHEN: service chosen, before booking | WHERE: QuickBookPanel filter on serviceId change | WHY: this is the headline UX win — pre-fix, the operator could pick Dana + Bay 3 + Tire Mount, hit Book Now, and only then learn Dana doesn't know how. Filtering up front matches the system's design contract: book only when employee+skill+resource align
  });

  test('picking an open-service (no mapping rows) keeps every Tech and Bay selectable', async () => {
    renderPanel();
    await waitFor(() => expect(mockApi.mappings.listServiceEmployee).toHaveBeenCalled());
    fireEvent.change(screen.getByTestId('quick-book-service'), { target: { value: 'svc-open' } });
    await waitFor(() => {
      const tech = Array.from((screen.getByTestId<HTMLSelectElement>('quick-book-employee')).options).map((o) => o.text);
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
      const tech = Array.from((screen.getByTestId<HTMLSelectElement>('quick-book-employee')).options).map((o) => o.text);
      expect(tech).not.toContain('Dana');
    });

    // Back to walk-in (no service).
    fireEvent.change(screen.getByTestId('quick-book-service'), { target: { value: '' } });
    await waitFor(() => {
      const tech = Array.from((screen.getByTestId<HTMLSelectElement>('quick-book-employee')).options).map((o) => o.text);
      expect(tech).toContain('Dana');
    });
    expect(screen.queryByTestId('quick-book-alignment-blocked')).not.toBeInTheDocument();
    // WHO: operator changing their mind about which service to book | WHAT: the form recovers — all options return, message clears | WHEN: serviceId set then cleared back to '' | WHERE: QuickBookPanel reactive filter | WHY: pin reactivity. A naive useEffect that only narrows on first set (without clearing on re-set to '') would leave the dropdown stuck in the narrow state, trapping the operator. Confirms the filter is a derivation, not a one-time effect
  });
});

describe('QuickBookPanel — conflict modal wiring (slice 2, 2026-05-08)', () => {
  test('booking returns 409 + conflict block → modal renders with existing appointment details', async () => {
    // WHO: front-desk operator submits a booking that overlaps an existing one
    // WHAT: Api.appointments.create returns success:false + error_code TIMESLOT_OCCUPIED
    //        + a conflict block; QuickBookPanel surfaces the ConflictModal so
    //        the operator sees the existing customer/employee/resource/time
    //        instead of just a string toast
    // WHEN: the backend's GiST exclusion constraint or pre-check rejects on overlap
    // WHERE: QuickBookPanel.handleBook conflict-branch + the rendered <ConflictModal>
    // WHY: pre-fix the modal didn't exist — the operator only saw "Resource
    //       already booked" as a toast and had no actionable info. This test
    //       fails if a refactor breaks the wiring (modal not mounted, conflict
    //       state not set, error_code branch removed).
    mockApi.appointments.create.mockReset().mockResolvedValue({
      success: false,
      error: 'Resource already booked during this timeslot',
      error_code: 'TIMESLOT_OCCUPIED',
      conflict: {
        appointment_id: 'existing-1',
        start_time: '2026-05-10T14:00:00.000Z',
        end_time: '2026-05-10T14:30:00.000Z',
        customer_name: 'Bob Smith',
        employee_name: 'Mike',
        resource_name: 'Bay 1',
        description: 'Tire rotation',
      },
    });

    renderPanel();
    await waitFor(() => expect(mockApi.mappings.listServiceEmployee).toHaveBeenCalled());

    // Fill the form with a 15-min-aligned slot so client-side validator passes.
    fireEvent.change(screen.getByTestId('quick-book-customer-search'), { target: { value: 'Alice' } });
    fireEvent.change(screen.getByTestId('quick-book-customer'), { target: { value: 'c-1' } });
    fireEvent.change(screen.getByTestId('quick-book-resource'), { target: { value: 'bay-1' } });
    // Find the start/end time inputs by label association via the underlying input.
    const startInput = document.querySelectorAll<HTMLInputElement>('input[type="datetime-local"]')[0];
    const endInput = document.querySelectorAll<HTMLInputElement>('input[type="datetime-local"]')[1];
    fireEvent.change(startInput, { target: { value: '2026-05-10T14:00' } });
    fireEvent.change(endInput, { target: { value: '2026-05-10T14:30' } });

    // Submit. Booking call resolves with the conflict response.
    fireEvent.click(screen.getByTestId('quick-book-confirm'));

    // Modal renders with the existing appointment's details. Scope queries
    // to the modal's dialog role so we don't false-match "Mike" or "Bay 1"
    // in the form's dropdown options behind the backdrop.
    await waitFor(() => {
      expect(screen.getByText('That time is already booked')).toBeInTheDocument();
    });
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('Bob Smith');
    expect(dialog).toHaveTextContent('Mike');
    expect(dialog).toHaveTextContent('Bay 1');
  });

  test('booking returns plain error (no error_code) → modal NOT rendered, error stays inline', async () => {
    // WHY: the modal must only appear for true overlaps. Other failure modes
    //       (past time, no skilled employee, validation) keep the existing
    //       inline-error UX so the operator isn't confronted with a "view
    //       conflict" affordance for failures that have no conflict.
    mockApi.appointments.create.mockReset().mockResolvedValue({
      success: false,
      error: 'Employee is not on shift during this time',
    });

    renderPanel();
    await waitFor(() => expect(mockApi.mappings.listServiceEmployee).toHaveBeenCalled());

    fireEvent.change(screen.getByTestId('quick-book-customer-search'), { target: { value: 'Alice' } });
    fireEvent.change(screen.getByTestId('quick-book-customer'), { target: { value: 'c-1' } });
    fireEvent.change(screen.getByTestId('quick-book-resource'), { target: { value: 'bay-1' } });
    const startInput = document.querySelectorAll<HTMLInputElement>('input[type="datetime-local"]')[0];
    const endInput = document.querySelectorAll<HTMLInputElement>('input[type="datetime-local"]')[1];
    fireEvent.change(startInput, { target: { value: '2026-05-10T14:00' } });
    fireEvent.change(endInput, { target: { value: '2026-05-10T14:30' } });
    fireEvent.click(screen.getByTestId('quick-book-confirm'));

    await waitFor(() =>
      expect(screen.getByText('Employee is not on shift during this time')).toBeInTheDocument()
    );
    expect(screen.queryByText('That time is already booked')).not.toBeInTheDocument();
  });
});
