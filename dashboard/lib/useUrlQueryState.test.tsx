/**
 * Tests for useUrlQueryState — a small client hook that owns the four bits of
 * URL-query plumbing that dashboard shells kept hand-writing: read+validate an
 * initial param, write updates via history.replaceState, react to popstate,
 * and (optionally) omit the param when it equals the default.
 *
 * WHO: dashboard tabbed shells (KnowledgeBaseView, SkillAssignmentsView, …)
 * WHAT: [value, setValue] backed by a single query param
 * WHEN: mount (initial read), setValue (write), browser back/forward (popstate)
 * WHERE: dashboard/lib/useUrlQueryState.ts
 * WHY: three views duplicated this and each got the popstate edge case subtly
 *      different; centralizing it kills the drift (docs/IMPROVEMENT_IDEAS.md).
 */
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';
import { useUrlQueryState } from './useUrlQueryState';

function setUrl(search: string) {
  window.history.replaceState({}, '', `/dashboard${search}`);
}

describe('useUrlQueryState', () => {
  beforeEach(() => {
    setUrl('');
  });

  it('reads the initial value from the URL and validates against the allowed set', () => {
    setUrl('?tab=knowledge');
    const { result } = renderHook(() =>
      useUrlQueryState('tab', {
        defaultValue: 'questionnaire',
        valid: ['questionnaire', 'knowledge'],
      })
    );
    expect(result.current[0]).toBe('knowledge');
  });

  it('falls back to the default when the URL value is invalid', () => {
    setUrl('?tab=bogus');
    const { result } = renderHook(() =>
      useUrlQueryState('tab', {
        defaultValue: 'questionnaire',
        valid: ['questionnaire', 'knowledge'],
      })
    );
    expect(result.current[0]).toBe('questionnaire');
  });

  it('falls back to the default when the param is absent', () => {
    const { result } = renderHook(() =>
      useUrlQueryState('tab', {
        defaultValue: 'questionnaire',
        valid: ['questionnaire', 'knowledge'],
      })
    );
    expect(result.current[0]).toBe('questionnaire');
  });

  it('setValue updates the state AND writes the param to the URL (replaceState)', () => {
    const { result } = renderHook(() =>
      useUrlQueryState('tab', {
        defaultValue: 'questionnaire',
        valid: ['questionnaire', 'knowledge'],
      })
    );
    act(() => result.current[1]('knowledge'));
    expect(result.current[0]).toBe('knowledge');
    expect(new URLSearchParams(window.location.search).get('tab')).toBe('knowledge');
  });

  it('omitDefault: the param is REMOVED from the URL when the value returns to the default', () => {
    setUrl('?view=map');
    const { result } = renderHook(() =>
      useUrlQueryState('view', { defaultValue: 'grid', valid: ['grid', 'map'], omitDefault: true })
    );
    expect(result.current[0]).toBe('map');
    act(() => result.current[1]('grid'));
    expect(new URLSearchParams(window.location.search).has('view')).toBe(false);
  });

  it('free-string param (no valid set): stores any value, omitDefault drops it when empty', () => {
    const { result } = renderHook(() =>
      useUrlQueryState<string>('q', { defaultValue: '', omitDefault: true })
    );
    act(() => result.current[1]('hello'));
    expect(new URLSearchParams(window.location.search).get('q')).toBe('hello');
    act(() => result.current[1](''));
    expect(new URLSearchParams(window.location.search).has('q')).toBe(false);
  });

  it('reacts to popstate — a browser back/forward that rewrites the URL updates the value', () => {
    const { result } = renderHook(() =>
      useUrlQueryState('view', { defaultValue: 'grid', valid: ['grid', 'map'], omitDefault: true })
    );
    expect(result.current[0]).toBe('grid');
    act(() => {
      setUrl('?view=map');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(result.current[0]).toBe('map');
    act(() => {
      setUrl('');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(result.current[0]).toBe('grid');
  });

  it('preserves OTHER params when writing its own', () => {
    setUrl('?subtab=skills');
    const { result } = renderHook(() =>
      useUrlQueryState('view', { defaultValue: 'grid', valid: ['grid', 'map'], omitDefault: true })
    );
    act(() => result.current[1]('map'));
    const params = new URLSearchParams(window.location.search);
    expect(params.get('subtab')).toBe('skills');
    expect(params.get('view')).toBe('map');
  });
});
