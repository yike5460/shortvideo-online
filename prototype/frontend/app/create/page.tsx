'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'

const IndexCreationStep = dynamic(() => import('@/components/indexing/IndexCreationStep'), {
  loading: () => <div>Loading...</div>,
  ssr: false
})

const UploadStep = dynamic(() => import('@/components/indexing/UploadStep'), {
  loading: () => <div>Loading...</div>,
  ssr: false
})

const IndexProgress = dynamic(() => import('@/components/indexing/IndexProgress'), {
  loading: () => <div>Loading...</div>,
  ssr: false
})

type Step = 'create' | 'upload' | 'progress'

export default function CreateIndexPage() {
  const router = useRouter()
  const [step, setStep] = useState<Step>('create')
  const [error, setError] = useState<string>('')
  const [indexData, setIndexData] = useState<{
    id?: string
    name: string
    models: string[]
  } | null>(null)

  const handleIndexCreation = async (data: { name: string; models: string[] }) => {
    console.log('Creating index with data:', data)
    try {
      // Mock API response for testing
      const mockResponse = {
        ok: true,
        json: () => Promise.resolve({ indexId: 'test-' + Date.now() })
      }

      // TODO: Replace with actual API call
      const response = await Promise.resolve(mockResponse)
      // const response = await fetch('/api/index', {
      //   method: 'POST',
      //   headers: {
      //     'Content-Type': 'application/json',
      //   },
      //   body: JSON.stringify(data),
      // })

      if (!response.ok) {
        throw new Error('Failed to create index')
      }

      const result = await response.json()
      console.log('Index created:', result)
      setIndexData({ ...data, id: result.indexId })
      setStep('upload')
    } catch (error) {
      console.error('Failed to create index:', error)
      setError('Failed to create index. Please try again.')
    }
  }

  const handleUpload = async (files: File[]) => {
    if (!indexData?.id) return

    try {
      const formData = new FormData()
      formData.append('indexId', indexData.id)
      files.forEach(file => formData.append('files', file))

      // Mock API response for testing
      const mockResponse = {
        ok: true,
        json: () => Promise.resolve({ success: true })
      }

      // TODO: Replace with actual API call
      const response = await Promise.resolve(mockResponse)
      // const response = await fetch('/api/index/upload', {
      //   method: 'POST',
      //   body: formData
      // })

      if (!response.ok) {
        throw new Error('Failed to upload files')
      }

      setStep('progress')
    } catch (error) {
      console.error('Failed to upload files:', error)
      setError('Failed to upload files. Please try again.')
    }
  }

  const handleIndexingComplete = () => {
    if (indexData?.id) {
      router.push(`/videos?index=${indexData.id}`)
    }
  }

  return (
    <main className="min-h-screen bg-gray-50 py-12">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
        {error && (
          <div className="mb-4 p-4 bg-red-50 text-red-700 rounded-lg">
            {error}
          </div>
        )}
        <div className="bg-white rounded-lg shadow-sm p-8">
          {step === 'create' && (
            <IndexCreationStep onNext={handleIndexCreation} />
          )}
          {step === 'upload' && (
            <UploadStep
              onNext={handleUpload}
              onBack={() => setStep('create')}
            />
          )}
          {step === 'progress' && indexData?.id && (
            <IndexProgress
              indexId={indexData.id}
              onComplete={handleIndexingComplete}
            />
          )}
        </div>
      </div>
    </main>
  )
} 