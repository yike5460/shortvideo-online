'use client'

import { useState } from 'react'

interface VideoResult {
  description: string;
  duration: number;
  originalRequest: string;
}

interface ResultsPreviewProps {
  result: VideoResult;
  onNewCreation: () => void;
}

export default function ResultsPreview({ result, onNewCreation }: ResultsPreviewProps) {
  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
      {/* Success Header */}
      <div className="bg-green-50 border-b border-green-200 px-6 py-4">
        <div className="flex items-center">
          <div className="flex-shrink-0">
            <svg className="h-6 w-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div className="ml-3">
            <h2 className="text-lg font-semibold text-green-900">
              Video Creation Completed!
            </h2>
            <p className="text-sm text-green-700">
              Your video has been successfully processed and merged.
            </p>
          </div>
        </div>
      </div>

      <div className="p-6">
        {/* Video Info */}
        <div className="mb-6">
          <h3 className="text-lg font-medium text-gray-900 mb-2">
            Creation Summary
          </h3>
          <p className="text-gray-700 leading-relaxed">
            {result.description}
          </p>
          <div className="mt-4 text-sm text-gray-500">
            <div>Original Request: {result.originalRequest}</div>
            <div className="mt-1">Estimated Duration: {formatDuration(result.duration)}</div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap gap-3">
          <button
            onClick={onNewCreation}
            className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
          >
            <svg className="mr-2 h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
            </svg>
            Create Another Video
          </button>
        </div>
      </div>
    </div>
  )
}