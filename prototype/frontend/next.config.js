/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    unoptimized: true,
  },
  // Ensure all routes are pre-rendered
  trailingSlash: true,
  // Allow external connections for port forwarding
  experimental: {
    appDir: true,
  },
}

module.exports = nextConfig 