import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Camera access requires a secure context; in development Next serves over
  // http://localhost, which browsers already treat as secure.
  experimental: {
    optimizePackageImports: [],
  },
};

export default nextConfig;
