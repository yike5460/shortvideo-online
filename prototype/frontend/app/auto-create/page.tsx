'use client'

import { useState, useEffect } from 'react'
import { useAuth } from '@/lib/auth/AuthContext'
import CreationForm from './components/CreationForm'
import ProgressDisplay from './components/ProgressDisplay'
import ResultsPreview from './components/ResultsPreview'
import JobHistory from './components/JobHistory' 
import { AutoCreateJob, CreationOptions } from '@/lib/auto-create/types'
import { createAutoCreateJob, getJobStatus, getJobHistory } from '@/lib/auto-create/api'
import { useToast } from '@/components/ui/Toast'

export default function AutoCreatePage() {
  const { state } = useAuth()
  const { addToast } = useToast()
  const [currentJob, setCurrentJob] = useState<AutoCreateJob | null>(null)
  const [jobHistory, setJobHistory] = useState<AutoCreateJob[]>([])
  const [isLoading, setIsLoading] = useState(false)

  // Load job history on component mount
  useEffect(() => {
    if (state.user?.email) {
      loadJobHistory()
    }
  }, [state.user?.email])

  const loadJobHistory = async () => {
    try {
      const history = await getJobHistory()
      setJobHistory(history)
    } catch (error) {
      console.error('Failed to load job history:', error)
    }
  }

  const handleCreateVideo = async (request: string, options?: CreationOptions) => {
    if (!state.user?.email) {
      addToast('error', 'Please log in to create videos')
      return
    }

    setIsLoading(true)
    try {
      const job = await createAutoCreateJob({
        request,
        userId: state.user.email,
        options
      })
      
      setCurrentJob(job)
      addToast('success', 'Video creation job started!')
      
      // Start polling for job status
      pollJobStatus(job.jobId)
    } catch (error) {
      console.error('Failed to create video:', error)
      addToast('error', 'Failed to start video creation')
    } finally {
      setIsLoading(false)
    }
  }

  const pollJobStatus = async (jobId: string) => {
    const pollInterval = setInterval(async () => {
      try {
        const updatedJob = await getJobStatus(jobId)
        setCurrentJob(updatedJob)
        
        if (updatedJob.status === 'completed' || updatedJob.status === 'failed') {
          clearInterval(pollInterval)
          loadJobHistory() // Refresh history
          
          if (updatedJob.status === 'completed') {
            addToast('success', 'Video created successfully!')
          } else {
            addToast('error', 'Video creation failed')
          }
        }
      } catch (error) {
        console.error('Failed to poll job status:', error)
        clearInterval(pollInterval)
      }
    }, 2000) // Poll every 2 seconds
  }

  const handleJobSelect = async (jobId: string) => {
    try {
      const job = await getJobStatus(jobId)
      setCurrentJob(job)
    } catch (error) {
      console.error('Failed to load job:', error)
      addToast('error', 'Failed to load job details')
    }
  }

  const handleNewCreation = () => {
    setCurrentJob(null)
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            Agentic Creation (Preview)
          </h1>
          <p className="text-gray-600">
            Create short videos using natural language. Describe what you want, and our AI will search your video library and create it for you.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Main Content Area */}
          <div className="lg:col-span-2 space-y-6">
            {!currentJob ? (
              <CreationForm 
                onSubmit={handleCreateVideo}
                isProcessing={isLoading}
              />
            ) : currentJob.status === 'completed' && currentJob.result ? (
              <ResultsPreview 
                result={currentJob.result}
                onNewCreation={handleNewCreation}
              />
            ) : (
              <ProgressDisplay 
                job={currentJob}
                onCancel={handleNewCreation}
              />
            )}
          </div>

          {/* Sidebar */}
          <div className="lg:col-span-1">
            <JobHistory 
              jobs={jobHistory}
              currentJobId={currentJob?.jobId}
              onJobSelect={handleJobSelect}
            />
          </div>
        </div>
      </div>
    </div>
  )
}