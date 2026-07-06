// @vitest-environment jsdom
/**
 * SetupWizard "Change business type" link + auto-seeded reset — Phase B
 * (2026-05-27 — Dale: "I first picked Answering Service. Then whenever
 * Picked any other business regardless, it had all of the answering
 * service services.").
 *
 * WHO: an owner who picked the wrong business type at the picker, got the
 *      matching template's example_services auto-seeded into the DRAFT, and
 *      wants to switch to a different type without abandoning the wizard.
 * WHAT: Step 1's "Change business type" link
 *       (a) only appears when onBackToPicker is wired,
 *       (b) drops ONLY the auto-seeded draft rows — a user-typed row survives
 *           — making ZERO Api.services/resources create/delete calls (Phase B:
 *           nothing was ever written, so there is nothing to delete),
 *       (c) invokes the parent's onBackToPicker callback to transition the
 *           onboarding stage, even before auto-seed has finished.
 * WHY: pre-Phase-B, the auto-seed gate (services.length === 0, read from the
 *      DB) stayed closed forever after the first seed, so a re-pick kept
 *      showing the original template's services regardless of what was
 *      selected. Under draft-commit the underlying bug can still recur if
 *      the auto-seeded draft rows aren't cleared on re-pick — this suite
 *      pins the NEW mechanism (local reset, not DB rollback) against the
 *      SAME regression.
 */
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

const TENANT = 'f234e471-0e60-4163-86c9-93cfd9338e3a';

vi.mock('@/lib/SessionContext', () => ({
  useActiveTenantId: () => TENANT,
  useSessionContext: () => ({ tenantId: TENANT, loading: false }),
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

// Phase B: no DB reads back services/resources for the wizard anymore, but
// these spies stay wired so the tests can assert they are NEVER called —
// that absence IS the property under test.
const createService = vi.fn(async (..._args: unknown[]) => ({
  service: { service_id: 'svc-real-1' },
}));
const createResource = vi.fn(async (..._args: unknown[]) => ({
  resource: { resource_id: 'res-real-1' },
}));
const deleteService = vi.fn(async (..._args: unknown[]) => ({ success: true }));
const deleteResource = vi.fn(async (..._args: unknown[]) => ({ success: true }));

vi.mock('@/lib/api', () => ({
  Api: {
    tenants: { getConfig: vi.fn().mockResolvedValue({ business_type: 'answering-service' }) },
    templates: {
      listFull: vi.fn().mockResolvedValue([
        {
          business_type: 'answering-service',
          example_services: ['Phone Consultation', 'In-Person Meeting'],
        },
      ]),
    },
    services: {
      create: (...args: unknown[]) => createService(...args),
      delete: (...args: unknown[]) => deleteService(...args),
    },
    resources: {
      create: (...args: unknown[]) => createResource(...args),
      delete: (...args: unknown[]) => deleteResource(...args),
    },
    coverage: { dryRun: vi.fn().mockResolvedValue([]) },
    setup: { commit: vi.fn().mockResolvedValue({ success: true, counts: {} }) },
  },
}));

import SetupWizard from './index';

describe('SetupWizard — Change business type (back-to-picker, Phase B)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('Step 1 hides the link when onBackToPicker is omitted', async () => {
    render(<SetupWizard isOpen onClose={vi.fn()} />);
    await screen.findByText('Phone Consultation'); // auto-seed settled
    expect(screen.queryByRole('button', { name: /Change business type/i })).toBeNull();
  });

  test('Step 1 shows the link when onBackToPicker is wired', async () => {
    render(<SetupWizard isOpen onClose={vi.fn()} onBackToPicker={vi.fn()} />);
    await screen.findByText('Phone Consultation');
    expect(screen.getByRole('button', { name: /Change business type/i })).toBeTruthy();
  });

  test('clicking the link makes ZERO mutating API calls, drops only auto-seeded rows (a user-typed row survives), and calls onBackToPicker', async () => {
    const onBackToPicker = vi.fn();
    render(<SetupWizard isOpen onClose={vi.fn()} onBackToPicker={onBackToPicker} />);

    // Auto-seed lands both template services + the default resource in the draft.
    await screen.findByText('Phone Consultation');
    await screen.findByText('In-Person Meeting');

    // Add a user-typed service alongside the seeded ones.
    fireEvent.click(screen.getByRole('button', { name: /Add a service/i }));
    fireEvent.change(screen.getByLabelText('Service Name'), {
      target: { value: 'My Custom Service' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^Add Service$/i }));
    await screen.findByText('My Custom Service');

    fireEvent.click(screen.getByRole('button', { name: /Change business type/i }));

    await waitFor(() => expect(onBackToPicker).toHaveBeenCalledTimes(1));

    // The whole point of Phase B: nothing was ever written, so re-pick never
    // deletes or creates anything server-side.
    expect(createService).not.toHaveBeenCalled();
    expect(deleteService).not.toHaveBeenCalled();
    expect(createResource).not.toHaveBeenCalled();
    expect(deleteResource).not.toHaveBeenCalled();

    // Seeded rows are cleared from the draft; the user-typed row survives —
    // the exact "keep what the user typed" nicety the old DB-tracked refs
    // provided, now via a local auto-seeded tmp_id set.
    expect(screen.queryByText('Phone Consultation')).toBeNull();
    expect(screen.queryByText('In-Person Meeting')).toBeNull();
    expect(screen.getByText('My Custom Service')).toBeTruthy();
  });

  test('re-pick always reaches the picker, even before auto-seed has finished', async () => {
    const onBackToPicker = vi.fn();
    render(<SetupWizard isOpen onClose={vi.fn()} onBackToPicker={onBackToPicker} />);

    // Click immediately — do not wait for the seed fetches to resolve.
    fireEvent.click(screen.getByRole('button', { name: /Change business type/i }));

    await waitFor(() => expect(onBackToPicker).toHaveBeenCalledTimes(1));
  });
});
