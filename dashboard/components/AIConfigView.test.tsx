/**
 * AIConfigView — Customer Preferences section tests.
 *
 * Covers the toggle + instruction textarea added 2026-06-06: the owner-facing
 * controls that turn on AI customer-preference capture and author the guidance
 * the voice agent follows. Happy + sad paths with 5W diagnostics.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import type { Tenant } from '../lib/types';

const mockTenantId = 'test-tenant-123';
vi.mock('../lib/SessionContext', () => ({
  useActiveTenantId: () => mockTenantId,
}));

const mockGetConfig = vi.fn();
const mockUpdateConfig = vi.fn();
vi.mock('../lib/api', () => ({
  Api: {
    tenants: {
      getConfig: (...args: unknown[]) => mockGetConfig(...args),
      updateConfig: (...args: unknown[]) => mockUpdateConfig(...args),
    },
  },
}));

vi.mock('./ui/Toast', () => ({ showToast: vi.fn() }));

import AIConfigView from './AIConfigView';

const BASE_CONFIG: Tenant = {
  tenant_id: mockTenantId,
  name: 'Debbie Salon',
  business_type: 'salon',
  system_prompt: 'You are Debbie.',
  voice_id: null,
  first_message: 'Hi!',
  save_preferences_enabled: false,
  preferences_instructions: null,
};

beforeEach(() => {
  mockGetConfig.mockReset();
  mockUpdateConfig.mockReset().mockResolvedValue({ success: true });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('AIConfigView — Customer Preferences', () => {
  test('HAPPY: textarea is disabled until the toggle is turned on, then enabled', async () => {
    // WHO: an owner opening Phone Assistant config with preferences off.
    // WHAT: the instruction textarea is disabled while the feature is off so
    //        you can't author guidance for a feature that won't run; flipping
    //        the toggle enables it.
    // WHEN: every visit to the AI config page.
    // WHERE: AIConfigView Customer Preferences section.
    // WHY: a disabled textarea is the visual cue that the toggle gates the
    //      feature — editing guidance without enabling it would silently no-op.
    mockGetConfig.mockResolvedValue({ ...BASE_CONFIG });
    render(<AIConfigView />);

    const textarea = await screen.findByTestId('preferences-instructions');
    expect(textarea).toBeDisabled();

    const toggle = screen.getByRole('switch', { name: /save customer preferences/i });
    fireEvent.click(toggle);
    expect(textarea).toBeEnabled();
  });

  test('HAPPY: saving sends the toggle + instructions to updateConfig', async () => {
    // WHO: an owner who enabled preferences and wrote guidance, then saved.
    // WHAT: the two new fields reach Api.tenants.updateConfig so the backend
    //        persists them (and the agent then injects them into the prompt).
    // WHEN: clicking Save Changes after editing the section.
    // WHERE: AIConfigView handleSave.
    // WHY: if the fields aren't in the payload the UI looks like it worked but
    //      nothing is stored — the classic silent-form-drop bug.
    mockGetConfig.mockResolvedValue({ ...BASE_CONFIG });
    render(<AIConfigView />);

    const toggle = await screen.findByRole('switch', { name: /save customer preferences/i });
    fireEvent.click(toggle);

    const textarea = screen.getByTestId('preferences-instructions');
    fireEvent.change(textarea, { target: { value: 'Offer the same stylist; ask about nails.' } });

    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(mockUpdateConfig).toHaveBeenCalledTimes(1));
    const [, payload] = mockUpdateConfig.mock.calls[0];
    expect(payload.save_preferences_enabled).toBe(true);
    expect(payload.preferences_instructions).toBe('Offer the same stylist; ask about nails.');
  });

  test('HAPPY: typing a forward number sends it to updateConfig', async () => {
    // WHO: an owner who wants personal/handoff calls routed to their cell.
    // WHAT: the forward_phone field value reaches Api.tenants.updateConfig so
    //        the backend persists it and the agent can SIP-transfer to it.
    // WHEN: clicking Save after entering a number.
    // WHERE: AIConfigView Forward Calls section + handleSave.
    // WHY: without it in the payload the field is cosmetic — the classic
    //      silent-form-drop bug; the AI would always take a message.
    mockGetConfig.mockResolvedValue({ ...BASE_CONFIG });
    render(<AIConfigView />);

    // Type the spaced/parenthesized format the placeholder itself invites —
    // it must normalize to clean E.164 so the agent builds a valid tel: URI.
    const input = await screen.findByPlaceholderText(/\+1 312 555 0100/i);
    fireEvent.change(input, { target: { value: '+1 (608) 217-5303' } });

    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(mockUpdateConfig).toHaveBeenCalledTimes(1));
    const [, payload] = mockUpdateConfig.mock.calls[0];
    expect(payload.forward_phone).toBe('+16082175303');
  });

  test('HAPPY: a blank forward number persists as null (forwarding off)', async () => {
    // WHAT: an empty/whitespace field saves as null so the agent falls back to
    //        taking a message rather than transferring to an empty tel: URI.
    mockGetConfig.mockResolvedValue({ ...BASE_CONFIG });
    render(<AIConfigView />);

    // Type whitespace (also dirties the form so Save is enabled).
    const input = await screen.findByPlaceholderText(/\+1 312 555 0100/i);
    fireEvent.change(input, { target: { value: '   ' } });

    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(mockUpdateConfig).toHaveBeenCalledTimes(1));
    const [, payload] = mockUpdateConfig.mock.calls[0];
    expect(payload.forward_phone).toBeNull();
  });

  test('HAPPY: typing an owner notification number sends it normalized to updateConfig', async () => {
    // WHO: owner setting SMS alert number on the AI Persona page.
    // WHAT: owner_phone input value is E.164-normalized before reaching the backend.
    // WHEN: clicking Save after entering a number in the Notification number field.
    // WHERE: AIConfigView Owner Notification Phone section + handleSave.
    // WHY: without normalization the agent's SMS call gets a malformed tel: URI and
    //      silently fails to deliver the owner alert.
    mockGetConfig.mockResolvedValue({ ...BASE_CONFIG });
    render(<AIConfigView />);

    const input = await screen.findByLabelText(/notification number/i);
    fireEvent.change(input, { target: { value: '+1 (630) 555-0100' } });

    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(mockUpdateConfig).toHaveBeenCalledTimes(1));
    const [, payload] = mockUpdateConfig.mock.calls[0];
    expect(payload.owner_phone).toBe('+16305550100');
  });

  test('HAPPY: blank owner notification number saves as null (alerts off)', async () => {
    // WHO: owner removing their SMS alert number.
    // WHAT: empty/whitespace owner_phone saves as null — disables owner SMS.
    // WHEN: clicking Save with the Notification number field cleared.
    // WHERE: AIConfigView handleSave normalizePhone guard.
    // WHY: normalizePhone('') returns null; an empty string would cause the
    //      SMS notifier to attempt delivery to a blank number.
    mockGetConfig.mockResolvedValue({ ...BASE_CONFIG });
    render(<AIConfigView />);

    const input = await screen.findByLabelText(/notification number/i);
    fireEvent.change(input, { target: { value: '   ' } });

    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(mockUpdateConfig).toHaveBeenCalledTimes(1));
    const [, payload] = mockUpdateConfig.mock.calls[0];
    expect(payload.owner_phone).toBeNull();
  });

  test('HAPPY: an already-enabled tenant renders its saved instructions', async () => {
    // WHO: an owner returning to a config they previously turned on.
    // WHAT: the saved instruction text is shown in the (enabled) textarea.
    // WHY: round-trips the persisted value back into the form so edits start
    //      from the real state, not a blank box.
    mockGetConfig.mockResolvedValue({
      ...BASE_CONFIG,
      save_preferences_enabled: true,
      preferences_instructions: 'Track stylist + last service.',
    });
    render(<AIConfigView />);

    const textarea = await screen.findByDisplayValue('Track stylist + last service.');
    expect(textarea).toBeEnabled();
    expect(screen.getByRole('switch', { name: /save customer preferences/i })).toHaveAttribute(
      'aria-checked',
      'true'
    );
  });

  test('SAD: a transfer number equal to the forwarded-from number shows a loop error + disables Save', async () => {
    // WHO: an owner who forwards their published line INTO the AI and then types
    //      that same line as the "talk to a person" transfer target.
    // WHAT: the client mirror of the backend loop guard renders an inline error
    //      and disables Save so the colliding config can never be submitted.
    // WHEN: the forward_phone field normalizes equal to the loaded
    //      forwarded_from_phone (entered after load so the form is dirty —
    //      otherwise Save would already be disabled by the !dirty rule and the
    //      test would pass for the wrong reason).
    // WHERE: AIConfigView forwardLoops derived value + the Save button disabled prop.
    // WHY: instant feedback prevents a save round-trip that the backend would 400;
    //      a transfer to the forwarding line loops the call back into the AI.
    mockGetConfig.mockResolvedValue({
      ...BASE_CONFIG,
      forwarded_from_phone: '+16082175303',
      forward_phone: null,
    });
    render(<AIConfigView />);

    // Type the same number (different human format) into the transfer field —
    // this also dirties the form, so a still-disabled Save proves forwardLoops.
    const forwardInput = await screen.findByPlaceholderText(/\+1 312 555 0100/i);
    fireEvent.change(forwardInput, { target: { value: '(608) 217-5303' } });

    expect(screen.getByText(/loop back to the assistant/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /save changes/i })).toBeDisabled();
  });

  test('HAPPY: distinct forwarded-from + transfer numbers save without a loop error', async () => {
    // WHO: an owner whose forwarded line and human-transfer line are different
    //      numbers (the supported configuration).
    // WHAT: no loop error renders and the new forwarded_from_phone reaches the
    //      updateConfig payload, normalized to E.164.
    // WHEN: the two numbers differ and the owner saves.
    // WHERE: AIConfigView handleSave payload + forwardLoops (false here).
    // WHY: the guard must not block or drop a legitimate distinct pairing.
    mockGetConfig.mockResolvedValue({
      ...BASE_CONFIG,
      forward_phone: '+16305551234',
    });
    render(<AIConfigView />);

    const fwdFromInput = await screen.findByLabelText(/forwarded-from number/i);
    fireEvent.change(fwdFromInput, { target: { value: '+1 (608) 217-5303' } });

    expect(screen.queryByText(/loop back to the assistant/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
    await waitFor(() => expect(mockUpdateConfig).toHaveBeenCalledTimes(1));
    const [, payload] = mockUpdateConfig.mock.calls[0];
    expect(payload.forwarded_from_phone).toBe('+16082175303');
  });

  test('HAPPY: editing the buffer field sends default_buffer_minutes to updateConfig', async () => {
    // WHO: an owner who wants the AI to leave a 15-minute gap between bookings.
    // WHAT: the number entered in the Buffer Between Appointments field reaches
    //        Api.tenants.updateConfig as default_buffer_minutes.
    // WHEN: clicking Save Changes after setting the buffer.
    // WHERE: AIConfigView buffer section + handleSave.
    // WHY: if it isn't in the payload the field is cosmetic — the AI would keep
    //      booking back-to-back no matter what the owner set.
    mockGetConfig.mockResolvedValue({ ...BASE_CONFIG, default_buffer_minutes: 0 });
    render(<AIConfigView />);

    const buffer = await screen.findByTestId('default-buffer-minutes');
    fireEvent.change(buffer, { target: { value: '15' } });
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(mockUpdateConfig).toHaveBeenCalledTimes(1));
    const [, payload] = mockUpdateConfig.mock.calls[0];
    expect(payload.default_buffer_minutes).toBe(15);
  });

  test('SAD: an out-of-range buffer is clamped to the 0–120 max before saving', async () => {
    // WHO: an owner who fat-fingers 999 into the buffer box.
    // WHAT: the field clamps to 120 (the same ceiling the backend Zod schema
    //        enforces) so a typo can't be submitted and rejected.
    // WHERE: AIConfigView buffer onChange clamp.
    // WHY: clamping in the UI gives immediate, visible feedback instead of a
    //      400 on save; it also keeps the value the backend will accept.
    mockGetConfig.mockResolvedValue({ ...BASE_CONFIG, default_buffer_minutes: 0 });
    render(<AIConfigView />);

    const buffer = await screen.findByTestId<HTMLInputElement>('default-buffer-minutes');
    fireEvent.change(buffer, { target: { value: '999' } });
    expect(buffer.value).toBe('120');
  });

  test('HAPPY: the textarea placeholder example matches the tenant industry', async () => {
    // WHO: a brand-new owner who hasn't written guidance yet.
    // WHAT: the empty-box example is industry-specific (salon talks stylists,
    //        auto talks vehicles) so it's relevant, with a generic fallback
    //        for unrecognized/platform business types.
    // WHEN: every first visit before any guidance is typed.
    // WHERE: AIConfigView preferencesPlaceholder(business_type).
    // WHY: a salon-only example in a tire shop's box is worse than none — it
    //      teaches the wrong thing. The match must follow business_type.
    const cases: Array<{ business_type: string; expect: RegExp }> = [
      { business_type: 'salon', expect: /stylist/i },
      { business_type: 'automotive', expect: /vehicle/i },
      { business_type: 'platform-admin', expect: /what each customer prefers/i },
    ];
    for (const c of cases) {
      mockGetConfig.mockResolvedValue({ ...BASE_CONFIG, business_type: c.business_type });
      const { unmount } = render(<AIConfigView />);
      const textarea = await screen.findByTestId('preferences-instructions');
      expect(textarea).toHaveAttribute('placeholder', expect.stringMatching(c.expect));
      unmount();
    }
  });
});
