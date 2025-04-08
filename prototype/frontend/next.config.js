/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    unoptimized: true,
  },
  // Ensure all routes are pre-rendered
  trailingSlash: true,
}

module.exports = nextConfig 