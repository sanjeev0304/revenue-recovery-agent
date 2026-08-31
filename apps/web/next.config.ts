import { join } from 'node:path'
import type { NextConfig } from 'next'

const monorepoRoot = join(import.meta.dirname, '..', '..')

const nextConfig: NextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: monorepoRoot,
  outputFileTracingIncludes: {
    '/metrics': ['../../docs/results.json'],
  },
  transpilePackages: ['@revenue/core', '@revenue/db'],
  typescript: { ignoreBuildErrors: false },
  eslint: { ignoreDuringBuilds: true },
  webpack: (config) => {
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      '.js': ['.ts', '.tsx', '.js'],
    }
    return config
  },
}

export default nextConfig
