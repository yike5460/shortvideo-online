/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  images: {
    unoptimized: true,
    formats: ['image/avif', 'image/webp'],
    domains: ['knowyourmoments.com', 'i.ytimg.com', 'example.com'],
  },
  // Ensure all routes are pre-rendered
  trailingSlash: true,
  // Allow external connections for port forwarding
  experimental: {
    appDir: true,
  },
  // Security headers configured in Cloudflare Pages _headers file
  // Compress assets for better performance
  compress: true,
  // Enable React strict mode for better error handling
  reactStrictMode: true,
  // Optimize fonts
  optimizeFonts: true,
}

module.exports = nextConfig 