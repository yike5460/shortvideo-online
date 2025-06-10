'use client'

import { AutoCreateJob } from '@/lib/auto-create/types'

interface JobHistoryProps {
  jobs: AutoCreateJob[];
  currentJobId?: string;
  onJobSelect: (jobId: string) => void;
}

export default function JobHistory({ jobs, currentJobId, onJobSelect }: JobHistoryProps) {
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'queued':
        return 'bg-yellow-100 text-yellow-800'
      case 'processing':
        return 'bg-blue-100 text-blue-800'
      case 'completed':
        return 'bg-green-100 text-green-800'
      case 'failed':
        return 'bg-red-100 text-red-800'
      default:
        return 'bg-gray-100 text-gray-800'
    }
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'queued':
        return (
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        )
      case 'processing':
        return (
          <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
        )
      case 'completed':
        return (
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        )
      case 'failed':
        return (
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        )
      default:
        return null
    }
  }

  const formatDate = (dateString: string) => {
    const date = new Date(dateString)
    const now = new Date()
    const diffInHours = (now.getTime() - date.getTime()) / (1000 * 60 * 60)

    if (diffInHours < 1) {
      const diffInMinutes = Math.floor(diffInHours * 60)
      return `${diffInMinutes}m ago`
    } else if (diffInHours < 24) {
      return `${Math.floor(diffInHours)}h ago`
    } else {
      return date.toLocaleDateString()
    }
  }

  const truncateText = (text: string, maxLength: number = 60) => {
    if (text.length <= maxLength) return text
    return text.substring(0, maxLength) + '...'
  }

  if (jobs.length === 0) {
    return (
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 max-h-[779.01px] flex flex-col w-full">
        <div className="px-6 py-4 border-b border-gray-200">
          <h3 className="text-lg font-medium text-gray-900">Job History</h3>
          <p className="text-sm text-gray-500 mt-1">0 jobs</p>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center py-8">
            <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
            <h3 className="mt-2 text-sm font-medium text-gray-900">No jobs yet</h3>
            <p className="mt-1 text-sm text-gray-500">
              Create your first video to see it here.
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 max-h-[779.01px] flex flex-col w-full">
      <div className="px-6 py-4 border-b border-gray-200">
        <h3 className="text-lg font-medium text-gray-900">Job History</h3>
        <p className="text-sm text-gray-500 mt-1">
          {jobs.length} job{jobs.length !== 1 ? 's' : ''}
        </p>
      </div>

      <div className="divide-y divide-gray-200 flex-1 overflow-y-auto">
        {jobs.map((job) => (
          <div
            key={job.jobId}
            onClick={() => onJobSelect(job.jobId)}
            className={`p-4 hover:bg-gray-50 cursor-pointer transition-colors ${
              currentJobId === job.jobId ? 'bg-indigo-50 border-r-2 border-indigo-500' : ''
            }`}
          >
            <div className="flex items-start justify-between">
              <div className="flex-1 min-w-0">
                <div className="flex items-center space-x-2 mb-2">
                  <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(job.status)}`}>
                    {getStatusIcon(job.status)}
                    <span className="ml-1 capitalize">{job.status}</span>
                  </span>
                  {job.status === 'processing' && (
                    <span className="text-xs text-gray-500">
                      {job.progress}%
                    </span>
                  )}
                </div>
                
                <p className="text-sm text-gray-900 mb-1">
                  {truncateText(job.request)}
                </p>
                
                <div className="flex items-center justify-between text-xs text-gray-500">
                  <span>{formatDate(job.createdAt)}</span>
                  {job.result && (
                    <span className="flex items-center">
                      <svg className="h-3 w-3 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                      Video ready
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Progress bar for processing jobs */}
            {job.status === 'processing' && (
              <div className="mt-2">
                <div className="w-full bg-gray-200 rounded-full h-1">
                  <div
                    className="bg-blue-500 h-1 rounded-full transition-all duration-300"
                    style={{ width: `${job.progress}%` }}
                  ></div>
                </div>
              </div>
            )}

            {/* Error indicator */}
            {job.status === 'failed' && job.error && (
              <div className="mt-2 text-xs text-red-600 bg-red-50 rounded px-2 py-1">
                {truncateText(job.error, 80)}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Footer with summary stats */}
      <div className="px-6 py-3 bg-gray-50 border-t border-gray-200">
        <div className="flex justify-between text-xs text-gray-500">
          <span>
            {jobs.filter(j => j.status === 'completed').length} completed
          </span>
          <span>
            {jobs.filter(j => j.status === 'processing').length} processing
          </span>
          <span>
            {jobs.filter(j => j.status === 'failed').length} failed
          </span>
        </div>
      </div>
    </div>
  )
}