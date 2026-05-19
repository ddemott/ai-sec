/**
 * Tests for BUG-039: ARIA accessibility attributes on UI primitives
 * Each section has happy + sad paths with 5W diagnostic context.
 */

import { expect, test, describe, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

// ── Toast ────────────────────────────────────────────────────────────

describe('BUG-039: Toast ARIA', () => {
  test('container has aria-live="polite" and role="status"', async () => {
    // We test the source code since ToastContainer renders conditionally
    const fs = await import('fs');
    const path = await import('path');
    const source = fs.readFileSync(path.join(__dirname, 'Toast.tsx'), 'utf-8');
    expect(source).toContain('aria-live="polite"');
    expect(source).toContain('aria-atomic="true"');
    expect(source).toContain('role="status"');
    // WHO: screen reader users | WHAT: live region for notifications
    // WHEN: toast appears | WHERE: ToastContainer | WHY: announces new toasts
  });

  test('error toasts use role="alert" for urgency', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const source = fs.readFileSync(path.join(__dirname, 'Toast.tsx'), 'utf-8');
    expect(source).toContain("role={toast.type === 'error' ? 'alert' : 'status'}");
    // WHO: screen reader | WHAT: elevated urgency for errors
    // WHEN: error toast | WHERE: individual toast div | WHY: errors need immediate attention
  });

  test('icons are aria-hidden', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const source = fs.readFileSync(path.join(__dirname, 'Toast.tsx'), 'utf-8');
    expect(source).toContain('aria-hidden="true"');
    // WHO: screen reader | WHAT: hides decorative icon
    // WHEN: rendering | WHERE: Toast icon | WHY: icon is decorative, text conveys meaning
  });
});

// ── Card ─────────────────────────────────────────────────────────────

import { Card } from './Card';

describe('BUG-039: Card ARIA', () => {
  describe('Happy Paths', () => {
    test('clickable Card has role="button" and tabIndex', () => {
      const onClick = vi.fn();
      render(<Card onClick={onClick}>Click me</Card>);
      const card = screen.getByRole('button');
      expect(card).toBeInTheDocument();
      expect(card).toHaveAttribute('tabindex', '0');
      // WHO: keyboard users | WHAT: focusable clickable card
      // WHEN: interactive card | WHERE: Card.tsx | WHY: must be keyboard-navigable
    });

    test('clickable Card responds to Enter key', () => {
      const onClick = vi.fn();
      render(<Card onClick={onClick}>Press me</Card>);
      const card = screen.getByRole('button');
      fireEvent.keyDown(card, { key: 'Enter' });
      expect(onClick).toHaveBeenCalledTimes(1);
    });

    test('clickable Card responds to Space key', () => {
      const onClick = vi.fn();
      render(<Card onClick={onClick}>Press me</Card>);
      const card = screen.getByRole('button');
      fireEvent.keyDown(card, { key: ' ' });
      expect(onClick).toHaveBeenCalledTimes(1);
    });
  });

  describe('Sad Paths', () => {
    test('non-clickable Card has no role or tabindex', () => {
      const { container } = render(<Card>Static content</Card>);
      const card = container.firstChild as HTMLElement;
      expect(card).not.toHaveAttribute('role');
      expect(card).not.toHaveAttribute('tabindex');
      // WHO: all users | WHAT: static card | WHEN: no onClick
      // WHERE: Card.tsx | WHY: non-interactive elements should not have button role
    });

    test('clickable Card ignores non-activation keys', () => {
      const onClick = vi.fn();
      render(<Card onClick={onClick}>Press me</Card>);
      const card = screen.getByRole('button');
      fireEvent.keyDown(card, { key: 'Tab' });
      fireEvent.keyDown(card, { key: 'a' });
      expect(onClick).not.toHaveBeenCalled();
    });
  });
});

// ── FeedbackButton ───────────────────────────────────────────────────

describe('BUG-039: FeedbackButton ARIA', () => {
  test('feedback trigger button has aria-label', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const source = fs.readFileSync(path.join(__dirname, 'FeedbackButton.tsx'), 'utf-8');
    expect(source).toContain('aria-label="Send feedback"');
    // WHO: screen reader | WHAT: labels the FAB | WHEN: closed state
    // WHERE: FeedbackButton.tsx | WHY: icon button needs explicit label
  });

  test('close button has aria-label', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const source = fs.readFileSync(path.join(__dirname, 'FeedbackButton.tsx'), 'utf-8');
    expect(source).toContain('aria-label="Close feedback"');
  });

  test('star rating has radiogroup role and aria-labels', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const source = fs.readFileSync(path.join(__dirname, 'FeedbackButton.tsx'), 'utf-8');
    expect(source).toContain('role="radiogroup"');
    expect(source).toContain('aria-label="Rating"');
    expect(source).toContain('role="radio"');
    expect(source).toContain('aria-checked');
    // WHO: screen reader / keyboard users | WHAT: rating control pattern
    // WHEN: feedback form open | WHERE: star rating section
    // WHY: grouped radio pattern is the correct ARIA for exclusive rating selection
  });

  test('textarea has aria-label', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const source = fs.readFileSync(path.join(__dirname, 'FeedbackButton.tsx'), 'utf-8');
    expect(source).toContain('aria-label="Feedback comment"');
  });

  test('all icons have aria-hidden', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const source = fs.readFileSync(path.join(__dirname, 'FeedbackButton.tsx'), 'utf-8');
    // MessageCircle, X, and Star icons should all be hidden
    const ariaHiddenCount = (source.match(/aria-hidden="true"/g) || []).length;
    expect(ariaHiddenCount).toBeGreaterThanOrEqual(3);
  });
});

