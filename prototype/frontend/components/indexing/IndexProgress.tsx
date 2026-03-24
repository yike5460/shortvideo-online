'use client'

import { useState, useEffect } from 'react'
import { CheckCircleIcon, XCircleIcon } from '@heroicons/react/24/outline'
import { videosApi } from '@/lib/api'

interface IndexProgressProps {
  indexId: string
  videoIds: string[]
  onComplete: () => void
}

interface IndexStatus {
  status: 'processing' | 'completed' | 'failed'
  progress: number
  videoCount: number
  completedCount: number
  failedCount: number
  processingCount: number
  currentVideo?: {
    id: string
    name: string
    status: string
    thumbnail?: string
  }
  processingVideos?: Array<{
    id: string
    name: string
    status: string
    thumbnail?: string
  }>
  pagination?: {
    page: number
    pageSize: number
    totalPages: number
    totalCount: number
  }
}

// Map status values to user-friendly messages
export type VideoStatus = 
  | 'awaiting_upload'   // Initial state when pre-signed URL is generated
  | 'uploading'         // File is being uploaded to S3
  | 'uploaded'          // File upload completed
  | 'processing'        // Video is being processed (slicing/indexing)
  | 'ready_for_face'    // Video completed face detection
  | 'ready_for_object'   // Video completed object detection
  | 'ready_for_shots'   // Video completed shot detection
  | 'ready_for_video_embed'   // Video completed video embedding
  | 'ready_for_audio_embed'   // Video completed audio embedding
  | 'ready'             // Video is fully processed and searchable
  | 'error'             // Processing failed
  | 'deleted';          // Video was deleted

const statusMessages: Record<VideoStatus, string> = {
  awaiting_upload: 'Awaiting to upload video',
  uploading: 'Uploading video',
  uploaded: 'Video uploaded',
  processing: 'Processing video',
  ready_for_face: 'Facial processing complete',
  ready_for_object: 'Object processing complete',
  ready_for_shots: 'Shots processing complete',
  ready_for_video_embed: 'Embedding video complete',
  ready_for_audio_embed: 'Embedding audio complete',
  ready: 'Processing complete',
  error: 'Processing failed',
  deleted: 'Video deleted',
};

// Map status to progress percentage weight
const statusProgressWeights: Record<VideoStatus, number> = {
  awaiting_upload: 0,
  uploading: 10,
  uploaded: 20,
  processing: 30,
  // Use a common weight for all parallel processing stages
  ready_for_face: 60,
  ready_for_object: 60,
  ready_for_shots: 60,
  ready_for_video_embed: 80,
  ready_for_audio_embed: 90,
  ready: 100,
  error: 0,
  deleted: 0
};

