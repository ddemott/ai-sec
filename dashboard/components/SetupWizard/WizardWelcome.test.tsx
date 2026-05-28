/**
 * WizardWelcome tests — the first screen a new tenant sees before the
 * mode chooser. Establishes scope ("~10 minutes", "stop any time") and
 * gives the user an explicit "not now" exit. Failing any of these means
 * the welcome step either traps a user who wanted out, or eats a
 * continue click that should have moved the flow forward.
 *
 * Each test carries 5W diagnostic context.
 */
import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

import { WizardWelcome } from './WizardWelcome';

describe('WizardWelcome', () => {
  test('HAPPY: renders the scope-setting headline and reassurance copy', async () => {
    // WHO: First-time tenant just landed on the dashboard with nothing set up
    // WHAT: Welcome dialog renders with headline + reassurance copy that
    //       they can stop any time.
    // WHY:  The 2026-05-16 UX audit found new users dropped at the mode
    //       chooser because they didn't know how long the wizard takes or
    //       whether they could pause. Welcome screen sets both expectations
    //       before the binary solo/team fork.
    //       2026-05-28: copy updated — "10 minutes / 6 quick questions"
    //       was inaccurate (wizard is 7 steps); replaced with durable
    //       language that won't drift as steps change.
    render(<WizardWelcome onContinue={vi.fn()} onDismiss={vi.fn()} />);

    expect(screen.getByRole('dialog', { name: /welcome/i })).toBeInTheDocument();
    expect(screen.getByText(/a few quick steps/i)).toBeInTheDocument();
    expect(screen.getByText(/stop and come back any time/i)).toBeInTheDocument();
  });

  test('HAPPY: "Let\'s go" fires onContinue and not onDismiss', async () => {
    // WHO: User ready to set up
    // WHAT: Click "Let's go" → exactly one onContinue call, zero onDismiss
    // WHY:  The wizard flow stages on onContinue advancing to the mode
    //       chooser. If onDismiss fired too, the wizard would close
    //       immediately after advancing — a race condition between siblings.
    const onContinue = vi.fn();
    const onDismiss = vi.fn();
    render(<WizardWelcome onContinue={onContinue} onDismiss={onDismiss} />);

    fireEvent.click(screen.getByRole('button', { name: /let's go/i }));

    expect(onContinue).toHaveBeenCalledTimes(1);
    expect(onDismiss).not.toHaveBeenCalled();
  });

  test('HAPPY: "I\'ll set up later, just show me around" fires onDismiss and not onContinue', async () => {
    // WHO: User who landed on the dashboard but wants to explore first
    // WHAT: Click the secondary button → exactly one onDismiss, zero onContinue
    // WHY:  Forcing setup before exploration is a Heuristic H3 violation
    //       (user control). The "show me around" exit must close the
    //       wizard entirely, not advance the flow under the welcome.
    const onContinue = vi.fn();
    const onDismiss = vi.fn();
    render(<WizardWelcome onContinue={onContinue} onDismiss={onDismiss} />);

    fireEvent.click(screen.getByRole('button', { name: /set up later/i }));

    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onContinue).not.toHaveBeenCalled();
  });

  test('HAPPY: header X close button also fires onDismiss', async () => {
    // WHO: User who closes via the affordance they expect on any modal
    // WHAT: Click the X icon (aria-label "Close welcome") → fires onDismiss
    // WHY:  Two exits ("show me around" + X) must behave identically;
    //       otherwise users learn that the X "does something different,"
    //       eroding trust in the close affordance across the app.
    const onContinue = vi.fn();
    const onDismiss = vi.fn();
    render(<WizardWelcome onContinue={onContinue} onDismiss={onDismiss} />);

    fireEvent.click(screen.getByRole('button', { name: /close welcome/i }));

    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onContinue).not.toHaveBeenCalled();
  });

  test('HAPPY: dialog is marked role="dialog" and aria-modal for screen readers', async () => {
    // WHO: Screen-reader user landing on the new-tenant dashboard
    // WHAT: The welcome modal exposes role=dialog + aria-modal=true so AT
    //       traps focus and announces it correctly
    // WHY:  Native <dialog> semantics + aria-labelledby pointing at the
    //       title give screen readers the "Welcome to your AI
    //       receptionist" announcement on appearance.
    render(<WizardWelcome onContinue={vi.fn()} onDismiss={vi.fn()} />);

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-labelledby', 'wizard-welcome-title');
    expect(document.getElementById('wizard-welcome-title')).toHaveTextContent(/welcome/i);
  });
});
