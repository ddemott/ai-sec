import React, { useEffect, useRef, useCallback } from 'react';
import { X } from 'lucide-react';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  disableBackdropClose?: boolean;
}

export const Modal: React.FC<ModalProps> = ({
  isOpen,
  onClose,
  title,
  children,
  footer,
  disableBackdropClose = false,
}) => {
  const modalRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  // Focus trap: cycle through focusable elements inside the modal
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
      return;
    }

    if (e.key !== 'Tab' || !modalRef.current) return;

    const focusable = modalRef.current.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    if (focusable.length === 0) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (e.shiftKey) {
      if (document.activeElement === first) {
        e.preventDefault();
        last.focus();
      }
    } else {
      if (document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }, [onClose]);

  useEffect(() => {
    if (isOpen) {
      // Save current focus to restore later
      previousFocusRef.current = document.activeElement as HTMLElement;
      document.body.style.overflow = 'hidden';
      document.addEventListener('keydown', handleKeyDown);

      // Focus the first focusable element in the modal
      requestAnimationFrame(() => {
        if (modalRef.current) {
          const first = modalRef.current.querySelector<HTMLElement>(
            'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
          );
          first?.focus();
        }
      });

      return () => {
        document.body.style.overflow = 'unset';
        document.removeEventListener('keydown', handleKeyDown);
        // Restore focus when modal closes
        previousFocusRef.current?.focus();
      };
    } else {
      document.body.style.overflow = 'unset';
    }
  }, [isOpen, handleKeyDown]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-in fade-in duration-200" role="dialog" aria-modal="true" aria-labelledby="modal-title" onClick={disableBackdropClose ? undefined : onClose}>
      <div
        ref={modalRef}
        className="rounded-2xl shadow-xl border max-w-lg w-full overflow-hidden animate-in zoom-in-95 duration-200"
        style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="px-6 py-4 border-b flex items-center justify-between" style={{ borderColor: 'var(--border)' }}>
          <h2 id="modal-title" className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>{title}</h2>
          <button
            onClick={onClose}
            aria-label="Close dialog"
            className="p-1 transition"
            style={{ color: 'var(--text-secondary)' }}
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </header>

        <div className="p-6">
          {children}
        </div>

        {footer && (
          <footer className="px-6 py-4 border-t flex justify-end space-x-3" style={{ backgroundColor: 'var(--surface-elevated)', borderColor: 'var(--border)' }}>
            {footer}
          </footer>
        )}
      </div>
    </div>
  );
};