// ── CoverageBar ──────────────────────────────────────────────────────

import { CoverageBar } from './CoverageBar';
import type { HourSlot } from './CoverageBar';

describe('BUG-039: CoverageBar ARIA', () => {
  describe('Happy Paths', () => {
    test('coverage bar has role="img" with descriptive aria-label', () => {
      const slots: HourSlot[] = [
        { hour: 8, status: 'covered' },
        { hour: 9, status: 'covered' },
        { hour: 10, status: 'gap' },
      ];
      const { container } = render(<CoverageBar slots={slots} />);
      const bar = container.querySelector('[role="img"]');
      expect(bar).toBeInTheDocument();
      expect(bar).toHaveAttribute('aria-label');
      expect(bar!.getAttribute('aria-label')).toContain('2 of 3');
      // WHO: screen reader | WHAT: describes coverage ratio
      // WHEN: rendering | WHERE: bar container | WHY: visual bar needs text equivalent
    });

    test('individual slot divs are aria-hidden', () => {
      const slots: HourSlot[] = [
        { hour: 8, status: 'covered' },
        { hour: 9, status: 'gap' },
      ];
      const { container } = render(<CoverageBar slots={slots} />);
      const hiddenSlots = container.querySelectorAll('[aria-hidden="true"]');
      expect(hiddenSlots.length).toBe(2);
      // WHO: screen reader | WHAT: hides individual color blocks
      // WHEN: rendering | WHERE: slot divs | WHY: the role="img" on parent provides context
    });
  });

  describe('Sad Paths', () => {
    test('empty slots render without role="img"', () => {
      const { container } = render(<CoverageBar slots={[]} />);
      const bar = container.querySelector('[role="img"]');
      expect(bar).not.toBeInTheDocument();
      // No role="img" needed when showing "No scheduled hours" text
    });
  });
});

// ── FolderTabs (used by OutlookLayout) ──────────────────────────────

describe('BUG-039: FolderTabs ARIA', () => {
  describe('Happy Paths', () => {
    test('FolderTabBar has role="tablist" with aria-label', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const source = fs.readFileSync(path.join(__dirname, 'FolderTabs.tsx'), 'utf-8');
      expect(source).toContain('role="tablist"');
      expect(source).toContain('aria-label={ariaLabel}');
      // WHO: screen reader / keyboard users | WHAT: tab navigation pattern
      // WHEN: using dashboard | WHERE: FolderTabBar component
      // WHY: Front Desk/Back Office toggle is semantically a tab set
    });

    test('FolderTab has role="tab" with aria-selected', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const source = fs.readFileSync(path.join(__dirname, 'FolderTabs.tsx'), 'utf-8');
      expect(source).toContain('role="tab"');
      expect(source).toContain('aria-selected={isActive}');
      // WHO: screen reader | WHAT: individual tab role
      // WHEN: navigating tabs | WHERE: FolderTab button
      // WHY: each tab needs role and selected state for AT
    });

    test('tab icons are aria-hidden', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const source = fs.readFileSync(path.join(__dirname, 'FolderTabs.tsx'), 'utf-8');
      expect(source).toContain('aria-hidden="true"');
      // WHO: screen reader | WHAT: hides decorative icons
      // WHEN: rendering tabs | WHERE: FolderTab icon
      // WHY: icons are decorative, label text conveys meaning
    });
  });

  describe('Sad Paths', () => {
    test('OutlookLayout uses FolderTabs for accessibility', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const source = fs.readFileSync(path.join(__dirname, '..', 'OutlookLayout.tsx'), 'utf-8');
      // Verify OutlookLayout imports and uses the accessible FolderTabs components
      expect(source).toContain("import { FolderTab, FolderTabBar } from './ui/FolderTabs'");
      expect(source).toContain('<FolderTabBar');
      expect(source).toContain('<FolderTab');
      // WHO: developers | WHAT: ensures OutlookLayout uses accessible components
      // WHEN: refactoring navigation | WHERE: OutlookLayout.tsx
      // WHY: if someone removes FolderTabs import, this test fails to catch regression
    });
  });
});
