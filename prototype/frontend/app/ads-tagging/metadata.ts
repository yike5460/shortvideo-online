import { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'AI Video Ads Tagging & Analysis',
  description: 'Advanced AI-powered video advertisement tagging and analysis. Detect brands, products, emotions, and scenes. Generate intelligent tags for video advertising content.',
  keywords: [
    'video ads tagging',
    'AI advertisement analysis',
    'brand detection in videos',
    'product placement detection',
    'video ad analytics',
    'emotion analysis in ads',
    'scene detection',
    'video content tagging',
    'ad performance analysis',
    'video marketing analytics',
    'AI video advertising',
    'automated video tagging'
  ],
  openGraph: {
    title: 'AI Video Ads Tagging & Analysis - Know Your Moments',
    description: 'Automatically tag and analyze video advertisements with AI. Detect brands, emotions, scenes, and generate intelligent insights for your video content.',
    url: '/ads-tagging',
    type: 'website',
    images: [
      {
        url: '/og-ads-tagging.png',
        width: 1200,
        height: 630,
        alt: 'AI Video Ads Tagging Tool - Know Your Moments',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'AI Video Ads Tagging - Know Your Moments',
    description: 'Tag and analyze video ads with AI. Detect brands, emotions, and scenes instantly.',
    images: ['/twitter-ads-tagging.png'],
  },
  alternates: {
    canonical: '/ads-tagging',
  },
}