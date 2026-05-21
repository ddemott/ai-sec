/**
 * Step1Services — duration input regression.
 *
 * WHO: an owner editing a service's duration in the setup wizard
 * WHAT: the duration field must be clearable + retypeable
 * WHEN: every keystroke in the "Duration (minutes)" field
 * WHERE: components/SetupWizard/StepServices.tsx
 * WHY: pre-fix the onChange did `parseInt(value) || 0`, which forced the
 *      field to "0" the instant it was emptied — you couldn't clear "3" to
 *      type "30". The fix keeps a raw-text display state and propagates a
 *      safe number (empty → 0, which saveService already rejects). These
 *      tests pin: (1) clearing leaves the field EMPTY (not "0"), (2) an
 *      empty field propagates 0 to the model (so save's guard still fires),
 *      (3) a real value propagates as the parsed number.
 */
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { Step1Services } from './StepServices';
import type { ServiceForm } from './types';

vi.mock('@/lib/VocabularyContext', () => ({
  useVocabulary: () => ({ example_services: ['Oil Change', 'Tire Rotation'] }),
}));

function renderStep(onChange: (form: ServiceForm) => void, duration = 30) {
  const editingService: ServiceForm = {
    name: 'Test Service',
    description: '',
    duration_minutes: duration,
  };
  render(
    <Step1Services
      services={[]}
      loading={false}
      editingService={editingService}
      editingServiceId="svc-1"
      saving={false}
      error={null}
      onAdd={vi.fn()}
      onEdit={vi.fn()}
      onDelete={vi.fn()}
      onSave={vi.fn()}
      onCancel={vi.fn()}
      onChange={onChange}
    />
  );
  // The only type=number field in the form is the duration input.
  return screen.getByRole('spinbutton') as HTMLInputElement;
}

describe('Step1Services duration input', () => {
  beforeEach(() => vi.clearAllMocks());

  test('shows the current duration', () => {
    const input = renderStep(vi.fn(), 45);
    expect(input.value).toBe('45');
  });

  test('renders EMPTY (not "0") when the model duration is 0 — the clearable-field fix', () => {
    // The regression was the field snapping to "0" on clear. Treating 0 as
    // "unset" → empty display is what lets the user clear + retype. (The
    // parent owns the value; once a clear propagates 0, this is what renders.)
    const input = renderStep(vi.fn(), 0);
    expect(input.value).toBe('');
  });

  test('clearing the field propagates 0 to the model (never NaN — save rejects 0)', () => {
    const onChange = vi.fn();
    const input = renderStep(onChange);
    fireEvent.change(input, { target: { value: '' } });
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ duration_minutes: 0 }));
  });

  test('typing a value propagates the parsed number', () => {
    const onChange = vi.fn();
    const input = renderStep(onChange);
    fireEvent.change(input, { target: { value: '60' } });
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ duration_minutes: 60 }));
  });
});
