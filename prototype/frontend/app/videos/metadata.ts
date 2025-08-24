import { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Video Library & Management',
  description: 'Browse, manage, and organize your video library. Access indexed videos, view analytics, search through your collection, and manage video content efficiently.',
  keywords: [
    'video library',
    'video management',
    'video collection',
    'video browser',
    'video organization',
    'video catalog',
    'media library',
    'video database',
    'content management',
    'video storage',
    'video indexing',
    'video search library'
  ],
  openGraph: {
    title: 'Video Library & Management - Know Your Moments',
    description: 'Efficiently manage and browse your video collection. Search, organize, and analyze your entire video library in one place.',
    url: '/videos',
    type: 'website',
    images: [
      {
        url: '/og-videos.png',
        width: 1200,
        height: 630,
        alt: 'Video Library Management - Know Your Moments',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Video Library - Know Your Moments',
    description: 'Manage your video collection efficiently. Search, organize, and analyze.',
    images: ['/twitter-videos.png'],
  },
  alternates: {
    canonical: '/videos',
  },
}