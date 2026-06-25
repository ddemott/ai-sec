'use client';

/**
 * Tiny build-stamp in the bottom-right corner so you can see at a glance WHICH
 * deploy is live ("is my fix actually out?"). Values are baked at build time in
 * next.config.mjs (NEXT_PUBLIC_BUILD_SHA from Railway's commit SHA, NEXT_PUBLIC_
 * BUILD_TIME at build). Subtle by default; hover for the full timestamp.
 *
 * IMPORTANT: render deterministically — NO toLocaleString()/new Date()
 * formatting. Those produce different output on the server (UTC) vs the browser
 * (user locale/timezone), which causes a React hydration mismatch (errors
 * #418/#423/#425). The baked NEXT_PUBLIC_BUILD_TIME is an ISO string; we only
 * slice it, so server and client render identical text.
 */
export function VersionBadge() {
  const version = process.env.NEXT_PUBLIC_APP_VERSION || '0.0.0';
  const sha = process.env.NEXT_PUBLIC_BUILD_SHA || 'dev';
  const buildTime = process.env.NEXT_PUBLIC_BUILD_TIME || '';

  // "2026-06-25T00:15:42.123Z" → "2026-06-25 00:15" (UTC, pure string slice).
  const shortTime = buildTime ? buildTime.slice(0, 16).replace('T', ' ') : '';
  const label = `v${version} · ${sha}${shortTime ? ` · ${shortTime}Z` : ''}`;

  return (
    <div
      title={`Build ${sha} — ${buildTime || 'unknown time'}`}
      className="fixed bottom-1 right-2 z-50 select-none text-[10px] leading-none text-gray-500/50 transition-colors hover:text-gray-400/90"
      data-testid="version-badge"
    >
      {label}
    </div>
  );
}
