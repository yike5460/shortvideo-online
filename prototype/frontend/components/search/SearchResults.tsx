'use client'

import { useState, useCallback, useMemo, useRef } from 'react'
import { Tab } from '@headlessui/react'
import { VideoCameraIcon, ClockIcon } from '@heroicons/react/24/outline'
import { cn } from '@/lib/utils'
import { VideoResult, VideoSegment } from '@/types'
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
  const [selectedSegment, setSelectedSegment] = useState<VideoSegment | null>(null)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [hoveredSegment, setHoveredSegment] = useState<{
    videoId: string,
    segmentIndex: number,
    rect: DOMRect | null
  } | null>(null)

  const getAverageConfidence = useCallback((searchConfidence: number): number => {
    return searchConfidence;
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
  
  const formatTimeDisplay = useCallback((timeMs: number): string => {
    const totalSeconds = Math.floor(timeMs / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    
    if (hours > 0) {
      return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }, [])
  
  const getConfidenceLevel = useCallback((confidence: number): 'High' | 'Medium' | 'Low' => {
    if (confidence >= 0.9) return 'High';
    if (confidence >= 0.7) return 'Medium';
    return 'Low';
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
                  {hoveredSegment && hoveredSegment.videoId === result.id && result.segments && 
                   ((): JSX.Element | null => {
                     // Extract the segment to avoid TypeScript errors
                     const segment = hoveredSegment.segmentIndex >= 0 && 
                                     hoveredSegment.segmentIndex < result.segments.length
                                     ? result.segments[hoveredSegment.segmentIndex] 
                                     : null;
                     
                     if (!segment) return null;
                     
                     const startTime = segment.start_time || 0;
                     const endTime = segment.end_time || 0;
                     const segmentConfidence = segment.confidence || 0;
                     const centerPosition = (startTime + (endTime - startTime) / 2) / formatDuration(result.videoDuration) * 100;
                     const confidenceLevel = getConfidenceLevel(segmentConfidence);
                     
                     return (
                      <div 
                        className="absolute bottom-8 transform -translate-x-1/2 z-10"
                        style={{ left: `${centerPosition}%` }}
                      >
                        <div className="bg-gray-900 rounded-lg shadow-lg overflow-hidden max-w-xs">
                          <div className="relative aspect-video bg-black">
                            <img 
                              src={segment.video_thumbnail_url || result.videoThumbnailUrl} 
                              alt={`Segment at ${formatTimeDisplay(startTime)}`}
                              className="w-full h-full object-cover"
                            />
                            <div className="absolute top-0 left-0 right-0 bg-black/50 text-white text-center text-sm py-1">
                              {formatTimeDisplay(startTime)} - {formatTimeDisplay(endTime)}
                            </div>
                            {showConfidenceScores && (
                              <div className={`absolute bottom-2 left-2 px-2 py-1 rounded text-white text-sm ${
                                segmentConfidence >= 0.9 
                                  ? 'bg-green-600' 
                                  : segmentConfidence >= 0.7 
                                    ? 'bg-blue-600' 
                                    : 'bg-gray-600'
                              }`}>
                                {`${confidenceLevel} - ${Math.round(segmentConfidence * 100)}%`}
                              </div>
                            )}
                          </div>
                        </div>
                        <div className="w-3 h-3 bg-gray-900 rotate-45 absolute -bottom-1 left-1/2 transform -translate-x-1/2"></div>
                      </div>
                     );
                   })()
                  }
                  {showConfidenceScores && result.segments?.map((segment, index) => {
                    const centerPercent = ((segment.start_time + (segment.end_time - segment.start_time) / 2) / formatDuration(result.videoDuration)) * 100;
                    const confidence = segment.confidence || 0;
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
                      const confidence = segment.confidence || 0;
                      
                      const getSegmentColor = (conf: number) => {
                        if (conf >= 0.9) return "bg-green-600";
                        if (conf >= 0.7) return "bg-blue-600";
                        return "bg-gray-600";
                      };
                      
                      return (
                        <div
                          key={index}
                          className={`absolute h-full transition-opacity hover:opacity-80 cursor-pointer ${getSegmentColor(confidence)}`}
                          style={{
                            left: `${startPercent}%`,
                            width: `${widthPercent}%`,
                            opacity: Math.max(0.3, confidence)
                          }}
                          onMouseEnter={(e) => {
                            setHoveredSegment({
                              videoId: result.id,
                              segmentIndex: index,
                              rect: e.currentTarget.getBoundingClientRect()
                            });
                          }}
                          onMouseLeave={() => {
                            setHoveredSegment(null);
                          }}
                          onClick={(e) => {
                            e.stopPropagation(); // Prevent triggering parent button click
                            setSelectedVideo(result);
                            setSelectedSegment(segment);
                            setIsModalOpen(true);
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
  ), [results, showConfidenceScores, formatDuration, handleVideoClick, hoveredSegment, formatTimeDisplay, getConfidenceLevel])

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
        selectedSegment={selectedSegment}
        isOpen={isModalOpen}
        onClose={() => {
          closeModal();
          setSelectedSegment(null);
        }}
      />
    </div>
  )
}
