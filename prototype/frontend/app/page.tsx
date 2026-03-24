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
import { indexesApi } from '@/lib/api'
import { searchApi } from '@/lib/api'
import { ApiError } from '@/lib/api'

const initialSearchOptions: SearchOptions = {
  searchType: 'text',
  visualSearch: true,
  audioSearch: true,
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
  confidenceAdjustment: 'default',
  skipValidation: true  // false means Exact Search is enabled
}

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
  const [advancedSearch, setAdvancedSearch] = useState(true)

  // Authentication check effect
  useEffect(() => {
    if (!state.session && !state.isLoading) {
      router.push('/landing')
    }
  }, [state.session, state.isLoading, router])

  // Fetch indexes from backend
  useEffect(() => {
    const loadIndexes = async () => {
      if (!state.session) return;

      setIsLoadingIndexes(true);
      try {
        const data = await indexesApi.fetchIndexes();

        // Create a map to deduplicate indexes by id
        const indexMap = new Map();
        data.forEach((item: any, i: number) => {
          if (!indexMap.has(item.id)) {
            indexMap.set(item.id, {
              id: item.id || `index-${i}`,
              name: `Index: ${item.name || item.id || 'Unknown'}`,
              status: 'ready',
              videoCount: item.videoCount || 0
            });
          } else if (item.videoCount) {
            const existing = indexMap.get(item.id);
            existing.videoCount = item.videoCount;
            indexMap.set(item.id, existing);
          }
        });

        const transformedIndexes = Array.from(indexMap.values());
        setIndexes(transformedIndexes);
      } catch (err) {
        console.error('Error fetching indexes:', err);
        setError('Failed to load indexes. Please refresh the page.');
      } finally {
        setIsLoadingIndexes(false);
      }
    };

    loadIndexes();
  }, [state.session]);

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
      
      let results
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
          advancedSearch, // Add the advanced search flag
          skipValidation: searchOptions.skipValidation // skipValidation=true means Exact Search is disabled
        }))
        
        // Use appropriate endpoint based on file type
        const endpoint = imageFile ? 'image' : audioFile ? 'audio' : 'video'
        results = await searchApi.searchMedia(endpoint, formData)
      } else {
        // Handle text search
        results = await searchApi.searchText({
          ...searchOptions,
          searchType: 'text',
          searchQuery: query,
          selectedIndex: searchOptions.selectedIndex,
          advancedSearch,
          skipValidation: searchOptions.skipValidation
        })
      }

      setSearchResults(results)
    } catch (err) {
      console.error('Search error:', err)
      setError('Failed to perform search. Please try again.')
      setSearchResults([])
    } finally {
      setIsLoading(false)
    }
  }, [searchOptions, advancedSearch])

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
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="animate-pulse flex flex-col items-center gap-3">
          <div className="h-8 w-8 rounded-full border-2 border-primary-500 border-t-transparent animate-spin" />
          <span className="text-sm text-gray-500">Loading...</span>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen">
      <div className="flex-1 flex flex-col">
        {/* Page header */}
        <div className="border-b border-gray-100 bg-white px-6 py-4">
          <h1 className="text-lg font-semibold text-gray-900">Search</h1>
          <p className="text-sm text-gray-500 mt-0.5">Find moments across your video library</p>
        </div>

        <div className="p-6">
          <SearchBar
            onSearch={handleSearch}
            onClear={handleClear}
            advancedSearch={advancedSearch}
            onToggleAdvancedSearch={handleToggleAdvancedSearch}
          />
        </div>

        {error && isErrorVisible && (
          <div className="mx-6 mb-4 p-3 bg-red-50 text-red-700 text-sm rounded-lg border border-red-100">
            {error}
          </div>
        )}

        <div className="flex-1 px-6 pb-6">
          {isLoading ? (
            <div className="flex items-center justify-center py-20">
              <div className="flex flex-col items-center gap-3">
                <div className="h-8 w-8 rounded-full border-2 border-primary-500 border-t-transparent animate-spin" />
                <span className="text-sm text-gray-500">Searching...</span>
              </div>
            </div>
          ) : searchResults.length > 0 ? (
            <SearchResults
              results={searchResults}
              showConfidenceScores={searchOptions.showConfidenceScores}
              searchOptions={searchOptions}
            />
          ) : (
            <div className="flex items-center justify-center py-20">
              <div className="text-center max-w-md">
                <div className="mx-auto h-12 w-12 rounded-full bg-gray-100 flex items-center justify-center mb-4">
                  <svg className="h-6 w-6 text-gray-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
                  </svg>
                </div>
                <p className="text-sm text-gray-500">
                  {searchOptions.selectedIndex
                    ? (advancedSearch
                       ? 'Enter a search query or upload media to find relevant moments'
                       : 'Enter a search query or upload an image to start searching')
                    : 'Select an index from the sidebar to start searching'}
                </p>
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
      />
    </div>
  )
}
