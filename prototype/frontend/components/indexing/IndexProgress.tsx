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
    thumbnail: string
  }
}

export default function IndexProgress({ indexId, videoIds, onComplete }: IndexProgressProps) {
  const [progress, setProgress] = useState(0)
  // Align with the WebVideoStatus enum in types/common.ts
  const [status, setStatus] = useState<'processing' | 'completed' | 'error'>('processing')
  const [error, setError] = useState<string | null>(null)
  const [currentVideo, setCurrentVideo] = useState<string | null>(null)

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
        
        // Update current video being processed
        if (indexStatus.currentVideo) {
          setCurrentVideo(indexStatus.currentVideo.name);
        }
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
            className="h-full bg-primary-600 transition-all duration-500"
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="flex justify-between text-sm text-gray-600">
          <span>{progress}% complete</span>
          {status === 'error' && (
            <span className="text-red-600">{error}</span>
          )}
        </div>
      </div>

      {/* Current video */}
      {status === 'processing' && (
        <div className="text-sm text-gray-600">
          {currentVideo ? (
            <div>
              <p>Currently processing: <span className="font-medium">{currentVideo}</span></p>
              <p className="mt-1">This may take a few minutes depending on video length.</p>
            </div>
          ) : (
            <p>Processing videos... This may take a few minutes.</p>
          )}
        </div>
      )}
      {status === 'completed' && (
        <div className="text-green-600">
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