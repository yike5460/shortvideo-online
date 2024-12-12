'use client'

import { useState } from 'react'
import { Tab } from '@headlessui/react'
import { cn } from '@/lib/utils'
import { VideoResult } from '@/types'

// Mock data for demonstration
const MOCK_VIDEOS: VideoResult[] = [
  {
    id: '1',
    title: 'Introduction to Machine Learning',
    description: 'A comprehensive guide to machine learning fundamentals.',
    thumbnailUrl: 'https://i.ytimg.com/vi/ABC123/maxresdefault.jpg',
    previewUrl: 'https://www.youtube.com/watch?v=ABC123',
    duration: 3600,
    source: 'youtube',
    sourceUrl: 'https://www.youtube.com/watch?v=ABC123',
    uploadDate: '2024-01-15',
    format: 'MP4',
    resolution: '1920x1080',
    fileSize: '1.2 GB',
    segments: [],
  },
  // ... more mock videos
]

export default function VideosPage() {
  const [videos] = useState<VideoResult[]>(MOCK_VIDEOS)

  return (
    <main className="min-h-screen bg-gray-50 py-12">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900">My Videos</h1>
          <p className="mt-2 text-sm text-gray-600">
            View and manage your indexed videos
          </p>
        </div>

        {/* Tabs */}
        <Tab.Group>
          <Tab.List className="flex space-x-1 rounded-lg bg-white p-1 shadow-sm">
            <Tab
              className={({ selected }) =>
                cn(
                  'w-full rounded-lg py-2.5 text-sm font-medium leading-5',
                  'ring-white ring-opacity-60 ring-offset-2 focus:outline-none',
                  selected
                    ? 'bg-primary-600 text-white shadow'
                    : 'text-gray-600 hover:bg-gray-100'
                )
              }
            >
              My Videos
            </Tab>
            <Tab
              className={({ selected }) =>
                cn(
                  'w-full rounded-lg py-2.5 text-sm font-medium leading-5',
                  'ring-white ring-opacity-60 ring-offset-2 focus:outline-none',
                  selected
                    ? 'bg-primary-600 text-white shadow'
                    : 'text-gray-600 hover:bg-gray-100'
                )
              }
            >
              Sample Videos
            </Tab>
          </Tab.List>

          <Tab.Panels className="mt-8">
            <Tab.Panel>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {videos.map((video) => (
                  <div
                    key={video.id}
                    className="bg-white rounded-lg shadow-sm overflow-hidden"
                  >
                    <div className="aspect-video relative">
                      <img
                        src={video.thumbnailUrl}
                        alt={video.title}
                        className="w-full h-full object-cover"
                      />
                    </div>
                    <div className="p-4">
                      <h3 className="text-lg font-semibold text-gray-900 line-clamp-1">
                        {video.title}
                      </h3>
                      <p className="mt-1 text-sm text-gray-500 line-clamp-2">
                        {video.description}
                      </p>
                      <div className="mt-4 flex items-center justify-between">
                        <span className="text-sm text-gray-600">
                          {new Date(video.uploadDate).toLocaleDateString()}
                        </span>
                        <span className="text-sm text-gray-600">
                          {Math.floor(video.duration / 60)}:{String(video.duration % 60).padStart(2, '0')}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </Tab.Panel>

            <Tab.Panel>
              <div className="text-center py-12">
                <p className="text-gray-500">Sample videos coming soon</p>
              </div>
            </Tab.Panel>
          </Tab.Panels>
        </Tab.Group>
      </div>
    </main>
  )
} 