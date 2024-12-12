'use client'

import { useState } from 'react'
import { Tab } from '@headlessui/react'
import { VideoCameraIcon, ClockIcon } from '@heroicons/react/24/outline'
import { cn } from '@/lib/utils'
import { VideoResult } from '@/types'

interface SearchResultsProps {
  results: VideoResult[]
  showConfidenceScores: boolean
  onFeedback: (videoId: string, isHelpful: boolean) => void
}

export default function SearchResults({
  results,
  showConfidenceScores,
  onFeedback
}: SearchResultsProps) {
  const [selectedView, setSelectedView] = useState<'clip' | 'video'>('clip')

  const renderGridView = () => (
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
                {Math.round(0.85 * 100)}% Confidence
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
              <span>{Math.floor(result.duration / 60)}:{String(result.duration % 60).padStart(2, '0')}</span>
            </div>
            <div className="mt-4 flex items-center justify-between">
              <div className="text-sm text-gray-600">Was this result helpful?</div>
              <div className="space-x-2">
                <button
                  onClick={() => onFeedback(result.id, true)}
                  className="px-3 py-1 text-sm text-gray-600 hover:text-gray-900"
                >
                  Yes
                </button>
                <button
                  onClick={() => onFeedback(result.id, false)}
                  className="px-3 py-1 text-sm text-gray-600 hover:text-gray-900"
                >
                  No
                </button>
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  )

  const renderTimelineView = () => (
    <div className="space-y-6">
      {results.map((result) => (
        <div key={result.id} className="bg-white rounded-lg shadow-sm p-6">
          <div className="flex gap-6">
            <div className="w-64 aspect-video rounded-lg overflow-hidden">
              <img
                src={result.thumbnailUrl}
                alt={result.title}
                className="w-full h-full object-cover"
              />
            </div>
            <div className="flex-1">
              <h3 className="text-lg font-semibold text-gray-900">
                {result.title}
              </h3>
              <p className="mt-1 text-sm text-gray-500">
                {result.description}
              </p>
              <div className="mt-4">
                <div className="relative h-2 bg-gray-200 rounded-full overflow-hidden">
                  {result.segments.map((segment, index) => (
                    <div
                      key={index}
                      className="absolute h-full bg-primary-600"
                      style={{
                        left: `${(segment.startTime / result.duration) * 100}%`,
                        width: `${((segment.endTime - segment.startTime) / result.duration) * 100}%`,
                        opacity: segment.confidence
                      }}
                    />
                  ))}
                </div>
                <div className="mt-1 flex justify-between text-sm text-gray-600">
                  <span>0:00</span>
                  <span>
                    {Math.floor(result.duration / 60)}:{String(result.duration % 60).padStart(2, '0')}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  )

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
              onClick={() => setSelectedView('clip')}
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
              onClick={() => setSelectedView('video')}
            >
              <ClockIcon className="h-5 w-5" />
              View by Video
            </Tab>
          </Tab.List>
        </Tab.Group>
      </div>

      {selectedView === 'clip' ? renderGridView() : renderTimelineView()}
    </div>
  )
} 