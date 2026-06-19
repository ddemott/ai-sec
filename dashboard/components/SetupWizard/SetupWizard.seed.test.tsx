// @vitest-environment jsdom
/**
 * SetupWizard auto-seed failure + retry (Cluster-B defect 3, 2026-05-21).
 *
 * WHO: an owner opening the setup wizard with an empty catalog
 * WHAT: when seeding the starter services/resource fails, the wizard must
 *       SURFACE it (banner + Retry), not swallow it (the old behavior was a
 *       silent console.warn that left setup half-done with no signal)
 * WHERE: components/SetupWizard/index.tsx runSeed + the body retry banner
 * WHY: a half-seeded, silent failure stranded new owners. Reconcile-on-retry
 *      finishes the job; this pins the surfaced-error + retry-invokes contract.
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

// Empty catalog so the auto-seed path runs.
const refresh = vi.fn();
vi.mock('@/lib/hooks', () => ({
  useStaticData: () => ({
    services: [],
    resources: [],
    employees: [],
    customers: [],
    skills: [],
    loading: false,
    error: null,
    refresh,
  }),
}));

const createService = vi.fn();
vi.mock('@/lib/api', () => ({
  Api: {
    tenants: { getConfig: vi.fn().mockResolvedValue({ business_type: 'salon' }) },
    templates: {
      listFull: vi
        .fn()
        .mockResolvedValue([{ business_type: 'salon', example_services: ['Haircut', 'Color'] }]),
    },
    services: { create: (...args: unknown[]) => createService(...args) },
    resources: { create: vi.fn().mockResolvedValue({}) },
  },
}));

import SetupWizard from './index';

describe('SetupWizard auto-seed failure + retry', () => {
  beforeEach(() => vi.clearAllMocks());

  test('SAD: a seed failure surfaces a retry banner instead of failing silently', async () => {
    createService.mockRejectedValue(new Error('boom'));
    render(<SetupWizard isOpen onClose={vi.fn()} />);

    const alert = await screen.findByRole('alert');
    expect(alert).toBeTruthy();
    expect(alert.textContent).toMatch(/Couldn.t finish setting up/i);
    expect(screen.getByRole('button', { name: /Retry/i })).toBeTruthy();
  });

  test('Retry re-invokes the seed (and clears the banner on success)', async () => {
    createService.mockRejectedValueOnce(new Error('boom')); // first attempt fails
    render(<SetupWizard isOpen onClose={vi.fn()} />);

    await screen.findByRole('alert');
    const callsBeforeRetry = createService.mock.calls.length;

    createService.mockResolvedValue({}); // now succeeds
    fireEvent.click(screen.getByRole('button', { name: /Retry/i }));

    // Retry re-attempts the seed...
    await waitFor(() => expect(createService.mock.calls.length).toBeGreaterThan(callsBeforeRetry));
    // ...and on success the banner clears.
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });
});
