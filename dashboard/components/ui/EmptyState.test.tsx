/**
 * EmptyState tests — pins the rendering contract of the canonical "nothing
 * here yet" primitive (E2, 2026-05-17).
 *
 * What we test:
 *   1. Required title always renders.
 *   2. Optional icon renders when provided, absent otherwise.
 *   3. Optional description renders when provided, absent otherwise.
 *   4. Optional action slot renders below the text block.
 *   5. The two variants ('centered' / 'compact') produce different
 *      outer wrappers (size and density).
 *   6. data-testid passes through for E2E hooks.
 *
 * Each test carries 5W context.
 */
import { describe, test, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom'
import React from 'react'
import { Users } from 'lucide-react'

import { EmptyState } from './EmptyState'

describe('EmptyState — rendering contract', () => {
  test('HAPPY: renders the required title', () => {
    // WHO: any view migrating its empty state to EmptyState
    // WHAT: title prop renders as the primary message.
    // WHY: the title is the only required field — if it doesn't render,
    //      the primitive is broken in the most basic way.
    render(<EmptyState title="No customers yet" />)
    expect(screen.getByText('No customers yet')).toBeInTheDocument()
  })

  test('HAPPY: renders an optional icon when provided', () => {
    // WHO: a view with a meaningful icon to show (CalendarCheck for
    //      analytics, Users for staff scheduler, etc.)
    // WHAT: the icon prop renders as an svg above the title.
    // WHY: icons reinforce the message and improve scan-ability — if
    //      the slot were broken, all migrated views would silently lose
    //      their icons.
    const { container } = render(<EmptyState icon={Users} title="No staff to display" />)
    expect(container.querySelector('svg')).toBeInTheDocument()
  })

  test('HAPPY: omits the icon when no icon prop is provided', () => {
    // WHO: a simple empty state that doesn't need a visual ("No matching
    //      results for ...")
    // WHAT: no svg renders.
    // WHY: defaulting to a generic icon when the caller didn't ask for
    //      one would create visual noise and a misleading affordance.
    const { container } = render(<EmptyState title="No matching results" />)
    expect(container.querySelector('svg')).not.toBeInTheDocument()
  })

  test('HAPPY: renders the optional description', () => {
    // WHO: views that need to explain why the state is empty
    // WHAT: description prop renders below the title.
    render(<EmptyState title="No bookings" description="Bookings will appear here when calls land." />)
    expect(screen.getByText('Bookings will appear here when calls land.')).toBeInTheDocument()
  })

  test('HAPPY: renders the optional action slot and clicks fire its handler', () => {
    // WHO: a view that wants to offer a primary CTA from the empty state
    //      (e.g., "Add your first customer")
    // WHAT: the action ReactNode renders below the description and
    //       click handlers attached to it fire normally.
    // WHY: the slot exists so empty states can be next-action-oriented
    //      instead of dead ends. A regression that dropped event
    //      bindings would silently break every CTA.
    const onClick = vi.fn()
    render(
      <EmptyState
        title="No customers yet"
        action={<button onClick={onClick}>Add a customer</button>}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /add a customer/i }))
    expect(onClick).toHaveBeenCalledTimes(1)
  })
})

describe('EmptyState — variants', () => {
  test('HAPPY: "centered" (default) variant fills the parent and centers', () => {
    // WHO: views where empty state IS the whole content (zero customers)
    // WHAT: the wrapper carries flex-1 + items-center for vertical fill.
    // WHY: pinning the layout class means a regression that swaps the
    //      flex direction or removes flex-1 would surface immediately
    //      rather than as "the empty state is now top-aligned" in QA.
    const { container } = render(<EmptyState title="No data" />)
    expect(container.firstChild).toHaveClass('flex-1', 'items-center', 'justify-center')
  })

  test('HAPPY: "compact" variant produces a tighter inline block', () => {
    // WHO: empty sub-sections inside larger views ("No services supported
    //      by this resource" inline within a row)
    // WHAT: 'compact' uses text-center + smaller padding, NOT flex-1.
    //       The icon (when present) is also smaller.
    const { container } = render(<EmptyState title="No services" variant="compact" />)
    expect(container.firstChild).toHaveClass('text-center')
    expect(container.firstChild).not.toHaveClass('flex-1')
  })
})

describe('EmptyState — accessibility + test hooks', () => {
  test('HAPPY: data-testid passes through to the outer wrapper', () => {
    // WHO: an E2E test that needs to assert "the schedule is empty"
    // WHAT: data-testid on the prop ends up on the outer element so
    //       page.getByTestId() works as expected.
    // WHY: NewSchedulerView's pre-E2 empty state had data-testid=
    //      "scheduler-empty" baked into its wrapper div. Migrating to
    //      EmptyState without preserving that hook would silently
    //      break any future E2E that depends on it.
    render(<EmptyState title="No staff" data-testid="scheduler-empty" />)
    expect(screen.getByTestId('scheduler-empty')).toBeInTheDocument()
  })

  test('HAPPY: icon is aria-hidden so screen readers skip it', () => {
    // WHO: screen-reader user landing on an empty page
    // WHAT: the decorative icon must be aria-hidden so the title is the
    //       first thing announced — not "Users icon."
    // WHY: decorative icons next to text labels create double-announcement
    //      noise; the title carries the meaning.
    const { container } = render(<EmptyState icon={Users} title="No staff" />)
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
  })
})
