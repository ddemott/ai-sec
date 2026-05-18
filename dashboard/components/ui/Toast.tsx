import React, { useEffect, useState, useCallback } from 'react'
import { Check, X, AlertTriangle, Info } from 'lucide-react'

type ToastType = 'success' | 'error' | 'warning' | 'info'

/**
 * Optional action button on a toast. Used for short-window reversible
 * operations — e.g. an Undo on a soft-cancel. Click runs `onClick`
 * and dismisses the toast immediately. The toast still auto-dismisses
 * after the type's normal duration if the user never clicks.
 */
export interface ToastAction {
  label: string
  onClick: () => void
}

interface ToastMessage {
  id: number
  message: string
  type: ToastType
  action?: ToastAction
}

const MAX_TOASTS = 5
// `null` means "do not auto-dismiss." Error toasts stick around
// until the user explicitly dismisses them (UX audit Heuristics
// 4.2.10, 2026-05-18) — when multiple errors stack, the oldest
// used to silently disappear after 5s, taking real diagnostic
// info with it. Success/warning/info still auto-dismiss because
// their stake in the user's attention is much lower.
const DURATIONS: Record<ToastType, number | null> = {
  success: 3000,
  info: 3000,
  warning: 5000,
  error: null,
}

// Action-bearing toasts (Undo etc.) live longer so the user actually
// has a chance to read + react. Matches the standard 5-second Undo
// window seen in Gmail / Slack / Linear.
const ACTION_TOAST_DURATION = 5000

let toastId = 0
let addToastFn: ((message: string, type: ToastType, action?: ToastAction) => void) | null = null

/**
 * Call from anywhere to show a toast.
 *
 * @param action Optional action button (e.g. Undo). Visible until the
 *   toast auto-dismisses or the user dismisses it. Click runs `onClick`
 *   and removes the toast immediately.
 */
export function showToast(message: string, type: ToastType = 'success', action?: ToastAction) {
  if (addToastFn) addToastFn(message, type, action)
}

const ICONS: Record<ToastType, React.ElementType> = {
  success: Check,
  error: X,
  warning: AlertTriangle,
  info: Info,
}

// Theme-token-driven toast colors. Maps each ToastType to a semantic
// CSS var defined per-theme in globals.css so toasts render correctly
// on every theme (was `bg-green-600 text-white` etc. — solid Tailwind
// classes that didn't respond to theme, just happened to be visible on
// most themes because the bg-{600} hue was strong enough).
function getToastStyle(type: ToastType): React.CSSProperties {
  switch (type) {
    case 'success':
      return { backgroundColor: 'var(--success)', color: '#ffffff' }
    case 'error':
      return { backgroundColor: 'var(--danger)', color: '#ffffff' }
    case 'warning':
      return { backgroundColor: 'var(--warning)', color: '#ffffff' }
    case 'info':
    default:
      return { backgroundColor: 'var(--accent)', color: '#ffffff' }
  }
}

export function ToastContainer() {
  const [toasts, setToasts] = useState<ToastMessage[]>([])

  const removeToast = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  const addToast = useCallback((message: string, type: ToastType, action?: ToastAction) => {
    const id = ++toastId
    setToasts(prev => {
      const next = [...prev, { id, message, type, action }]
      return next.length > MAX_TOASTS ? next.slice(-MAX_TOASTS) : next
    })
    // Compute auto-dismiss ms. Action toasts use ACTION_TOAST_DURATION
    // regardless of type (the user needs time to read + click).
    // Otherwise look up the per-type duration — `null` means
    // "stay until the user dismisses" (errors).
    const dismissAfter = action ? ACTION_TOAST_DURATION : DURATIONS[type]
    if (dismissAfter !== null) {
      setTimeout(() => {
        setToasts(prev => prev.filter(t => t.id !== id))
      }, dismissAfter)
    }
  }, [])

  useEffect(() => {
    addToastFn = addToast
    return () => { addToastFn = null }
  }, [addToast])

  if (toasts.length === 0) return null

  return (
    <div className="fixed bottom-4 right-4 z-[200] flex flex-col gap-2" aria-live="polite" aria-atomic="true" role="status">
      {toasts.map(toast => {
        const Icon = ICONS[toast.type]
        return (
          <div
            key={toast.id}
            role={toast.type === 'error' ? 'alert' : 'status'}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg shadow-lg text-sm font-medium animate-in slide-in-from-bottom-2 fade-in"
            style={getToastStyle(toast.type)}
          >
            <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span className="flex-1">{toast.message}</span>
            {toast.action && (
              <button
                onClick={() => {
                  toast.action!.onClick()
                  removeToast(toast.id)
                }}
                className="ml-1 px-2.5 py-1 rounded font-bold text-xs uppercase tracking-wider bg-white/15 hover:bg-white/30 transition-colors shrink-0"
              >
                {toast.action.label}
              </button>
            )}
            <button
              onClick={() => removeToast(toast.id)}
              className="ml-1 p-0.5 rounded hover:bg-white/20 transition-colors shrink-0"
              aria-label="Dismiss notification"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )
      })}
    </div>
  )
}
