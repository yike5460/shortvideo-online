'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth/AuthContext'
import SearchBar from '@/components/search/SearchBar'
import SearchSidebar from '@/components/search/SearchSidebar'
import SearchResults from '@/components/search/SearchResults'
import FeedbackBar from '@/components/search/FeedbackBar'
import { VideoResult, SearchOptions, Index } from '@/types'
import { cn } from '@/lib/utils'

// Mock data for demonstration
const MOCK_INDEXES: Index[] = [
  { 
    id: 'index-1', 
    name: 'Main Video Index',
    status: 'ready',
    videoCount: 1
  },
  { 
    id: 'index-2', 
    name: 'Training Videos',
    status: 'ready',
    videoCount: 1
  },
]

// Extended mock data with indexId
const ALL_MOCK_RESULTS: VideoResult[] = [
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
    title: 'Advanced Deep Learning Techniques',
    description: 'Exploring advanced concepts in deep learning.',
    thumbnailUrl: 'https://i.ytimg.com/vi/DEF456/maxresdefault.jpg',
    previewUrl: 'https://www.youtube.com/watch?v=DEF456',
    duration: 2700,
    source: 'youtube',
    sourceUrl: 'https://www.youtube.com/watch?v=DEF456',
    uploadDate: '2024-01-20',
    format: 'MP4',
    resolution: '1920x1080',
    fileSize: '1.0 GB',
    indexId: 'index-2',
    segments: [
      {
        startTime: 180,
        endTime: 240,
        text: 'Advanced neural network architectures',
        confidence: 0.92,
      },
      {
        startTime: 420,
        endTime: 480,
        text: 'Training optimization techniques',
        confidence: 0.89,
      },
    ],
  },
]

const initialSearchOptions: SearchOptions = {
  visualSearch: true,
  audioSearch: true,
  minConfidence: 0.5,
  showConfidenceScores: true,
  selectedIndex: null,
  confidencePreset: 'medium',
  confidenceAdjustment: 'default',
}

export default function HomePage() {
  const { state } = useAuth()
  const router = useRouter()
  const [searchOptions, setSearchOptions] = useState<SearchOptions>(initialSearchOptions)
  const [searchResults, setSearchResults] = useState<VideoResult[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string>('')
  const [searchQuery, setSearchQuery] = useState('')
  const [isErrorVisible, setIsErrorVisible] = useState(false)

  // Authentication check effect
  useEffect(() => {
    if (!state.session && !state.isLoading) {
      router.push('/landing')
    }
  }, [state.session, state.isLoading, router])

  // Error display effect
  useEffect(() => {
    if (!error) return

    setIsErrorVisible(true)
    const fadeTimer = setTimeout(() => {
      setIsErrorVisible(false)
    }, 3000)

    const clearTimer = setTimeout(() => {
      setError('')
    }, 3300)

    return () => {
      clearTimeout(fadeTimer)
      clearTimeout(clearTimer)
    }
  }, [error])

  // Search results effect
  useEffect(() => {
    if (!searchQuery) {
      setSearchResults([])
      return
    }

    const filterResults = () => {
      return ALL_MOCK_RESULTS.filter(result => {
        if (searchOptions.selectedIndex && result.indexId !== searchOptions.selectedIndex) {
          return false
        }
        const query = searchQuery.toLowerCase()
        return (
          result.title.toLowerCase().includes(query) ||
          result.description.toLowerCase().includes(query) ||
          result.segments.some(segment => segment.text.toLowerCase().includes(query))
        )
      })
    }

    setIsLoading(true)
    const searchTimer = setTimeout(() => {
      setSearchResults(filterResults())
      setIsLoading(false)
    }, 500)

    return () => clearTimeout(searchTimer)
  }, [searchQuery, searchOptions.selectedIndex])

  const handleSearch = useCallback(async (query: string, imageFile?: File) => {
    setError('')
    setSearchQuery(query)

    if (!searchOptions.selectedIndex) {
      setError('Please select an index to search from')
      setSearchResults([])
      return
    }

    if (!query && !imageFile) {
      setSearchResults([])
      return
    }

    if (imageFile) {
      console.log('Image search with:', imageFile)
    }
  }, [searchOptions.selectedIndex])

  const handleFeedback = useCallback(async (isHelpful: boolean) => {
    try {
      console.log('Feedback:', { isHelpful })
    } catch (err) {
      console.error('Failed to submit feedback:', err)
    }
  }, [])

  const handleClear = useCallback(() => {
    setSearchQuery('')
    setSearchResults([])
  }, [])

  const handleOptionsChange = useCallback((newOptions: SearchOptions) => {
    setSearchOptions(newOptions)
  }, [])

  // Loading or not authenticated
  if (state.isLoading || !state.session) {
    return <div className="flex items-center justify-center h-screen">
      <div className="text-gray-600">Loading...</div>
    </div>
  }

  return (
    <div className="flex min-h-screen bg-gray-50">
      <div className="flex-1 flex flex-col">
        <div className="p-8">
          <SearchBar onSearch={handleSearch} onClear={handleClear} />
        </div>

        <div className={cn(
          "px-8 mb-4 transition-all duration-300",
          isErrorVisible ? "opacity-100" : "opacity-0 pointer-events-none"
        )}>
          {error && (
            <div className="p-4 bg-red-50 text-red-700 rounded-lg border border-red-100">
              {error}
            </div>
          )}
        </div>

        <div className="flex-1 px-8 pb-8">
          {isLoading ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-gray-600">Loading results...</div>
            </div>
          ) : searchResults.length > 0 ? (
            <SearchResults
              results={searchResults}
              showConfidenceScores={searchOptions.showConfidenceScores}
            />
          ) : (
            <div className="flex items-center justify-center h-full">
              <div className="text-gray-600">
                {searchOptions.selectedIndex 
                  ? 'Enter a search query or upload an image to start searching'
                  : 'Please select an index from the sidebar to start searching'}
              </div>
            </div>
          )}
        </div>

        {searchResults.length > 0 && (
          <FeedbackBar onFeedback={handleFeedback} />
        )}
      </div>

      <SearchSidebar
        options={searchOptions}
        onOptionsChange={handleOptionsChange}
        indexes={MOCK_INDEXES}
      />
    </div>
  )
} 