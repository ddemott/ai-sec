/**
 * VoiceCallsView Tests
 * Tests voice call history display, active calls, call details, and customer context.
 * Each section has happy + sad paths with 5W diagnostic context.
 */

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

// Mock tenant context
vi.mock('../lib/SessionContext', () => ({
  useActiveTenantId: () => 'test-tenant-123',
}));

// Mock phone formatting
vi.mock('../lib/phone', () => ({
  formatPhone: (phone: string) => phone || 'Unknown',
}));

// Mock API responses
const mockActiveCalls = vi.fn();
const mockCallHistory = vi.fn();
const mockGetSession = vi.fn();

vi.mock('../lib/api', () => ({
  Api: {
    voice: {
      getActiveCalls: (...args: unknown[]) => mockActiveCalls(...args),
      getHistory: (...args: unknown[]) => mockCallHistory(...args),
      getSession: (...args: unknown[]) => mockGetSession(...args),
    },
  },
}));

import VoiceCallsView from './VoiceCallsView';

const mockCall = {
  id: 'call-1',
  call_id: 'vapi-123',
  tenant_id: 'test-tenant-123',
  caller_phone: '+15551234567',
  customer_name: 'John Smith',
  started_at: new Date(Date.now() - 60000).toISOString(), // 1 minute ago
  ended_at: new Date().toISOString(),
  status: 'completed',
  duration_seconds: 120,
  outcome: 'appointment_booked',
  transcript: 'Hello, I would like to book an appointment.',
  summary: 'Customer booked a 30-minute service appointment.',
  customer_context: {
    customer: { id: 'cust-1', name: 'John Smith', email: 'john@example.com' },
    is_known_customer: true,
    member_since: '2024-01-15T00:00:00Z',
    appointment_history: {
      total: 5,
      completed: 4,
      cancelled: 1,
      no_shows: 0,
      upcoming_appointments: [
        { appointment_id: 'apt-1', start_time: '2026-04-15T10:00:00Z', description: 'Haircut' },
      ],
    },
    notes: [
      {
        id: 'note-1',
        text: 'Prefers morning appointments',
        type: 'preference',
        created_at: '2024-03-01T00:00:00Z',
      },
    ],
    tags: ['VIP', 'Regular'],
  },
};

const mockActiveCall = {
  id: 'active-1',
  call_id: 'vapi-active',
  caller_phone: '+15559876543',
  customer_name: 'Jane Doe',
  started_at: new Date(Date.now() - 30000).toISOString(),
  is_known_customer: true,
};

