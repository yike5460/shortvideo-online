'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth/AuthContext'
import SearchBar from '@/components/search/SearchBar'
import SearchSidebar from '@/components/search/SearchSidebar'
import SearchResults from '@/components/search/SearchResults'
import FeedbackBar from '@/components/search/FeedbackBar'
import { VideoResult, SearchOptions } from '@/types'
import { cn } from '@/lib/utils'

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
    status: 'ready',
    size: 1.2 * 1024 * 1024 * 1024,
    segments: [
      {
        segment_id: 'seg1',
        video_id: '1',
        start_time: 120000,
        end_time: 180000,
        duration: 60000,
        segment_visual: {
          segment_visual_description: 'Explanation of supervised learning algorithms'
        }
      },
      {
        segment_id: 'seg2',
        video_id: '1',
        start_time: 360000,
        end_time: 420000,
        duration: 60000,
        segment_visual: {
          segment_visual_description: 'Deep dive into neural networks architecture'
        }
      }
    ]
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
    status: 'ready',
    size: 1.0 * 1024 * 1024 * 1024,
    segments: [
      {
        segment_id: 'seg3',
        video_id: '2',
        start_time: 180000,
        end_time: 240000,
        duration: 60000,
        segment_visual: {
          segment_visual_description: 'Advanced neural network architectures'
        }
      },
      {
        segment_id: 'seg4',
        video_id: '2',
        start_time: 420000,
        end_time: 480000,
        duration: 60000,
        segment_visual: {
          segment_visual_description: 'Training optimization techniques'
        }
      }
    ]
  }
]

const initialSearchOptions: SearchOptions = {
  searchType: 'text',
  searchQuery: '',
  exactMatch: false,
  topK: 3,
  weights: {
    text: 1.0,
    image: 0.0,
    video: 0.0,
    audio: 0.0
  },
  minConfidence: 0.5,
  showConfidenceScores: true,
  selectedIndex: null,
  confidencePreset: 'medium',
  confidenceAdjustment: 'default'
}

// Add API configuration
const API_ENDPOINT = process.env.NEXT_PUBLIC_API_URL

// Add Index type definition
interface Index {
  id: string;
  name: string;
  status: 'ready' | 'indexing' | 'error';
  videoCount: number;
}

// Add mock indexes
const MOCK_INDEXES: Index[] = [
  { 
    id: 'main', 
    name: 'Main Video Index',
    status: 'ready',
    videoCount: 1
  },
  { 
    id: 'training', 
    name: 'Training Videos',
    status: 'ready',
    videoCount: 1
  },
]

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
        const query = searchQuery.toLowerCase();
        return (
          result.title.toLowerCase().includes(query) ||
          result.description.toLowerCase().includes(query) ||
          (result.segments?.some(segment => 
            segment.segment_visual?.segment_visual_description?.toLowerCase().includes(query) ||
            segment.segment_audio?.segment_audio_transcript?.toLowerCase().includes(query)
          ) ?? false)
        );
      });
    };

    setIsLoading(true)
    const searchTimer = setTimeout(() => {
      setSearchResults(filterResults())
      setIsLoading(false)
    }, 500)

    return () => clearTimeout(searchTimer)
  }, [searchQuery])

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

    try {
      setIsLoading(true)
      
      let searchResponse
      if (imageFile) {
        // Handle image search
        const formData = new FormData()
        formData.append('image', imageFile)
        formData.append('searchOptions', JSON.stringify({
          ...searchOptions,
          searchType: 'image',
          searchQuery: query
        }))
        
        searchResponse = await fetch(`${API_ENDPOINT}/search/image`, {
          method: 'POST',
          body: formData
        })
      } else {
        // Handle text search
        searchResponse = await fetch(`${API_ENDPOINT}/search`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            ...searchOptions,
            searchType: 'text',
            searchQuery: query,
            selectedIndex: 'videos' // Use fixed index for now
          })
        })
      }

      if (!searchResponse.ok) {
        throw new Error(`Search failed: ${searchResponse.statusText}`)
      }

      const results = await searchResponse.json()
      setSearchResults(results)
    } catch (err) {
      console.error('Search error:', err)
      setError('Failed to perform search. Please try again.')
      setSearchResults([])
    } finally {
      setIsLoading(false)
    }
  }, [searchOptions, API_ENDPOINT])

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