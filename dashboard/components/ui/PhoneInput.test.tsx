import { describe, test, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom'
import React from 'react'
import { PhoneInput } from './PhoneInput'

describe('PhoneInput', () => {
  test('renders with label and placeholder', () => {
    render(<PhoneInput label="Phone" value="" onChange={vi.fn()} />)
    expect(screen.getByText('Phone')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('+1 (555) 555-5555')).toBeInTheDocument()
  })

  test('displays empty string when value is empty', () => {
    render(<PhoneInput label="Phone" value="" onChange={vi.fn()} />)
    const input = screen.getByRole('textbox') as HTMLInputElement
    expect(input.value).toBe('')
  })

  test('formats stored +15555551234 as +1 (555) 555-1234', () => {
    render(<PhoneInput label="Phone" value="+15555551234" onChange={vi.fn()} />)
    const input = screen.getByRole('textbox') as HTMLInputElement
    expect(input.value).toBe('+1 (555) 555-1234')
  })

  test('formats partial number with area code only', () => {
    render(<PhoneInput label="Phone" value="+1555" onChange={vi.fn()} />)
    const input = screen.getByRole('textbox') as HTMLInputElement
    expect(input.value).toBe('+1 (555')
  })

  test('formats partial number with area code + prefix', () => {
    render(<PhoneInput label="Phone" value="+1555555" onChange={vi.fn()} />)
    const input = screen.getByRole('textbox') as HTMLInputElement
    expect(input.value).toBe('+1 (555) 555')
  })

  test('formats partial number with just 2 digits', () => {
    render(<PhoneInput label="Phone" value="+155" onChange={vi.fn()} />)
    const input = screen.getByRole('textbox') as HTMLInputElement
    expect(input.value).toBe('+1 (55')
  })

  test('typing digits calls onChange with normalized E.164 value', () => {
    const onChange = vi.fn()
    render(<PhoneInput label="Phone" value="" onChange={onChange} />)
    const input = screen.getByRole('textbox')

    fireEvent.change(input, { target: { value: '5' } })
    expect(onChange).toHaveBeenCalledWith('+15')

    onChange.mockClear()
    fireEvent.change(input, { target: { value: '+1 (555)' } })
    expect(onChange).toHaveBeenCalledWith('+1555')

    onChange.mockClear()
    fireEvent.change(input, { target: { value: '+1 (555) 555-1234' } })
    expect(onChange).toHaveBeenCalledWith('+15555551234')
  })

  test('strips non-digit characters from input', () => {
    const onChange = vi.fn()
    render(<PhoneInput label="Phone" value="" onChange={onChange} />)
    const input = screen.getByRole('textbox')

    fireEvent.change(input, { target: { value: 'abc555def1234' } })
    expect(onChange).toHaveBeenCalledWith('+15551234')
  })

  test('caps at 11 digits (country code + 10 digits)', () => {
    const onChange = vi.fn()
    render(<PhoneInput label="Phone" value="" onChange={onChange} />)
    const input = screen.getByRole('textbox')

    fireEvent.change(input, { target: { value: '155555512349999' } })
    expect(onChange).toHaveBeenCalledWith('+15555551234')
  })

  test('clearing input calls onChange with empty string', () => {
    const onChange = vi.fn()
    render(<PhoneInput label="Phone" value="+15555551234" onChange={onChange} />)
    const input = screen.getByRole('textbox')

    fireEvent.change(input, { target: { value: '' } })
    expect(onChange).toHaveBeenCalledWith('')
  })

  test('handles 10-digit input without leading 1', () => {
    const onChange = vi.fn()
    render(<PhoneInput label="Phone" value="" onChange={onChange} />)
    const input = screen.getByRole('textbox')

    fireEvent.change(input, { target: { value: '5555551234' } })
    expect(onChange).toHaveBeenCalledWith('+15555551234')
  })

  test('custom placeholder overrides default', () => {
    render(<PhoneInput label="Phone" value="" onChange={vi.fn()} placeholder="Enter phone" />)
    expect(screen.getByPlaceholderText('Enter phone')).toBeInTheDocument()
  })

  test('shows error state', () => {
    render(<PhoneInput label="Phone" value="" onChange={vi.fn()} error="Required" />)
    expect(screen.getByText('Required')).toBeInTheDocument()
  })
})
