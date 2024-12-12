'use client'

import { useState, useMemo } from 'react'
import { Tab } from '@headlessui/react'
import { cn } from '@/lib/utils'
import { VideoResult, Index } from '@/types'

// Mock data for demonstration
const MOCK_INDEXES: Index[] = [
  { 
    id: 'index-1', 
    name: 'Main Video Index',
    status: 'ready',
    videoCount: 2,
    createdAt: '2024-01-15',
  },
  { 
    id: 'index-2', 
    name: 'Training Videos',
    status: 'ready',
    videoCount: 1,
    createdAt: '2024-01-20',
  },
]

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
    indexId: 'index-1',
    segments: [],
  },
  {
    id: '2',
    title: 'Deep Learning Fundamentals',
    description: 'Understanding the basics of neural networks.',
    thumbnailUrl: 'https://i.ytimg.com/vi/DEF456/maxresdefault.jpg',
    previewUrl: 'https://www.youtube.com/watch?v=DEF456',
    duration: 2700,
    source: 'youtube',
    sourceUrl: 'https://www.youtube.com/watch?v=DEF456',
    uploadDate: '2024-01-16',
    format: 'MP4',
    resolution: '1920x1080',
    fileSize: '1.0 GB',
    indexId: 'index-1',
    segments: [],
  },
  {
    id: '3',
    title: 'Advanced Neural Networks',
    description: 'Deep dive into advanced neural network architectures.',
    thumbnailUrl: 'https://i.ytimg.com/vi/GHI789/maxresdefault.jpg',
    previewUrl: 'https://www.youtube.com/watch?v=GHI789',
    duration: 3300,
    source: 'youtube',
    sourceUrl: 'https://www.youtube.com/watch?v=GHI789',
    uploadDate: '2024-01-20',
    format: 'MP4',
    resolution: '1920x1080',
    fileSize: '1.5 GB',
    indexId: 'index-2',
    segments: [],
  },
]

export default function VideosPage() {
  const [selectedIndex, setSelectedIndex] = useState<string | null>(null)
  const [videos] = useState<VideoResult[]>(MOCK_VIDEOS)

  const videosByIndex = useMemo(() => {
    return videos.reduce((acc, video) => {
      if (!acc[video.indexId]) {
        acc[video.indexId] = []
      }
      acc[video.indexId].push(video)
      return acc
    }, {} as Record<string, VideoResult[]>)
  }, [videos])

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

        {/* Index Selection */}
        <div className="mb-8">
          <label htmlFor="index-select" className="block text-sm font-medium text-gray-700 mb-2">
            Select Index
          </label>
          <select
            id="index-select"
            value={selectedIndex || ''}
            onChange={(e) => setSelectedIndex(e.target.value || null)}
            className="w-full md:w-64 border border-gray-300 rounded-lg p-2 focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
          >
            <option value="">All Indexes</option>
            {MOCK_INDEXES.map((index) => (
              <option key={index.id} value={index.id}>
                {index.name} ({videosByIndex[index.id]?.length || 0} videos)
              </option>
            ))}
          </select>
        </div>

        {/* Video Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {videos
            .filter(video => !selectedIndex || video.indexId === selectedIndex)
            .map((video) => (
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
                  <div className="absolute top-2 right-2 px-2 py-1 bg-black/50 rounded text-white text-xs">
                    {MOCK_INDEXES.find(index => index.id === video.indexId)?.name}
                  </div>
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

        {videos.filter(video => !selectedIndex || video.indexId === selectedIndex).length === 0 && (
          <div className="text-center py-12">
            <p className="text-gray-500">
              {selectedIndex 
                ? 'No videos found in this index'
                : 'No videos found'}
            </p>
          </div>
        )}
      </div>
    </main>
  )
} 