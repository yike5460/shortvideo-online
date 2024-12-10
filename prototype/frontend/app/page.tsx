'use client'

import { useState } from 'react'
import { MagnifyingGlassIcon } from '@heroicons/react/24/outline'
import VideoGrid from '@/components/VideoGrid'
import VideoSidebar from '@/components/VideoSidebar'
import { VideoSource, VideoResult } from '@/types'

export default function Home() {
  const [query, setQuery] = useState('')
  const [selectedSources, setSelectedSources] = useState<VideoSource[]>([])
  const [searchResults, setSearchResults] = useState<VideoResult[]>([])
  const [selectedVideo, setSelectedVideo] = useState<VideoResult | null>(null)

  const sources: VideoSource[] = [
    { id: 'youtube', label: 'YouTube' },
    { id: 's3', label: 'Amazon S3' },
    // Add more sources as needed
  ]

  const handleSearch = async () => {
    try {
      // TODO: Implement actual API call to Cloudflare Worker
      const response = await fetch(`/api/search?q=${query}&sources=${selectedSources.map(s => s.id).join(',')}`)
      const data = await response.json()
      setSearchResults(data.results)
    } catch (error) {
      console.error('Search failed:', error)
    }
  }

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
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
                className="px-6 py-3 bg-primary-600 text-white rounded-lg hover:bg-primary-700 focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
              >
                Search
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
              <VideoGrid
                videos={searchResults}
                onVideoSelect={setSelectedVideo}
                selectedVideo={selectedVideo}
              />
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