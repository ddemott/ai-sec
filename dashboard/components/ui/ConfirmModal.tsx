import React from 'react';
import { Modal } from './Modal';
import { Button } from './Button';
import { AlertTriangle } from 'lucide-react';

interface ConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmLabel?: string;
  confirmVariant?: 'danger' | 'primary' | 'warning';
  loading?: boolean;
}

export function ConfirmModal({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = 'Confirm',
  confirmVariant = 'danger',
  loading = false,
}: ConfirmModalProps) {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      disableBackdropClose
      footer={
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button variant={confirmVariant} onClick={onConfirm} isLoading={loading}>
            {confirmLabel}
          </Button>
        </div>
      }
    >
      <div className="flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" style={{ color: 'var(--danger)' }} />
        {/* whitespace-pre-line: a <p> collapses newlines, so a message built as a
            list (e.g. the setup removal warning's one-bullet-per-entity summary)
            would otherwise render as a single run-on line. Callers whose messages
            contain no newlines are unaffected. */}
        <p className="text-sm whitespace-pre-line" style={{ color: 'var(--text-secondary)' }}>
          {message}
        </p>
      </div>
    </Modal>
  );
}
