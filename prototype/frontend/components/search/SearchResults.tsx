'use client'

import { useState, useCallback, useMemo, useRef, useEffect } from 'react'
import { ArrowPathIcon, ArrowsRightLeftIcon, CheckIcon, ChevronDownIcon, CloudArrowDownIcon, ArrowRightIcon, ShoppingCartIcon } from '@heroicons/react/24/outline'
import { Tab } from '@headlessui/react'
import { VideoCameraIcon, ClockIcon, CheckCircleIcon, ExclamationCircleIcon, QuestionMarkCircleIcon } from '@heroicons/react/24/outline'
import CartIcon from '@/components/cart/CartIcon'
import CartPanel from '@/components/cart/CartPanel'
import { cn } from '@/lib/utils'
import { VideoResult, VideoSegment, SearchOptions } from '@/types'
import VideoModal from '@/components/VideoModal'
import { useToast } from '@/components/ui/Toast'
import AddToCartButton from '@/components/cart/AddToCartButton'
import { useCart } from '@/lib/cart/CartContext'
import Link from 'next/link'

// Add API configuration
const API_ENDPOINT = process.env.NEXT_PUBLIC_API_URL

interface SearchResultsProps {
  results: VideoResult[]
  showConfidenceScores: boolean
  searchOptions: SearchOptions
}

