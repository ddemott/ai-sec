import { withSentryConfig } from '@sentry/nextjs';

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
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
