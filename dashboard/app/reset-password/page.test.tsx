/**
 * reset-password page — UX-review a11y pass.
 *
 * Pins the fix: the New password + Confirm password inputs are now
 * programmatically associated with their labels (were adjacent labels with no
 * htmlFor/id), so getByLabelText resolves each — screen-reader operable.
 *
 * 5W for failures: WHO a user completing a reset link; WHAT the two password
 * fields; WHERE reset-password/page.tsx; WHY unlabeled password fields are
 * unusable with assistive tech.
 */
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

vi.mock('@/lib/api', () => ({ API_BASE_URL: 'http://test' }));

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams('token=abc123'),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

import ResetPasswordPage from './page';

beforeEach(() => vi.clearAllMocks());

describe('ResetPasswordPage a11y', () => {
  test('both password inputs are reachable by their labels', () => {
    render(<ResetPasswordPage />);
    expect(screen.getByLabelText('New password')).toHaveAttribute('type', 'password');
    expect(screen.getByLabelText('Confirm password')).toHaveAttribute('type', 'password');
  });
});
