// @vitest-environment jsdom
/**
 * WizardModeChooser back-navigation contract (2026-05-27 — Dale:
 * "there is no back button the wizard. There should be back buttons.").
 *
 * WHO: an owner who clicked "Let's go" on the welcome modal, landed on
 *      the mode chooser, and wants to return to the welcome framing.
 * WHAT: when the parent wires `onBack`, the chooser renders a Back link
 *       in its footer; when omitted, the link must NOT render (the
 *       MyBusinessView entry skips welcome entirely so there's nowhere
 *       to back into).
 * WHY: the chooser previously only had an X (which dismisses), so the
 *      sole way "back" was to abandon the flow — bad UX and the
 *      reported pain point.
 */
import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { WizardModeChooser } from './WizardModeChooser';

describe('WizardModeChooser — Back affordance', () => {
  test('renders Back link when onBack is provided and invokes it on click', () => {
    const onBack = vi.fn();
    render(<WizardModeChooser onChoose={vi.fn()} onClose={vi.fn()} onBack={onBack} />);

    const backBtn = screen.getByRole('button', { name: /Back/i });
    expect(backBtn).toBeTruthy();
    fireEvent.click(backBtn);
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  test('hides Back link when onBack is omitted (e.g. MyBusinessView entry path)', () => {
    render(<WizardModeChooser onChoose={vi.fn()} onClose={vi.fn()} />);
    // The X (close) button has aria-label "Close wizard" — that should
    // be the only button-with-a-back-or-close-affordance left. Assert
    // explicitly that "Back" does not appear.
    expect(screen.queryByRole('button', { name: /^Back$/i })).toBeNull();
  });
});