export default function IndexProgress({ indexId, videoIds, onComplete }: IndexProgressProps) {
  const [progress, setProgress] = useState(0)
  const [statusBasedProgress, setStatusBasedProgress] = useState(0)
  // Align with the WebVideoStatus enum in types/common.ts
  const [status, setStatus] = useState<'processing' | 'completed' | 'error'>('processing')
  const [error, setError] = useState<string | null>(null)
  const [processingVideos, setProcessingVideos] = useState<Array<{
    id: string;
    name: string;
    status: string;
    thumbnail?: string;
  }>>([])
  const [previousVideoStatuses, setPreviousVideoStatuses] = useState<Record<string, string>>({})
  const [stats, setStats] = useState({
    videoCount: 0,
    completedCount: 0,
    failedCount: 0,
    processingCount: 0
  })

  useEffect(() => {
    // Poll for status of the index
    const checkProgress = async () => {
      try {
        // Get the index status
        const videoIdsParam = videoIds && videoIds.length > 0 ? videoIds.join(',') : undefined;
        const indexStatus: IndexStatus = await videosApi.getVideoStatus(indexId, videoIdsParam);
        
        // Update component state based on index status
        setProgress(indexStatus.progress);
        
        // Update statistics
        setStats({
          videoCount: indexStatus.videoCount,
          completedCount: indexStatus.completedCount,
          failedCount: indexStatus.failedCount,
          processingCount: indexStatus.processingCount
        });
        
        if (indexStatus.status === 'failed') {
          setStatus('error');
          setError(`${indexStatus.failedCount} videos failed to process`);
        } else if (indexStatus.status === 'completed') {
          setStatus('completed');
          
          // Call onComplete after a short delay to show the completed state
          setTimeout(() => {
            onComplete();
          }, 2000);
        }
        
        // Update processing videos array and track status changes
        let newProcessingVideos: Array<{
          id: string;
          name: string;
          status: string;
          thumbnail?: string;
        }> = [];
        
        // Use processingVideos array, ignoring currentVideo
        if (Array.isArray(indexStatus.processingVideos)) {
          newProcessingVideos = indexStatus.processingVideos;
        }
        
        // Check for status changes and update progress accordingly
        const newStatusMap: Record<string, string> = {};
        let statusChanged = false;
        
        // Calculate status-based progress that includes both processing and completed videos
        // Store video statuses for change detection
        newProcessingVideos.forEach(video => {
          newStatusMap[video.id] = video.status;
          if (previousVideoStatuses[video.id] !== video.status) {
            statusChanged = true;
          }
        });
        
        // Calculate combined progress that includes both processing and completed videos
        const calculateCombinedProgress = () => {
          // If there are no videos, progress is 0
          if (indexStatus.videoCount === 0) return 0;
          
          // Calculate progress contribution from processing videos
          const processingProgress = newProcessingVideos.reduce((sum, video) => {
            return sum + (video.status in statusProgressWeights 
              ? statusProgressWeights[video.status as VideoStatus] 
              : 0);
          }, 0);
          
          // Each completed video contributes 100% to the progress
          const completedProgress = indexStatus.completedCount * 100;
          
          // Failed videos contribute 0% (already accounted for by not including them)
          
          // Calculate total videos being considered for progress (processing + completed)
          const totalVideosForProgress = newProcessingVideos.length + indexStatus.completedCount;
          
          // Avoid division by zero
          if (totalVideosForProgress === 0) return 0;
          
          // Return the weighted average progress
          return (processingProgress + completedProgress) / totalVideosForProgress;
        };
        
        // Always calculate the progress to reflect the current state
        const combinedProgress = calculateCombinedProgress();
        // Round to nearest integer for display
        setStatusBasedProgress(Math.round(combinedProgress));
        
        // Update state
        setProcessingVideos(newProcessingVideos);
        setPreviousVideoStatuses(newStatusMap);
      } catch (err) {
        console.error('Error checking index progress:', err);
        setError('Failed to check indexing progress');
      }
    };

    // Check immediately and then every 5 seconds
    checkProgress();
    const interval = setInterval(checkProgress, 5000);
    
    return () => clearInterval(interval);
  }, [indexId, onComplete]);

  return (
    <div className="bg-white rounded-lg shadow-sm p-6 space-y-6">
      {/* Status header */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900">
          Indexing Progress
        </h2>
        <div className="flex items-center space-x-2">
          <span className="text-sm font-medium text-gray-600">
            {Math.max(progress, statusBasedProgress)}% complete
          </span>
          {status === 'completed' && (
            <CheckCircleIcon className="h-5 w-5 text-green-500" />
          )}
          {status === 'error' && (
            <XCircleIcon className="h-5 w-5 text-red-500" />
          )}
        </div>
      </div>

      {/* Progress bar */}
      <div className="space-y-2">
        <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
          <div
            className={`h-full transition-all duration-500 ${
              status === 'error' 
                ? 'bg-red-500' 
                : status === 'completed' 
                  ? 'bg-green-500' 
                  : 'bg-primary-600'
            }`}
            style={{ width: `${Math.max(progress, statusBasedProgress)}%` }}
          />
        </div>
        <div className="flex justify-between text-sm text-gray-600">
          <span>
            {stats.completedCount} of {stats.videoCount} videos completed
            {stats.failedCount > 0 && ` (${stats.failedCount} failed)`}
          </span>
          {status === 'error' && (
            <span className="text-red-600">{error}</span>
          )}
        </div>
      </div>

      {/* Processing videos */}
      {status === 'processing' && processingVideos.length > 0 && (
        <div className="space-y-4">
          <h3 className="text-sm font-medium text-gray-700">Currently Processing Videos</h3>
          {/* Grid layout for videos */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {processingVideos.slice(0, 8).map((video) => (
              <div 
                key={video.id} 
                className="text-sm border border-gray-100 rounded-md p-3 bg-gray-50 hover:bg-gray-100 transition-colors"
              >
                <div className="flex flex-col space-y-2">
                  {/* Video title and thumbnail */}
                  <div className="flex justify-between items-center">
                    <span className="font-medium truncate max-w-[180px]" title={video.name}>
                      {video.name}
                    </span>
                    {video.thumbnail && (
                      <img 
                        src={video.thumbnail} 
                        alt={video.name} 
                        className="h-12 w-20 object-cover rounded shadow-sm"
                      />
                    )}
                  </div>
                  
                  {/* Status indicator with animated dot */}
                  <div className="flex items-center">
                    <div 
                      className={`w-2 h-2 rounded-full mr-2 animate-pulse ${
                        video.status === 'error' 
                          ? 'bg-red-500' 
                          : video.status === 'ready' 
                            ? 'bg-green-500' 
                            : 'bg-primary-500'
                      }`}
                    ></div>
                    <span className="font-medium text-xs sm:text-sm">
                      {(video.status in statusMessages) 
                        ? statusMessages[video.status as VideoStatus] 
                        : video.status}
                    </span>
                  </div>
                  
                  {/* Progress bar */}
                  <div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden mt-1">
                    <div 
                      className={`h-full transition-all duration-300 ${
                        video.status === 'error' 
                          ? 'bg-red-500' 
                          : video.status === 'ready' 
                            ? 'bg-green-500' 
                            : 'bg-primary-500'
                      }`}
                      style={{ 
                        width: `${
                          video.status in statusProgressWeights 
                            ? statusProgressWeights[video.status as VideoStatus] 
                            : 0
                        }%` 
                      }}
                    />
                  </div>
                  
                  {/* Progress percentage */}
                  <div className="text-right text-xs text-gray-500">
                    {video.status in statusProgressWeights 
                      ? `${statusProgressWeights[video.status as VideoStatus]}%`
                      : '0%'
                    }
                  </div>
                </div>
              </div>
            ))}
          </div>
          
          {/* Show count of additional videos */}
          {processingVideos.length > 8 && (
            <p className="text-xs text-gray-500 mt-2">
              And {processingVideos.length - 8} more videos processing...
            </p>
          )}
          
          <div className="bg-gray-50 p-3 rounded-md mt-3 border border-gray-100">
            <p className="text-xs text-gray-600">
              Processing may take a few minutes depending on video length. The system processes multiple videos in parallel.
            </p>
          </div>
        </div>
      )}

      {/* Status messages */}
      {status === 'completed' && (
        <div className="text-green-600 font-medium">
          All videos have been successfully indexed!
        </div>
      )}
      {status === 'error' && (
        <div className="text-red-600">
          {error}
        </div>
      )}
    </div>
  )
}
