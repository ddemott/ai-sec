'use client'

import { SessionProvider } from '@/lib/SessionContext'
import { VocabularyProvider } from '@/lib/VocabularyContext'
import { ThemeProvider } from '@/lib/ThemeContext'

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <SessionProvider>
        <VocabularyProvider>{children}</VocabularyProvider>
      </SessionProvider>
    </ThemeProvider>
  )
}
