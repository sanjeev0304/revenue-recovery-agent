import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@revenue/core', '@revenue/db'],
  typescript: { ignoreBuildErrors: false },
  eslint: { ignoreDuringBuilds: true },
}

export default nextConfig
