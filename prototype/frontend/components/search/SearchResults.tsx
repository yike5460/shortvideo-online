'use client'

import { useState, useCallback, useMemo, useRef } from 'react'
import { Tab } from '@headlessui/react'
import { VideoCameraIcon, ClockIcon, CheckCircleIcon, ExclamationCircleIcon, QuestionMarkCircleIcon } from '@heroicons/react/24/outline'
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
    if (confidence >= 0.8) return 'High';
    if (confidence >= 0.6) return 'Medium';
    return 'Low';
  }, [])
  
  const getConfidenceIcon = useCallback((level: 'High' | 'Medium' | 'Low') => {
    switch(level) {
      case 'High': return <CheckCircleIcon className="h-4 w-4 text-white" />;
      case 'Medium': return <ExclamationCircleIcon className="h-4 w-4 text-white" />;
      case 'Low': return <QuestionMarkCircleIcon className="h-4 w-4 text-white" />;
    }
  }, [])

  const handleVideoClick = useCallback((video: VideoResult) => {
    setSelectedVideo(video);
    setSelectedSegment(null);
    setIsModalOpen(true);
  }, []);
  
  const handleSegmentClick = useCallback((video: VideoResult, segment: VideoSegment) => {
    setSelectedVideo(video);
    setSelectedSegment(segment);
    setIsModalOpen(true);
  }, []);

  const closeModal = useCallback(() => {
    setIsModalOpen(false);
    // Give time for the animation to complete before clearing the selected video
    setTimeout(() => setSelectedVideo(null), 300);
  }, []);

  const renderGridView = useCallback(() => {
    // Extract all segments with confidence > 0 from all videos
    const allMatchedSegments = results.flatMap(result => 
      (result.segments || [])
        .filter(segment => (segment.confidence || 0) > 0)
        .map(segment => ({
          segment,
          video: result
        }))
    );

    // Sort segments by confidence score (highest to lowest)
    const sortedSegments = [...allMatchedSegments].sort((a, b) => 
      (b.segment.confidence || 0) - (a.segment.confidence || 0)
    );

    // If no matched segments, show a message
    if (sortedSegments.length === 0) {
      return (
        <div className="py-8 text-center">
          <p className="text-gray-500">No matched clips found. Try adjusting your search criteria.</p>
        </div>
      );
    }

    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {sortedSegments.map(({ segment, video }, index) => {
          const startTime = segment.start_time || 0;
          const endTime = segment.end_time || 0;
          const confidenceScore = segment.confidence || 0;
          const confidenceLevel = getConfidenceLevel(confidenceScore);
          
          return (
            <button
              key={`${video.id}_segment_${index}`}
              className="bg-white rounded-lg shadow-sm overflow-hidden text-left transition-transform hover:scale-[1.02] focus:outline-none focus:ring-2 focus:ring-primary-500"
              onClick={() => handleSegmentClick(video, segment)}
              type="button"
            >
              <div className="aspect-video relative">
                <img
                  src={segment.segment_video_thumbnail_url || video.videoThumbnailUrl}
                  alt={`${video.title} - Clip at ${formatTimeDisplay(startTime)}`}
                  className="w-full h-full object-cover"
                />
                <div className="absolute top-0 left-0 right-0 bg-black/70 text-white text-center text-xs py-1 font-medium">
                  {formatTimeDisplay(startTime)} - {formatTimeDisplay(endTime)}
                </div>
                {showConfidenceScores && (
                  <div className={`absolute bottom-2 left-2 px-2 py-1 rounded text-white text-sm flex items-center gap-1 ${
                    confidenceScore >= 0.8
                      ? 'bg-green-600' 
                      : confidenceScore >= 0.6 
                        ? 'bg-blue-600' 
                        : 'bg-gray-600'
                  }`}>
                    {getConfidenceIcon(confidenceLevel)}
                    <span className="font-medium">{Math.round(confidenceScore * 100)}%</span>
                  </div>
                )}
              </div>
              <div className="p-4">
                <h3 className="text-lg font-semibold text-gray-900 line-clamp-1">
                  {video.title}
                </h3>
                <div className="mt-1 flex items-center gap-1">
                  <span className="text-xs py-0.5 px-1.5 bg-blue-100 text-blue-800 rounded">Clip</span>
                  <span className="text-sm text-gray-500">
                    {formatTimeDisplay(segment.duration)} duration
                  </span>
                </div>
                <div className="mt-4 flex items-center justify-between text-sm text-gray-600">
                  <span>{new Date(video.uploadDate).toLocaleDateString()}</span>
                  <span className="text-xs text-gray-500">
                    From {video.videoDuration} video
                  </span>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    );
  }, [results, showConfidenceScores, handleSegmentClick, formatTimeDisplay, getConfidenceLevel, getConfidenceIcon]);

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
                     
                     // Calculate constrained position to keep the preview within bounds
                     const constrainedPosition = Math.max(15, Math.min(centerPosition, 85));
                     
                     return (
                      <div 
                        className="absolute bottom-10 transform -translate-x-1/2 z-10"
                        style={{ left: `${constrainedPosition}%` }}
                      >
                        <div className="bg-gray-900 rounded-lg shadow-xl overflow-hidden max-w-xs border border-gray-700">
                          <div className="relative bg-black" style={{width: "240px", height: "135px"}}>
                            <img 
                              src={segment.segment_video_thumbnail_url} 
                              alt={`Segment at ${formatTimeDisplay(startTime)}`}
                              className="w-full h-full object-cover"
                            />
                            <div className="absolute top-0 left-0 right-0 bg-black/70 text-white text-center text-sm py-1 font-medium">
                              {formatTimeDisplay(startTime)} - {formatTimeDisplay(endTime)}
                            </div>
                            {/* Only display confidence for matched segments (confidence > 0) */}
                            {showConfidenceScores && segmentConfidence > 0 && (
                              <div className={`absolute bottom-2 left-2 px-2 py-1 rounded text-white text-sm flex items-center gap-1 ${
                                segmentConfidence >= 0.8
                                  ? 'bg-green-600' 
                                  : segmentConfidence >= 0.6 
                                    ? 'bg-blue-600' 
                                    : 'bg-gray-600'
                              }`}>
                                {getConfidenceIcon(confidenceLevel)}
                                <span className="font-medium">{`${confidenceLevel} - ${Math.round(segmentConfidence * 100)}%`}</span>
                              </div>
                            )}
                          </div>
                        </div>
                        <div className="w-4 h-4 bg-gray-900 rotate-45 absolute -bottom-2 left-1/2 transform -translate-x-1/2 border-r border-b border-gray-700"></div>
                      </div>
                     );
                   })()
                  }
                  {/* Only show confidence scores for matched segments (confidence > 0) */}
                  {showConfidenceScores && result.segments?.map((segment, index) => {
                    // Skip segments with no confidence (unmatched segments)
                    if ((segment.confidence || 0) <= 0) return null;
                    
                    const centerPercent = ((segment.start_time + (segment.end_time - segment.start_time) / 2) / formatDuration(result.videoDuration)) * 100;
                    const confidence = segment.confidence || 0;
                    const confidenceLevel = getConfidenceLevel(confidence);
                    const getBadgeColor = (level: string) => {
                      if (level === 'High') return "bg-green-500";
                      if (level === 'Medium') return "bg-blue-500";
                      return "bg-gray-500";
                    };
                    
                    return (
                      <div
                        key={`confidence-${index}`}
                        className={`absolute -top-8 transform -translate-x-1/2 whitespace-nowrap flex items-center gap-1 rounded-full px-2 py-1 text-xs font-bold text-white shadow-md ${getBadgeColor(confidenceLevel)}`}
                        style={{ left: `${centerPercent}%` }}
                      >
                        {getConfidenceIcon(confidenceLevel)}
                        <span>{Math.round(confidence * 100)}%</span>
                      </div>
                    );
                  })}
                  <div className="h-6 bg-gray-200 rounded-lg overflow-hidden border border-gray-300 shadow-inner relative">
                    {/* Time markers for better navigation */}
                    <div className="absolute inset-0 w-full pointer-events-none">
                      <div className="absolute top-0 left-1/4 h-2 w-px bg-gray-400"></div>
                      <div className="absolute top-0 left-1/2 h-2 w-px bg-gray-400"></div>
                      <div className="absolute top-0 left-3/4 h-2 w-px bg-gray-400"></div>
                    </div>
                    
                    {result.segments?.map((segment, index) => {
                      const startPercent = (segment.start_time / formatDuration(result.videoDuration)) * 100;
                      const widthPercent = ((segment.end_time - segment.start_time) / formatDuration(result.videoDuration)) * 100;
                      const confidence = segment.confidence || 0;
                      // Check if this is a matched segment
                      const isMatched = confidence > 0;
                      
                      const getSegmentColor = (conf: number) => {
                        if (conf >= 0.8) return "bg-green-500";
                        if (conf >= 0.6) return "bg-blue-500";
                        return "bg-gray-500";
                      };
                      
                      return (
                        <div
                          key={index}
                          className={`absolute h-full transition-all duration-200 hover:shadow-md hover:opacity-100 cursor-pointer rounded-sm ${isMatched ? getSegmentColor(confidence) : "bg-gray-400"}`}
                          style={{
                            left: `${startPercent}%`,
                            width: `${Math.max(widthPercent, 1)}%`, /* Ensure minimum width for very short segments */
                            opacity: isMatched ? Math.max(0.5, confidence) : 0.3,
                            transform: hoveredSegment?.segmentIndex === index ? 'scaleY(1.1)' : 'scaleY(1)',
                            zIndex: hoveredSegment?.segmentIndex === index ? 10 : 1,
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
                <div className="mt-2 flex justify-between items-center">
                  <span className="text-sm font-medium text-gray-700">0:00</span>
                  <div className="flex space-x-2">
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-100 text-green-800 text-xs font-medium">
                      <CheckCircleIcon className="h-3 w-3" />
                      High
                    </span>
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-100 text-blue-800 text-xs font-medium">
                      <ExclamationCircleIcon className="h-3 w-3" />
                      Medium
                    </span>
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-gray-100 text-gray-800 text-xs font-medium">
                      <QuestionMarkCircleIcon className="h-3 w-3" />
                      Low
                    </span>
                  </div>
                  <span className="text-sm font-medium text-gray-700">{result.videoDuration}</span>
                </div>
              </div>
            </div>
          </div>
        </button>
      ))}
    </div>
  ), [results, showConfidenceScores, formatDuration, handleVideoClick, handleSegmentClick, hoveredSegment, formatTimeDisplay, getConfidenceLevel, getConfidenceIcon])

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
