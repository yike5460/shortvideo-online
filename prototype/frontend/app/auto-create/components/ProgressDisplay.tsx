'use client'

import { useState, useEffect } from 'react'
import { AutoCreateJob } from '@/lib/auto-create/types'
import { subscribeToJobUpdates } from '@/lib/auto-create/api'

interface ProgressDisplayProps {
  job: AutoCreateJob;
  onCancel?: () => void;
}

export default function ProgressDisplay({ job, onCancel }: ProgressDisplayProps) {
  const [currentJob, setCurrentJob] = useState<AutoCreateJob>(job)
  const [isExpanded, setIsExpanded] = useState(false)

  useEffect(() => {
    // Subscribe to real-time updates
    const unsubscribe = subscribeToJobUpdates(
      job.jobId,
      (updatedJob) => {
        setCurrentJob(updatedJob)
      },
      (error) => {
        console.error('Failed to receive job updates:', error)
      }
    )

    return unsubscribe
  }, [job.jobId])

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'queued':
        return 'text-yellow-600 bg-yellow-100'
      case 'processing':
        return 'text-blue-600 bg-blue-100'
      case 'completed':
        return 'text-green-600 bg-green-100'
      case 'failed':
        return 'text-red-600 bg-red-100'
      default:
        return 'text-gray-600 bg-gray-100'
    }
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'queued':
        return (
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        )
      case 'processing':
        return (
          <svg className="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
        )
      case 'completed':
        return (
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        )
      case 'failed':
        return (
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        )
      default:
        return null
    }
  }

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">
            Creating Your Video
          </h2>
          <p className="text-gray-600 mt-1">
            Job ID: {currentJob.jobId}
          </p>
        </div>
        {onCancel && currentJob.status !== 'completed' && currentJob.status !== 'failed' && (
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
          >
            Cancel
          </button>
        )}
      </div>

      {/* Status Badge */}
      <div className="flex items-center mb-4">
        <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${getStatusColor(currentJob.status)}`}>
          {getStatusIcon(currentJob.status)}
          <span className="ml-2 capitalize">{currentJob.status}</span>
        </span>
        {currentJob.estimatedDuration && currentJob.status === 'processing' && (
          <span className="ml-4 text-sm text-gray-500">
            Est. {formatDuration(currentJob.estimatedDuration)}
          </span>
        )}
      </div>

      {/* Progress Bar */}
      <div className="mb-6">
        <div className="flex justify-between text-sm text-gray-600 mb-2">
          <span>Progress</span>
          <span>{currentJob.progress}%</span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-2">
          <div
            className="bg-indigo-600 h-2 rounded-full transition-all duration-300 ease-out"
            style={{ width: `${currentJob.progress}%` }}
          ></div>
        </div>
      </div>

      {/* Request Display */}
      <div className="mb-6">
        <h3 className="text-sm font-medium text-gray-700 mb-2">Your Request:</h3>
        <div className="bg-gray-50 rounded-md p-3">
          <p className="text-sm text-gray-800">{currentJob.request}</p>
        </div>
      </div>

      {/* Error Display */}
      {currentJob.error && (
        <div className="mb-6">
          <div className="bg-red-50 border border-red-200 rounded-md p-4">
            <div className="flex">
              <div className="flex-shrink-0">
                <svg className="h-5 w-5 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
              </div>
              <div className="ml-3">
                <h3 className="text-sm font-medium text-red-800">Error</h3>
                <p className="text-sm text-red-700 mt-1">{currentJob.error}</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Logs Section */}
      {currentJob.logs && currentJob.logs.length > 0 && (
        <div>
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="flex items-center justify-between w-full text-left text-sm font-medium text-gray-700 mb-2 hover:text-gray-900"
          >
            <span>Processing Logs ({currentJob.logs.length})</span>
            <svg
              className={`h-4 w-4 transform transition-transform ${isExpanded ? 'rotate-180' : ''}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          
          {isExpanded && (
            <div className="bg-gray-900 rounded-md p-4 max-h-64 overflow-y-auto">
              <div className="space-y-1">
                {currentJob.logs.map((log, index) => (
                  <div key={index} className="text-sm font-mono text-gray-300">
                    {log}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Action Buttons */}
      {currentJob.status === 'completed' && onCancel && (
        <div className="mt-6 flex justify-end">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm font-medium text-indigo-600 bg-indigo-50 border border-indigo-200 rounded-md hover:bg-indigo-100 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
          >
            Create Another Video
          </button>
        </div>
      )}
    </div>
  )
}