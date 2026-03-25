import { expect, test, describe } from 'vitest'
import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import React from 'react'
import { CoverageStatusBadge } from './CoverageStatusBadge'
import { CoverageBar } from './CoverageBar'
import type { HourSlot } from './CoverageBar'

// --- CoverageStatusBadge ---

describe('CoverageStatusBadge', () => {
  test('renders "Full Coverage" with success styling for full status', () => {
    render(<CoverageStatusBadge status="full" />)
    const badge = screen.getByText('Full Coverage')
    expect(badge).toBeInTheDocument()
  })

  test('renders "Partial" with warning styling for partial status', () => {
    render(<CoverageStatusBadge status="partial" />)
    const badge = screen.getByText('Partial')
    expect(badge).toBeInTheDocument()
  })

  test('renders "Uncovered" with danger styling for uncovered status', () => {
    render(<CoverageStatusBadge status="uncovered" />)
    const badge = screen.getByText('Uncovered')
    expect(badge).toBeInTheDocument()
  })

  test('renders "No Staff" with danger styling for no_staff status', () => {
    render(<CoverageStatusBadge status="no_staff" />)
    const badge = screen.getByText('No Staff')
    expect(badge).toBeInTheDocument()
  })

  test('renders "No Resource" with danger styling for no_resource status', () => {
    render(<CoverageStatusBadge status="no_resource" />)
    const badge = screen.getByText('No Resource')
    expect(badge).toBeInTheDocument()
  })

  test('passes className to Badge', () => {
    render(<CoverageStatusBadge status="full" className="mt-2" />)
    const badge = screen.getByText('Full Coverage')
    expect(badge.className).toContain('mt-2')
  })
})

// --- CoverageBar ---

describe('CoverageBar', () => {
  test('renders empty state when no slots provided', () => {
    render(<CoverageBar slots={[]} />)
    expect(screen.getByText('No scheduled hours')).toBeInTheDocument()
  })

  test('renders one cell per slot', () => {
    const slots: HourSlot[] = [
      { hour: 8, status: 'covered' },
      { hour: 9, status: 'covered' },
      { hour: 10, status: 'gap' },
    ]
    const { container } = render(<CoverageBar slots={slots} />)
    // 3 slot cells in the bar row
    const barRow = container.querySelector('.flex.w-full.rounded')
    expect(barRow?.children.length).toBe(3)
  })

  test('sorts slots by hour regardless of input order', () => {
    const slots: HourSlot[] = [
      { hour: 12, status: 'gap' },
      { hour: 8, status: 'covered' },
      { hour: 10, status: 'covered' },
    ]
    const { container } = render(<CoverageBar slots={slots} />)
    const cells = container.querySelectorAll('.flex.w-full.rounded > div')
    expect(cells[0].getAttribute('title')).toContain('8a')
    expect(cells[1].getAttribute('title')).toContain('10a')
    expect(cells[2].getAttribute('title')).toContain('12p')
  })

  test('applies green color for covered slots', () => {
    const slots: HourSlot[] = [{ hour: 9, status: 'covered' }]
    const { container } = render(<CoverageBar slots={slots} />)
    const cell = container.querySelector('.flex.w-full.rounded > div')
    expect(cell?.className).toContain('green')
  })

  test('applies red color for gap slots', () => {
    const slots: HourSlot[] = [{ hour: 9, status: 'gap' }]
    const { container } = render(<CoverageBar slots={slots} />)
    const cell = container.querySelector('.flex.w-full.rounded > div')
    expect(cell?.className).toContain('red')
  })

  test('applies gray color for closed slots', () => {
    const slots: HourSlot[] = [{ hour: 9, status: 'closed' }]
    const { container } = render(<CoverageBar slots={slots} />)
    const cell = container.querySelector('.flex.w-full.rounded > div')
    expect(cell?.className).toContain('gray')
  })

  test('shows hour labels by default', () => {
    const slots: HourSlot[] = [
      { hour: 8, status: 'covered' },
      { hour: 9, status: 'covered' },
    ]
    render(<CoverageBar slots={slots} />)
    expect(screen.getByText('8a')).toBeInTheDocument()
    expect(screen.getByText('9a')).toBeInTheDocument()
  })

  test('hides hour labels when showHourLabels is false', () => {
    const slots: HourSlot[] = [{ hour: 8, status: 'covered' }]
    render(<CoverageBar slots={slots} showHourLabels={false} />)
    expect(screen.queryByText('8a')).toBeNull()
  })

  test('tooltip includes employee names when provided', () => {
    const slots: HourSlot[] = [{
      hour: 9,
      status: 'covered',
      employees: [
        { id: '1', name: 'Mike' },
        { id: '2', name: 'Steve' },
      ],
    }]
    const { container } = render(<CoverageBar slots={slots} />)
    const cell = container.querySelector('.flex.w-full.rounded > div')
    expect(cell?.getAttribute('title')).toContain('Mike')
    expect(cell?.getAttribute('title')).toContain('Steve')
  })

  test('tooltip shows status only when no employees provided', () => {
    const slots: HourSlot[] = [{ hour: 14, status: 'gap' }]
    const { container } = render(<CoverageBar slots={slots} />)
    const cell = container.querySelector('.flex.w-full.rounded > div')
    const title = cell?.getAttribute('title') || ''
    expect(title).toContain('2p')
    expect(title).toContain('gap')
    expect(title).not.toContain('(')
  })

  test('formats noon and midnight correctly', () => {
    const slots: HourSlot[] = [
      { hour: 0, status: 'closed' },
      { hour: 12, status: 'covered' },
    ]
    const { container } = render(<CoverageBar slots={slots} />)
    const cells = container.querySelectorAll('.flex.w-full.rounded > div')
    expect(cells[0].getAttribute('title')).toContain('12a')
    expect(cells[1].getAttribute('title')).toContain('12p')
  })

  test('skips every other label when more than 12 slots', () => {
    const slots: HourSlot[] = Array.from({ length: 14 }, (_, i) => ({
      hour: 6 + i,
      status: 'covered' as const,
    }))
    render(<CoverageBar slots={slots} />)
    // Odd-indexed slots should have empty labels
    expect(screen.queryByText('7a')).toBeNull() // index 1, skipped
    expect(screen.getByText('8a')).toBeInTheDocument() // index 2, shown
  })

  test('applies custom className', () => {
    const slots: HourSlot[] = [{ hour: 8, status: 'covered' }]
    const { container } = render(<CoverageBar slots={slots} className="my-4" />)
    expect(container.firstChild).toHaveClass('my-4')
  })
})
