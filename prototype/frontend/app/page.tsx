'use client'

import { useState } from 'react'
import { MagnifyingGlassIcon } from '@heroicons/react/24/outline'
import { Switch } from '@headlessui/react'
import VideoGrid from '@/components/VideoGrid'
import VideoSidebar from '@/components/VideoSidebar'
import { VideoSource, VideoResult } from '@/types'

// Mock data for demonstration
const MOCK_VIDEOS: VideoResult[] = [
  {
    id: '1',
    title: 'Introduction to Machine Learning',
    description: 'A comprehensive guide to machine learning fundamentals, covering basic concepts and practical applications.',
    thumbnailUrl: 'https://i.ytimg.com/vi/ABC123/maxresdefault.jpg',
    previewUrl: 'https://www.youtube.com/watch?v=ABC123',
    duration: 3600,
    source: 'youtube',
    sourceUrl: 'https://www.youtube.com/watch?v=ABC123',
    uploadDate: '2024-01-15',
    format: 'MP4',
    resolution: '1920x1080',
    fileSize: '1.2 GB',
    segments: [
      {
        startTime: 120,
        endTime: 180,
        text: 'Explanation of supervised learning algorithms',
        confidence: 0.95,
      },
      {
        startTime: 360,
        endTime: 420,
        text: 'Deep dive into neural networks architecture',
        confidence: 0.88,
      },
    ],
  },
  {
    id: '2',
    title: 'Data Structures and Algorithms',
    description: 'Learn about essential data structures and algorithms with practical examples in Python.',
    thumbnailUrl: 'https://i.ytimg.com/vi/XYZ789/maxresdefault.jpg',
    previewUrl: 'https://www.youtube.com/watch?v=XYZ789',
    duration: 2700, // 45 minutes
    source: 's3',
    sourceUrl: 'https://www.youtube.com/watch?v=XYZ789',
    uploadDate: '2024-01-20',
    format: 'MP4',
    resolution: '2560x1440',
    fileSize: '850 MB',
    segments: [
      {
        startTime: 300,
        endTime: 360,
        text: 'Implementation of binary search trees',
        confidence: 0.92,
      },
      {
        startTime: 900,
        endTime: 960,
        text: 'Advanced graph algorithms discussion',
        confidence: 0.85,
      },
    ],
  },
  {
    id: '3',
    title: 'Web Development Best Practices',
    description: 'Modern web development techniques and best practices for building scalable applications.',
    thumbnailUrl: 'https://i.ytimg.com/vi/DEF456/maxresdefault.jpg',
    previewUrl: 'https://www.youtube.com/watch?v=DEF456',
    duration: 1800, // 30 minutes
    source: 'youtube',
    sourceUrl: 'https://www.youtube.com/watch?v=DEF456',
    uploadDate: '2024-01-25',
    format: 'MP4',
    resolution: '1920x1080',
    fileSize: '500 MB',
    segments: [
      {
        startTime: 240,
        endTime: 300,
        text: 'Frontend performance optimization techniques',
        confidence: 0.89,
      },
      {
        startTime: 720,
        endTime: 780,
        text: 'Security best practices for web applications',
        confidence: 0.94,
      },
    ],
  },
]

