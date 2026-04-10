import { useState, useCallback } from 'react'

interface ConfirmState {
  isOpen: boolean
  title: string
  message: string
  confirmLabel: string
  confirmVariant: 'danger' | 'primary' | 'warning'
  onConfirm: () => void
}

const INITIAL: ConfirmState = {
  isOpen: false,
  title: '',
  message: '',
  confirmLabel: 'Confirm',
  confirmVariant: 'danger',
  onConfirm: () => {},
}

export function useConfirm() {
  const [state, setState] = useState<ConfirmState>(INITIAL)

  const confirm = useCallback((opts: {
    title: string
    message: string
    confirmLabel?: string
    confirmVariant?: 'danger' | 'primary' | 'warning'
    onConfirm: () => void
  }) => {
    setState({
      isOpen: true,
      title: opts.title,
      message: opts.message,
      confirmLabel: opts.confirmLabel ?? 'Confirm',
      confirmVariant: opts.confirmVariant ?? 'danger',
      onConfirm: opts.onConfirm,
    })
  }, [])

  const close = useCallback(() => setState(INITIAL), [])

  return { state, confirm, close }
}
