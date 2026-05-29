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

describe('WizardModeChooser — accessibility + keyboard (Cluster C)', () => {
  test('HAPPY: has role=dialog, aria-modal, aria-labelledby pointing at heading', () => {
    // WHO: screen-reader user entering the mode chooser
    // WHAT: overlay exposes role=dialog + aria-modal=true + labelledby -> h2 text
    // WHERE: WizardModeChooser outer div / heading
    // WHY: without these, screen readers cannot announce "How is your business set up?" on open
    render(<WizardModeChooser onChoose={vi.fn()} onClose={vi.fn()} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    const title = document.getElementById('mode-chooser-title');
    expect(title).toBeTruthy();
    expect(dialog).toHaveAttribute('aria-labelledby', 'mode-chooser-title');
  });

  test('HAPPY: Escape key fires onClose', () => {
    // WHO: keyboard user who opened the chooser and changed their mind
    // WHAT: pressing Escape calls onClose exactly once
    // WHERE: WizardModeChooser keydown listener
    // WHY: Escape-to-close is the universal keyboard contract for dialogs; without it
    //      keyboard users are forced to tab to the X button to exit
    const onClose = vi.fn();
    render(<WizardModeChooser onChoose={vi.fn()} onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('HAPPY: clicking the backdrop (outside the card) fires onClose', () => {
    // WHO: mouse user who wants to dismiss without reaching the X button
    // WHAT: click on the dark overlay (role=dialog) calls onClose
    // WHERE: WizardModeChooser backdrop onClick
    // WHY: standard modal behavior; missing backdrop-close creates a perception that
    //      the overlay is "stuck" and forces users to hunt for the X
    const onClose = vi.fn();
    render(<WizardModeChooser onChoose={vi.fn()} onClose={onClose} />);
    fireEvent.click(screen.getByRole('dialog'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('HAPPY: clicking inside the card does NOT fire onClose (stopPropagation)', () => {
    // WHO: mouse user clicking a mode card
    // WHAT: click on a mode button reaches onChoose, NOT onClose
    // WHERE: WizardModeChooser inner card stopPropagation
    // WHY: without stopPropagation, selecting a mode would simultaneously fire onClose
    //      and close the entire wizard before the parent could act on the chosen mode
    const onClose = vi.fn();
    const onChoose = vi.fn();
    render(<WizardModeChooser onChoose={onChoose} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: /just me/i }));
    expect(onChoose).toHaveBeenCalledWith('solo');
    expect(onClose).not.toHaveBeenCalled();
  });
});

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
