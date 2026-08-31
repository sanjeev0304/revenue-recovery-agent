import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  reactStrictMode: true,
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
