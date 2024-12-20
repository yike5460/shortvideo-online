/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  images: {
    unoptimized: true,
  },
  // Ensure all routes are pre-rendered for static export
  trailingSlash: true,
}

module.exports = nextConfig 