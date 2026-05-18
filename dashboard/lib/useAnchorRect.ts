'use client'

import { useEffect, useState, type RefObject } from 'react'

/**
 * Track the bounding rect of a ref'd element, updating on scroll,
 * resize, and any size change (via ResizeObserver). Used to keep
 * floating menus anchored to their trigger across viewport shifts.
 *
 * Before: OutlookLayout's tenant + profile dropdowns called
 * `getBoundingClientRect()` inline in the JSX `style` — the rect
 * was only computed at render time, so any scroll or window resize
 * left the menu floating in a stale position (UX audit 4.2 row 7).
 *
 * After: this hook subscribes to scroll/resize/size-change events
 * while `active` is true and re-publishes a fresh rect on each.
 * The consumer re-renders with the updated position.
 *
 * Passes `null` while `active` is false so menus can use it as a
 * "should I render?" gate too.
 */
export function useAnchorRect(
  ref: RefObject<HTMLElement | null>,
  active: boolean,
): DOMRect | null {
  const [rect, setRect] = useState<DOMRect | null>(null)

  useEffect(() => {
    if (!active || !ref.current) {
      setRect(null)
      return
    }
    const el = ref.current
    const update = () => setRect(el.getBoundingClientRect())
    update()

    // Re-anchor on scroll (capture=true so nested-scroller scrolls
    // also fire) and on viewport resize.
    window.addEventListener('scroll', update, true)
    window.addEventListener('resize', update)
    // Catches size changes that don't fire scroll/resize — e.g.
    // sidebar collapse, font load, dynamic content insertion.
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null
    ro?.observe(el)

    return () => {
      window.removeEventListener('scroll', update, true)
      window.removeEventListener('resize', update)
      ro?.disconnect()
    }
  }, [ref, active])

  return rect
}
