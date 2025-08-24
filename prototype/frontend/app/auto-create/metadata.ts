import { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Auto-Create Videos with AI',
  description: 'Automatically generate and edit videos using AI. Create professional video content from text prompts, combine clips, add effects, and produce stunning videos in minutes.',
  keywords: [
    'AI video creation',
    'automatic video generation',
    'text to video',
    'AI video editor',
    'video automation',
    'AI content creation',
    'video production tools',
    'automated video editing',
    'AI video generator',
    'smart video creation'
  ],
  openGraph: {
    title: 'Auto-Create Videos with AI - Know Your Moments',
    description: 'Generate professional videos automatically using AI. From text to video in minutes. Smart editing, effects, and production tools.',
    url: '/auto-create',
    type: 'website',
    images: [
      {
        url: '/og-auto-create.png',
        width: 1200,
        height: 630,
        alt: 'AI Video Auto-Creation Tool - Know Your Moments',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'AI Video Auto-Creation - Know Your Moments',
    description: 'Create videos automatically with AI. Text to video in minutes.',
    images: ['/twitter-auto-create.png'],
  },
  alternates: {
    canonical: '/auto-create',
  },
}