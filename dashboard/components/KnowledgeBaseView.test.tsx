/**
 * KnowledgeBaseView — questionnaire prefill + provenance badge.
 *
 * REGRESSION GUARD for the "from your website" provenance work: scanned answers
 * are saved with source='website-scan' (was 'policy-questionnaire'). The prefill
 * map must accept BOTH sources — otherwise a website-scanned answer would stop
 * pre-filling the questions step, breaking onboarding. This test renders the
 * view with one of each source and asserts both pre-fill, and that the
 * website-sourced one shows the distinct "From your website" marker.
 */
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

const mockTenantId = 'test-tenant-kb';
vi.mock('../lib/SessionContext', () => ({
  useActiveTenantId: () => mockTenantId,
}));

const mockList = vi.fn();
const mockSuggestions = vi.fn();
vi.mock('../lib/api', () => ({
  Api: {
    knowledge: {
      list: (...a: unknown[]) => mockList(...a),
      suggestions: (...a: unknown[]) => mockSuggestions(...a),
    },
  },
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('./ui/Toast', () => ({ showToast: vi.fn() }));
vi.mock('../lib/useConfirm', () => ({
  useConfirm: () => ({ confirm: vi.fn(), closeConfirm: vi.fn(), confirmState: { isOpen: false } }),
}));

import KnowledgeBaseView from './KnowledgeBaseView';

// Both questions are in the first category ("Business Hours & Location"), which
// renders open by default — so both textareas are present without expanding.
const Q_MANUAL = 'What are your hours of operation?';
const Q_SCANNED = 'Where are you located?';

beforeEach(() => {
  mockSuggestions.mockResolvedValue({ success: true, suggestions: [] });
  mockList.mockResolvedValue([
    {
      tenant_doc_id: 'doc-manual',
      tenant_id: mockTenantId,
      title: Q_MANUAL,
      content: `Q: ${Q_MANUAL}\nA: Open Mon–Fri 9 to 5.`,
      source: 'policy-questionnaire',
      created_at: '2026-06-01T00:00:00Z',
    },
    {
      tenant_doc_id: 'doc-scanned',
      tenant_id: mockTenantId,
      title: Q_SCANNED,
      content: `Q: ${Q_SCANNED}\nA: 123 Main Street.`,
      source: 'website-scan',
      created_at: '2026-06-01T00:00:00Z',
    },
  ]);
});

describe('KnowledgeBaseView prefill + provenance', () => {
  test('HAPPY: both policy-questionnaire AND website-scan answers pre-fill', async () => {
    // WHY: the regression — widening the scan source must not stop scanned
    //      answers from pre-filling the questionnaire.
    render(<KnowledgeBaseView />);
    // Manual answer pre-fills (baseline behavior).
    await waitFor(() => expect(screen.getByDisplayValue('Open Mon–Fri 9 to 5.')).toBeInTheDocument());
    // Website-scanned answer ALSO pre-fills (the guard).
    expect(screen.getByDisplayValue('123 Main Street.')).toBeInTheDocument();
  });

  test('HAPPY: website-scanned answer shows "From your website"; manual shows "Answered"', async () => {
    // WHY: the provenance feature — the owner can tell scan-sourced answers apart.
    render(<KnowledgeBaseView />);
    await waitFor(() => expect(screen.getByText('From your website')).toBeInTheDocument());
    expect(screen.getByText('Answered')).toBeInTheDocument();
  });
});
