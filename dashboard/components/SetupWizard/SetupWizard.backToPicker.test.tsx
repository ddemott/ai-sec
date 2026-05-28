// @vitest-environment jsdom
/**
 * SetupWizard "Change business type" link + auto-seeded rollback
 * (2026-05-27 — Dale: "I first picked Answering Service. Then whenever
 * Picked any other business regardless, it had all of the answering
 * service services.").
 *
 * WHO: an owner who picked the wrong business type at the picker, got
 *      the matching template's example_services auto-seeded, and wants
 *      to switch to a different type without abandoning the wizard.
 * WHAT: Step 1's "Change business type" link
 *       (a) only appears when onBackToPicker is wired,
 *       (b) deletes the services + resource the wizard auto-seeded (so
 *           the next pick's runSeed sees an empty catalog and reseeds),
 *       (c) invokes the parent's onBackToPicker callback to transition
 *           the onboarding stage.
 * WHY: pre-fix, the auto-seed gate (services.length === 0) stayed
 *      closed forever after the first seed, so a re-pick kept showing
 *      the original template's services regardless of what was
 *      selected. Rolling back auto-seeded-only rows lets reseed run
 *      again WITHOUT touching anything the user typed.
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

// Mock factory returns sequential service_ids so we can assert each
// auto-seeded row was deleted. Typed broadly because the mock surface
// here only cares about the arg shape on `.delete` (id, tenantId).
let serviceIdCounter = 1;
const createService = vi.fn(async (..._args: unknown[]) => ({
  service: { service_id: `svc-${serviceIdCounter++}` },
}));
const createResource = vi.fn(async (..._args: unknown[]) => ({
  resource: { resource_id: 'res-1' },
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
  },
}));

import SetupWizard from './index';

describe('SetupWizard — Change business type (back-to-picker)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    serviceIdCounter = 1;
  });

  test('Step 1 hides the link when onBackToPicker is omitted', async () => {
    render(<SetupWizard isOpen onClose={vi.fn()} />);
    // Wait for auto-seed to settle so the footer is fully rendered.
    await waitFor(() => expect(createService).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: /Change business type/i })).toBeNull();
  });

  test('Step 1 shows the link when onBackToPicker is wired', async () => {
    render(<SetupWizard isOpen onClose={vi.fn()} onBackToPicker={vi.fn()} />);
    await waitFor(() => expect(createService).toHaveBeenCalled());
    expect(screen.getByRole('button', { name: /Change business type/i })).toBeTruthy();
  });

  test('clicking the link deletes EVERY auto-seeded row then calls onBackToPicker', async () => {
    const onBackToPicker = vi.fn();
    render(<SetupWizard isOpen onClose={vi.fn()} onBackToPicker={onBackToPicker} />);

    // Auto-seed creates 2 services + 1 resource for the answering-service template.
    await waitFor(() => expect(createService).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(createResource).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole('button', { name: /Change business type/i }));

    // Both seeded services + the seeded resource get deleted.
    await waitFor(() => expect(deleteService).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(deleteResource).toHaveBeenCalledTimes(1));

    // First arg is the id (any value), second is the tenant id. Pin the
    // tenant arg so a cross-tenant delete regression would fail loudly.
    for (const call of deleteService.mock.calls) {
      expect(call[1]).toBe(TENANT);
    }

    // Parent transition only fires AFTER cleanup completes (sequential await).
    await waitFor(() => expect(onBackToPicker).toHaveBeenCalledTimes(1));
  });

  test('a delete failure does not block the picker transition', async () => {
    // A row the user edited might now be backend-owned; we still want
    // to return the user to the picker rather than strand them.
    deleteService.mockRejectedValueOnce(new Error('row was edited'));
    const onBackToPicker = vi.fn();
    render(<SetupWizard isOpen onClose={vi.fn()} onBackToPicker={onBackToPicker} />);

    await waitFor(() => expect(createService).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole('button', { name: /Change business type/i }));
    await waitFor(() => expect(onBackToPicker).toHaveBeenCalledTimes(1));
  });
});
