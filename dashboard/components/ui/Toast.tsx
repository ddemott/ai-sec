import React, { useEffect, useState, useCallback } from 'react'
import { Check, X, AlertTriangle, Info } from 'lucide-react'

type ToastType = 'success' | 'error' | 'warning' | 'info'

interface ToastMessage {
  id: number
  message: string
  type: ToastType
}

const MAX_TOASTS = 5
const DURATIONS: Record<ToastType, number> = {
  success: 3000,
  info: 3000,
  warning: 5000,
  error: 5000,
}

let toastId = 0
let addToastFn: ((message: string, type: ToastType) => void) | null = null

/** Call from anywhere to show a toast */
export function showToast(message: string, type: ToastType = 'success') {
  if (addToastFn) addToastFn(message, type)
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

  const addToast = useCallback((message: string, type: ToastType) => {
    const id = ++toastId
    setToasts(prev => {
      const next = [...prev, { id, message, type }]
      return next.length > MAX_TOASTS ? next.slice(-MAX_TOASTS) : next
    })
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id))
    }, DURATIONS[type])
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
            <button
              onClick={() => removeToast(toast.id)}
              className="ml-2 p-0.5 rounded hover:bg-white/20 transition-colors shrink-0"
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
