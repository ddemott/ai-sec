import { useEffect, useRef } from 'react';

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Activates a focus trap inside containerRef when isOpen is true.
 *
 * - Captures the previously-focused element and restores it on close.
 * - Moves initial focus to the first focusable child (skips if autoFocus
 *   already handled it).
 * - Traps Tab / Shift+Tab within the container.
 * - Calls onEscape when Escape is pressed.
 * - Optionally locks body scroll (for centered overlay dialogs).
 */
export function useFocusTrap(
  containerRef: React.RefObject<HTMLElement | null>,
  isOpen: boolean,
  onEscape?: () => void,
  lockScroll?: boolean
): void {
  const prevFocusRef = useRef<HTMLElement | null>(null);
  const onEscapeRef = useRef(onEscape);
  onEscapeRef.current = onEscape;

  useEffect(() => {
    if (!isOpen) return;

    const lock = lockScroll === true;
    prevFocusRef.current = document.activeElement as HTMLElement;

    if (lock) document.body.style.overflow = 'hidden';

    requestAnimationFrame(() => {
      const el = containerRef.current;
      if (!el) return;
      // Skip if autoFocus already placed focus inside the container.
      if (el.contains(document.activeElement) && document.activeElement !== document.body) return;
      el.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    });

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        onEscapeRef.current?.();
        return;
      }
      if (e.key !== 'Tab' || !containerRef.current) return;

      const nodes = containerRef.current.querySelectorAll<HTMLElement>(FOCUSABLE);
      if (nodes.length === 0) return;

      const first = nodes[0];
      const last = nodes[nodes.length - 1];

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
    }

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      if (lock) document.body.style.overflow = 'unset';
      const prev = prevFocusRef.current;
      if (prev && document.body.contains(prev)) prev.focus();
    };
    // containerRef is stable; lockScroll and onEscape are captured via ref/closure
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);
}
