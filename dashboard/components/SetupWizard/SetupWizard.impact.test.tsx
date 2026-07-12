/**
 * The removal-impact confirmation gate.
 *
 * A SYNC commit (re-running setup on an existing business) SOFT-DELETES anything
 * the owner removed from the draft — which can include a service, staff member,
 * or resource that upcoming appointments are already booked against. Before this
 * gate, the wizard would do that silently: the backend reported the number of
 * stranded bookings, but only in the commit RESPONSE, i.e. after the soft-delete
 * had already happened. That is no use to someone deciding whether to go through
 * with it.
 *
 * The property under test is therefore not "a modal appears" — it is that the
 * COMMIT DOES NOT FIRE until the owner has said yes. A test that only asserted on
 * the modal would still pass if the commit raced ahead behind it.
 *
 * WHO: an owner re-running setup who deleted a service someone is booked for
 * WHERE: dashboard/components/SetupWizard/index.tsx goNext() → /setup/impact
 */
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

vi.mock('@/lib/SessionContext', () => ({
  useSessionContext: () => ({
    tenantId: 'f234e471-0e60-4163-86c9-93cfd9338e3a',
    userName: 'Owner',
    isAdmin: false,
    managedTenantId: 'f234e471-0e60-4163-86c9-93cfd9338e3a',
    managedTenantName: 'Test',
    loading: false,
    login: vi.fn(),
    logout: vi.fn(),
    selectManagedTenant: vi.fn(),
    tenantsVersion: 0,
    notifyTenantsChanged: vi.fn(),
  }),
  useActiveTenantId: () => 'f234e471-0e60-4163-86c9-93cfd9338e3a',
  SessionProvider: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('@/lib/VocabularyContext', () => ({
  useVocabulary: () => ({
    resource_label: 'Resource',
    resource_plural: 'Resources',
    employee_label: 'Employee',
    employee_plural: 'Employees',
    booking_label: 'Appointment',
  }),
}));

import SetupWizard from './index';

const SERVICE_ID = 'aaaaaaaa-1111-4111-8111-111111111111';
const EMPLOYEE_ID = 'bbbbbbbb-2222-4222-8222-222222222222';
const RESOURCE_ID = 'cccccccc-3333-4333-8333-333333333333';

/** An existing business, so the wizard hydrates and enters SYNC mode. */
const EXISTING_GRAPH = {
  services: [
    {
      service_id: SERVICE_ID,
      name: 'Color',
      subtitle: null,
      description: null,
      duration_minutes: 90,
      price: null,
    },
  ],
  resources: [{ resource_id: RESOURCE_ID, name: 'Chair 1', description: null }],
  employees: [
    {
      employee_id: EMPLOYEE_ID,
      name: 'Tess',
      first_name: 'Tess',
      last_name: '',
      email: null,
      phone: null,
    },
  ],
  shifts: [{ employee_id: EMPLOYEE_ID, day_of_week: 1, start_time: '09:00', end_time: '17:00' }],
  service_employee: [{ service_id: SERVICE_ID, employee_id: EMPLOYEE_ID }],
  service_resource: [{ service_id: SERVICE_ID, resource_id: RESOURCE_ID }],
};

let impactFails = false;

function setupFetch() {
  (global.fetch as unknown as ReturnType<typeof vi.fn>) = vi
    .fn()
    .mockImplementation((url: string, init?: { method?: string }) => {
      const path = typeof url === 'string' ? url : '';

      if (path.includes('/setup/graph')) {
        return Promise.resolve({ ok: true, json: async () => EXISTING_GRAPH });
      }
      if (path.includes('/setup/impact') && init?.method === 'POST') {
        if (impactFails) return Promise.reject(new Error('network'));
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            impact: {
              upcomingAppointments: 2,
              removed: [{ kind: 'service', name: 'Color', upcomingAppointments: 2 }],
            },
          }),
        });
      }
      if (path.includes('/setup/commit') && init?.method === 'POST') {
        return Promise.resolve({ ok: true, json: async () => ({ success: true, counts: {} }) });
      }
      return Promise.resolve({ ok: true, json: async () => [] });
    });
}

const commitCalls = () =>
  (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.filter(
    ([u, i]) =>
      typeof u === 'string' &&
      u.includes('/setup/commit') &&
      (i as RequestInit | undefined)?.method === 'POST'
  );

beforeEach(() => {
  vi.clearAllMocks();
  impactFails = false;
  localStorage.setItem('tenantId', 'f234e471-0e60-4163-86c9-93cfd9338e3a');
  setupFetch();
});

/** Walk a hydrated (sync-mode) wizard from step 1 to the Go Live click. */
async function goLive() {
  render(<SetupWizard isOpen={true} onClose={() => {}} />);
  // Wait for hydration — the preloaded service is what puts us in sync mode.
  await waitFor(() => expect(screen.getByText('Color')).toBeInTheDocument());
  for (let i = 0; i < 7; i++) fireEvent.click(screen.getByText('Next'));
  await waitFor(() => expect(screen.getByText('Step 8 of 9')).toBeInTheDocument());
  fireEvent.click(screen.getByText('Go Live'));
}

describe('SetupWizard — removal-impact gate', () => {
  test('HOLDS the commit and names what would be stranded', async () => {
    await goLive();

    // The warning names the service AND the booking count — "2 appointments
    // affected" alone wouldn't tell the owner whether they're retiring a dead
    // service or the one their whole book is on.
    await waitFor(() =>
      expect(screen.getByText(/This will affect booked appointments/i)).toBeInTheDocument()
    );
    expect(screen.getByText(/Color/)).toBeInTheDocument();

    // THE assertion: nothing has been committed. The soft-delete has NOT happened,
    // so "go back" is still a real option rather than a lie.
    expect(commitCalls()).toHaveLength(0);
  });

  test('backing out commits NOTHING', async () => {
    await goLive();
    await waitFor(() =>
      expect(screen.getByText(/This will affect booked appointments/i)).toBeInTheDocument()
    );

    fireEvent.click(screen.getByText('Cancel'));

    await waitFor(() =>
      expect(screen.queryByText(/This will affect booked appointments/i)).not.toBeInTheDocument()
    );
    expect(commitCalls()).toHaveLength(0);
    // Still on step 8 — the owner can go back and restore what they removed.
    expect(screen.getByText('Step 8 of 9')).toBeInTheDocument();
  });

  test('confirming commits once and advances', async () => {
    await goLive();
    await waitFor(() =>
      expect(screen.getByText(/This will affect booked appointments/i)).toBeInTheDocument()
    );

    fireEvent.click(screen.getByText('Remove and finish setup'));

    await waitFor(() => expect(commitCalls()).toHaveLength(1));
    const body = JSON.parse(commitCalls()[0][1]!.body as string);
    expect(body.mode).toBe('sync');
    await waitFor(() => expect(screen.getByText('Step 9 of 9')).toBeInTheDocument());
  });

  test('a FAILED impact check still blocks — never silently destroy what we could not describe', async () => {
    // The preview is what makes the removal explainable. If it fails we must not
    // just barrel on and soft-delete anyway — that is precisely the behavior this
    // gate exists to stop. But we also don't hard-block setup on a transient
    // error: we confirm with an honest "we couldn't check".
    impactFails = true;
    await goLive();

    await waitFor(() =>
      expect(screen.getByText(/Couldn't check what this affects/i)).toBeInTheDocument()
    );
    expect(commitCalls()).toHaveLength(0);

    fireEvent.click(screen.getByText('Continue anyway'));
    await waitFor(() => expect(commitCalls()).toHaveLength(1));
  });
});
