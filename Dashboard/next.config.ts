import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Static export — generates plain HTML/JS/CSS in Dashboard/out/
  // Served by NestJS via @fastify/static (single process, single port)
  output: 'export',
  trailingSlash: true,
  images: { unoptimized: true },
};

export default nextConfig;
