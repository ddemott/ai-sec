'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * A tiny client hook that backs a single piece of shallow UI state with a URL
 * query param. It owns the four things dashboard shells kept re-implementing
 * (and getting subtly different):
 *
 *   1. read + validate the initial param value (falling back to a default),
 *   2. write updates with `history.replaceState` (no navigation / no scroll),
 *   3. react to browser `popstate` (back/forward) so the value stays in sync,
 *   4. optionally OMIT the param from the URL when it equals the default
 *      (keeps canonical URLs clean, e.g. `?view=grid` collapses to no param).
 *
 * Intentionally limited to string URL state — NOT API state, NOT a router.
 *
 * Extracted from KnowledgeBaseView / SkillAssignmentsView / AIInsightsView
 * (docs/IMPROVEMENT_IDEAS.md — the "extract after the 3rd consumer" rule).
 */
export interface UrlQueryStateOptions<T extends string> {
  /** Value used when the param is absent or fails validation. */
  defaultValue: T;
  /**
   * Allowed values. An array is treated as an allow-list; a predicate lets a
   * caller validate free-form input. Omit entirely for an unvalidated string
   * param (e.g. a search box).
   */
  valid?: readonly T[] | ((raw: string) => boolean);
  /** When true, the param is removed from the URL once value === defaultValue. */
  omitDefault?: boolean;
}

function currentSearch(): URLSearchParams {
  // Guard for SSR / non-browser render passes.
  if (typeof window === 'undefined') return new URLSearchParams();
  return new URLSearchParams(window.location.search);
}

function readParam<T extends string>(key: string, opts: UrlQueryStateOptions<T>): T {
  const raw = currentSearch().get(key);
  if (raw == null) return opts.defaultValue;
  const { valid } = opts;
  if (valid == null) return raw as T;
  // typeof-function narrows the union cleanly (Array.isArray doesn't narrow a
  // `readonly T[]`).
  const ok = typeof valid === 'function' ? valid(raw) : valid.includes(raw as T);
  return ok ? (raw as T) : opts.defaultValue;
}

export function useUrlQueryState<T extends string>(
  key: string,
  opts: UrlQueryStateOptions<T>
): [T, (next: T) => void] {
  const { defaultValue, omitDefault } = opts;
  const [value, setValueState] = useState<T>(() => readParam(key, opts));

  const setValue = useCallback(
    (next: T) => {
      setValueState(next);
      if (typeof window === 'undefined') return;
      const params = new URLSearchParams(window.location.search);
      if (omitDefault && next === defaultValue) {
        params.delete(key);
      } else {
        params.set(key, next);
      }
      const qs = params.toString();
      window.history.replaceState({}, '', `${window.location.pathname}${qs ? `?${qs}` : ''}`);
    },
    [key, defaultValue, omitDefault]
  );

  // Keep the value in sync with browser back/forward and any external URL
  // rewrite. Re-reads through readParam so validation applies to popstate too.
  useEffect(() => {
    function onPopState() {
      const next = readParam(key, opts);
      setValueState((prev) => (prev === next ? prev : next));
    }
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
    // opts is intentionally read fresh each fire; key is the stable identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return [value, setValue];
}
