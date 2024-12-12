/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export', // Static HTML export for Cloudflare Pages
  images: {
    unoptimized: true, // Required for static export
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**.ytimg.com',
      },
      {
        protocol: 'https',
        hostname: '**.cloudfront.net',
      }
    ],
  },
  // Ensure trailing slashes for better compatibility
  trailingSlash: true,
}

module.exports = nextConfig 