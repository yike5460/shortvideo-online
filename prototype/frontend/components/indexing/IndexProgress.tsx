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
}

// Map technical status values to user-friendly messages
const statusMessages: Record<string, string> = {
  uploading: 'Uploading video',
  processing: 'Processing video',
  extracting_audio: 'Extracting audio',
  embedding_audio: 'Analyzing audio',
  extracting_video: 'Extracting video frames',
  embedding_video: 'Analyzing video content',
  generating_thumbnail: 'Generating thumbnail',
  ready_for_video_embed: 'Preparing final output',
  completed: 'Completed',
  failed: 'Processing failed'
};

export default function IndexProgress({ indexId, videoIds, onComplete }: IndexProgressProps) {
  const [progress, setProgress] = useState(0)
  // Align with the WebVideoStatus enum in types/common.ts
  const [status, setStatus] = useState<'processing' | 'completed' | 'error'>('processing')
  const [error, setError] = useState<string | null>(null)
  const [currentVideo, setCurrentVideo] = useState<{
    name: string;
    status: string;
  } | null>(null)
  const [stats, setStats] = useState({
    videoCount: 0,
    completedCount: 0,
    failedCount: 0,
    processingCount: 0
  })
  const [statusLog, setStatusLog] = useState<Array<{
    timestamp: Date;
    message: string;
    type: 'success' | 'error' | 'info';
  }>>([])

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
        const newStats = {
          videoCount: indexStatus.videoCount,
          completedCount: indexStatus.completedCount,
          failedCount: indexStatus.failedCount,
          processingCount: indexStatus.processingCount
        };
        
        // Check if any stats changed to update the log
        if (
          newStats.completedCount > stats.completedCount ||
          newStats.failedCount > stats.failedCount ||
          indexStatus.currentVideo?.status !== currentVideo?.status
        ) {
          // Add new log entry
          if (newStats.completedCount > stats.completedCount) {
            const completedDiff = newStats.completedCount - stats.completedCount;
            setStatusLog(prev => [
              {
                timestamp: new Date(),
                message: `${completedDiff} video${completedDiff > 1 ? 's' : ''} completed`,
                type: 'success'
              },
              ...prev.slice(0, 4) // Keep only last 5 entries
            ]);
          }
          
          if (newStats.failedCount > stats.failedCount) {
            const failedDiff = newStats.failedCount - stats.failedCount;
            setStatusLog(prev => [
              {
                timestamp: new Date(),
                message: `${failedDiff} video${failedDiff > 1 ? 's' : ''} failed processing`,
                type: 'error'
              },
              ...prev.slice(0, 4)
            ]);
          }
          
          if (indexStatus.currentVideo?.status !== currentVideo?.status) {
            const statusText = statusMessages[indexStatus.currentVideo?.status || ''] || 
                              indexStatus.currentVideo?.status || 'Processing';
            
            setStatusLog(prev => [
              {
                timestamp: new Date(),
                message: `Status changed: ${statusText}`,
                type: 'info'
              },
              ...prev.slice(0, 4)
            ]);
          }
        }
        
        setStats(newStats);
        
        if (indexStatus.status === 'failed') {
          setStatus('error');
          setError(`${indexStatus.failedCount} videos failed to process`);
        } else if (indexStatus.status === 'completed') {
          setStatus('completed');
          // Add completion log
          setStatusLog(prev => [
            {
              timestamp: new Date(),
              message: 'All processing completed',
              type: 'success'
            },
            ...prev.slice(0, 4)
          ]);
          
          // Call onComplete after a short delay to show the completed state
          setTimeout(() => {
            onComplete();
          }, 2000);
        }
        
        // Update current video being processed
        if (indexStatus.currentVideo) {
          setCurrentVideo({
            name: indexStatus.currentVideo.name,
            status: indexStatus.currentVideo.status
          });
        }
      } catch (err) {
        console.error('Error checking index progress:', err);
        setError('Failed to check indexing progress');
        setStatusLog(prev => [
          {
            timestamp: new Date(),
            message: 'Error checking progress',
            type: 'error'
          },
          ...prev.slice(0, 4)
        ]);
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
            {progress}% complete
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
            style={{ width: `${progress}%` }}
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

      {/* Current video */}
      {status === 'processing' && currentVideo && (
        <div className="text-sm border border-gray-100 rounded-md p-3 bg-gray-50">
          <div className="flex flex-col space-y-2">
            <p>
              <span className="text-gray-500">Currently processing: </span>
              <span className="font-medium">{currentVideo.name}</span>
            </p>
            <p>
              <span className="text-gray-500">Status: </span>
              <span className="font-medium">
                {statusMessages[currentVideo.status] || currentVideo.status}
              </span>
            </p>
            <p className="text-xs text-gray-500">
              This may take a few minutes depending on video length.
            </p>
          </div>
        </div>
      )}

      {/* Status log */}
      {statusLog.length > 0 && (
        <div className="mt-4">
          <h3 className="text-sm font-medium text-gray-700 mb-2">Recent activity:</h3>
          <div className="space-y-1 text-sm max-h-32 overflow-y-auto">
            {statusLog.map((log, index) => (
              <div 
                key={index} 
                className={`flex items-center space-x-2 py-1 ${
                  index === 0 ? 'text-gray-900' : 'text-gray-600'
                }`}
              >
                <span>
                  {log.type === 'success' && '✓ '}
                  {log.type === 'error' && '✗ '}
                  {log.type === 'info' && 'ⓘ '}
                </span>
                <span>{log.message}</span>
                <span className="text-xs text-gray-400">
                  {log.timestamp.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                </span>
              </div>
            ))}
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
