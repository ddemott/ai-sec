'use client';

import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100vh',
          fontFamily: 'system-ui, sans-serif',
          backgroundColor: '#090E1A',
          color: '#E8F0FF',
          gap: '16px',
        }}
      >
        <h2 style={{ margin: 0, fontSize: '20px' }}>Something went wrong</h2>
        <p style={{ margin: 0, color: '#8899CC', fontSize: '14px' }}>
          {error.digest ? `Error ID: ${error.digest}` : 'An unexpected error occurred.'}
        </p>
        <button
          onClick={reset}
          style={{
            padding: '8px 20px',
            backgroundColor: '#2563EB',
            color: '#fff',
            border: 'none',
            borderRadius: '6px',
            cursor: 'pointer',
            fontSize: '14px',
          }}
        >
          Try again
        </button>
      </body>
    </html>
  );
}