describe('VoiceCallsView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });

    // Default happy path responses
    mockActiveCalls.mockResolvedValue({ calls: [] });
    mockCallHistory.mockResolvedValue({
      calls: [mockCall],
      total: 1,
      has_more: false,
    });
    mockGetSession.mockResolvedValue(mockCall);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('Happy Paths', () => {
    test('renders voice calls header with refresh button', async () => {
      render(<VoiceCallsView />);
      expect(screen.getByText('Voice Calls')).toBeInTheDocument();
      expect(screen.getByTitle('Refresh')).toBeInTheDocument();
      // WHO: all users | WHAT: page header display
      // WHEN: navigating to calls | WHERE: VoiceCallsView header
      // WHY: users need to identify the page and have refresh access
    });

    test('displays call history with call details', async () => {
      render(<VoiceCallsView />);
      await waitFor(() => {
        // John Smith appears in both list and detail panel
        expect(screen.getAllByText('John Smith').length).toBeGreaterThanOrEqual(1);
      });
      expect(screen.getByText('Call History (1)')).toBeInTheDocument();
      // WHO: users viewing history | WHAT: call list display
      // WHEN: history loads | WHERE: left panel
      // WHY: users need to see past calls and counts
    });

    test('displays call duration formatted correctly', async () => {
      render(<VoiceCallsView />);
      await waitFor(() => {
        // Duration appears in list and detail panel
        expect(screen.getAllByText('2:00').length).toBeGreaterThanOrEqual(1); // 120 seconds = 2:00
      });
      // WHO: users | WHAT: duration formatting
      // WHEN: viewing call | WHERE: call list item
      // WHY: mm:ss format is human-readable
    });

    test('displays outcome badge with correct styling', async () => {
      render(<VoiceCallsView />);
      await waitFor(() => {
        // Outcome badge appears in list and detail panel
        expect(screen.getAllByText('Booked').length).toBeGreaterThanOrEqual(1);
      });
      // WHO: users | WHAT: outcome badge
      // WHEN: viewing call | WHERE: call list and details
      // WHY: quick visual indicator of call result
    });

    test('shows active calls section when calls are in progress', async () => {
      mockActiveCalls.mockResolvedValue({ calls: [mockActiveCall] });
      render(<VoiceCallsView />);
      await waitFor(() => {
        expect(screen.getByText('Active Calls (1)')).toBeInTheDocument();
        expect(screen.getByText('Jane Doe')).toBeInTheDocument();
      });
      // WHO: users monitoring calls | WHAT: active calls display
      // WHEN: calls in progress | WHERE: active calls section
      // WHY: real-time visibility into ongoing calls
    });

    test('displays customer context for known customers', async () => {
      render(<VoiceCallsView />);
      await waitFor(() => {
        expect(screen.getByText('Customer Context')).toBeInTheDocument();
        expect(screen.getByText('5')).toBeInTheDocument(); // Total appointments
        expect(screen.getByText('4')).toBeInTheDocument(); // Completed
        expect(screen.getByText('1')).toBeInTheDocument(); // Cancelled
      });
      // WHO: users viewing call details | WHAT: customer history
      // WHEN: selecting a call | WHERE: right panel
      // WHY: context helps understand customer relationship
    });

    test('displays transcript when available', async () => {
      render(<VoiceCallsView />);
      await waitFor(() => {
        expect(screen.getByText('Transcript')).toBeInTheDocument();
        expect(screen.getByText('Hello, I would like to book an appointment.')).toBeInTheDocument();
      });
      // WHO: users reviewing calls | WHAT: call transcript
      // WHEN: viewing completed call | WHERE: details panel
      // WHY: verify what was discussed
    });

    test('displays call summary when available', async () => {
      render(<VoiceCallsView />);
      await waitFor(() => {
        expect(screen.getByText('Call Summary')).toBeInTheDocument();
        expect(
          screen.getByText('Customer booked a 30-minute service appointment.')
        ).toBeInTheDocument();
      });
      // WHO: users | WHAT: AI-generated summary
      // WHEN: call completed | WHERE: details panel
      // WHY: quick overview without reading transcript
    });

    test('displays customer notes and tags', async () => {
      render(<VoiceCallsView />);
      await waitFor(() => {
        expect(screen.getByText('Notes')).toBeInTheDocument();
        expect(screen.getByText('Prefers morning appointments')).toBeInTheDocument();
        expect(screen.getByText('VIP')).toBeInTheDocument();
        expect(screen.getByText('Regular')).toBeInTheDocument();
      });
      // WHO: users | WHAT: customer notes and tags
      // WHEN: viewing known customer | WHERE: customer context
      // WHY: helps personalize service
    });

    test('clicking refresh fetches new data', async () => {
      render(<VoiceCallsView />);
      await waitFor(() => {
        expect(mockCallHistory).toHaveBeenCalled();
      });

      fireEvent.click(screen.getByTitle('Refresh'));

      await waitFor(() => {
        expect(mockActiveCalls).toHaveBeenCalledTimes(2);
        expect(mockCallHistory).toHaveBeenCalledTimes(2);
      });
      // WHO: user | WHAT: manual refresh
      // WHEN: clicking refresh | WHERE: header
      // WHY: get latest data on demand
    });
  });

  describe('Sad Paths', () => {
    test('displays empty state when no call history', async () => {
      mockCallHistory.mockResolvedValue({ calls: [], total: 0, has_more: false });
      render(<VoiceCallsView />);
      await waitFor(() => {
        expect(screen.getByText('No call history')).toBeInTheDocument();
      });
      // WHO: new tenants | WHAT: empty state display
      // WHEN: no calls recorded | WHERE: call list
      // WHY: clear indication there's no data yet
    });

    test('displays prompt when no call is selected', async () => {
      mockCallHistory.mockResolvedValue({ calls: [], total: 0, has_more: false });
      render(<VoiceCallsView />);
      await waitFor(() => {
        expect(screen.getByText('Select a call to view details')).toBeInTheDocument();
      });
      // WHO: users | WHAT: selection prompt
      // WHEN: no call selected | WHERE: details panel
      // WHY: guide user to select a call
    });

    test('handles API error for active calls gracefully', async () => {
      mockActiveCalls.mockRejectedValue(new Error('Network error'));
      render(<VoiceCallsView />);
      await waitFor(() => {
        // Should not crash, just show empty active calls
        expect(screen.queryByText('Active Calls')).not.toBeInTheDocument();
      });
      // WHO: users | WHAT: error handling
      // WHEN: API fails | WHERE: active calls section
      // WHY: graceful degradation on network issues
    });

    test('handles API error for call history gracefully', async () => {
      mockCallHistory.mockRejectedValue(new Error('Server error'));
      render(<VoiceCallsView />);
      await waitFor(() => {
        expect(screen.queryByText('No call history')).not.toBeInTheDocument();
      });
      // WHO: users | WHAT: error handling for history
      // WHEN: history API fails | WHERE: call list
      // WHY: prevent crash on API errors
    });

    test('displays new caller message for unknown customers', async () => {
      const unknownCustomerCall = {
        ...mockCall,
        customer_context: {
          ...mockCall.customer_context,
          is_known_customer: false,
        },
      };
      mockCallHistory.mockResolvedValue({
        calls: [unknownCustomerCall],
        total: 1,
        has_more: false,
      });
      render(<VoiceCallsView />);
      await waitFor(() => {
        expect(screen.getByText('New caller - no previous history')).toBeInTheDocument();
      });
      // WHO: users | WHAT: new caller indicator
      // WHEN: caller not in system | WHERE: customer context
      // WHY: indicates this is a new customer
    });

    test('falls back to phone number when customer name is missing', async () => {
      const noNameCall = {
        ...mockCall,
        customer_name: null,
        customer_context: null,
      };
      mockCallHistory.mockResolvedValue({ calls: [noNameCall], total: 1, has_more: false });
      render(<VoiceCallsView />);
      await waitFor(() => {
        // Phone number appears in list and detail panel
        expect(screen.getAllByText('+15551234567').length).toBeGreaterThanOrEqual(1);
      });
      // WHO: users | WHAT: phone number fallback
      // WHEN: name unavailable | WHERE: call list and header
      // WHY: always have some identifier for the call
    });
  });

  describe('Edge Cases', () => {
    test('formats duration of 0 seconds correctly', async () => {
      const zeroDurationCall = { ...mockCall, duration_seconds: 0 };
      mockCallHistory.mockResolvedValue({ calls: [zeroDurationCall], total: 1, has_more: false });
      render(<VoiceCallsView />);
      await waitFor(() => {
        expect(screen.getAllByText('0:00').length).toBeGreaterThanOrEqual(1);
      });
    });

    test('formats duration of null correctly', async () => {
      const nullDurationCall = { ...mockCall, duration_seconds: null };
      mockCallHistory.mockResolvedValue({ calls: [nullDurationCall], total: 1, has_more: false });
      render(<VoiceCallsView />);
      await waitFor(() => {
        expect(screen.getAllByText('0:00').length).toBeGreaterThanOrEqual(1);
      });
    });

    test('shows load more button when has_more is true', async () => {
      mockCallHistory.mockResolvedValue({ calls: [mockCall], total: 25, has_more: true });
      render(<VoiceCallsView />);
      await waitFor(() => {
        expect(screen.getByText(/Load more/)).toBeInTheDocument();
      });
    });

    test('load more appends to existing history', async () => {
      const secondCall = { ...mockCall, id: 'call-2', customer_name: 'Alice Brown' };
      mockCallHistory
        .mockResolvedValueOnce({ calls: [mockCall], total: 2, has_more: true })
        .mockResolvedValueOnce({ calls: [secondCall], total: 2, has_more: false });

      render(<VoiceCallsView />);
      await waitFor(() => {
        expect(screen.getAllByText('John Smith').length).toBeGreaterThanOrEqual(1);
      });

      fireEvent.click(screen.getByText(/Load more/));

      await waitFor(() => {
        expect(screen.getAllByText('Alice Brown').length).toBeGreaterThanOrEqual(1);
        expect(screen.getAllByText('John Smith').length).toBeGreaterThanOrEqual(1);
      });
    });

    test('handles all outcome types correctly', async () => {
      const outcomes = [
        'appointment_booked',
        'appointment_rescheduled',
        'appointment_cancelled',
        'info_provided',
        'transferred',
        'voicemail',
        'abandoned',
        'other',
      ];
      const labels = [
        'Booked',
        'Rescheduled',
        'Cancelled',
        'Info Provided',
        'Transferred',
        'Voicemail',
        'Abandoned',
        'Other',
      ];

      for (let i = 0; i < outcomes.length; i++) {
        const callWithOutcome = { ...mockCall, id: `call-${i}`, outcome: outcomes[i] };
        mockCallHistory.mockResolvedValue({ calls: [callWithOutcome], total: 1, has_more: false });
        const { unmount } = render(<VoiceCallsView />);
        await waitFor(() => {
          // Outcome label appears in list and detail panel
          expect(screen.getAllByText(labels[i]).length).toBeGreaterThanOrEqual(1);
        });
        unmount();
      }
    });

    test('handles unknown outcome gracefully', async () => {
      const unknownOutcomeCall = { ...mockCall, outcome: 'unknown_type' };
      mockCallHistory.mockResolvedValue({ calls: [unknownOutcomeCall], total: 1, has_more: false });
      render(<VoiceCallsView />);
      await waitFor(() => {
        // Unknown outcome appears in list and detail panel
        expect(screen.getAllByText('unknown_type').length).toBeGreaterThanOrEqual(1);
      });
    });

    test('clicking active call fetches full session details', async () => {
      mockActiveCalls.mockResolvedValue({ calls: [mockActiveCall] });
      render(<VoiceCallsView />);

      await waitFor(() => {
        expect(screen.getByText('Jane Doe')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('Jane Doe'));

      await waitFor(() => {
        expect(mockGetSession).toHaveBeenCalledWith('test-tenant-123', 'vapi-active');
      });
    });

    test('shows returning customer badge in active calls', async () => {
      mockActiveCalls.mockResolvedValue({ calls: [mockActiveCall] });
      render(<VoiceCallsView />);
      await waitFor(() => {
        expect(screen.getByText('Returning customer')).toBeInTheDocument();
      });
    });

    test('displays appointment count in history for known customers', async () => {
      render(<VoiceCallsView />);
      await waitFor(() => {
        expect(screen.getByText('5 appointments')).toBeInTheDocument();
      });
    });
  });

  describe('Status Display', () => {
    test('shows Active status badge for in-progress calls', async () => {
      const activeStatusCall = { ...mockCall, status: 'active' };
      mockCallHistory.mockResolvedValue({ calls: [activeStatusCall], total: 1, has_more: false });
      render(<VoiceCallsView />);
      await waitFor(() => {
        expect(screen.getByText('Active')).toBeInTheDocument();
      });
    });

    test('shows Completed status badge for finished calls', async () => {
      render(<VoiceCallsView />);
      await waitFor(() => {
        // Status may appear multiple times
        expect(screen.getAllByText('Completed').length).toBeGreaterThanOrEqual(1);
      });
    });

    test('shows error status for failed calls', async () => {
      const failedCall = { ...mockCall, status: 'failed' };
      mockCallHistory.mockResolvedValue({ calls: [failedCall], total: 1, has_more: false });
      render(<VoiceCallsView />);
      await waitFor(() => {
        expect(screen.getByText('failed')).toBeInTheDocument();
      });
    });
  });
});
