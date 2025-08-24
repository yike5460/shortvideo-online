/** @type {import('next').NextConfig} */
const nextConfig = {
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
  // Add security headers for better SEO and security
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'X-DNS-Prefetch-Control',
            value: 'on'
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff'
          },
          {
            key: 'X-Frame-Options',
            value: 'SAMEORIGIN'
          },
          {
            key: 'X-XSS-Protection',
            value: '1; mode=block'
          },
          {
            key: 'Referrer-Policy',
            value: 'origin-when-cross-origin'
          },
        ],
      },
    ]
  },
  // Compress assets for better performance
  compress: true,
  // Enable React strict mode for better error handling
  reactStrictMode: true,
  // Optimize fonts
  optimizeFonts: true,
}

module.exports = nextConfig 