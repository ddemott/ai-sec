/**
 * GoLivePanel — phone go-live UX (Phase B / PR D).
 *
 * WHO: an owner going through the wizard's "Go Live" step, or later visiting
 *      AIConfigView's Go Live section — both mount this same component.
 * WHAT: three stages — A) provision, B) verify the raw Telnyx number
 *       actually answers (never claim "live" before a real call is
 *       confirmed), C) the fork (new-number "you're all set" vs.
 *       forwarding-with-proof vs. a porting notify-Dale email).
 * WHERE: dashboard/components/phone/GoLivePanel.tsx
 * WHY: docs/superpowers/specs/2026-07-05-wizard-phase-b-design.md §3 — the
 *      unconditional "Your AI line is live" claim was the actual bug this
 *      replaces; this suite pins that a real call, not a click, is what
 *      flips each verification stage.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

const TENANT_ID = 'f234e471-0e60-4163-86c9-93cfd9338e3a';

vi.mock('../../lib/SessionContext', () => ({
  useActiveTenantId: () => TENANT_ID,
}));

const mockStatus = vi.fn();
const mockActivate = vi.fn();
const mockGetHistory = vi.fn();
const mockUpdateConfig = vi.fn();
const mockPortInquiry = vi.fn();

vi.mock('../../lib/api', () => ({
  Api: {
    provisioning: {
      status: (...args: unknown[]) => mockStatus(...args),
      activate: (...args: unknown[]) => mockActivate(...args),
      portInquiry: (...args: unknown[]) => mockPortInquiry(...args),
    },
    voice: {
      getHistory: (...args: unknown[]) => mockGetHistory(...args),
    },
    tenants: {
      updateConfig: (...args: unknown[]) => mockUpdateConfig(...args),
    },
  },
}));

vi.mock('../ui/Toast', () => ({ showToast: vi.fn() }));

import { GoLivePanel } from './GoLivePanel';

function noCalls() {
  return Promise.resolve({ calls: [], total: 0, has_more: false });
}

function oneCallStartedAt(iso: string) {
  return Promise.resolve({
    calls: [{ voice_session_id: 'vs-1', started_at: iso }],
    total: 1,
    has_more: false,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  // shouldAdvanceTime: real wall-clock keeps ticking so RTL's waitFor/findBy*
  // (which poll via real timers) still work; vi.advanceTimersByTimeAsync
  // below is what actually fires the component's 5s poll interval on demand.
  vi.useFakeTimers({ shouldAdvanceTime: true });
  mockGetHistory.mockImplementation(noCalls);
  mockUpdateConfig.mockResolvedValue({ success: true });
  mockPortInquiry.mockResolvedValue({ success: true });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('GoLivePanel — Stage A (unprovisioned)', () => {
  test('shows the activate form when unprovisioned', async () => {
    mockStatus.mockResolvedValue({
      phone_status: null,
      inbound_phone: null,
      forwarded_from_phone: null,
    });
    render(<GoLivePanel />);

    await screen.findByRole('button', { name: /Activate AI Phone Line/i });
    expect(screen.getByPlaceholderText('e.g. 312')).toBeInTheDocument();
  });

  test('activation success moves to Stage B — never claims "live" immediately', async () => {
    mockStatus.mockResolvedValue({
      phone_status: null,
      inbound_phone: null,
      forwarded_from_phone: null,
    });
    mockActivate.mockResolvedValue({
      phone_number: '+16305551234',
      telnyx_phone_number_id: 'pn-abc',
    });
    render(<GoLivePanel />);

    await screen.findByRole('button', { name: /Activate AI Phone Line/i });
    fireEvent.click(screen.getByRole('button', { name: /Activate AI Phone Line/i }));

    await waitFor(() => expect(screen.getByText('Your number is ready')).toBeInTheDocument());
    expect(screen.getByText('+16305551234')).toBeInTheDocument();
    expect(screen.queryByText(/is live/i)).toBeNull();
  });

  test('activation failure shows the error and stays on Stage A', async () => {
    mockStatus.mockResolvedValue({
      phone_status: null,
      inbound_phone: null,
      forwarded_from_phone: null,
    });
    mockActivate.mockRejectedValue(new Error('No numbers available'));
    render(<GoLivePanel />);

    await screen.findByRole('button', { name: /Activate AI Phone Line/i });
    fireEvent.click(screen.getByRole('button', { name: /Activate AI Phone Line/i }));

    await waitFor(() => expect(screen.getByText('Activation failed')).toBeInTheDocument());
    expect(screen.getByText('No numbers available')).toBeInTheDocument();
  });
});

describe('GoLivePanel — Stage B (verify the raw number)', () => {
  test('polls /voice/history and advances to Stage C once a call lands after activation', async () => {
    mockStatus.mockResolvedValue({
      phone_status: 'active',
      inbound_phone: '+16305551234',
      forwarded_from_phone: null,
    });
    render(<GoLivePanel />);

    await screen.findByText('Your number is ready');
    // First poll (immediate, on mount) sees nothing yet.
    await waitFor(() => expect(mockGetHistory).toHaveBeenCalledTimes(1));

    // A call arrives, started well after "now" (the activatedAt anchor).
    mockGetHistory.mockImplementation(() =>
      oneCallStartedAt(new Date(Date.now() + 1000).toISOString())
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    await waitFor(() => expect(screen.queryByText('Your number is ready')).toBeNull());
    // Landed on Stage C — the fork question (no forwarded_from_phone yet).
    expect(
      screen.getByText('Do you already have a phone number customers call today?')
    ).toBeInTheDocument();
  });

  test('a call from BEFORE activation never falsely satisfies the check', async () => {
    mockStatus.mockResolvedValue({
      phone_status: 'active',
      inbound_phone: '+16305551234',
      forwarded_from_phone: null,
    });
    // A stale call sitting in history from before this session ever saw
    // 'active' — must not be mistaken for the real test call.
    mockGetHistory.mockImplementation(() =>
      oneCallStartedAt(new Date(Date.now() - 60 * 60 * 1000).toISOString())
    );
    render(<GoLivePanel />);

    await screen.findByText('Your number is ready');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    // Still on Stage B — the stale call didn't count.
    expect(screen.getByText('Your number is ready')).toBeInTheDocument();
  });

  test('"I\'ll test it later" skips straight to Stage C', async () => {
    mockStatus.mockResolvedValue({
      phone_status: 'active',
      inbound_phone: '+16305551234',
      forwarded_from_phone: null,
    });
    render(<GoLivePanel />);

    await screen.findByText('Your number is ready');
    fireEvent.click(screen.getByText(/test it later/i));

    expect(
      screen.getByText('Do you already have a phone number customers call today?')
    ).toBeInTheDocument();
  });

  test('skipping verification never claims "is live" — shows "not yet verified" instead', async () => {
    // WHO: an owner who clicked "I'll test it later" without a real call
    //      ever confirming the raw number answers.
    // WHAT: Stage C must NOT render the "is live" claim in this case — that
    //      claim is reserved for an actually-confirmed number. This is the
    //      exact bug the design doc calls out as the thing being replaced.
    mockStatus.mockResolvedValue({
      phone_status: 'active',
      inbound_phone: '+16305551234',
      forwarded_from_phone: null,
    });
    render(<GoLivePanel />);

    await screen.findByText('Your number is ready');
    fireEvent.click(screen.getByText(/test it later/i));

    expect(screen.queryByText(/is live/i)).toBeNull();
    expect(screen.getByText(/not yet verified/i)).toBeInTheDocument();
  });

  test('useCallDetector stops polling once a call is detected — no unbounded background traffic', async () => {
    mockStatus.mockResolvedValue({
      phone_status: 'active',
      inbound_phone: '+16305551234',
      forwarded_from_phone: null,
    });
    render(<GoLivePanel />);

    await screen.findByText('Your number is ready');
    mockGetHistory.mockImplementation(() =>
      oneCallStartedAt(new Date(Date.now() + 1000).toISOString())
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    await waitFor(() => expect(screen.queryByText('Your number is ready')).toBeNull());

    const callsAtDetection = mockGetHistory.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20000); // 4 more poll intervals worth
    });
    expect(mockGetHistory.mock.calls.length).toBe(callsAtDetection);
  });

  test('a returning visit with forwarded_from_phone already set skips Stage B entirely', async () => {
    mockStatus.mockResolvedValue({
      phone_status: 'active',
      inbound_phone: '+16305551234',
      forwarded_from_phone: '+16082175303',
    });
    render(<GoLivePanel />);

    await screen.findByText(/is live/i);
    expect(screen.queryByText('Your number is ready')).toBeNull();
    // The question isn't re-asked — forwarding is already configured.
    expect(
      screen.queryByText('Do you already have a phone number customers call today?')
    ).toBeNull();
    // No forever-spinning verify prompt: forwardSavedAt was never set THIS
    // session (the save happened in a prior one), so nothing is actively
    // polling — the prompt gates on forwardSavedAt, not forwardedFromPhone.
    expect(screen.queryByText(/if the AI answers, forwarding works/i)).toBeNull();
    // getHistory is never called for forwarding verification without an
    // active poll window.
    expect(mockGetHistory).not.toHaveBeenCalled();
  });
});

describe('GoLivePanel — Stage C fork', () => {
  async function advanceToStageC() {
    mockStatus.mockResolvedValue({
      phone_status: 'active',
      inbound_phone: '+16305551234',
      forwarded_from_phone: null,
    });
    render(<GoLivePanel />);
    await screen.findByText('Your number is ready');
    fireEvent.click(screen.getByText(/test it later/i));
    await screen.findByText('Do you already have a phone number customers call today?');
  }

  test('"No — this is new" shows the you\'re-all-set card, no forwarding/porting UI', async () => {
    await advanceToStageC();
    fireEvent.click(screen.getByRole('button', { name: /No — this is new/i }));

    expect(screen.getByText("You're all set")).toBeInTheDocument();
    expect(screen.queryByText(/Forward your existing number/i)).toBeNull();
    expect(screen.queryByText(/take over your number/i)).toBeNull();
  });

  test('"Yes, I have one" shows forwarding (primary) + porting (secondary)', async () => {
    await advanceToStageC();
    fireEvent.click(screen.getByRole('button', { name: /Yes, I have one/i }));

    expect(screen.getByText(/Forward your existing number/i)).toBeInTheDocument();
    expect(screen.getByText(/take over your number/i)).toBeInTheDocument();
  });

  test('saving a forwarding number calls updateConfig with ONLY that field, then verifies via a new call', async () => {
    await advanceToStageC();
    fireEvent.click(screen.getByRole('button', { name: /Yes, I have one/i }));

    fireEvent.change(screen.getByLabelText(/Your real business number/i), {
      target: { value: '+16082175303' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^Save$/i }));

    await waitFor(() => expect(mockUpdateConfig).toHaveBeenCalledTimes(1));
    expect(mockUpdateConfig).toHaveBeenCalledWith(TENANT_ID, {
      forwarded_from_phone: '+16082175303',
    });

    await screen.findByText(/if the AI answers, forwarding works/i);

    mockGetHistory.mockImplementation(() =>
      oneCallStartedAt(new Date(Date.now() + 1000).toISOString())
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    await waitFor(() => expect(screen.getByText(/Forwarding verified/i)).toBeInTheDocument());
  });

  test('a garbage forwarding number is rejected client-side, not saved', async () => {
    // WHO: an owner who fat-fingers the forwarding number field.
    // WHAT: forwarded_from_phone drives the agent's caller-ID match — an
    //       un-normalized or too-short value would silently disable that
    //       guard. Validate before ever calling updateConfig.
    await advanceToStageC();
    fireEvent.click(screen.getByRole('button', { name: /Yes, I have one/i }));

    fireEvent.change(screen.getByLabelText(/Your real business number/i), {
      target: { value: '123' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^Save$/i }));

    expect(mockUpdateConfig).not.toHaveBeenCalled();
  });

  test('a save normalizes a human-formatted number to E.164 before sending', async () => {
    await advanceToStageC();
    fireEvent.click(screen.getByRole('button', { name: /Yes, I have one/i }));

    fireEvent.change(screen.getByLabelText(/Your real business number/i), {
      target: { value: '(608) 217-5303' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^Save$/i }));

    await waitFor(() =>
      expect(mockUpdateConfig).toHaveBeenCalledWith(TENANT_ID, {
        forwarded_from_phone: '+16082175303',
      })
    );
  });

  test('port inquiry submits and shows a confirmation — no table, just the email call', async () => {
    await advanceToStageC();
    fireEvent.click(screen.getByRole('button', { name: /Yes, I have one/i }));

    fireEvent.change(screen.getByPlaceholderText("Number you'd like to port"), {
      target: { value: '+16082175303' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Email us about porting/i }));

    await waitFor(() =>
      expect(mockPortInquiry).toHaveBeenCalledWith(TENANT_ID, '+16082175303', undefined)
    );
    expect(await screen.findByText(/we'll follow up by email/i)).toBeInTheDocument();
  });
});
