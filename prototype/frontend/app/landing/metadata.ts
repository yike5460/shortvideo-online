import { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Get Started - AI Video Search Platform',
  description: 'Join thousands of users revolutionizing video search with AI. Sign up for free and start finding exact moments in your videos using natural language and visual recognition.',
  keywords: [
    'video search signup',
    'AI video platform registration',
    'free video analysis tool',
    'video search demo',
    'multimodal video search',
    'start video indexing',
    'video content discovery platform',
    'AI-powered video tools'
  ],
  openGraph: {
    title: 'Get Started with Know Your Moments - Free AI Video Search',
    description: 'Revolutionary AI-powered video search platform. Start finding exact moments in videos instantly. Free signup, no credit card required.',
    url: '/landing',
    type: 'website',
    images: [
      {
        url: '/og-landing.png',
        width: 1200,
        height: 630,
        alt: 'Know Your Moments - Get Started with AI Video Search',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Start Your AI Video Search Journey - Know Your Moments',
    description: 'Sign up free. Search videos with AI. Find moments instantly.',
    images: ['/twitter-landing.png'],
  },
  alternates: {
    canonical: '/landing',
  },
}