'use client'

import { useState, useCallback, useMemo } from 'react'
import { Tab } from '@headlessui/react'
import { VideoCameraIcon, ClockIcon } from '@heroicons/react/24/outline'
import { cn } from '@/lib/utils'
import { VideoResult } from '@/types'
import VideoModal from '@/components/VideoModal'

interface SearchResultsProps {
  results: VideoResult[]
  showConfidenceScores: boolean
}

export default function SearchResults({
  results,
  showConfidenceScores
}: SearchResultsProps) {
  const [selectedView, setSelectedView] = useState<'clip' | 'video'>('clip')
  const [selectedVideo, setSelectedVideo] = useState<VideoResult | null>(null)
  const [isModalOpen, setIsModalOpen] = useState(false)

  const getAverageConfidence = useCallback((segments: VideoResult['segments']): number => {
    console.log('segments', segments)
    if (!segments || segments.length === 0) return 0;
    const sum = segments.reduce((acc, segment) => {
      if (!segment.segment_visual?.segment_visual_objects) return acc;
      return acc + segment.segment_visual.segment_visual_objects.reduce((objectAcc, object) => {
        return objectAcc + (object.confidence || 0);
      }, 0);
    }, 0);
    return sum / segments.length;
  }, []);

  const formatDuration = useCallback((videoDuration: string | undefined): number => {
    if (!videoDuration) return 0;
    
    try {
      const [hours, minutes, seconds] = videoDuration.split(':').map(Number);
      const totalSeconds = hours * 3600 + minutes * 60 + seconds;
      return totalSeconds * 1000;
    } catch (error) {
      console.warn('Error parsing video duration:', videoDuration);
      return 0;
    }
  }, [])

  const handleVideoClick = useCallback((video: VideoResult) => {
    setSelectedVideo(video);
    setIsModalOpen(true);
  }, []);

  const closeModal = useCallback(() => {
    setIsModalOpen(false);
    // Give time for the animation to complete before clearing the selected video
    setTimeout(() => setSelectedVideo(null), 300);
  }, []);

  const renderGridView = useCallback(() => (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {results.map((result) => (
        <button
          key={result.id}
          className="bg-white rounded-lg shadow-sm overflow-hidden text-left transition-transform hover:scale-[1.02] focus:outline-none focus:ring-2 focus:ring-primary-500"
          onClick={() => handleVideoClick(result)}
          type="button"
        >
          <div className="aspect-video relative">
            <img
              src={result.videoThumbnailUrl}
              alt={result.title}
              className="w-full h-full object-cover"
            />
            {showConfidenceScores && (
              <div className="absolute top-2 right-2 px-2 py-1 bg-black/50 rounded text-white text-sm">
                {Math.round((result.searchConfidence || 0) * 100)}% Match
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
              <span>{result.videoDuration}</span>
            </div>
          </div>
        </button>
      ))}
    </div>
  ), [results, showConfidenceScores, handleVideoClick])

  const renderTimelineView = useCallback(() => (
    <div className="space-y-6">
      {results.map((result) => (
        <button
          key={result.id}
          className="bg-white rounded-lg shadow-sm p-6 w-full text-left transition-transform hover:scale-[1.01] focus:outline-none focus:ring-2 focus:ring-primary-500"
          onClick={() => handleVideoClick(result)}
          type="button"
        >
          <div className="flex gap-6">
            <div className="w-64 aspect-video rounded-lg overflow-hidden relative">
              <img
                src={result.videoThumbnailUrl}
                alt={result.title}
                className="w-full h-full object-cover"
              />
              {showConfidenceScores && (
                <div className="absolute top-2 right-2 px-2 py-1 bg-black/50 rounded text-white text-sm">
                  {Math.round((result.searchConfidence || 0) * 100)}% Match
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
                  {showConfidenceScores && result.segments?.map((segment, index) => {
                    const centerPercent = ((segment.start_time + (segment.end_time - segment.start_time) / 2) / formatDuration(result.videoDuration)) * 100;
                    const confidence = segment.segment_visual?.segment_visual_objects?.[0]?.confidence || 0;
                    return (
                      <div
                        key={`confidence-${index}`}
                        className="absolute -top-6 text-xs font-medium text-gray-600 transform -translate-x-1/2 whitespace-nowrap"
                        style={{ left: `${centerPercent}%` }}
                      >
                        {Math.round(confidence * 100)}%
                      </div>
                    );
                  })}
                  <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                    {result.segments?.map((segment, index) => {
                      const startPercent = (segment.start_time / formatDuration(result.videoDuration)) * 100;
                      const widthPercent = ((segment.end_time - segment.start_time) / formatDuration(result.videoDuration)) * 100;
                      const confidence = segment.segment_visual?.segment_visual_objects?.[0]?.confidence || 0;
                      return (
                        <div
                          key={index}
                          className="absolute h-full bg-primary-600 transition-opacity hover:opacity-80"
                          style={{
                            left: `${startPercent}%`,
                            width: `${widthPercent}%`,
                            opacity: confidence
                          }}
                        />
                      );
                    })}
                  </div>
                </div>
                <div className="mt-1 flex justify-between text-sm text-gray-600">
                  <span>0:00</span>
                  <span>{result.videoDuration}</span>
                </div>
              </div>
            </div>
          </div>
        </button>
      ))}
    </div>
  ), [results, showConfidenceScores, getAverageConfidence, formatDuration, handleVideoClick])

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

      {/* Video Player Modal */}
      <VideoModal
        video={selectedVideo}
        isOpen={isModalOpen}
        onClose={closeModal}
      />
    </div>
  )
} 