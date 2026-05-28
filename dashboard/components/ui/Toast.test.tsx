import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { ToastContainer, showToast } from './Toast';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('ToastContainer — Dismiss all button', () => {
  test('HAPPY: ≤2 toasts → no Dismiss all button', async () => {
    // WHO: user with 1-2 notifications
    // WHAT: "Dismiss all" button not shown
    // WHEN: toast count is at or below the threshold
    // WHERE: ToastContainer header area
    // WHY: button is unnecessary noise when there are only 1-2 toasts
    render(<ToastContainer />);
    act(() => {
      showToast('First error', 'error');
      showToast('Second error', 'error');
    });
    expect(screen.getByText('First error')).toBeInTheDocument();
    expect(screen.getByText('Second error')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /dismiss all/i })).not.toBeInTheDocument();
  });

  test('HAPPY: >2 toasts → Dismiss all button appears', async () => {
    // WHO: user with 3+ stacked error notifications
    // WHAT: "Dismiss all" button renders above the stack
    // WHEN: toast count exceeds 2
    // WHERE: ToastContainer header row
    // WHY: a dense error stack is unusable without a single-tap escape
    render(<ToastContainer />);
    act(() => {
      showToast('Error 1', 'error');
      showToast('Error 2', 'error');
      showToast('Error 3', 'error');
    });
    expect(screen.getByRole('button', { name: /dismiss all/i })).toBeInTheDocument();
  });

  test('HAPPY: clicking Dismiss all removes every toast', async () => {
    // WHO: user with 3 stacked errors wanting to clear everything
    // WHAT: all toasts gone after one click; button disappears too
    // WHEN: clicking the Dismiss all button
    // WHERE: ToastContainer
    // WHY: pins the core utility — one action clears the entire stack
    render(<ToastContainer />);
    act(() => {
      showToast('Error A', 'error');
      showToast('Error B', 'error');
      showToast('Error C', 'error');
    });
    const btn = screen.getByRole('button', { name: /dismiss all/i });
    fireEvent.click(btn);
    expect(screen.queryByText('Error A')).not.toBeInTheDocument();
    expect(screen.queryByText('Error B')).not.toBeInTheDocument();
    expect(screen.queryByText('Error C')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /dismiss all/i })).not.toBeInTheDocument();
  });

  test('HAPPY: adding a 3rd toast to existing 2 makes button appear', async () => {
    // WHO: user who already had 2 errors and gets a third
    // WHAT: button appears reactively when count crosses the threshold
    // WHEN: third toast is added
    // WHERE: ToastContainer
    // WHY: button visibility is driven by live count, not initial render
    render(<ToastContainer />);
    act(() => {
      showToast('E1', 'error');
      showToast('E2', 'error');
    });
    expect(screen.queryByRole('button', { name: /dismiss all/i })).not.toBeInTheDocument();
    act(() => {
      showToast('E3', 'error');
    });
    expect(screen.getByRole('button', { name: /dismiss all/i })).toBeInTheDocument();
  });
});
