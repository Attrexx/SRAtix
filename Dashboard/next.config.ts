import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Proxy API calls to the NestJS server during local development.
  // In production, NestJS reverse-proxies the Dashboard, so both
  // share the same origin — no rewrites needed.
  async rewrites() {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL;
    if (!apiUrl) return [];          // production — same origin
    return [
      {
        source: '/api/:path*',
        destination: `${apiUrl}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
