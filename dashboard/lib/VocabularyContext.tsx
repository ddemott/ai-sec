'use client'

import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react'
import { Api } from './api'
import { useSessionContext } from './SessionContext'

export interface Vocabulary {
  resource_label: string
  resource_plural: string
  employee_label: string
  employee_plural: string
  booking_label: string
}

const DEFAULTS: Vocabulary = {
  resource_label: 'Resource',
  resource_plural: 'Resources',
  employee_label: 'Employee',
  employee_plural: 'Employees',
  booking_label: 'Appointment',
}

const VocabularyContext = createContext<Vocabulary>(DEFAULTS)

export function VocabularyProvider({ children }: { children: ReactNode }) {
  const { managedTenantId } = useSessionContext()
  const [vocab, setVocab] = useState<Vocabulary>(DEFAULTS)

  useEffect(() => {
    if (!managedTenantId) {
      setVocab(DEFAULTS)
      return
    }

    let cancelled = false
    Api.vocabulary.get(managedTenantId).then((data) => {
      if (!cancelled && data) {
        setVocab({
          resource_label: data.resource_label || DEFAULTS.resource_label,
          resource_plural: data.resource_plural || DEFAULTS.resource_plural,
          employee_label: data.employee_label || DEFAULTS.employee_label,
          employee_plural: data.employee_plural || DEFAULTS.employee_plural,
          booking_label: data.booking_label || DEFAULTS.booking_label,
        })
      }
    }).catch(() => {
      // Fall back to defaults on error
      if (!cancelled) setVocab(DEFAULTS)
    })

    return () => { cancelled = true }
  }, [managedTenantId])

  return (
    <VocabularyContext.Provider value={vocab}>
      {children}
    </VocabularyContext.Provider>
  )
}

export function useVocabulary(): Vocabulary {
  return useContext(VocabularyContext)
}
