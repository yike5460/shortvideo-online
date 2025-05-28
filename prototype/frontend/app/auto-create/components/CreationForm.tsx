'use client'

import { useState } from 'react'
import { CreationOptions } from '@/lib/auto-create/types'

interface CreationFormProps {
  onSubmit: (request: string, options?: CreationOptions) => void;
  isProcessing: boolean;
}

export default function CreationForm({ onSubmit, isProcessing }: CreationFormProps) {
  const [request, setRequest] = useState('')
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [options, setOptions] = useState<CreationOptions>({
    maxDuration: 60,
    preferredIndexes: [],
    outputFormat: 'mp4'
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (request.trim()) {
      onSubmit(request.trim(), options)
    }
  }

  const exampleRequests = [
    "Create a short video about English education for K12 showing common expressions for booking flights",
    "Make a video compilation of all the cooking scenes from my uploaded videos",
    "Create a tutorial video showing how to use basic computer functions",
    "Generate a highlight reel of outdoor activities from my video library"
  ]

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
      <div className="mb-6">
        <h2 className="text-xl font-semibold text-gray-900 mb-2">
          Create Your Video
        </h2>
        <p className="text-gray-600">
          Describe what kind of video you want to create. Our AI will search your video library and automatically create it for you.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Main Request Input */}
        <div>
          <label htmlFor="request" className="block text-sm font-medium text-gray-700 mb-2">
            Video Description *
          </label>
          <textarea
            id="request"
            value={request}
            onChange={(e) => setRequest(e.target.value)}
            placeholder="Describe the video you want to create..."
            className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 resize-none"
            rows={4}
            required
            disabled={isProcessing}
          />
          <p className="mt-1 text-sm text-gray-500">
            Be as specific as possible for better results
          </p>
        </div>

        {/* Example Requests */}
        <div>
          <p className="text-sm font-medium text-gray-700 mb-2">Example requests:</p>
          <div className="space-y-2">
            {exampleRequests.map((example, index) => (
              <button
                key={index}
                type="button"
                onClick={() => setRequest(example)}
                className="block w-full text-left px-3 py-2 text-sm text-gray-600 bg-gray-50 hover:bg-gray-100 rounded-md transition-colors duration-200"
                disabled={isProcessing}
              >
                "{example}"
              </button>
            ))}
          </div>
        </div>

        {/* Advanced Options Toggle */}
        <div>
          <button
            type="button"
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="flex items-center text-sm font-medium text-indigo-600 hover:text-indigo-500"
            disabled={isProcessing}
          >
            <span>Advanced Options</span>
            <svg
              className={`ml-1 h-4 w-4 transform transition-transform ${showAdvanced ? 'rotate-180' : ''}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
        </div>

        {/* Advanced Options */}
        {showAdvanced && (
          <div className="space-y-4 p-4 bg-gray-50 rounded-md">
            <div>
              <label htmlFor="maxDuration" className="block text-sm font-medium text-gray-700 mb-1">
                Maximum Duration (seconds)
              </label>
              <input
                type="number"
                id="maxDuration"
                value={options.maxDuration}
                onChange={(e) => setOptions(prev => ({ ...prev, maxDuration: parseInt(e.target.value) || 60 }))}
                min="10"
                max="300"
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                disabled={isProcessing}
              />
            </div>

            <div>
              <label htmlFor="outputFormat" className="block text-sm font-medium text-gray-700 mb-1">
                Output Format
              </label>
              <select
                id="outputFormat"
                value={options.outputFormat}
                onChange={(e) => setOptions(prev => ({ ...prev, outputFormat: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                disabled={isProcessing}
              >
                <option value="mp4">MP4</option>
                <option value="webm">WebM</option>
                <option value="mov">MOV</option>
              </select>
            </div>
          </div>
        )}

        {/* Submit Button */}
        <div className="flex justify-end">
          <button
            type="submit"
            disabled={!request.trim() || isProcessing}
            className="inline-flex items-center px-6 py-3 border border-transparent text-base font-medium rounded-md shadow-sm text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isProcessing ? (
              <>
                <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Creating Video...
              </>
            ) : (
              <>
                <svg className="mr-2 h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.847a4.5 4.5 0 003.09 3.09L15.75 12l-2.847.813a4.5 4.5 0 00-3.09 3.091z" />
                </svg>
                Create Video
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  )
}