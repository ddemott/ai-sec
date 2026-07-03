/**
 * forgot-password page — UX-review a11y pass.
 *
 * Pins the fix: the Email input is now programmatically associated with its
 * label (was an adjacent label with no htmlFor/id), so getByLabelText resolves
 * it — a screen reader announces the field and clicking the label focuses it.
 *
 * 5W for failures: WHO a locked-out owner; WHAT the reset-request form; WHERE
 * forgot-password/page.tsx; WHY an unlabeled email field is unusable with a
 * screen reader.
 */
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

vi.mock('@/lib/api', () => ({ API_BASE_URL: 'http://test' }));

import ForgotPasswordPage from './page';

beforeEach(() => vi.clearAllMocks());

describe('ForgotPasswordPage a11y', () => {
  test('the email input is reachable by its label', () => {
    render(<ForgotPasswordPage />);
    const input = screen.getByLabelText('Email');
    expect(input).toBeInTheDocument();
    expect(input).toHaveAttribute('type', 'email');
    expect(input).toHaveAttribute('autoComplete', 'email');
  });
});
