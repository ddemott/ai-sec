import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { PhoneInput } from './PhoneInput';

describe('PhoneInput', () => {
  test('renders with label and placeholder', () => {
    render(<PhoneInput label="Phone" value="" onChange={vi.fn()} />);
    expect(screen.getByText('Phone')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('+1 (555) 555-5555')).toBeInTheDocument();
    // WHO: any user | WHAT: views phone input field | WHEN: form first renders | WHERE: PhoneInput | WHY: label and placeholder guide correct data entry
  });

  test('displays empty string when value is empty', () => {
    render(<PhoneInput label="Phone" value="" onChange={vi.fn()} />);
    const input = screen.getByRole<HTMLInputElement>('textbox');
    expect(input.value).toBe('');
    // WHO: any user | WHAT: sees blank phone field | WHEN: no phone number stored | WHERE: PhoneInput | WHY: empty state must not show stale or malformed data
  });

  test('formats stored +15555551234 as +1 (555) 555-1234', () => {
    render(<PhoneInput label="Phone" value="+15555551234" onChange={vi.fn()} />);
    const input = screen.getByRole<HTMLInputElement>('textbox');
    expect(input.value).toBe('+1 (555) 555-1234');
    // WHO: any user | WHAT: views a stored full phone number | WHEN: record loaded from DB | WHERE: PhoneInput | WHY: E.164 must display as human-readable formatted number
  });

  test('formats partial number with area code only', () => {
    render(<PhoneInput label="Phone" value="+1555" onChange={vi.fn()} />);
    const input = screen.getByRole<HTMLInputElement>('textbox');
    expect(input.value).toBe('+1 (555');
    // WHO: any user | WHAT: views partial phone during entry | WHEN: only area code entered so far | WHERE: PhoneInput | WHY: progressive formatting must not break mid-input
  });

  test('formats partial number with area code + prefix', () => {
    render(<PhoneInput label="Phone" value="+1555555" onChange={vi.fn()} />);
    const input = screen.getByRole<HTMLInputElement>('textbox');
    expect(input.value).toBe('+1 (555) 555');
    // WHO: any user | WHAT: views partial phone with 6 digits | WHEN: mid-entry with area code + prefix | WHERE: PhoneInput | WHY: formatting must stay consistent as digits are added
  });

  test('formats partial number with just 2 digits', () => {
    render(<PhoneInput label="Phone" value="+155" onChange={vi.fn()} />);
    const input = screen.getByRole<HTMLInputElement>('textbox');
    expect(input.value).toBe('+1 (55');
    // WHO: any user | WHAT: views very short partial phone | WHEN: only 2 digits entered | WHERE: PhoneInput | WHY: early formatting must not produce garbage output
  });

  test('typing digits calls onChange with normalized E.164 value', () => {
    const onChange = vi.fn();
    render(<PhoneInput label="Phone" value="" onChange={onChange} />);
    const input = screen.getByRole('textbox');

    fireEvent.change(input, { target: { value: '5' } });
    expect(onChange).toHaveBeenCalledWith('+15');

    onChange.mockClear();
    fireEvent.change(input, { target: { value: '+1 (555)' } });
    expect(onChange).toHaveBeenCalledWith('+1555');

    onChange.mockClear();
    fireEvent.change(input, { target: { value: '+1 (555) 555-1234' } });
    expect(onChange).toHaveBeenCalledWith('+15555551234');
    // WHO: any user | WHAT: types phone digits | WHEN: entering a new phone number | WHERE: PhoneInput | WHY: parent form must receive normalized E.164 for DB storage
  });

  test('strips non-digit characters from input', () => {
    const onChange = vi.fn();
    render(<PhoneInput label="Phone" value="" onChange={onChange} />);
    const input = screen.getByRole('textbox');

    fireEvent.change(input, { target: { value: 'abc555def1234' } });
    expect(onChange).toHaveBeenCalledWith('+15551234');
    // WHO: any user | WHAT: pastes or types letters mixed with digits | WHEN: sloppy input or paste from clipboard | WHERE: PhoneInput | WHY: non-digit chars must be silently stripped to prevent invalid phone storage
  });

  test('caps at 11 digits (country code + 10 digits)', () => {
    const onChange = vi.fn();
    render(<PhoneInput label="Phone" value="" onChange={onChange} />);
    const input = screen.getByRole('textbox');

    fireEvent.change(input, { target: { value: '155555512349999' } });
    expect(onChange).toHaveBeenCalledWith('+15555551234');
    // WHO: any user | WHAT: enters more than 11 digits | WHEN: paste or rapid typing overshoots | WHERE: PhoneInput | WHY: phone numbers beyond 11 digits are invalid and must be truncated
  });

  test('clearing input calls onChange with empty string', () => {
    const onChange = vi.fn();
    render(<PhoneInput label="Phone" value="+15555551234" onChange={onChange} />);
    const input = screen.getByRole('textbox');

    fireEvent.change(input, { target: { value: '' } });
    expect(onChange).toHaveBeenCalledWith('');
    // WHO: any user | WHAT: clears the phone field | WHEN: removing a phone number | WHERE: PhoneInput | WHY: empty string must propagate so parent form can mark field as blank
  });

  test('handles 10-digit input without leading 1', () => {
    const onChange = vi.fn();
    render(<PhoneInput label="Phone" value="" onChange={onChange} />);
    const input = screen.getByRole('textbox');

    fireEvent.change(input, { target: { value: '5555551234' } });
    expect(onChange).toHaveBeenCalledWith('+15555551234');
    // WHO: any user | WHAT: enters 10-digit local number without country code | WHEN: common US phone entry pattern | WHERE: PhoneInput | WHY: country code must be auto-prepended for valid E.164 storage
  });

  test('custom placeholder overrides default', () => {
    render(<PhoneInput label="Phone" value="" onChange={vi.fn()} placeholder="Enter phone" />);
    expect(screen.getByPlaceholderText('Enter phone')).toBeInTheDocument();
    // WHO: developer | WHAT: passes custom placeholder prop | WHEN: context needs different hint text | WHERE: PhoneInput | WHY: placeholder must be configurable for different form contexts
  });

  test('shows error state', () => {
    render(<PhoneInput label="Phone" value="" onChange={vi.fn()} error="Required" />);
    expect(screen.getByText('Required')).toBeInTheDocument();
    // WHO: any user | WHAT: submits form with missing phone | WHEN: validation fails | WHERE: PhoneInput | WHY: error message must be visible so user knows what to fix
  });
});
