import { Metadata } from 'next'

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || 'https://knowyourmoments.com'),
  title: {
    default: 'Know Your Moments - AI-Powered Video Search & Analysis Platform',
    template: '%s | Know Your Moments'
  },
  description: 'Revolutionary AI-powered video search platform. Find exact moments in videos using natural language, visual recognition, and multimodal search. Analyze, tag, and discover video content instantly.',
  keywords: [
    'video search',
    'AI video analysis',
    'multimodal search',
    'video content discovery',
    'natural language video search',
    'visual recognition',
    'video tagging',
    'video indexing',
    'machine learning video',
    'deep learning video analysis',
    'video moments search',
    'brand detection in videos',
    'video content management',
    'video AI platform',
    'intelligent video search'
  ],
  authors: [{ name: 'Know Your Moments Team' }],
  creator: 'Know Your Moments',
  publisher: 'Know Your Moments',
  formatDetection: {
    email: false,
    address: false,
    telephone: false,
  },
  openGraph: {
    title: 'Know Your Moments - AI-Powered Video Search Platform',
    description: 'Search and analyze video content with cutting-edge AI. Find exactly what you\'re looking for using natural language queries and advanced visual recognition.',
    url: '/',
    siteName: 'Know Your Moments',
    locale: 'en_US',
    type: 'website',
    images: [
      {
        url: '/og-image.png',
        width: 1200,
        height: 630,
        alt: 'Know Your Moments - AI Video Search Platform',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Know Your Moments - AI-Powered Video Search',
    description: 'Revolutionary video search using AI. Find exact moments instantly.',
    creator: '@knowyourmoments',
    images: ['/twitter-image.png'],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
  alternates: {
    canonical: '/',
  },
  category: 'technology',
} 