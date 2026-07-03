/**
 * RecordHistoryModal — a11y-focused tests for the un-audited-surface UX pass.
 *
 * The modal lacked dialog semantics (role/aria-modal/labelledby), an accessible
 * name on its close button, Escape-to-close, and aria-expanded on the per-version
 * toggles. These tests pin the fixes.
 *
 * 5W for failures: WHO a screen-reader/keyboard owner reviewing version history;
 * WHAT the modal shell + close button + version toggles; WHERE RecordHistoryModal;
 * WHY a non-dialog overlay with no Escape traps keyboard users.
 */
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

const mockGetHistory = vi.fn();

vi.mock('../lib/api', () => ({
  Api: {
    versionHistory: {
      getHistory: (...a: unknown[]) => mockGetHistory(...a),
    },
  },
}));

import { RecordHistoryModal } from './RecordHistoryModal';

const history = {
  current_version: 2,
  is_deleted: false,
  versions: [
    {
      record_version_id: 'v2',
      version_number: 2,
      change_type: 'update',
      change_source: 'local',
      changed_at: '2026-07-02T10:00:00Z',
      changed_by: 'owner@shop.test',
      data: { name: 'Ada L.' },
      changed_fields: ['name'],
    },
    {
      record_version_id: 'v1',
      version_number: 1,
      change_type: 'create',
      change_source: 'local',
      changed_at: '2026-07-01T10:00:00Z',
      changed_by: 'owner@shop.test',
      data: { name: 'Ada' },
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  mockGetHistory.mockResolvedValue(history);
});

function renderModal(onClose = vi.fn()) {
  render(
    <RecordHistoryModal
      isOpen
      onClose={onClose}
      table="customers"
      recordId="rec-1"
      recordName="Ada Lovelace"
      tenantId="t-1"
    />
  );
  return { onClose };
}

describe('RecordHistoryModal a11y', () => {
  test('renders as a labelled dialog with an accessible close button', async () => {
    renderModal();
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    // Labelled by the visible title.
    expect(dialog).toHaveAccessibleName('Version History');
    expect(screen.getByLabelText('Close version history')).toBeInTheDocument();
  });

  test('Escape closes the modal', async () => {
    const { onClose } = renderModal();
    await screen.findByRole('dialog');
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  test('version toggle exposes aria-expanded', async () => {
    renderModal();
    await screen.findByRole('dialog');
    const toggle = await screen.findByRole('button', { name: /Show details for version 2/i });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(toggle);
    expect(screen.getByRole('button', { name: /Hide details for version 2/i })).toHaveAttribute(
      'aria-expanded',
      'true'
    );
  });
});
