import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Camera access requires a secure context; in development Next serves over
  // http://localhost, which browsers already treat as secure.
  experimental: {
    optimizePackageImports: [],
  },
  /*
   * transformers.js ships a Node runtime (onnxruntime-node, sharp) alongside the
   * browser one. We only ever use the browser build — CLIP runs on the device,
   * and the route handler is text-only — but the bundler will still try to
   * resolve the native halves unless they are marked external. Marking them also
   * keeps their native binaries out of the serverless function.
   */
  serverExternalPackages: ['@huggingface/transformers', 'onnxruntime-node', 'sharp'],
};

export default nextConfig;