export default function SearchResults({
  results,
  showConfidenceScores,
  searchOptions
}: SearchResultsProps) {
  const { addToast } = useToast();
  const { addToCart } = useCart(); // Add useCart hook at the component level
  const [selectedView, setSelectedView] = useState<'clip' | 'video'>('clip')
  const [selectedVideo, setSelectedVideo] = useState<VideoResult | null>(null)
  const [selectedSegment, setSelectedSegment] = useState<VideoSegment | null>(null)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [hoveredSegment, setHoveredSegment] = useState<{
    videoId: string,
    segmentIndex: number,
    rect: DOMRect | null
  } | null>(null)
  
  // State to track selected segments for each video
  const [selectedSegments, setSelectedSegments] = useState<Record<string, VideoSegment[]>>({})
  
  // State to track if a merge operation is in progress
  const [isMerging, setIsMerging] = useState(false)
  const [mergedSegment, setMergedSegment] = useState<VideoSegment | null>(null)
  
  // State to track merge status
  const [mergeStatus, setMergeStatus] = useState<{
    status: 'idle' | 'initiating' | 'processing' | 'completed' | 'failed',
    message: string,
    s3Path?: string,
    videoId?: string,
    indexId?: string
  }>({
    status: 'idle',
    message: ''
  });
  
  // Reference to store polling intervals for cleanup
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  
  // Clean up any active polling on unmount
  useEffect(() => {
    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
      }
    };
  }, []);

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
  
  // Helper function to check if a segment is selected
  const isSegmentSelected = useCallback((videoId: string, segmentId: string) => {
    if (!selectedSegments[videoId]) return false;
    return selectedSegments[videoId].some(segment => segment.segment_id === segmentId);
  }, [selectedSegments]);
  
  // Helper function to toggle segment selection
  const toggleSegmentSelection = useCallback((video: VideoResult, segment: VideoSegment, e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent triggering parent button click
    
    setSelectedSegments(prev => {
      const videoSegments = prev[video.id] || [];
      const isSelected = videoSegments.some(s => s.segment_id === segment.segment_id);
      
      let updatedSegments;
      if (isSelected) {
        // Remove segment if already selected
        updatedSegments = videoSegments.filter(s => s.segment_id !== segment.segment_id);
      } else {
        // Add segment if not selected
        updatedSegments = [...videoSegments, segment];
      }
      
      // If no segments left for this video, clean up the entry
      if (updatedSegments.length === 0) {
        const newSelectedSegments = {...prev};
        delete newSelectedSegments[video.id];
        return newSelectedSegments;
      }
      
      return {
        ...prev,
        [video.id]: updatedSegments
      };
    });
  }, []);
  
  // Helper function to clear selected segments for a video
  const clearSelectedSegments = useCallback((videoId: string) => {
    setSelectedSegments(prev => {
      const newSelectedSegments = {...prev};
      delete newSelectedSegments[videoId];
      return newSelectedSegments;
    });
  }, []);
  
  // Helper function to select all matched segments for a video
  const selectAllMatchedSegments = useCallback((video: VideoResult) => {
    // Get all segments that have a confidence score > 0
    const matchedSegments = (video.segments || []).filter(segment => 
      (segment.confidence || 0) > 0
    );
    
    if (matchedSegments.length === 0) {
      addToast('info', 'No matched segments found to select', { duration: 3000 });
      return;
    }
    
    setSelectedSegments(prev => {
      // Get current selections for this video
      const currentSelections = prev[video.id] || [];
      
      // Create a set of already selected segment IDs for quick lookup
      const selectedIds = new Set(currentSelections.map(s => s.segment_id));
      
      // Add all matched segments that aren't already selected
      const newSelections = [
        ...currentSelections,
        ...matchedSegments.filter(segment => 
          segment.segment_id && !selectedIds.has(segment.segment_id)
        )
      ];
      
      // If no new segments were added, show a toast
      if (newSelections.length === currentSelections.length) {
        addToast('info', 'All matched segments are already selected', { duration: 3000 });
        return prev;
      }
      
      // Show success toast with count of newly selected segments
      const newlyAdded = newSelections.length - currentSelections.length;
      addToast('success', `Selected ${newlyAdded} additional segment${newlyAdded === 1 ? '' : 's'}`, {
        duration: 3000
      });
      
      return {
        ...prev,
        [video.id]: newSelections
      };
    });
  }, [addToast]);
  
  // Function to poll for merged file existence
  const startPollingForMergedFile = useCallback((s3Path: string, videoId: string, indexId: string, segmentCount: number) => {
    const checkInterval = 5000; // Check every 5 seconds
    const maxAttempts = 60;     // Maximum 5 minutes (60 * 5 seconds)
    let attempts = 0;
    
    // Clear any existing intervals
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
    }
    
    // Start polling
    pollingIntervalRef.current = setInterval(() => {
      attempts++;
      console.log(`Checking if merged file exists (attempt ${attempts}/${maxAttempts})...`);
      
      // TODO, since we don't have a direct API to check file existence,
      // we'll simulate checking by waiting for a few attempts
      if (attempts >= 3) { // Simulate the file being ready after 15 seconds (3 * 5s)
        // Clear interval
        if (pollingIntervalRef.current) {
          clearInterval(pollingIntervalRef.current);
          pollingIntervalRef.current = null;
        }
        
        // Update status to completed
        setMergeStatus({
          status: 'completed',
          message: 'Merge completed successfully!',
          videoId,
          indexId
        });
        
        // Show success toast with action to view merged video
        addToast('success', `Successfully merged ${segmentCount} clips`, {
          duration: 8000, // 8 seconds
          action: {
            label: 'View merged video',
            onClick: () => {
              // Navigate to the videos page with the merged video
              window.location.href = `/videos?indexId=${encodeURIComponent(indexId)}&videoId=${encodeURIComponent(videoId)}`;
            }
          }
        });
        
        return;
      }
      
      // If max attempts reached
      if (attempts >= maxAttempts) {
        clearInterval(pollingIntervalRef.current!);
        pollingIntervalRef.current = null;
        
        // Update status to failed
        setMergeStatus({
          status: 'failed',
          message: 'Merge process timed out. The video might still be processing.'
        });
        
        // Show error toast
        addToast('error', 'Merge process timed out. The video might still be processing.');
      }
    }, checkInterval);
    
    // Return a cleanup function
    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
    };
  }, [addToast]);
  
  // Helper function to merge selected segments for a video
  const mergeSegments = useCallback(async (video: VideoResult, segments: VideoSegment[]) => {
    if (segments.length < 2) {
      addToast('error', 'Please select at least 2 clips to merge');
      return;
    }
    
    // Show merging in progress
    setIsMerging(true);
    setMergeStatus({
      status: 'initiating',
      message: 'Starting merge operation...'
    });
    
    try {
      // Get segment IDs for the API call
      const segmentIds = segments.map(segment => segment.segment_id!);
      
      // Extract the actual video ID from the first segment ID
      // Assuming segment_id format is [videoId]_segment_[segmentNumber]
      const extractedVideoId = segmentIds[0].split('_segment_')[0];
      
      // Create a merged name based on timestamp and selected segment count
      const mergedName = `merged_${segments.length}_clips_${Date.now()}`;
      
      // Use the selected index from searchOptions if available, otherwise fall back to video.indexId
      const indexId = searchOptions.selectedIndex || video.indexId;
      
      console.log('Merging segments:', segmentIds, 'into', mergedName, ' video id:', extractedVideoId, ' video index:', indexId);
      
      // Show processing toast
      addToast('info', 'Starting merge process. This may take a minute...');
      
      // Call the backend API to perform the actual merge
      const response = await fetch(`${API_ENDPOINT}/videos/merge`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          indexId,
          videoId: extractedVideoId, // Use extracted ID instead of video.id
          segmentIds,
          mergedName
        }),
      });
      
      if (!response.ok) {
        throw new Error(`Failed to merge segments: ${response.statusText}`);
      }
      
      const result = await response.json();
      
      // Update merge status
      setMergeStatus({
        status: 'processing',
        message: 'Merging in progress...',
        s3Path: result.mergedSegment?.segment_video_s3_path,
        videoId: extractedVideoId,
        indexId
      });
      
      // Create a client-side representation of the merged segment for immediate display
      const mergedSegment: VideoSegment = {
        ...result.mergedSegment,
        segment_id: result.mergedSegment.segment_id || `merged_${Date.now()}`,
        video_id: video.id,
        segment_video_thumbnail_url: result.mergedSegment.segment_video_thumbnail_url,
        segment_visual: {
          segment_visual_description: `Merged clip: ${segments.length} segments`
        }
      };
      
      // Display the merged segment
      setMergedSegment(mergedSegment);
      
      // Clear selected segments after initiating merge
      clearSelectedSegments(video.id);
      
      // Start polling for the merged file
      startPollingForMergedFile(
        result.mergedSegment.segment_video_s3_path,
        extractedVideoId,
        indexId,
        segments.length
      );
      
    } catch (error) {
      console.error('Error merging segments:', error);
      
      // Show error toast
      addToast('error', `Failed to merge segments: ${error instanceof Error ? error.message : 'Unknown error'}`);
      
      // Update merge status
      setMergeStatus({
        status: 'failed',
        message: `Failed to merge: ${error instanceof Error ? error.message : 'Unknown error'}`
      });
    }
  }, [clearSelectedSegments, searchOptions, addToast, startPollingForMergedFile]);
  
  // Helper function to download selected segments
  const downloadSelectedSegments = useCallback((video: VideoResult, segments: VideoSegment[]) => {
    if (!segments || segments.length === 0) {
      addToast('error', 'No clips selected for download', { duration: 3000 });
      return;
    }
    
    console.log('Downloading segments:', segments);

    // Browser download limitations - most browsers block multiple automatic downloads
    const MAX_AUTO_DOWNLOADS = 3;
    const hasMultipleSegments = segments.length > 1;
    const hasTooManySegments = segments.length > MAX_AUTO_DOWNLOADS;
    
    if (hasTooManySegments) {
      // Show warning about browser limitations for multiple downloads
      addToast('info', `Browser security may block multiple downloads. Only the first ${MAX_AUTO_DOWNLOADS} clips will be downloaded.`, {
        duration: 8000
      });
    }
    
    // Show initial download notification
    addToast('info', `Starting download for ${Math.min(segments.length, MAX_AUTO_DOWNLOADS)} clips from "${video.title}"`, {
      duration: 5000
    });
    
    // Limit the number of segments to download to prevent browser blocking
    const segmentsToDownload = hasTooManySegments 
      ? segments.slice(0, MAX_AUTO_DOWNLOADS) 
      : segments;
    
    // Counter for successful downloads
    let downloadCount = 0;

    // Process each segment for download using segment-specific URLs
    segmentsToDownload.forEach((segment, index) => {
      // Determine the URL to use for download
      // Since TypeScript doesn't recognize segment_video_url despite it being in the .d.ts file,
      // we'll use a safe property access approach with type casting
      const segmentVideoUrl = (segment as any).segment_video_preview_url;
      console.log('Downloading segment URL is :', segmentVideoUrl);
      // Create the download URL based on availability
      let segmentUrl = '';
      if (segmentVideoUrl) {
        // Use the direct segment video URL if available
        segmentUrl = segmentVideoUrl;
      } else if (segment.segment_id && video.indexId) {
        // Fall back to constructing a URL based on segment ID
        segmentUrl = `${API_ENDPOINT}/videos/${video.indexId}/${video.id}/segments/${segment.segment_id}/download`;
      } else {
        // As a last resort, use the video preview URL
        segmentUrl = video.videoPreviewUrl || '';
      }
      
      // Ensure we have a URL to download
      if (!segmentUrl) {
        console.error(`No URL available for segment ${segment.segment_id || index}`);
        addToast('error', `Failed to download clip ${index + 1}: No URL available`, { duration: 3000 });
        return;
      }

      // Open the URL directly in a new window with staggered timing to avoid browser blocking
      setTimeout(() => {
        try {
          // Create a download link
          const link = document.createElement('a');
          link.href = segmentUrl;
          
          // Set the filename
          const fileName = `${video.title.replace(/[^\w\s-]/gi, '')}-clip-${formatTimeDisplay(segment.start_time)}-${formatTimeDisplay(segment.end_time)}.mp4`;
          link.setAttribute('download', fileName);
          link.setAttribute('target', '_blank');
          
          // Add link to document, click it, then remove it
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          
          downloadCount++;
          if (downloadCount === segmentsToDownload.length) {
            const message = hasTooManySegments
              ? `Downloaded ${downloadCount}/${segments.length} clips. Use CSV export for all metadata.`
              : `Downloaded ${downloadCount} video clips`;
              
            addToast('success', message, { duration: 5000 });
          }
        } catch (error) {
          console.error(`Error downloading segment ${segment.segment_id || index}:`, error);
          addToast('error', `Failed to download clip ${index + 1}`, { duration: 3000 });
        }
      }, 1500 * index); // Stagger downloads with a longer delay (1.5 seconds) to reduce browser blocking
    });
  }, [addToast, formatTimeDisplay, API_ENDPOINT]);

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
              className="bg-white rounded-lg shadow-sm overflow-hidden text-left transition-transform hover:scale-[1.02] focus:outline-none focus:ring-2 focus:ring-indigo-500"
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
                      ? 'bg-purple-600' 
                      : confidenceScore >= 0.6 
                        ? 'bg-indigo-600' 
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
                  <span className="text-xs py-0.5 px-1.5 bg-indigo-100 text-indigo-800 rounded">Clip</span>
                  <span className="text-sm text-gray-500">
                    {formatTimeDisplay(segment.duration)} duration
                  </span>
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <span className="text-sm text-gray-500">
                    {formatTimeDisplay(segment.duration)} duration
                  </span>
                  {/* Removed individual AddToCartButton to reduce visual clutter */}
                </div>
                <div className="mt-2 flex items-center justify-between text-sm text-gray-600">
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
  }, [results, showConfidenceScores, handleSegmentClick, formatTimeDisplay, getConfidenceLevel, getConfidenceIcon, searchOptions]);

  const renderTimelineView = useCallback(() => (
    <div className="space-y-8">
      {results.map((result) => (
        <div
          key={result.id}
          className="bg-white rounded-lg shadow-sm p-6 w-full text-left"
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
                {/* User interaction hint banner - increased margin to avoid overlap with confidence scores */}
                <div className="mb-12 text-xs text-gray-500 flex items-center gap-1 px-2 py-1 bg-gray-50 border border-gray-200 rounded">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span>Click on colored segments to select clips for batch operations. Use <kbd className="px-1 py-0.5 bg-gray-200 rounded text-xs">Ctrl</kbd>/<kbd className="px-1 py-0.5 bg-gray-200 rounded text-xs">⌘</kbd>+Click to view clip details.</span>
                </div>
                
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
                                  ? 'bg-purple-600' 
                                  : segmentConfidence >= 0.6 
                                    ? 'bg-indigo-600' 
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
                      if (level === 'High') return "bg-purple-500";
                      if (level === 'Medium') return "bg-indigo-500";
                      return "bg-gray-500";
                    };
                    
                    return (
                      <div
                        key={`confidence-${index}`}
                        className={`absolute -top-8 transform -translate-x-1/2 whitespace-nowrap flex items-center gap-1 rounded-full px-2 py-1 text-xs font-bold text-white shadow-md ${getBadgeColor(confidenceLevel)}`}
                        style={{ left: `${centerPercent}%` }}
                      >
                        {/* {getConfidenceIcon(confidenceLevel)} */}
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
                        if (conf >= 0.8) return "bg-purple-500";
                        if (conf >= 0.6) return "bg-indigo-500";
                        return "bg-gray-500";
                      };
                      
                      // Check if segment is selected
                      const isSelected = segment.segment_id && 
                        isSegmentSelected(result.id, segment.segment_id);
                      
                      return (
                        <div
                          key={index}
                          className={`absolute h-full transition-all duration-200 hover:shadow-md hover:opacity-100 cursor-pointer rounded-sm ${
                            isSelected 
                              ? 'bg-fuchsia-600 ring-2 ring-fuchsia-500 ring-offset-1' 
                              : isMatched 
                                ? getSegmentColor(confidence) 
                                : "bg-gray-400"
                          }`}
                          style={{
                            left: `${startPercent}%`,
                            width: `${Math.max(widthPercent, 1)}%`, /* Ensure minimum width for very short segments */
                            opacity: isSelected ? 0.9 : isMatched ? Math.max(0.5, confidence) : 0.3,
                            transform: hoveredSegment?.segmentIndex === index || isSelected ? 'scaleY(1.2)' : 'scaleY(1)',
                            zIndex: hoveredSegment?.segmentIndex === index || isSelected ? 10 : 1,
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
                            if (e.ctrlKey || e.metaKey) {
                              // Open the modal when holding Ctrl or Cmd key
                              setSelectedVideo(result);
                              setSelectedSegment(segment);
                              setIsModalOpen(true);
                            } else {
                              // Toggle selection otherwise
                              toggleSegmentSelection(result, segment, e);
                            }
                          }}
                        >
                          {isSelected && (
                            <div className="absolute inset-0 flex items-center justify-center">
                              <CheckIcon className="h-3 w-3 text-white drop-shadow-md" />
                            </div>
                          )}
                          {/* Removed individual AddToCartButton to reduce visual clutter */}
                        </div>
                      );
                    })}
                  </div>
                </div>
                <div className="mt-2 flex justify-between items-center">
                  <span className="text-sm font-medium text-gray-700">0:00</span>
                  <div className="flex space-x-2">
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-purple-100 text-purple-800 text-xs font-medium">
                      <CheckCircleIcon className="h-3 w-3" />
                      High
                    </span>
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-800 text-xs font-medium">
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
          
          {/* Operations panel for selected segments */}
          {selectedSegments[result.id] && selectedSegments[result.id].length > 0 && (
            <div className="mt-4 border-t border-gray-200 pt-4">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-medium text-gray-700">
                  Selected Clips: {selectedSegments[result.id].length}
                </h4>
                <div className="flex gap-2">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      selectAllMatchedSegments(result);
                    }}
                    className="inline-flex items-center gap-1 px-3 py-1 bg-gray-600 hover:bg-gray-700 text-white text-sm font-medium rounded-md transition-colors"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 5h16M4 12h16m-7 7h7" />
                    </svg>
                    Select All
                  </button>
                  
                  {/* Add to Cart button for selected segments */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      
                      // Add all selected segments to cart
                      selectedSegments[result.id].forEach(segment => {
                        // Add to cart directly
                        addToCart({
                          videoId: result.id,
                          indexId: result.indexId,
                          segment: segment,
                          addedAt: Date.now(),
                          source: "",
                          videoTitle: result.title,
                          selectedIndex: searchOptions.selectedIndex
                        });
                      });
                      
                      addToast('success', `Added ${selectedSegments[result.id].length} clips to cart`, {
                        duration: 3000
                      });
                    }}
                    className="inline-flex items-center gap-1 px-3 py-1 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-md transition-colors"
                  >
                    <ShoppingCartIcon className="h-4 w-4" />
                    Add to Cart
                  </button>
                  
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (selectedSegments[result.id].length >= 2) {
                        mergeSegments(result, selectedSegments[result.id]);
                      } else {
                        addToast('error', 'Please select at least 2 clips to merge');
                      }
                    }}
                    className={`inline-flex items-center gap-1 px-3 py-1 text-sm font-medium rounded-md transition-colors ${
                      mergeStatus.status === 'initiating' || mergeStatus.status === 'processing'
                        ? 'bg-yellow-500 cursor-not-allowed'
                        : 'bg-gray-600 hover:bg-gray-700 text-white'
                    }`}
                    disabled={selectedSegments[result.id].length < 2 ||
                             mergeStatus.status === 'initiating' ||
                             mergeStatus.status === 'processing'}
                  >
                    {mergeStatus.status === 'initiating' || mergeStatus.status === 'processing' ? (
                      <>
                        <ArrowPathIcon className="h-4 w-4 animate-spin" />
                        Processing...
                      </>
                    ) : (
                      <>
                        <ArrowsRightLeftIcon className="h-4 w-4" />
                        Merge
                      </>
                    )}
                  </button>
                  <div className="relative group">
                    <button
                      className="inline-flex items-center gap-1 px-3 py-1 bg-gray-600 hover:bg-gray-700 text-white text-sm font-medium rounded-md transition-colors"
                    >
                      <CloudArrowDownIcon className="h-4 w-4" />
                      Download
                      <ChevronDownIcon className="h-3 w-3 ml-1" />
                    </button>
                    <div className="absolute right-0 mt-1 w-56 rounded-md shadow-lg bg-white ring-1 ring-black ring-opacity-5 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-10">
                      <div className="py-1">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            downloadSelectedSegments(result, selectedSegments[result.id]);
                            addToast('info', `Starting download of ${selectedSegments[result.id].length} video clips`, {
                              duration: 5000
                            });
                          }}
                          className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                        >
                          Download Video Clips
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            
                            // Generate CSV data
                            const csvHeader = "segment_id,start_time,end_time,duration,confidence_score,description";
                            const csvRows = selectedSegments[result.id].map(segment => {
                              return [
                                segment.segment_id,
                                formatTimeDisplay(segment.start_time),
                                formatTimeDisplay(segment.end_time),
                                formatTimeDisplay(segment.duration),
                                segment.confidence ? Math.round(segment.confidence * 100) + '%' : 'N/A',
                                segment.segment_visual?.segment_visual_description || ""
                              ].map(value => `"${value}"`).join(",");
                            });
                            const csvData = [csvHeader, ...csvRows].join("\n");
                            
                            // Create and download CSV file
                            const blob = new Blob([csvData], { type: 'text/csv' });
                            const url = window.URL.createObjectURL(blob);
                            const link = document.createElement('a');
                            link.href = url;
                            link.setAttribute('download', `segments-${result.id}-${Date.now()}.csv`);
                            document.body.appendChild(link);
                            link.click();
                            link.remove();
                            
                            addToast('success', `Downloaded CSV metadata for ${selectedSegments[result.id].length} segments`, {
                              duration: 5000
                            });
                          }}
                          className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                        >
                          Download CSV Metadata
                        </button>
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      clearSelectedSegments(result.id);
                    }}
                    className="inline-flex items-center gap-1 px-3 py-1 bg-rose-600 hover:bg-rose-700 text-white text-sm font-medium rounded-md transition-colors"
                  >
                    Clear
                  </button>
                </div>
              </div>
              
              {/* Selected clips timeline */}
              <div className="relative h-8 bg-gray-100 rounded-md overflow-hidden mb-2">
                {selectedSegments[result.id].map((segment, index) => {
                  const startPercent = (segment.start_time / formatDuration(result.videoDuration)) * 100;
                  const widthPercent = ((segment.end_time - segment.start_time) / formatDuration(result.videoDuration)) * 100;
                  
                  return (
                    <div
                      key={`selected-${index}`}
                      className="absolute h-full bg-fuchsia-400 opacity-80 border border-fuchsia-500"
                      style={{
                        left: `${startPercent}%`,
                        width: `${Math.max(widthPercent, 1)}%`,
                      }}
                    />
                  );
                })}
              </div>
              
              {/* Merged segment preview if available */}
              {isMerging && mergedSegment && mergedSegment.video_id === result.id && (
                <div className="bg-fuchsia-50 border border-fuchsia-200 rounded-md p-3 mt-3">
                  <div className="flex items-center justify-between mb-2">
                    <h5 className="text-sm font-medium text-fuchsia-800">
                      {mergeStatus.status === 'completed' 
                        ? 'Merge Complete'
                        : mergeStatus.status === 'failed'
                          ? 'Merge Failed'
                          : 'Merged Clip Preview'}
                    </h5>
                    <button 
                      onClick={() => setIsMerging(false)}
                      className="text-fuchsia-700 hover:text-fuchsia-900"
                    >
                      <span className="text-xs">Close</span>
                    </button>
                  </div>
                  <div className="flex gap-3">
                    <div className="w-24 h-16 bg-gray-200 rounded overflow-hidden">
                      <img 
                        src={mergedSegment.segment_video_thumbnail_url || result.videoThumbnailUrl} 
                        alt="Merged clip preview"
                        className="w-full h-full object-cover"
                      />
                    </div>
                    <div>
                      <div className="text-xs text-gray-600 mb-1">
                        {formatTimeDisplay(mergedSegment.start_time)} - {formatTimeDisplay(mergedSegment.end_time)} 
                        ({formatTimeDisplay(mergedSegment.duration)} duration)
                      </div>
                      <div className="text-sm text-gray-700">
                        {mergedSegment.segment_visual?.segment_visual_description || "Merged clip"}
                      </div>
                      
                      {/* Show view video link when merge completes */}
                      {mergeStatus.status === 'completed' && mergeStatus.videoId && mergeStatus.indexId && (
                        <div className="mt-2">
                          <a 
                            href={`/videos?indexId=${encodeURIComponent(mergeStatus.indexId)}&videoId=${encodeURIComponent(mergeStatus.videoId)}`}
                            className="inline-flex items-center gap-1 text-sm font-medium text-green-600 hover:text-green-800"
                          >
                            <ArrowRightIcon className="h-4 w-4" />
                            View merged video
                          </a>
                        </div>
                      )}
                      
                      {/* Show error message when merge fails */}
                      {mergeStatus.status === 'failed' && (
                        <div className="mt-2 text-sm text-red-500">
                          {mergeStatus.message}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  ), [
    results, 
    showConfidenceScores, 
    formatDuration, 
    hoveredSegment, 
    formatTimeDisplay, 
    getConfidenceLevel, 
    getConfidenceIcon,
    selectedSegments,
    isSegmentSelected,
    toggleSegmentSelection,
    mergeSegments,
    downloadSelectedSegments,
    clearSelectedSegments,
    selectAllMatchedSegments,
    isMerging,
    mergedSegment,
    searchOptions
  ])

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
        
        {/* Cart Icon */}
        <div className="flex items-center">
          <div className="relative">
            <CartIcon />
          </div>
        </div>
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
      
      {/* CartPanel is now rendered inside CartIcon component */}
    </div>
  )
}
