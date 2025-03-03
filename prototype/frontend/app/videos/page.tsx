'use client'

import { useState, useEffect, useMemo } from 'react'
import { VideoResult } from '@/types'
import VideoGrid from '@/components/VideoGrid'
import VideoSidebar from '@/components/VideoSidebar'
import { useSearchParams } from 'next/navigation'
import { useAuth } from '@/lib/auth/AuthContext'

interface VideoResponse {
  videos: VideoResult[];
  total: number;
  hasMore: boolean;
}

// Add API configuration
const API_ENDPOINT = process.env.NEXT_PUBLIC_API_URL
// Add Index interface similar to the one in page.tsx
interface Index {
  id: string;
  name: string;
  status: 'ready' | 'indexing' | 'error';
  videoCount: number;
}

export default function VideosPage() {
  const { state } = useAuth()
  const searchParams = useSearchParams()
  const [videos, setVideos] = useState<VideoResult[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedVideo, setSelectedVideo] = useState<VideoResult | null>(null)
  const [indexes, setIndexes] = useState<Index[]>([])
  const [selectedIndexId, setSelectedIndexId] = useState<string | null>(null)
  const [isLoadingIndexes, setIsLoadingIndexes] = useState(false)

  // Fetch videos on mount
  useEffect(() => {
    const fetchVideos = async () => {
      try {
        setIsLoading(true)
        const response = await fetch(`${API_ENDPOINT}/videos`)
        
        // Only throw for actual HTTP errors, not for empty results
        if (!response.ok) {
          if (response.status === 404) {
            // 404 could mean "no videos found" in some API designs - treat as empty array
            setVideos([])
            return
          }
          throw new Error(`Failed to fetch videos: ${response.statusText}`)
        }
        
        const data: VideoResponse = await response.json()
        
        // Even if we get a successful response, videos might be null or undefined
        setVideos(data.videos || []) 
      } catch (error) {
        console.error('Error fetching videos:', error)
        setError(error instanceof Error ? error.message : 'Failed to load videos')
      } finally {
        setIsLoading(false)
      }
    }

    fetchVideos()
  }, [])

  // Fetch indexes from backend - similar to implementation in page.tsx
  useEffect(() => {
    const fetchIndexes = async () => {
      if (!state.session) return;
      
      setIsLoadingIndexes(true);
      try {
        const response = await fetch(`${API_ENDPOINT}/indexes`, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${state.session.token}`
          }
        });
        
        if (!response.ok) {
          throw new Error(`Failed to fetch indexes: ${response.statusText}`);
        }
        
        const data = await response.json();
        
        // [
        //   {
        //       "updated_at": "2025-02-27T13:10:49.561Z",
        //       "indexId": "66778899",
        //       "videoId": "536c20ca-a866-49a2-97d1-a1d91e68874f",
        //       "video_status": "uploaded",
        //       "videoCount": 9363
        //   },
        //   {
        //       "updated_at": "2025-02-27T13:35:30.622Z",
        //       "indexId": "1122334455",
        //       "videoId": "5c4a6985-61d1-4a0a-afc0-1222cfafdef0",
        //       "video_status": "uploaded",
        //       "videoCount": 9363
        //   }
        // ]
        
        const formattedIndexes = data.map((item: any) => ({
          id: item.indexId,
          name: item.indexId,
          status: item.video_status === 'error' ? 'error' : 'ready',
          videoCount: item.videoCount || 0
        }));
        
        setIndexes(formattedIndexes);
        // Set first index as default selected if available and none selected
        if (formattedIndexes.length > 0 && !selectedIndexId) {
          setSelectedIndexId(formattedIndexes[0].id);
        }
      } catch (error) {
        console.error('Error fetching indexes:', error);
      } finally {
        setIsLoadingIndexes(false);
      }
    };

    fetchIndexes();
  }, [state.session, selectedIndexId]);

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
        <div className="text-gray-600">
          No videos found. <a href="/create" className="text-blue-600 hover:underline">Upload your first video</a>
        </div>
      </div>
    )
  }

  return (
    <div className="container mx-auto p-4">
      <h1 className="text-2xl font-bold mb-6">My Videos</h1>
      
      {/* Index Selection Dropdown */}
      <div className="mb-6">
        <label htmlFor="index-select" className="block text-sm font-medium text-gray-700 mb-1">
          Select Index
        </label>
        <select
          id="index-select"
          className="w-full md:w-64 px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
          value={selectedIndexId || ''}
          onChange={(e) => setSelectedIndexId(e.target.value || null)}
          disabled={isLoadingIndexes}
        >
          {indexes.map((index) => (
            <option key={index.id} value={index.id}>
              {index.name}
            </option>
          ))}
          {indexes.length === 0 && (
            <option value="" disabled>
              {isLoadingIndexes ? 'Loading indexes...' : 'No indexes available'}
            </option>
          )}
        </select>
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
  )
} 