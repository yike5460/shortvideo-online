'use client'

import { useState, useEffect, useMemo } from 'react'
import { VideoResult } from '@/types'
import VideoGrid from '@/components/VideoGrid'
import VideoSidebar from '@/components/VideoSidebar'
import { useSearchParams } from 'next/navigation'

interface VideoResponse {
  videos: VideoResult[];
  total: number;
  hasMore: boolean;
}

export default function VideosPage() {
  const searchParams = useSearchParams()
  const [videos, setVideos] = useState<VideoResult[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedVideo, setSelectedVideo] = useState<VideoResult | null>(null)

  // Fetch videos on mount
  useEffect(() => {
    const fetchVideos = async () => {
      try {
        setIsLoading(true)
        const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/videos`)
        if (!response.ok) {
          throw new Error('Failed to fetch videos')
        }
        const data: VideoResponse = await response.json()
        setVideos(data.videos || []) // Ensure videos is always an array
      } catch (error) {
        console.error('Error fetching videos:', error)
        setError(error instanceof Error ? error.message : 'Failed to load videos')
      } finally {
        setIsLoading(false)
      }
    }

    fetchVideos()
  }, [])

  // Group videos by status
  const videosByStatus = useMemo(() => {
    if (!videos || !Array.isArray(videos)) return {}
    
    return videos.reduce((acc: { [key: string]: VideoResult[] }, video) => {
      const status = video.status || 'unknown'
      if (!acc[status]) {
        acc[status] = []
      }
      acc[status].push(video)
      return acc
    }, {})
  }, [videos])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-gray-600">Loading videos...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-red-600">{error}</div>
      </div>
    )
  }

  if (!videos.length) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-gray-600">No videos found</div>
      </div>
    )
  }

  return (
    <div className="flex h-full">
      <div className="flex-1 p-8">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900">My Videos</h1>
          <p className="mt-1 text-sm text-gray-500">
            {videos.length} video{videos.length !== 1 ? 's' : ''} in total
          </p>
        </div>

        {/* Status sections */}
        {Object.entries(videosByStatus).map(([status, statusVideos]) => (
          <div key={status} className="mb-12">
            <h2 className="mb-4 text-lg font-semibold text-gray-900 capitalize">
              {status.replace('_', ' ')}
              <span className="ml-2 text-sm text-gray-500">
                ({statusVideos.length})
              </span>
            </h2>
            <VideoGrid
              videos={statusVideos}
              onVideoSelect={setSelectedVideo}
              selectedVideo={selectedVideo}
            />
          </div>
        ))}
      </div>

      {/* Video details sidebar */}
      {selectedVideo && (
        <div className="w-96 border-l border-gray-200 p-6 overflow-y-auto">
          <VideoSidebar video={selectedVideo} />
        </div>
      )}
    </div>
  )
} 