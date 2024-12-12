'use client'

import { useState } from 'react'
import SearchBar from '@/components/search/SearchBar'
import SearchSidebar from '@/components/search/SearchSidebar'
import SearchResults from '@/components/search/SearchResults'
import { VideoResult } from '@/types'

// Mock data for demonstration
const MOCK_INDEXES = [
  { id: 'index-1', name: 'Main Video Index' },
  { id: 'index-2', name: 'Training Videos' },
]

const MOCK_RESULTS: VideoResult[] = [
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
  // Add more mock results as needed
]

export default function HomePage() {
  const [searchOptions, setSearchOptions] = useState({
    visualSearch: true,
    audioSearch: true,
    minConfidence: 0.7,
    showConfidenceScores: true,
    selectedIndex: null as string | null,
  })

  const [searchResults, setSearchResults] = useState<VideoResult[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string>('')

  const handleSearch = async (query: string, imageFile?: File) => {
    setIsLoading(true)
    setError('')

    try {
      // Mock API call
      await new Promise(resolve => setTimeout(resolve, 1000))
      setSearchResults(MOCK_RESULTS)
    } catch (err) {
      setError('Failed to perform search. Please try again.')
      console.error('Search failed:', err)
    } finally {
      setIsLoading(false)
    }
  }

  const handleFeedback = async (videoId: string, isHelpful: boolean) => {
    try {
      // TODO: Implement feedback API call
      console.log('Feedback:', { videoId, isHelpful })
    } catch (err) {
      console.error('Failed to submit feedback:', err)
    }
  }

  return (
    <div className="flex min-h-screen bg-gray-50">
      <div className="flex-1 flex flex-col">
        <div className="p-8">
          <SearchBar onSearch={handleSearch} onClear={() => setSearchResults([])} />
        </div>

        {error && (
          <div className="px-8 mb-4">
            <div className="p-4 bg-red-50 text-red-700 rounded-lg">
              {error}
            </div>
          </div>
        )}

        <div className="flex-1 px-8 pb-8">
          {isLoading ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-gray-600">Loading results...</div>
            </div>
          ) : searchResults.length > 0 ? (
            <SearchResults
              results={searchResults}
              showConfidenceScores={searchOptions.showConfidenceScores}
              onFeedback={handleFeedback}
            />
          ) : (
            <div className="flex items-center justify-center h-full">
              <div className="text-gray-600">
                Enter a search query or upload an image to start searching
              </div>
            </div>
          )}
        </div>
      </div>

      <SearchSidebar
        options={searchOptions}
        onOptionsChange={setSearchOptions}
        indexes={MOCK_INDEXES}
      />
    </div>
  )
} 