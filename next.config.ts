import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  experimental: {
    // Authenticated reads must stay fresh during development, including HMR.
    serverComponentsHmrCache: false,
  },
};

export default nextConfig;
