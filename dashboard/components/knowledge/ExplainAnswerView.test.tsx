/**
 * ExplainAnswerView tests — the owner-only RAG "answer debugger"
 * (POST /knowledge/explain). Pins that submitting a question renders the ranked
 * candidate chunks with scores + the would_answer verdict, and that the
 * "would not answer" path nudges the owner to add content.
 *
 * Each test carries 5W diagnostic context.
 */
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

vi.mock('../../lib/SessionContext', () => ({
  useActiveTenantId: () => 'tenant-123',
}));

const { mockApi, mockToast } = vi.hoisted(() => ({
  mockApi: { knowledge: { explain: vi.fn() } },
  mockToast: vi.fn(),
}));

vi.mock('../../lib/api', () => ({ Api: mockApi }));
vi.mock('../ui/Toast', () => ({ showToast: mockToast }));

import ExplainAnswerView from './ExplainAnswerView';

beforeEach(() => {
  mockApi.knowledge.explain.mockReset();
  mockToast.mockReset();
});

describe('ExplainAnswerView', () => {
  test('HAPPY: shows ranked candidates + a positive verdict when the AI would answer', async () => {
    // WHO: an owner debugging why the AI does/doesn't answer a question.
    // WHAT: typing a question + Explain renders each candidate chunk with its
    //        match % and flags which would be used in production.
    // WHEN: explain returns 2 candidates, one above threshold + used.
    // WHERE: the candidate list + the would_answer banner.
    // WHY: owners need to SEE the retrieval to know whether to add KB content.
    mockApi.knowledge.explain.mockResolvedValue({
      success: true,
      question: 'Do you take walk-ins?',
      production_threshold: 0.5,
      production_match_count: 3,
      candidates: [
        {
          rank: 1,
          tenant_doc_id: 'd1',
          similarity: 0.82,
          above_threshold: true,
          used_in_production: true,
          content: 'Yes, walk-ins are welcome before 4pm.',
        },
        {
          rank: 2,
          tenant_doc_id: 'd2',
          similarity: 0.31,
          above_threshold: false,
          used_in_production: false,
          content: 'We are located downtown.',
        },
      ],
      would_answer: true,
      composed_answer: '[From "Walk-ins"]\nYes, walk-ins are welcome before 4pm.',
    });

    render(<ExplainAnswerView />);

    fireEvent.change(screen.getByLabelText('Caller question'), {
      target: { value: 'Do you take walk-ins?' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Explain' }));

    // Appears in both the candidate chunk + the composed-answer box.
    expect((await screen.findAllByText(/Yes, walk-ins are welcome/i)).length).toBeGreaterThan(0);
    expect(screen.getByText('82% match')).toBeInTheDocument();
    expect(screen.getByText('Used by AI')).toBeInTheDocument();
    expect(screen.getByText(/The AI would answer this/i)).toBeInTheDocument();
    // The composed-answer box shows the exact cited context the AI would draw from.
    expect(screen.getByText(/What the AI would draw from/i)).toBeInTheDocument();
    expect(screen.getByText(/\[From "Walk-ins"\]/)).toBeInTheDocument();
    expect(mockApi.knowledge.explain).toHaveBeenCalledWith('tenant-123', 'Do you take walk-ins?');
  });

  test('HAPPY: a negative verdict nudges the owner to add content', async () => {
    // WHAT: would_answer=false → an amber banner telling the owner the KB has
    //        no strong match, so they know to add/reword content.
    mockApi.knowledge.explain.mockResolvedValue({
      success: true,
      question: 'Do you do taxes?',
      production_threshold: 0.5,
      production_match_count: 3,
      candidates: [
        {
          rank: 1,
          tenant_doc_id: 'd1',
          similarity: 0.21,
          above_threshold: false,
          used_in_production: false,
          content: 'We cut hair.',
        },
      ],
      would_answer: false,
    });

    render(<ExplainAnswerView />);
    fireEvent.change(screen.getByLabelText('Caller question'), {
      target: { value: 'Do you do taxes?' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Explain' }));

    expect(await screen.findByText(/would NOT answer this/i)).toBeInTheDocument();
  });

  test('SAD: an error surfaces a toast and no results', async () => {
    mockApi.knowledge.explain.mockRejectedValue(new Error('nope'));

    render(<ExplainAnswerView />);
    fireEvent.change(screen.getByLabelText('Caller question'), {
      target: { value: 'anything' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Explain' }));

    // Toast fires; the verdict banner never appears.
    await vi.waitFor(() => expect(mockToast).toHaveBeenCalledWith('nope', 'error'));
    expect(screen.queryByText(/would answer/i)).not.toBeInTheDocument();
  });
});
