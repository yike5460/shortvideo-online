'use client'

import { useState, useCallback, useMemo } from 'react'
import { Tab } from '@headlessui/react'
import { VideoCameraIcon, ClockIcon } from '@heroicons/react/24/outline'
import { cn } from '@/lib/utils'
import { VideoResult } from '@/types'

interface SearchResultsProps {
  results: VideoResult[]
  showConfidenceScores: boolean
}

export default function SearchResults({
  results,
  showConfidenceScores
}: SearchResultsProps) {
  const [selectedView, setSelectedView] = useState<'clip' | 'video'>('clip')

  const getAverageConfidence = useCallback((segments: VideoResult['segments']): number => {
    if (segments.length === 0) return 0
    const sum = segments.reduce((acc, segment) => acc + segment.confidence, 0)
    return sum / segments.length
  }, [])

  const formatDuration = useCallback((duration: number): string => {
    const minutes = Math.floor(duration / 60)
    const seconds = String(duration % 60).padStart(2, '0')
    return `${minutes}:${seconds}`
  }, [])

  const renderGridView = useCallback(() => (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {results.map((result) => (
        <div key={result.id} className="bg-white rounded-lg shadow-sm overflow-hidden">
          <div className="aspect-video relative">
            <img
              src={result.thumbnailUrl}
              alt={result.title}
              className="w-full h-full object-cover"
            />
            {showConfidenceScores && (
              <div className="absolute top-2 right-2 px-2 py-1 bg-black/50 rounded text-white text-sm">
                {Math.round(getAverageConfidence(result.segments) * 100)}% Confidence
              </div>
            )}
          </div>
          <div className="p-4">
            <h3 className="text-lg font-semibold text-gray-900 line-clamp-1">
              {result.title}
            </h3>
            <p className="mt-1 text-sm text-gray-500 line-clamp-2">
              {result.description}
            </p>
            <div className="mt-4 flex items-center justify-between text-sm text-gray-600">
              <span>{new Date(result.uploadDate).toLocaleDateString()}</span>
              <span>{formatDuration(result.duration)}</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  ), [results, showConfidenceScores, getAverageConfidence, formatDuration])

  const renderTimelineView = useCallback(() => (
    <div className="space-y-6">
      {results.map((result) => (
        <div key={result.id} className="bg-white rounded-lg shadow-sm p-6">
          <div className="flex gap-6">
            <div className="w-64 aspect-video rounded-lg overflow-hidden relative">
              <img
                src={result.thumbnailUrl}
                alt={result.title}
                className="w-full h-full object-cover"
              />
              {showConfidenceScores && (
                <div className="absolute top-2 right-2 px-2 py-1 bg-black/50 rounded text-white text-sm">
                  {Math.round(getAverageConfidence(result.segments) * 100)}% Avg. Confidence
                </div>
              )}
            </div>
            <div className="flex-1">
              <h3 className="text-lg font-semibold text-gray-900">
                {result.title}
              </h3>
              <p className="mt-1 text-sm text-gray-500 mb-8">
                {result.description}
              </p>
              <div className="mt-4">
                <div className="relative">
                  {showConfidenceScores && result.segments.map((segment, index) => {
                    const centerPercent = ((segment.startTime + (segment.endTime - segment.startTime) / 2) / result.duration) * 100
                    return (
                      <div
                        key={`confidence-${index}`}
                        className="absolute -top-6 text-xs font-medium text-gray-600 transform -translate-x-1/2 whitespace-nowrap"
                        style={{ left: `${centerPercent}%` }}
                      >
                        {Math.round(segment.confidence * 100)}%
                      </div>
                    )
                  })}
                  <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                    {result.segments.map((segment, index) => {
                      const startPercent = (segment.startTime / result.duration) * 100
                      const widthPercent = ((segment.endTime - segment.startTime) / result.duration) * 100
                      return (
                        <div
                          key={index}
                          className="absolute h-full bg-primary-600 transition-opacity hover:opacity-80"
                          style={{
                            left: `${startPercent}%`,
                            width: `${widthPercent}%`,
                            opacity: segment.confidence
                          }}
                        />
                      )
                    })}
                  </div>
                </div>
                <div className="mt-1 flex justify-between text-sm text-gray-600">
                  <span>0:00</span>
                  <span>{formatDuration(result.duration)}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  ), [results, showConfidenceScores, getAverageConfidence, formatDuration])

  const handleViewChange = useCallback((view: 'clip' | 'video') => {
    setSelectedView(view)
  }, [])

  const tabPanels = useMemo(() => ({
    clip: renderGridView(),
    video: renderTimelineView()
  }), [renderGridView, renderTimelineView])

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Tab.Group>
          <Tab.List className="flex space-x-1 rounded-lg bg-gray-100 p-1">
            <Tab
              className={({ selected }) =>
                cn(
                  'flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-md',
                  selected
                    ? 'bg-white text-gray-900 shadow'
                    : 'text-gray-500 hover:text-gray-700'
                )
              }
              onClick={() => handleViewChange('clip')}
            >
              <VideoCameraIcon className="h-5 w-5" />
              View by Clip
            </Tab>
            <Tab
              className={({ selected }) =>
                cn(
                  'flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-md',
                  selected
                    ? 'bg-white text-gray-900 shadow'
                    : 'text-gray-500 hover:text-gray-700'
                )
              }
              onClick={() => handleViewChange('video')}
            >
              <ClockIcon className="h-5 w-5" />
              View by Video
            </Tab>
          </Tab.List>
        </Tab.Group>
      </div>

      {tabPanels[selectedView]}
    </div>
  )
} 