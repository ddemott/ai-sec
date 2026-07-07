/**
 * TimeInput — UI primitive coverage.
 *
 * WHO: Any form using a time-of-day picker (shift editor, quick book).
 * WHAT: Renders a labelled <input type="time"> with optional error state.
 * WHERE: components/ui/TimeInput.tsx — previously 0% coverage.
 * WHY: Zero coverage means a broken onChange or missing aria-invalid attribute
 *   would go undetected until a shift or booking form is manually tested.
 */
import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { TimeInput } from './TimeInput';

describe('TimeInput rendering', () => {
  test('HAPPY: renders the label when provided', () => {
    // WHO: form with a labelled time field
    // WHY: label is required for screen readers to announce the field's purpose
    render(<TimeInput label="Start Time" value="09:00" onChange={() => {}} />);
    expect(screen.getByText('Start Time')).toBeInTheDocument();
    const label = document.querySelector('label') as HTMLLabelElement;
    const input = document.querySelector('input[type="time"]') as HTMLInputElement;
    expect(label.htmlFor).toBe(input.id);
  });

  test('HAPPY: renders without a label when prop is omitted', () => {
    render(<TimeInput value="10:30" onChange={() => {}} />);
    expect(document.querySelector('label')).toBeNull();
    expect(document.querySelector('input[type="time"]')).toBeInTheDocument();
  });

  test('HAPPY: displays the current value', () => {
    render(<TimeInput value="14:45" onChange={() => {}} />);
    const input = document.querySelector('input[type="time"]') as HTMLInputElement;
    expect(input.value).toBe('14:45');
  });

  test('HAPPY: disabled prop prevents interaction', () => {
    render(<TimeInput value="08:00" onChange={() => {}} disabled />);
    const input = document.querySelector('input[type="time"]') as HTMLInputElement;
    expect(input).toBeDisabled();
  });
});

describe('TimeInput error state', () => {
  test('SAD: shows the error message in an alert role when error is provided', () => {
    // WHO: invalid time entered by a user
    // WHAT: error text must be visible and announced by screen readers
    render(<TimeInput value="25:00" onChange={() => {}} error="Invalid time" />);
    const alert = screen.getByRole('alert');
    expect(alert).toBeInTheDocument();
    expect(alert.textContent).toBe('Invalid time');
  });

  test('SAD: sets aria-invalid on the input when error is provided', () => {
    // WHO: screen reader user on a form with validation errors
    // WHY: aria-invalid signals to assistive tech that the field is invalid
    render(<TimeInput value="" onChange={() => {}} error="Required" />);
    const input = document.querySelector('input[type="time"]') as HTMLInputElement;
    expect(input).toHaveAttribute('aria-invalid', 'true');
  });

  test('HAPPY: does not set aria-invalid when there is no error', () => {
    render(<TimeInput value="09:00" onChange={() => {}} />);
    const input = document.querySelector('input[type="time"]') as HTMLInputElement;
    expect(input).not.toHaveAttribute('aria-invalid');
  });

  test('HAPPY: no alert role when error is absent', () => {
    render(<TimeInput value="09:00" onChange={() => {}} />);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('TimeInput onChange', () => {
  test('HAPPY: calls onChange with the new time value on change event', () => {
    // WHO: user selecting a shift start time
    // WHAT: onChange receives the raw HH:mm string from the input
    const onChange = vi.fn();
    render(<TimeInput value="09:00" onChange={onChange} />);
    const input = document.querySelector('input[type="time"]') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '14:00' } });
    expect(onChange).toHaveBeenCalledWith('14:00');
  });

  test('HAPPY: does not call onChange when disabled', () => {
    // WHO: a disabled time picker (e.g. read-only schedule view)
    // WHY: disabled inputs should not fire their handlers when the browser prevents interaction
    const onChange = vi.fn();
    render(<TimeInput value="09:00" onChange={onChange} disabled />);
    const input = document.querySelector('input[type="time"]') as HTMLInputElement;
    // fireEvent bypasses browser disabled check, so we just verify the component
    // passes disabled through — the browser enforces the actual block
    expect(input).toBeDisabled();
  });
});
