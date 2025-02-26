'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'

// Import API endpoint from environment
const API_ENDPOINT = process.env.NEXT_PUBLIC_API_URL

const IndexCreationStep = dynamic(() => import('@/components/indexing/IndexCreationStep'), {
  ssr: false,
})

const UploadStep = dynamic(() => import('@/components/indexing/UploadStep'), {
  ssr: false,
})

const IndexProgress = dynamic(() => import('@/components/indexing/IndexProgress'), {
  loading: () => <div>Loading...</div>,
  ssr: false
})

type Step = 'create' | 'upload' | 'progress'

export default function CreatePage() {
  const router = useRouter()
  const [step, setStep] = useState<Step>('create')
  const [error, setError] = useState<string>('')
  const [indexData, setIndexData] = useState<{
    name: string;
    models: string[];
  } | null>(null)

  const handleIndexCreation = async (data: { name: string; models: string[] }) => {
    try {
      // Store the index data for use in the upload step
      setIndexData({
        name: data.name,
        models: data.models
      });
      
      // Move to upload step
      setStep('upload');
    } catch (error) {
      setError(error instanceof Error ? error.message : 'An error occurred');
    }
  };

  const handleUpload = async (files: File[]) => {
    // Handle upload completion
    console.log('Upload completed for files:', files)
    router.push('/videos')
  }

  const handleIndexingComplete = () => {
    if (indexData?.name) {
      router.push(`/videos?index=${indexData.name}`)
    }
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-between p-8 bg-gray-50">
      <div className="w-full max-w-4xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Create New Index</h1>
          <p className="mt-2 text-gray-600">
            Create a new index to organize and search your videos
          </p>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
            {error}
          </div>
        )}

        <div className="bg-white rounded-lg shadow-sm p-8">
          {step === 'create' && (
            <IndexCreationStep onNext={handleIndexCreation} />
          )}
          {step === 'upload' && indexData && (
            <UploadStep
              onNext={handleUpload}
              onBack={() => setStep('create')}
              indexId={indexData.name}
            />
          )}
          {step === 'progress' && indexData?.name && (
            <IndexProgress
              indexId={indexData.name}
              onComplete={handleIndexingComplete}
            />
          )}
        </div>
      </div>
    </main>
  )
} 