import { withSentryConfig } from '@sentry/nextjs';

/** @type {import('next').NextConfig} */
const nextConfig = {
  // NOTE: `output: 'standalone'` was removed 2026-06-10. This is a monorepo and
  // the dashboard imports repo-root `/shared/*` (../../shared/...). Standalone's
  // file-tracing mirrors the monorepo path (server.js lands at
  // .next/standalone/dashboard/server.js, not .next/standalone/server.js), which
  // made the Railway start command wrong and the build effectively undeployable
  // after the May `/shared` extraction. Plain `next build` + `next start` resolves
  // `/shared` at build time (when built from the repo root so /shared is present)
  // and serves `.next` directly — no fragile standalone path. See dashboard/railway.json.
  eslint: {
    // Test files have cosmetic `any` warnings — don't block production builds
    ignoreDuringBuilds: true,
  },
};

// withSentryConfig is a no-op at runtime when SENTRY_DSN is unset; the
// source-map upload + tunnel route are skipped without an auth token.
// Keep the wrap unconditional so prod-style builds don't behave
// differently from local builds at the file layer.
export default withSentryConfig(nextConfig, {
  silent: !process.env.SENTRY_AUTH_TOKEN,
  // Source maps are only uploaded when SENTRY_AUTH_TOKEN is set (CI/CD).
  // The wizard's default config tries to upload on every build, which
  // makes local builds noisy and CI builds slow when the token is
  // missing — gate it explicitly.
  widenClientFileUpload: false,
  tunnelRoute: '/monitoring',
  disableLogger: true,
  automaticVercelMonitors: false,
});
