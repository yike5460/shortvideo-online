'use client'

import { useState, useEffect } from 'react'
import { CheckCircleIcon, XCircleIcon } from '@heroicons/react/24/outline'

interface IndexProgressProps {
  indexId: string
  onComplete?: () => void
}

interface IndexStatus {
  status: 'processing' | 'completed' | 'failed'
  progress: number
  videoCount: number
  completedCount: number
  failedCount: number
  currentVideo?: {
    name: string
    thumbnail: string
  }
}

export default function IndexProgress({ indexId, onComplete }: IndexProgressProps) {
  const [status, setStatus] = useState<IndexStatus>({
    status: 'processing',
    progress: 0,
    videoCount: 0,
    completedCount: 0,
    failedCount: 0
  })

  useEffect(() => {
    // Mock progress updates
    const interval = setInterval(() => {
      setStatus(prev => {
        if (prev.progress >= 100) {
          clearInterval(interval)
          onComplete?.()
          return { ...prev, status: 'completed' }
        }
        return {
          ...prev,
          progress: Math.min(prev.progress + 10, 100),
          completedCount: Math.floor((prev.progress + 10) / 100 * prev.videoCount)
        }
      })
    }, 1000)

    return () => clearInterval(interval)
  }, [onComplete])

  return (
    <div className="bg-white rounded-lg shadow-sm p-6 space-y-6">
      {/* Status header */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900">
          Indexing Progress
        </h2>
        <div className="flex items-center space-x-2">
          <span className="text-sm font-medium text-gray-600">
            {status.completedCount}/{status.videoCount} videos processed
          </span>
          {status.status === 'completed' && (
            <CheckCircleIcon className="h-5 w-5 text-green-500" />
          )}
          {status.status === 'failed' && (
            <XCircleIcon className="h-5 w-5 text-red-500" />
          )}
        </div>
      </div>

      {/* Progress bar */}
      <div className="space-y-2">
        <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
          <div
            className="h-full bg-primary-600 transition-all duration-500"
            style={{ width: `${status.progress}%` }}
          />
        </div>
        <div className="flex justify-between text-sm text-gray-600">
          <span>{status.progress}% complete</span>
          <span>
            {status.failedCount > 0 && `${status.failedCount} failed`}
          </span>
        </div>
      </div>

      {/* Current video */}
      {status.currentVideo && (
        <div className="flex items-center space-x-4">
          <div className="w-24 h-16 bg-gray-100 rounded-lg overflow-hidden">
            <img
              src={status.currentVideo.thumbnail}
              alt={status.currentVideo.name}
              className="w-full h-full object-cover"
            />
          </div>
          <div>
            <p className="text-sm font-medium text-gray-900">
              Currently processing:
            </p>
            <p className="text-sm text-gray-600">
              {status.currentVideo.name}
            </p>
          </div>
        </div>
      )}

      {/* Status message */}
      <div className="text-sm text-gray-600">
        {status.status === 'processing' && (
          <p>Processing videos... This may take a few minutes.</p>
        )}
        {status.status === 'completed' && (
          <p className="text-green-600">
            All videos have been successfully indexed!
          </p>
        )}
        {status.status === 'failed' && (
          <p className="text-red-600">
            Some videos failed to process. Please try again.
          </p>
        )}
      </div>
    </div>
  )
} 