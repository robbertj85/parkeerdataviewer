import type { NextConfig } from "next";

// Served under a path prefix behind the reverse proxy (see deploy/), e.g.
// NEXT_PUBLIC_BASE_PATH=/parkeerdataviewer. Empty for local dev.
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || undefined;

const nextConfig: NextConfig = {
  basePath,
  // Self-contained server bundle for the Docker image (deploy/Dockerfile.web).
  output: "standalone",
  // In production nginx serves /data from the worker's volume, not Next; the
  // /data headers below only apply to local dev.

  async headers() {
    const securityHeaders = [
      { key: 'X-DNS-Prefetch-Control', value: 'on' },
      { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'X-XSS-Protection', value: '1; mode=block' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(self)' },
    ];

    return [
      {
        source: '/:path*',
        headers: securityHeaders,
      },
      {
        source: '/data/:path*.geojson',
        headers: [
          { key: 'Content-Type', value: 'application/geo+json' },
          { key: 'Cache-Control', value: 'public, max-age=300' },
        ],
      },
      {
        source: '/data/:path*.json',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=300' },
        ],
      },
      {
        source: '/api/v1/:path*',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: '*' },
          { key: 'Access-Control-Allow-Methods', value: 'GET, OPTIONS' },
        ],
      },
    ];
  },
};

export default nextConfig;
