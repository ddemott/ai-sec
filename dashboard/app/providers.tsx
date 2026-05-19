'use client';

import { SessionProvider } from '@/lib/SessionContext';
import { VocabularyProvider } from '@/lib/VocabularyContext';
import { ThemeProvider } from '@/lib/ThemeContext';
import { ToastContainer } from '@/components/ui/Toast';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <SessionProvider>
        <VocabularyProvider>
          {children}
          <ToastContainer />
        </VocabularyProvider>
      </SessionProvider>
    </ThemeProvider>
  );
}
