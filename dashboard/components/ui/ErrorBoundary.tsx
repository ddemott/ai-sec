'use client';

import React, { Component, type ReactNode } from 'react';
import { Card } from './Card';
import { Button } from './Button';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('[ErrorBoundary] Caught error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      // Only show raw error text in development. In production the user
      // sees a friendly generic message while the actual error still
      // reaches telemetry via componentDidCatch's console.error.
      const isDev = typeof process !== 'undefined' && process.env?.NODE_ENV !== 'production';
      const friendlyMessage =
        'Something unexpected happened. Your work is safe — try again, or refresh the page if this keeps happening.';

      return (
        <div className="flex items-center justify-center p-8" role="alert">
          <Card className="p-6 max-w-lg w-full">
            <h2 className="font-semibold text-lg mb-2" style={{ color: 'var(--text-primary)' }}>
              Something went wrong
            </h2>
            <p className="text-sm mb-4" style={{ color: 'var(--text-secondary)' }}>
              {friendlyMessage}
            </p>
            {isDev && this.state.error?.message && (
              <pre
                data-testid="error-boundary-dev-details"
                className="text-xs mb-4 p-3 rounded overflow-auto"
                style={{
                  backgroundColor: 'var(--bg-raised)',
                  color: 'var(--text-muted)',
                  maxHeight: '120px',
                }}
              >
                {this.state.error.message}
              </pre>
            )}
            <div className="flex gap-2">
              {/* Retry resets local state — works for transient render errors. */}
              <Button
                variant="primary"
                onClick={() => this.setState({ hasError: false, error: null })}
              >
                Try again
              </Button>
              {/* Reload is the escape hatch for errors that persist in-memory. */}
              <Button
                variant="secondary"
                onClick={() => {
                  if (typeof window !== 'undefined') window.location.reload();
                }}
              >
                Reload page
              </Button>
            </div>
          </Card>
        </div>
      );
    }

    return this.props.children;
  }
}
