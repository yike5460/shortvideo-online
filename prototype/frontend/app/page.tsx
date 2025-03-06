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
    indexId: 'videos',
    title: 'Introduction to Machine Learning',
    description: 'A comprehensive guide to machine learning fundamentals.',
    videoThumbnailUrl: 'https://i.ytimg.com/vi/ABC123/maxresdefault.jpg',
    videoThumbnailS3Path: 'RawVideos/2025-03-02/videos/ABC123/thumbnail.jpg',
    videoPreviewUrl: 'https://example.com/previews/ABC123.mp4',
    videoS3Path: 'RawVideos/2025-03-02/videos/ABC123/video.mp4',
    videoDuration: '01:00:00',
    source: 'youtube',
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
    indexId: 'videos',
    title: 'Advanced Deep Learning Techniques',
    description: 'Exploring advanced concepts in deep learning.',
    videoThumbnailUrl: 'https://i.ytimg.com/vi/DEF456/maxresdefault.jpg',
    videoThumbnailS3Path: 'RawVideos/2025-03-02/videos/DEF456/thumbnail.jpg',
    videoPreviewUrl: 'https://example.com/previews/DEF456.mp4',
    videoS3Path: 'RawVideos/2025-03-02/videos/DEF456/video.mp4',
    videoDuration: '00:45:00',
    source: 'youtube',
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
  // searchType: 'text' | 'visual' | 'audio';
  // visualSearch: boolean;
  // audioSearch: boolean;
  // minConfidence: number;
  // showConfidenceScores: boolean;
  // selectedIndex: string | null;
  // confidencePreset: ConfidencePreset;
  // confidenceAdjustment: ConfidenceAdjustment;
  searchType: 'text',
  visualSearch: false,
  audioSearch: false,
  // exactMatch: false,
  // topK: 20,
  // weights: {
  //   text: 1.0,
  //   image: 0.0,
  //   video: 0.0,
  //   audio: 0.0
  // },
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

export default function HomePage() {
  const { state } = useAuth()
  const router = useRouter()
  const [searchOptions, setSearchOptions] = useState<SearchOptions>(initialSearchOptions)
  const [searchResults, setSearchResults] = useState<VideoResult[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string>('')
  const [searchQuery, setSearchQuery] = useState('')
  const [isErrorVisible, setIsErrorVisible] = useState(false)
  const [indexes, setIndexes] = useState<Index[]>([])
  const [isLoadingIndexes, setIsLoadingIndexes] = useState(false)
  // Add state for advanced search toggle
  const [advancedSearch, setAdvancedSearch] = useState(false)

  // Authentication check effect
  useEffect(() => {
    if (!state.session && !state.isLoading) {
      router.push('/landing')
    }
  }, [state.session, state.isLoading, router])

  // Fetch indexes from backend
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
        
        // Create a map to deduplicate indexes by indexId
        const indexMap = new Map();
        
        // First pass: collect all unique indexIds with their data
        data.forEach((item: any, i: number) => {
          if (!indexMap.has(item.indexId)) {
            indexMap.set(item.indexId, {
              id: item.indexId || `index-${i}`,
              name: `Index: ${item.indexId || 'Unknown'}`,
              status: item.video_status === 'error' ? 'error' : 'ready',
              videoCount: item.videoCount || 0
            });
          } else if (item.videoCount) {
            // If this entry has a videoCount and the indexId is already in our map,
            // update the videoCount
            const existing = indexMap.get(item.indexId);
            existing.videoCount = item.videoCount;
            indexMap.set(item.indexId, existing);
          }
        });
        
        // Convert the map back to an array of unique indexes
        const transformedIndexes = Array.from(indexMap.values());
        
        setIndexes(transformedIndexes);
      } catch (err) {
        console.error('Error fetching indexes:', err);
        setError('Failed to load indexes. Please refresh the page.');
      } finally {
        setIsLoadingIndexes(false);
      }
    };
    
    fetchIndexes();
  }, [state.session, API_ENDPOINT]);

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
      // Use the mock data for now
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

  const handleSearch = useCallback(async (
    query: string, 
    imageFile?: File, 
    audioFile?: File, 
    videoFile?: File
  ) => {
    setError('')
    setSearchQuery(query)

    if (!searchOptions.selectedIndex) {
      setError('Please select an index to search from')
      setSearchResults([])
      return
    }

    if (!query && !imageFile && !audioFile && !videoFile) {
      setSearchResults([])
      return
    }

    try {
      setIsLoading(true)
      
      let searchResponse
      // Handle different types of media search
      if (imageFile || audioFile || videoFile) {
        // Create form data for any file uploads
        const formData = new FormData()
        
        if (imageFile) {
          formData.append('image', imageFile)
        }
        
        if (audioFile) {
          formData.append('audio', audioFile)
        }
        
        if (videoFile) {
          formData.append('video', videoFile)
        }
        
        // Determine search type based on which file is provided
        let searchType = 'text'
        if (imageFile) searchType = 'image'
        if (audioFile) searchType = 'audio'
        if (videoFile) searchType = 'video'
        
        formData.append('searchOptions', JSON.stringify({
          ...searchOptions,
          searchType,
          searchQuery: query,
          advancedSearch // Add the advanced search flag
        }))
        
        // Use appropriate endpoint based on file type
        const endpoint = imageFile ? 'image' : audioFile ? 'audio' : 'video'
        searchResponse = await fetch(`${API_ENDPOINT}/search/${endpoint}`, {
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
            selectedIndex: searchOptions.selectedIndex,
            advancedSearch // Add the advanced search flag
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
  }, [searchOptions, API_ENDPOINT, advancedSearch]) // Add advancedSearch to dependencies

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
  
  // Handler for toggling advanced search
  const handleToggleAdvancedSearch = useCallback((enabled: boolean) => {
    setAdvancedSearch(enabled)
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
          <SearchBar 
            onSearch={handleSearch} 
            onClear={handleClear}
            advancedSearch={advancedSearch}
            onToggleAdvancedSearch={handleToggleAdvancedSearch}
          />
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
                  ? (advancedSearch 
                     ? 'Enter a search query or upload media (image, audio, or video) to start an advanced search'
                     : 'Enter a search query or upload an image to start searching')
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
        indexes={indexes}
        // isLoadingIndexes={isLoadingIndexes}
      />
    </div>
  )
} 