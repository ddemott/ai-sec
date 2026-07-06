import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

// WHO: a solo owner on "What will callers ask?" (Solo Setup → Teach Your AI).
// WHAT: the document-upload control + example-sheet link appear next to Scan &
//       prefill, and uploading a doc calls importDocument + reports custom Qs.
// WHEN: 2026-07-01 — the upload was originally only wired into the full wizard's
//       website-scan step, which the Solo path doesn't render (owner reported
//       "where?"). WHERE: Step7CallerQuestions handleDocumentUpload. WHY: the
//       Solo path is the one owners actually use, so it must show the control.
const mockList = vi.fn();
const mockImportDocument = vi.fn();
const mockAdd = vi.fn().mockResolvedValue({ success: true });
vi.mock('../../lib/api', () => ({
  Api: {
    knowledge: {
      list: (...a: unknown[]) => mockList(...a),
      importDocument: (...a: unknown[]) => mockImportDocument(...a),
      importWebsite: vi.fn(),
      add: (...a: unknown[]) => mockAdd(...a),
    },
  },
}));

import { Step7CallerQuestions } from './Step7CallerQuestions';

describe('Step7CallerQuestions — document upload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockList.mockResolvedValue([]);
  });

  it('shows the upload control + example link and imports a document', async () => {
    mockImportDocument.mockResolvedValue({
      success: true,
      standard_answers: [],
      custom_questions: [{ question: 'X?', answer: 'Y' }],
      malformed: [],
      confirmed: 1,
    });

    render(<Step7CallerQuestions tenantId="t1" />);
    expect(screen.getByTestId('kb-download-example')).toBeInTheDocument();

    const input = screen.getByTestId('kb-document-upload');
    const file = new File(['**Q: X?\n**A: Y'], 'faq.md', { type: 'text/markdown' });
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(mockImportDocument).toHaveBeenCalledWith('t1', file));
    await waitFor(() => expect(screen.getByText(/1 custom question/i)).toBeInTheDocument());
  });

  it('hides the upload control when showWebsiteImport is false', () => {
    render(<Step7CallerQuestions tenantId="t1" showWebsiteImport={false} />);
    expect(screen.queryByTestId('kb-document-upload')).not.toBeInTheDocument();
  });
});
