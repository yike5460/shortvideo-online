'use client'

import { useState, useEffect, useMemo } from 'react'
import { VideoResult } from '@/types'
import VideoGrid from '@/components/VideoGrid'
import VideoSidebar from '@/components/VideoSidebar'
import { useSearchParams } from 'next/navigation'
import { useAuth } from '@/lib/auth/AuthContext'
import { Dialog } from '@headlessui/react'

// Add API configuration
const API_ENDPOINT = process.env.NEXT_PUBLIC_API_URL

interface VideoResponse {
  videos: VideoResult[];
  total: number;
  hasMore: boolean;
}

interface Index {
  id: string;
  name: string;
  status: 'ready' | 'indexing' | 'error';
  videoCount: number;
}

interface VideoModalProps {
  video: VideoResult | null;
  isOpen: boolean;
  onClose: () => void;
}

function VideoModal({ video, isOpen, onClose }: VideoModalProps) {
  if (!video) return null;

  return (
    <Dialog
      open={isOpen}
      onClose={onClose}
      className="relative z-50"
      as="div"
    >
      <div className="fixed inset-0 bg-black/30" aria-hidden="true" />
      
      <div className="fixed inset-0 flex items-center justify-center p-4">
        <Dialog.Panel className="w-full max-w-4xl bg-white rounded-lg shadow-xl overflow-hidden">
          <div className="p-6">
            <div className="flex justify-between items-center mb-4">
              <Dialog.Title className="text-xl font-medium">
                {video.title || video.description || "Untitled Video"}
              </Dialog.Title>
              <button 
                onClick={onClose}
                className="text-gray-500 hover:text-gray-700"
                type="button"
              >
                <span className="sr-only">Close</span>
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            
            <div className="flex gap-4 mb-4 text-sm text-gray-500">
              <div className="flex items-center gap-1">
                <span>video-id: {video.id?.substring(0, 8) || 'unknown'}...</span>
                <button className="text-gray-400 hover:text-gray-600" type="button">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                </button>
              </div>
              
              <div className="flex items-center gap-1">
                <span>index-id: {video.indexId?.substring(0, 8) || 'none'}...</span>
                <button className="text-gray-400 hover:text-gray-600" type="button">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                </button>
              </div>
            </div>
            
            <div className="relative w-full aspect-video bg-black rounded overflow-hidden">
              <video 
                src={video.videoPreviewUrl} 
                className="w-full h-full object-cover"
                controls
                autoPlay
              >
                Your browser does not support the video tag.
              </video>
            </div>
          </div>
        </Dialog.Panel>
      </div>
    </Dialog>
  );
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
  const [isModalOpen, setIsModalOpen] = useState(false)

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

  // Function to handle video card click - add console log for debugging
  const handleVideoClick = (video: VideoResult) => {
    console.log("Video clicked:", video);
    setSelectedVideo(video);
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setSelectedVideo(null);
  };

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
      
      {/* Status sections, only show videos with status ready */}
      {Object.entries(videosByStatus).map(([status, statusVideos]) => (
        status === 'ready' && (
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
        )
      ))}
      
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {videos.map((video) => (
          <button 
            key={video.id} 
            className="bg-white rounded-lg shadow-md overflow-hidden cursor-pointer transition-all hover:shadow-lg text-left block w-full"
            onClick={() => handleVideoClick(video)}
            type="button"
          >
            <div className="relative aspect-video bg-gray-100">
              {/* Display static thumbnail instead of video */}
              {video.videoPreviewUrl ? (
                <img
                  src={video.videoThumbnailUrl}
                  alt={video.title || video.description || "Video thumbnail"}
                  className="w-full h-full object-cover"
                  loading="lazy"
                />
              ) : (
                <div className="w-full h-full bg-gray-200 flex items-center justify-center">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                </div>
              )}
              
              {/* Play icon overlay - simplified */}
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-16 h-16 bg-black bg-opacity-60 rounded-full flex items-center justify-center">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
              </div>
              
              {/* Duration badge */}
              <div className="absolute bottom-2 right-2 bg-black bg-opacity-70 text-white text-xs px-2 py-1 rounded">
                {video.duration || '00:00'}
              </div>
            </div>
            
            <div className="p-4">
              <h3 className="text-lg font-medium truncate">{video.title || video.description || "Untitled Video"}</h3>
              <p className="text-sm text-gray-500 mt-1">
                Uploaded {new Date(video.uploadDate || Date.now()).toLocaleDateString()}
              </p>
            </div>
          </button>
        ))}
      </div>
      
      {/* Simplified modal rendering */}
      <VideoModal
        video={selectedVideo}
        isOpen={isModalOpen}
        onClose={closeModal}
      />
    </div>
  )
} 