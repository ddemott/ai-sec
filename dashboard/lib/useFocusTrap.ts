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
 * - Optionally dismisses on an outside `mousedown` (`onOutsideDismiss`) — for
 *   popover/card overlays that close when you click away. The listener is
 *   attached on the NEXT tick so the same click that opened the overlay can't
 *   immediately close it. Modal/panel callers that omit it are unaffected.
 */
export function useFocusTrap(
  containerRef: React.RefObject<HTMLElement | null>,
  isOpen: boolean,
  onEscape?: () => void,
  lockScroll?: boolean,
  onOutsideDismiss?: () => void
): void {
  const prevFocusRef = useRef<HTMLElement | null>(null);
  const onEscapeRef = useRef(onEscape);
  onEscapeRef.current = onEscape;
  const onOutsideDismissRef = useRef(onOutsideDismiss);
  onOutsideDismissRef.current = onOutsideDismiss;

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

    // Outside-dismiss (opt-in). Deferred one tick so the opening click doesn't
    // bubble up and immediately re-close the overlay.
    function handleOutside(e: MouseEvent) {
      const el = containerRef.current;
      if (el && !el.contains(e.target as Node)) onOutsideDismissRef.current?.();
    }
    let outsideTimer: ReturnType<typeof setTimeout> | undefined;
    if (onOutsideDismissRef.current) {
      outsideTimer = setTimeout(() => {
        document.addEventListener('mousedown', handleOutside);
      }, 0);
    }

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      if (outsideTimer !== undefined) clearTimeout(outsideTimer);
      document.removeEventListener('mousedown', handleOutside);
      if (lock) document.body.style.overflow = 'unset';
      const prev = prevFocusRef.current;
      if (prev && document.body.contains(prev)) prev.focus();
    };
    // containerRef is stable; lockScroll/onEscape/onOutsideDismiss are captured via ref/closure
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);
}
