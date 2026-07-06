// @vitest-environment jsdom
/**
 * SetupWizard auto-seed failure + retry (Cluster-B defect 3, 2026-05-21;
 * updated for Phase B draft-commit, 2026-07-05).
 *
 * WHO: an owner opening the setup wizard with an empty catalog
 * WHAT: when seeding the starter services/resource fails, the wizard must
 *       SURFACE it (banner + Retry), not swallow it (the old behavior was a
 *       silent console.warn that left setup half-done with no signal)
 * WHERE: components/SetupWizard/index.tsx runSeed + the body retry banner
 * WHY: a half-seeded, silent failure stranded new owners. This still matters
 *      under Phase B, but the failure surface moved: seeding no longer calls
 *      Api.services.create (it pushes into local draft state, which cannot
 *      partially fail), so the only thing left that CAN fail is the read-only
 *      template/config fetch that decides what to seed. This suite pins the
 *      surfaced-error + retry contract against that new failure surface, and
 *      adds the inverse pin (seeding never calls the create APIs at all).
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

const createService = vi.fn();
const createResource = vi.fn();
const listFull = vi.fn();

vi.mock('@/lib/api', () => ({
  Api: {
    tenants: { getConfig: vi.fn().mockResolvedValue({ business_type: 'salon' }) },
    templates: { listFull: (...args: unknown[]) => listFull(...args) },
    services: { create: (...args: unknown[]) => createService(...args) },
    resources: { create: (...args: unknown[]) => createResource(...args) },
    coverage: { dryRun: vi.fn().mockResolvedValue([]) },
    setup: { commit: vi.fn().mockResolvedValue({ success: true, counts: {} }) },
  },
}));

import SetupWizard from './index';

describe('SetupWizard auto-seed failure + retry (Phase B: local push, not a DB write)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listFull.mockResolvedValue([
      { business_type: 'salon', example_services: ['Haircut', 'Color'] },
    ]);
  });

  test('SAD: the template fetch failing surfaces a retry banner instead of failing silently', async () => {
    listFull.mockRejectedValue(new Error('boom'));
    render(<SetupWizard isOpen onClose={vi.fn()} />);

    const alert = await screen.findByRole('alert');
    expect(alert).toBeTruthy();
    expect(alert.textContent).toMatch(/Couldn.t finish setting up/i);
    expect(screen.getByRole('button', { name: /Retry/i })).toBeTruthy();
  });

  test('Retry re-invokes the template fetch, and on success the starter services render (and the banner clears)', async () => {
    listFull.mockRejectedValueOnce(new Error('boom')); // first attempt fails
    render(<SetupWizard isOpen onClose={vi.fn()} />);

    await screen.findByRole('alert');
    const callsBeforeRetry = listFull.mock.calls.length;

    listFull.mockResolvedValue([
      { business_type: 'salon', example_services: ['Haircut', 'Color'] },
    ]); // now succeeds
    fireEvent.click(screen.getByRole('button', { name: /Retry/i }));

    await waitFor(() => expect(listFull.mock.calls.length).toBeGreaterThan(callsBeforeRetry));
    // Local-array seeding succeeded: the starter names actually render...
    await screen.findByText('Haircut');
    expect(screen.getByText('Color')).toBeTruthy();
    // ...and the banner clears.
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });

  test('HAPPY: seeding never calls the live create APIs — it is a pure local-state push', async () => {
    render(<SetupWizard isOpen onClose={vi.fn()} />);
    await screen.findByText('Haircut');
    await screen.findByText('Color');

    expect(createService).not.toHaveBeenCalled();
    expect(createResource).not.toHaveBeenCalled();
  });
});
