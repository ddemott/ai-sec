'use client'

import { SessionProvider } from '@/lib/SessionContext'

export function Providers({ children }: { children: React.ReactNode }) {
  return <SessionProvider>{children}</SessionProvider>
}
