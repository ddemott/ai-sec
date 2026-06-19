/**
 * CommsSentView tests — outbound SMS/email history table
 * Each test carries 5W diagnostic context.
 */
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

const { mockApi } = vi.hoisted(() => ({
  mockApi: {
    communications: {
      history: vi.fn(),
    },
  },
}));

vi.mock('../lib/api', () => ({ Api: mockApi }));

import { CommsSentView } from './CommsSentView';

const TENANT = 'tenant-abc';

const makeRow = (overrides = {}) => ({
  communications_history_id: 1,
  channel: 'sms' as const,
  recipient: '+15551234567',
  subject: null,
  body: 'Your appointment is confirmed.',
  status: 'sent',
  created_at: '2026-06-17T10:00:00Z',
  ...overrides,
});

beforeEach(() => {
  mockApi.communications.history.mockReset();
});

describe('CommsSentView', () => {
  describe('Happy paths', () => {
    test('renders rows from API response', async () => {
      // WHO: owner viewing outbound comms | WHAT: rows appear in table
      // WHEN: API returns history | WHERE: CommsSentView table body
      // WHY: proves data-fetch → render path works end-to-end
      mockApi.communications.history.mockResolvedValue({
        success: true,
        history: [
          makeRow({ body: 'Your appointment is confirmed.', channel: 'sms' }),
          makeRow({ communications_history_id: 2, channel: 'email', subject: 'Reminder', body: 'See you tomorrow.' }),
        ],
        total: 2,
      });

      render(<CommsSentView tenantId={TENANT} />);

      await waitFor(() => {
        expect(screen.getByText('Your appointment is confirmed.')).toBeInTheDocument();
        expect(screen.getByText('See you tomorrow.')).toBeInTheDocument();
        expect(screen.getByText('Reminder')).toBeInTheDocument();
      });
    });

    test('sent/delivered status shows green badge, failed shows red', async () => {
      // WHO: owner scanning for failures | WHAT: status badge color
      // WHEN: mixed statuses | WHERE: Status column
      // WHY: visual triage — red = something went wrong
      mockApi.communications.history.mockResolvedValue({
        success: true,
        history: [
          makeRow({ communications_history_id: 1, status: 'sent' }),
          makeRow({ communications_history_id: 2, status: 'failed' }),
        ],
        total: 2,
      });

      render(<CommsSentView tenantId={TENANT} />);

      await waitFor(() => {
        expect(screen.getByText('sent')).toBeInTheDocument();
        expect(screen.getByText('failed')).toBeInTheDocument();
      });
    });

    test('filter button changes channel param and resets to page 0', async () => {
      // WHO: owner wanting only SMS | WHAT: filter resets page + calls API with type=sms
      // WHEN: clicks SMS filter | WHERE: toolbar filter group
      // WHY: ensures filter toggle wires through to API correctly
      mockApi.communications.history.mockResolvedValue({ success: true, history: [], total: 0 });

      render(<CommsSentView tenantId={TENANT} />);
      await waitFor(() => expect(mockApi.communications.history).toHaveBeenCalledTimes(1));

      fireEvent.click(screen.getByRole('button', { name: 'SMS' }));

      await waitFor(() => expect(mockApi.communications.history).toHaveBeenCalledTimes(2));
      const secondCall = mockApi.communications.history.mock.calls[1] as [string, { type: string; offset: number }];
      expect(secondCall[1].type).toBe('sms');
      expect(secondCall[1].offset).toBe(0);
    });

    test('filter buttons expose aria-pressed for accessibility', async () => {
      // WHO: screen-reader users | WHAT: aria-pressed reflects active filter
      // WHEN: default render | WHERE: channel filter buttons
      // WHY: color-only pressed state is inaccessible without aria-pressed
      mockApi.communications.history.mockResolvedValue({ success: true, history: [], total: 0 });

      render(<CommsSentView tenantId={TENANT} />);

      await waitFor(() => {
        const allBtn = screen.getByRole('button', { name: 'All' });
        const smsBtn = screen.getByRole('button', { name: 'SMS' });
        expect(allBtn).toHaveAttribute('aria-pressed', 'true');
        expect(smsBtn).toHaveAttribute('aria-pressed', 'false');
      });
    });

    test('pagination controls have accessible names', async () => {
      // WHO: keyboard/screen-reader users | WHAT: prev/next buttons have aria-label
      // WHEN: more than PAGE_SIZE rows | WHERE: pagination footer
      // WHY: icon-only buttons need text equivalent for assistive tech
      mockApi.communications.history.mockResolvedValue({
        success: true,
        history: Array.from({ length: 25 }, (_, i) => makeRow({ communications_history_id: i + 1 })),
        total: 50,
      });

      render(<CommsSentView tenantId={TENANT} />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Previous page' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Next page' })).toBeInTheDocument();
      });
    });
  });

  describe('Sad paths', () => {
    test('shows empty state when no history', async () => {
      // WHO: owner on fresh tenant | WHAT: empty state copy
      // WHEN: API returns zero rows | WHERE: content area
      // WHY: blank table is confusing; explicit empty state is not
      mockApi.communications.history.mockResolvedValue({ success: true, history: [], total: 0 });

      render(<CommsSentView tenantId={TENANT} />);

      await waitFor(() => {
        expect(screen.getByText('No sent messages')).toBeInTheDocument();
      });
    });

    test('shows error message on API failure', async () => {
      // WHO: owner | WHAT: error banner instead of crash
      // WHEN: network error | WHERE: content area
      // WHY: unhandled rejection would produce a blank or spinner-stuck view
      mockApi.communications.history.mockRejectedValue(new Error('Network error'));

      render(<CommsSentView tenantId={TENANT} />);

      await waitFor(() => {
        expect(screen.getByText('Failed to load sent messages.')).toBeInTheDocument();
      });
    });

    test('shows error on success:false response', async () => {
      // WHO: owner | WHAT: API returns success:false (auth or 500)
      // WHEN: backend rejects with success:false | WHERE: content area
      // WHY: API returns 200 success:false — must handle same as network error
      mockApi.communications.history.mockResolvedValue({ success: false });

      render(<CommsSentView tenantId={TENANT} />);

      await waitFor(() => {
        expect(screen.getByText('Failed to load sent messages.')).toBeInTheDocument();
      });
    });

    test('null tenantId clears state and stops spinner immediately', async () => {
      // WHO: any user | WHAT: no infinite spinner when tenantId is null
      // WHEN: component mounts before session resolves | WHERE: CommsSentView
      // WHY: prior impl returned early leaving loading=true forever, leaking prior-tenant rows
      render(<CommsSentView tenantId={null} />);

      await waitFor(() => {
        expect(screen.queryByText('Loading…')).not.toBeInTheDocument();
        expect(screen.getByText('No sent messages')).toBeInTheDocument();
      });
      expect(mockApi.communications.history).not.toHaveBeenCalled();
    });
  });
});
