import type { NextConfig } from 'next';
import path from 'path';

const nextConfig: NextConfig = {
  // Static export — generates plain HTML/JS/CSS in Dashboard/out/
  // Served by NestJS via @fastify/static (single process, single port)
  output: 'export',
  trailingSlash: true,
  images: { unoptimized: true },

  // Point to monorepo root so Next.js doesn't warn about multiple lockfiles
  outputFileTracingRoot: path.join(__dirname, '../'),
};

export default nextConfig;
