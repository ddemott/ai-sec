'use client';

import React, { useEffect, useState } from 'react';

function getRemainingSeconds(): number {
  if (typeof window === 'undefined') return 0;
  const raw = localStorage.getItem('demoExpiresAt');
  if (!raw) return 0;
  const diff = Math.floor((new Date(raw).getTime() - Date.now()) / 1000);
  return Math.max(0, diff);
}

function formatCountdown(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function isDemo(): boolean {
  if (typeof window === 'undefined') return false;
  return !!localStorage.getItem('demoTenantId');
}

export function DemoBanner() {
  const [remaining, setRemaining] = useState<number>(() => getRemainingSeconds());
  const [visible, setVisible] = useState<boolean>(() => isDemo());

  useEffect(() => {
    if (!visible) return;

    const interval = setInterval(() => {
      const secs = getRemainingSeconds();
      setRemaining(secs);
      if (secs <= 0) {
        // Session expired — clear demo state and force re-login.
        localStorage.removeItem('authToken');
        localStorage.removeItem('tenantId');
        localStorage.removeItem('userName');
        localStorage.removeItem('userEmail');
        localStorage.removeItem('userRole');
        localStorage.removeItem('demoExpiresAt');
        localStorage.removeItem('demoTenantId');
        window.location.href = '/';
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [visible]);

  function handleExit() {
    localStorage.removeItem('authToken');
    localStorage.removeItem('tenantId');
    localStorage.removeItem('userName');
    localStorage.removeItem('userEmail');
    localStorage.removeItem('userRole');
    localStorage.removeItem('demoExpiresAt');
    localStorage.removeItem('demoTenantId');
    setVisible(false);
    window.location.href = '/';
  }

  if (!visible) return null;

  const urgent = remaining < 300; // < 5 min

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="demo-banner"
      data-urgent={urgent ? 'true' : 'false'}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        padding: '6px 16px',
        background: urgent ? 'rgba(239,68,68,0.15)' : 'rgba(37,99,235,0.15)',
        borderBottom: `1px solid ${urgent ? 'rgba(239,68,68,0.35)' : 'rgba(37,99,235,0.35)'}`,
        fontSize: 13,
        color: urgent ? '#FCA5A5' : '#93C5FD',
        fontFamily: 'var(--font-dm-sans, sans-serif)',
        flexShrink: 0,
      }}
    >
      <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span
          style={{
            display: 'inline-block',
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: urgent ? '#EF4444' : '#3B82F6',
            flexShrink: 0,
          }}
        />
        <strong>Demo Mode</strong>
        <span style={{ color: urgent ? '#FCA5A5' : '#7A90B8' }}>
          — session expires in{' '}
          <span
            style={{
              fontVariantNumeric: 'tabular-nums',
              fontWeight: 600,
              color: urgent ? '#FCA5A5' : '#93C5FD',
            }}
          >
            {formatCountdown(remaining)}
          </span>
          . Data is isolated to this session and discarded on expiry.
        </span>
      </span>
      <button
        onClick={handleExit}
        style={{
          padding: '3px 12px',
          borderRadius: 6,
          border: `1px solid ${urgent ? 'rgba(239,68,68,0.4)' : 'rgba(37,99,235,0.4)'}`,
          background: 'transparent',
          color: urgent ? '#FCA5A5' : '#93C5FD',
          cursor: 'pointer',
          fontSize: 12,
          fontWeight: 600,
          flexShrink: 0,
          whiteSpace: 'nowrap',
        }}
      >
        Exit demo
      </button>
    </div>
  );
}
