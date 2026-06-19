/**
 * WHO:   Owner reviewing AI-extracted Q&A from a website scan.
 * WHAT:  KnowledgeSuggestions component — list, approve, reject, empty/error states.
 * WHEN:  Setup Wizard website import completes; owner opens Knowledge tab.
 * WHERE: dashboard/components/KnowledgeSuggestions.tsx
 * WHY:   Component has real stateful logic: loading-stuck bug when tenantId is null,
 *        optimistic remove-on-action, onCountChange propagation, error display.
 *        Backend API coverage exists; this covers the UI layer.
 */
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

const mockSuggestions = vi.fn();
const mockApproveSuggestion = vi.fn();
const mockRejectSuggestion = vi.fn();

vi.mock('../lib/api', () => ({
  Api: {
    knowledge: {
      suggestions: (...args: unknown[]) => mockSuggestions(...args),
      approveSuggestion: (...args: unknown[]) => mockApproveSuggestion(...args),
      rejectSuggestion: (...args: unknown[]) => mockRejectSuggestion(...args),
    },
  },
}));

import { KnowledgeSuggestions } from './KnowledgeSuggestions';

const TENANT_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

const SUGGESTION_A = {
  id: '11111111-1111-4111-8111-111111111111',
  question: 'What are your hours?',
  answer: 'Monday to Friday, 9am to 6pm.',
  source_url: 'https://example.com/about',
  confidence: 0.92,
  created_at: '2026-06-15T10:00:00Z',
};

const SUGGESTION_B = {
  id: '22222222-2222-4222-8222-222222222222',
  question: 'Do you offer same-day appointments?',
  answer: 'Yes, subject to availability.',
  source_url: null,
  confidence: null,
  created_at: '2026-06-15T10:01:00Z',
};

beforeEach(() => {
  mockSuggestions.mockReset();
  mockApproveSuggestion.mockReset();
  mockRejectSuggestion.mockReset();
});

describe('KnowledgeSuggestions — null tenantId', () => {
  test('SAD: stops spinner immediately when tenantId is null', async () => {
    // WHO: component mounts before session context resolves (tenantId still null).
    // WHAT: initial loading=true but tenantId guard fires synchronously — loading
    //       must clear so the UI does not hang on a spinner forever.
    // WHEN: first render before auth/session is ready.
    // WHERE: load() early-return on !tenantId.
    // WHY: regression guard for the loading-stuck bug fixed 2026-06-18.
    render(<KnowledgeSuggestions tenantId={null} />);

    // Empty state renders, not spinner — loading cleared.
    await waitFor(() => {
      expect(screen.queryByText(/loading suggestions/i)).not.toBeInTheDocument();
    });
    expect(screen.getByText(/no pending suggestions/i)).toBeInTheDocument();
    expect(mockSuggestions).not.toHaveBeenCalled();
  });
});

