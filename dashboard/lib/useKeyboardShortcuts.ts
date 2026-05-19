'use client';

import { useEffect } from 'react';

/**
 * Global keyboard shortcuts (UX audit #10, 2026-05-18).
 *
 * Two patterns supported:
 *
 * 1. Single-key shortcuts: `'n'`, `'?'`, `'Escape'`. Standard.
 * 2. Chord shortcuts: `'g h'`, `'g s'`, `'g c'`, `'g k'`. The user presses
 *    the first key, then the second within 750 ms. Matches the Gmail /
 *    GitHub / Linear convention.
 *
 * Focus-aware: when an `<input>`, `<textarea>`, or `[contenteditable]`
 * has focus, ALL shortcuts are suppressed except `Escape` (which we
 * delegate to the focused element's own escape handler, so modals close
 * normally). This stops `n` from triggering "New Booking" while a user
 * is typing a customer name.
 *
 * Modifier keys (Ctrl/Cmd/Alt) are intentionally ignored — chord +
 * single-key shortcuts here are "vimium-style" plain-letter triggers.
 * The browser keeps Cmd+K / Ctrl+L / etc. for native behavior.
 */

export interface Shortcut {
  /**
   * Key spec — either a single key (`'n'`, `'?'`) or a two-key chord
   * separated by a space (`'g h'`). Match is case-insensitive.
   */
  key: string;
  /** Action to run when the key/chord fires. */
  run: () => void;
  /** Human-readable label shown in the help modal (`Open new booking`). */
  label: string;
  /** Category in the help modal grouping. */
  category?: 'navigation' | 'actions' | 'help';
}

const CHORD_TIMEOUT_MS = 750;

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (target.isContentEditable) return true;
  return false;
}

export function useKeyboardShortcuts(shortcuts: Shortcut[], enabled = true) {
  useEffect(() => {
    if (!enabled || shortcuts.length === 0) return;

    let lastKey: string | null = null;
    let lastKeyAt = 0;

    // Pre-process the registered shortcuts into a single dispatch map.
    // Chords are stored as `"g+h"` etc. so the dispatcher can do a flat
    // string lookup after assembling the current chord.
    const singleKeys = new Map<string, Shortcut>();
    const chords = new Map<string, Shortcut>();
    const chordHeads = new Set<string>();
    for (const sc of shortcuts) {
      const parts = sc.key.toLowerCase().split(/\s+/);
      if (parts.length === 1) {
        singleKeys.set(parts[0], sc);
      } else if (parts.length === 2) {
        chords.set(`${parts[0]}+${parts[1]}`, sc);
        chordHeads.add(parts[0]);
      }
    }

    function handleKeyDown(e: KeyboardEvent) {
      // Suppress while typing — except Escape, which we never claim;
      // we leave it for the focused element's own handler so modals
      // close as expected.
      if (e.key === 'Escape') return;
      if (isEditableTarget(e.target)) return;

      // Ignore plain modifier-only events and any combo with Ctrl/Cmd/Alt
      // (those belong to the browser or platform).
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      const key = e.key.toLowerCase();
      // Ignore individual modifier keypresses (Shift, etc.) and any
      // non-single-character key that's not in our keyword list.
      // `?` arrives as `?` (Shift+/) — that's fine, single char.
      const now = Date.now();
      const withinChordWindow = lastKey !== null && now - lastKeyAt < CHORD_TIMEOUT_MS;

      // Resolve a chord first, since `g h` should NOT also fire single-key `h`.
      if (withinChordWindow) {
        const chordKey = `${lastKey}+${key}`;
        const chordHit = chords.get(chordKey);
        lastKey = null;
        if (chordHit) {
          e.preventDefault();
          chordHit.run();
          return;
        }
        // chord miss — fall through to single-key
      }

      const single = singleKeys.get(key);
      if (single) {
        e.preventDefault();
        single.run();
        return;
      }

      // Not a single-key match. If this is a chord-head, arm the chord.
      if (chordHeads.has(key)) {
        lastKey = key;
        lastKeyAt = now;
        // Do NOT preventDefault — the user may still be typing.
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [shortcuts, enabled]);
}