export default function Home() {
  const [query, setQuery] = useState('')
  const [selectedSources, setSelectedSources] = useState<VideoSource[]>([])
  const [searchResults, setSearchResults] = useState<VideoResult[]>([])
  const [selectedVideo, setSelectedVideo] = useState<VideoResult | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isDemoMode, setIsDemoMode] = useState(false)

  const sources: VideoSource[] = [
    { id: 'youtube', label: 'YouTube' },
    { id: 's3', label: 'Amazon S3' },
  ]

  const handleMockSearch = async () => {
    // Simulate API call delay
    await new Promise(resolve => setTimeout(resolve, 1000))

    // Mock search logic
    const filteredVideos = MOCK_VIDEOS.filter(video => {
      // Filter by selected sources
      if (selectedSources.length > 0 && !selectedSources.some(s => s.id === video.source)) {
        return false
      }
      
      // Filter by search query
      if (query) {
        const searchLower = query.toLowerCase()
        return (
          video.title.toLowerCase().includes(searchLower) ||
          video.description.toLowerCase().includes(searchLower) ||
          video.segments.some(segment => segment.text.toLowerCase().includes(searchLower))
        )
      }
      
      return true
    })

    // Sort by relevance (mock implementation)
    const sortedVideos = filteredVideos.sort((a, b) => {
      const aRelevance = a.segments.reduce((acc, segment) => 
        acc + (segment.text.toLowerCase().includes(query.toLowerCase()) ? segment.confidence : 0), 0)
      const bRelevance = b.segments.reduce((acc, segment) => 
        acc + (segment.text.toLowerCase().includes(query.toLowerCase()) ? segment.confidence : 0), 0)
      return bRelevance - aRelevance
    })

    return sortedVideos
  }

  const handleApiSearch = async () => {
    const response = await fetch('/api/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query,
        sources: selectedSources.map(s => s.id),
      }),
    })

    if (!response.ok) {
      throw new Error('Search request failed')
    }

    const data = await response.json()
    return data.results
  }

  const handleSearch = async () => {
    try {
      setIsLoading(true)
      
      const results = isDemoMode 
        ? await handleMockSearch()
        : await handleApiSearch()

      setSearchResults(results)
    } catch (error) {
      console.error('Search failed:', error)
      setSearchResults([])
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Demo Mode Switch */}
        <div className="flex justify-end mb-8">
          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-600">Demonstration Mode</span>
            <Switch
              checked={isDemoMode}
              onChange={setIsDemoMode}
              className={`${
                isDemoMode ? 'bg-primary-600' : 'bg-gray-200'
              } relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2`}
            >
              <span
                className={`${
                  isDemoMode ? 'translate-x-6' : 'translate-x-1'
                } inline-block h-4 w-4 transform rounded-full bg-white transition-transform`}
              />
            </Switch>
          </div>
        </div>

        <div className="space-y-8">
          {/* Search Section */}
          <div className="space-y-4">
            <div className="flex gap-4">
              <div className="flex-1">
                <div className="relative">
                  <input
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search for video content..."
                    className="w-full pl-4 pr-10 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        handleSearch()
                      }
                    }}
                  />
                  <button
                    onClick={handleSearch}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-gray-400 hover:text-gray-600"
                  >
                    <MagnifyingGlassIcon className="h-5 w-5" />
                  </button>
                </div>
              </div>
              <button
                onClick={handleSearch}
                disabled={isLoading}
                className={`px-6 py-3 bg-primary-600 text-white rounded-lg hover:bg-primary-700 focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:opacity-50 disabled:cursor-not-allowed ${
                  isLoading ? 'animate-pulse' : ''
                }`}
              >
                {isLoading ? 'Searching...' : 'Search'}
              </button>
            </div>

            {/* Source Selection */}
            <div className="flex gap-4 flex-wrap">
              {sources.map((source) => (
                <label key={source.id} className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    checked={selectedSources.some(s => s.id === source.id)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedSources([...selectedSources, source])
                      } else {
                        setSelectedSources(selectedSources.filter((s) => s.id !== source.id))
                      }
                    }}
                    className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                  />
                  <span className="text-sm text-gray-700">{source.label}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Results Section */}
          <div className="flex gap-6">
            <div className={`flex-1 transition-all duration-200 ${selectedVideo ? 'w-2/3' : 'w-full'}`}>
              {searchResults.length > 0 ? (
                <VideoGrid
                  videos={searchResults}
                  onVideoSelect={setSelectedVideo}
                  selectedVideo={selectedVideo}
                />
              ) : query && !isLoading ? (
                <div className="text-center py-12 text-gray-500">
                  No videos found matching your search criteria
                </div>
              ) : null}
            </div>
            {selectedVideo && (
              <div className="w-1/3">
                <VideoSidebar video={selectedVideo} />
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  )
} 