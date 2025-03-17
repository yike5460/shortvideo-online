'use client'

import { useState, useEffect } from 'react'
import { CheckCircleIcon, XCircleIcon } from '@heroicons/react/24/outline'

// Import API endpoint from environment
const API_ENDPOINT = process.env.NEXT_PUBLIC_API_URL

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
  ready_for_face: 45,
  ready_for_object: 60,
  ready_for_shots: 70,
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
        const response = await fetch(`${API_ENDPOINT}/videos/status?index=${indexId}`);
        if (!response.ok) {
          throw new Error(`Failed to get index status: ${response.statusText}`);
        }
        
        const indexStatus: IndexStatus = await response.json();
        
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
        
        if (indexStatus.currentVideo) {
          // For backward compatibility, if API still returns single currentVideo
          newProcessingVideos = [{
            id: indexStatus.currentVideo.id,
            name: indexStatus.currentVideo.name,
            status: indexStatus.currentVideo.status,
            thumbnail: indexStatus.currentVideo.thumbnail
          }];
        } else if (Array.isArray(indexStatus.processingVideos)) {
          // If the API has been updated to return multiple videos
          newProcessingVideos = indexStatus.processingVideos;
        }
        
        // Check for status changes and update progress accordingly
        const newStatusMap: Record<string, string> = {};
        let statusChanged = false;
        let totalProgressWeight = 0;
        
        // Calculate status-based progress
        newProcessingVideos.forEach(video => {
          // Store current status for next comparison
          newStatusMap[video.id] = video.status;
          
          // Check if this video's status has changed
          if (previousVideoStatuses[video.id] !== video.status) {
            statusChanged = true;
          }
          
          // Add this video's progress weight to total
          if (video.status in statusProgressWeights) {
            totalProgressWeight += statusProgressWeights[video.status as VideoStatus];
          }
        });
        
        // Update progress when status changes
        if (statusChanged && newProcessingVideos.length > 0) {
          // Calculate average progress weight across all videos
          const averageProgress = totalProgressWeight / newProcessingVideos.length;
          setStatusBasedProgress(averageProgress);
        }
        
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
          <div className="space-y-3">
            {processingVideos.slice(0, 5).map((video) => (
              <div key={video.id} className="text-sm border border-gray-100 rounded-md p-3 bg-gray-50">
                <div className="flex flex-col space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="font-medium truncate">{video.name}</span>
                    {video.thumbnail && (
                      <img 
                        src={video.thumbnail} 
                        alt={video.name} 
                        className="h-10 w-16 object-cover rounded"
                      />
                    )}
                  </div>
                  <div className="flex items-center">
                    <div className="w-2 h-2 bg-primary-500 rounded-full animate-pulse mr-2"></div>
                    <span className="font-medium">
                      {(video.status in statusMessages) 
                        ? statusMessages[video.status as VideoStatus] 
                        : video.status}
                    </span>
                  </div>
                </div>
              </div>
            ))}
            {processingVideos.length > 5 && (
              <p className="text-xs text-gray-500">
                And {processingVideos.length - 5} more videos processing...
              </p>
            )}
            <p className="text-xs text-gray-500">
              Processing may take a few minutes depending on video length.
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
