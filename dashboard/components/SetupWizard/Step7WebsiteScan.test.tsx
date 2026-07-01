import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

// WHO: an owner in Solo setup uploading their FAQ sheet.
// WHAT: the upload control calls Api.knowledge.importDocument and reports the
//       custom questions added. WHEN: 2026-07-01 doc-upload feature. WHERE:
//       Step7WebsiteScan upload handler. WHY: gives owners a file path to prefill
//       knowledge alongside the URL scan.
const mockImportDocument = vi.fn();
const mockAdd = vi.fn().mockResolvedValue({ success: true });
vi.mock('../../lib/api', () => ({
  Api: {
    knowledge: {
      importDocument: (...a: unknown[]) => mockImportDocument(...a),
      add: (...a: unknown[]) => mockAdd(...a),
      importWebsite: vi.fn(),
    },
  },
}));

import { Step7WebsiteScan } from './Step7WebsiteScan';

describe('Step7WebsiteScan — document upload', () => {
  beforeEach(() => vi.clearAllMocks());

  it('uploads a document and reports the custom questions added', async () => {
    mockImportDocument.mockResolvedValue({
      success: true,
      standard_answers: [],
      custom_questions: [{ question: 'Do you sell gift cards?', answer: 'Yes.' }],
      malformed: [],
      confirmed: 1,
    });

    render(<Step7WebsiteScan tenantId="t1" />);
    const input = screen.getByTestId('kb-document-upload') as HTMLInputElement;
    const file = new File(['**Q: Do you sell gift cards?\n**A: Yes.'], 'faq.md', {
      type: 'text/markdown',
    });
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(mockImportDocument).toHaveBeenCalledWith('t1', file));
    await waitFor(() => expect(screen.getByText(/1 custom question/i)).toBeInTheDocument());
  });

  it('surfaces an error when the import fails', async () => {
    mockImportDocument.mockResolvedValue({ success: false, error: 'Unsupported file type ".exe"' });

    render(<Step7WebsiteScan tenantId="t1" />);
    const input = screen.getByTestId('kb-document-upload') as HTMLInputElement;
    const file = new File(['x'], 'bad.exe', { type: 'application/octet-stream' });
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(screen.getByText(/Unsupported file type/i)).toBeInTheDocument());
  });
});
