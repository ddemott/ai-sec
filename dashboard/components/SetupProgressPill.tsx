'use client'

import React from 'react'
import { Wand2 } from 'lucide-react'
import { useActiveTenantId } from '../lib/SessionContext'
import { useSetupProgress } from '../lib/useSetupProgress'

/**
 * SetupProgressPill — persistent "Setup: N of 6 done" affordance pinned
 * to OutlookLayout's top utility row until the tenant has finished every
 * wizard step (D4 spec, 2026-05-17).
 *
 * Visibility rules:
 *   - Hidden while there's no active tenant (super-admin on the All-
 *     Businesses grid, or pre-login).
 *   - Hidden while progress is still loading (avoids a flash of
 *     "Setup: 0 of 6 done" before the API calls return).
 *   - Hidden when complete === true (the auto-dismiss requirement).
 *
 * Click behavior: navigates to ?tab=home&wizard=open. DashboardHome
 * detects the `wizard=open` param on mount and force-opens the wizard
 * past the welcome (skip welcome because the user explicitly clicked
 * the pill — they've already committed to setting up).
 */
export function SetupProgressPill() {
  const tenantId = useActiveTenantId()
  const { done, total, complete, loading } = useSetupProgress(tenantId)

  if (!tenantId) return null
  if (loading) return null
  if (complete) return null

  function handleClick() {
    const params = new URLSearchParams(window.location.search)
    // Internal tab id is `dashboard`, not `home` — the label is "Home"
    // in the FolderTab UI but the VALID_TABS list in app/dashboard/page.tsx
    // uses `'dashboard'`. Writing `tab=home` would no-op against the
    // popstate listener's validation, leaving the user on whatever tab
    // they were on with no wizard opened.
    params.set('tab', 'dashboard')
    params.set('wizard', 'open')
    const next = `${window.location.pathname}?${params.toString()}`
    // Use pushState + a popstate dispatch so the dashboard's URL-driven
    // tab state reads the new value without a hard reload (which would
    // re-trigger the auth bootstrap and visibly flash the page).
    window.history.pushState({}, '', next)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }

  // Dot row: solid for completed steps, hollow for pending. Six dots
  // mirror the wizard's chip strip 1:1 so the user reads them as the
  // same six steps from D2.
  const dots = Array.from({ length: total }, (_, i) => i < done)

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={`Setup ${done} of ${total} done. Click to open the setup assistant.`}
      title={`Setup: ${done} of ${total} done — click to continue`}
      className="hidden md:flex items-center gap-2 px-2.5 py-1.5 rounded-md transition-all text-xs font-medium"
      style={{
        backgroundColor: 'var(--accent-muted)',
        color: 'var(--accent-soft)',
        border: '1px solid var(--accent)',
      }}
    >
      <Wand2 className="w-3.5 h-3.5" aria-hidden="true" />
      <span className="flex gap-1" aria-hidden="true">
        {dots.map((filled, i) => (
          <span
            key={i}
            className="inline-block w-1.5 h-1.5 rounded-full"
            style={{
              backgroundColor: filled ? 'var(--accent-soft)' : 'transparent',
              border: filled ? 'none' : '1px solid var(--accent-soft)',
            }}
          />
        ))}
      </span>
      <span className="whitespace-nowrap">Setup: {done} of {total} done</span>
    </button>
  )
}
