/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  eslint: {
    // Test files have cosmetic `any` warnings — don't block production builds
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