describe('KnowledgeSuggestions — happy paths', () => {
  test('HAPPY: renders list of suggestions with question, answer, confidence, source', async () => {
    // WHO: owner with two pending suggestions from a website scan.
    // WHAT: both cards render with their Q&A content, confidence %, and source URL.
    // WHEN: API resolves successfully.
    // WHERE: suggestions.map() render loop.
    // WHY: verify content binding — wrong key or missing field would hide data.
    mockSuggestions.mockResolvedValue({
      success: true,
      suggestions: [SUGGESTION_A, SUGGESTION_B],
    });

    render(<KnowledgeSuggestions tenantId={TENANT_ID} />);

    await screen.findByText('What are your hours?');
    expect(screen.getByText('Monday to Friday, 9am to 6pm.')).toBeInTheDocument();
    expect(screen.getByText('https://example.com/about')).toBeInTheDocument();
    expect(screen.getByText('Confidence: 92%')).toBeInTheDocument();

    expect(screen.getByText('Do you offer same-day appointments?')).toBeInTheDocument();
    // null confidence + null source_url → neither confidence line nor URL rendered
    expect(screen.queryByText('Confidence: 0%')).not.toBeInTheDocument();

    // Header count
    expect(screen.getByText(/2 items extracted/i)).toBeInTheDocument();
  });

  test('HAPPY: approving a suggestion removes it from the list and updates count', async () => {
    // WHO: owner clicking Add on the first suggestion.
    // WHAT: API called with suggestion id; on success the card disappears and
    //       onCountChange fires with the new count (1).
    // WHEN: approve action succeeds.
    // WHERE: act() → setSuggestions filter + onCountChange.
    // WHY: ensures optimistic remove works and parent badge count stays in sync.
    mockSuggestions.mockResolvedValue({
      success: true,
      suggestions: [SUGGESTION_A, SUGGESTION_B],
    });
    mockApproveSuggestion.mockResolvedValue({ success: true });
    const onCountChange = vi.fn();

    render(<KnowledgeSuggestions tenantId={TENANT_ID} onCountChange={onCountChange} />);

    await screen.findByText('What are your hours?');
    // onCountChange called on initial load with 2
    expect(onCountChange).toHaveBeenLastCalledWith(2);

    const addButtons = screen.getAllByRole('button', { name: /add/i });
    fireEvent.click(addButtons[0]);

    await waitFor(() => {
      expect(screen.queryByText('What are your hours?')).not.toBeInTheDocument();
    });

    expect(mockApproveSuggestion).toHaveBeenCalledWith(SUGGESTION_A.id, TENANT_ID);
    expect(screen.getByText('Do you offer same-day appointments?')).toBeInTheDocument();
    expect(onCountChange).toHaveBeenLastCalledWith(1);
  });

  test('HAPPY: rejecting a suggestion removes it from the list', async () => {
    // WHO: owner clicking Discard on the second suggestion.
    // WHAT: rejectSuggestion called; card removed; count drops to 1.
    // WHEN: reject action succeeds.
    // WHERE: act() → setSuggestions filter.
    // WHY: mirrors approve path — both must clear the card on success.
    mockSuggestions.mockResolvedValue({
      success: true,
      suggestions: [SUGGESTION_A, SUGGESTION_B],
    });
    mockRejectSuggestion.mockResolvedValue({ success: true });
    const onCountChange = vi.fn();

    render(<KnowledgeSuggestions tenantId={TENANT_ID} onCountChange={onCountChange} />);

    await screen.findByText('Do you offer same-day appointments?');

    const discardButtons = screen.getAllByRole('button', { name: /discard/i });
    fireEvent.click(discardButtons[1]);

    await waitFor(() => {
      expect(
        screen.queryByText('Do you offer same-day appointments?')
      ).not.toBeInTheDocument();
    });

    expect(mockRejectSuggestion).toHaveBeenCalledWith(SUGGESTION_B.id, TENANT_ID);
    expect(screen.getByText('What are your hours?')).toBeInTheDocument();
    expect(onCountChange).toHaveBeenLastCalledWith(1);
  });

  test('HAPPY: shows empty state when API returns zero suggestions', async () => {
    // WHO: owner who has already reviewed all suggestions.
    // WHAT: empty state renders with the "no pending suggestions" message.
    // WHEN: API returns success with empty array.
    // WHERE: suggestions.length === 0 branch.
    // WHY: confirm empty state is rendered, not an error or spinner.
    mockSuggestions.mockResolvedValue({ success: true, suggestions: [] });

    render(<KnowledgeSuggestions tenantId={TENANT_ID} />);

    await screen.findByText(/no pending suggestions/i);
    expect(screen.queryByText(/items extracted/i)).not.toBeInTheDocument();
  });

  test('HAPPY: singular "item" label when exactly one suggestion remains', async () => {
    // WHO: owner with one pending suggestion.
    // WHAT: header reads "1 item" not "1 items".
    // WHEN: single suggestion returned.
    // WHERE: pluralisation in count paragraph.
    // WHY: trivial but owner-visible grammar bug if the ternary breaks.
    mockSuggestions.mockResolvedValue({ success: true, suggestions: [SUGGESTION_A] });

    render(<KnowledgeSuggestions tenantId={TENANT_ID} />);

    await screen.findByText(/1 item extracted/);
    expect(screen.queryByText(/1 items/)).not.toBeInTheDocument();
  });
});

describe('KnowledgeSuggestions — sad paths', () => {
  test('SAD: shows error message when API returns success:false', async () => {
    // WHO: owner whose session token expired mid-load.
    // WHAT: component shows "Failed to load suggestions." instead of crashing.
    // WHEN: API resolves but success is false.
    // WHERE: load() else branch → setError.
    // WHY: non-throwing API failures must surface, not silently show empty state.
    mockSuggestions.mockResolvedValue({ success: false, error: 'Unauthorized' });

    render(<KnowledgeSuggestions tenantId={TENANT_ID} />);

    await screen.findByText(/failed to load suggestions/i);
    expect(screen.queryByText(/no pending suggestions/i)).not.toBeInTheDocument();
  });

  test('SAD: shows error message when API throws', async () => {
    // WHO: owner on a network with transient DNS failure.
    // WHAT: caught exception renders the same error message.
    // WHEN: fetch throws (network error, CORS, etc.).
    // WHERE: load() catch block → setError.
    // WHY: thrown errors and failure responses must both surface clearly.
    mockSuggestions.mockRejectedValue(new Error('Network error'));

    render(<KnowledgeSuggestions tenantId={TENANT_ID} />);

    await screen.findByText(/failed to load suggestions/i);
  });

  test('SAD: failed action leaves card in list for retry', async () => {
    // WHO: owner whose approve request fails (e.g. suggestion already reviewed).
    // WHAT: card stays in the list so the owner can retry or refresh.
    // WHEN: approveSuggestion throws or returns success:false.
    // WHERE: act() catch block — no setSuggestions call on failure.
    // WHY: silent removal on failure would lose track of unprocessed suggestions.
    mockSuggestions.mockResolvedValue({ success: true, suggestions: [SUGGESTION_A] });
    mockApproveSuggestion.mockRejectedValue(new Error('Already reviewed'));

    render(<KnowledgeSuggestions tenantId={TENANT_ID} />);

    await screen.findByText('What are your hours?');
    fireEvent.click(screen.getByRole('button', { name: /add/i }));

    // After the action settles, card must still be present
    await waitFor(() => {
      expect(mockApproveSuggestion).toHaveBeenCalled();
    });
    expect(screen.getByText('What are your hours?')).toBeInTheDocument();
  });
});
