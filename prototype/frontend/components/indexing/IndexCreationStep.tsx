'use client'

import { useState } from 'react'
import { CheckCircleIcon } from '@heroicons/react/24/outline'
import { cn } from '@/lib/utils'

interface Model {
  id: string
  name: string
  description: string
  features: string[]
  type: 'visual' | 'audio'
}

interface IndexCreationStepProps {
  onNext: (data: { name: string; models: string[] }) => void
}

const AVAILABLE_MODELS: Model[] = [
  {
    id: 'Amazon NOVA',
    name: 'Amazon NOVA',
    description: 'Advanced visual recognition model for detailed scene understanding',
    features: [
      'Object detection',
      'Scene classification',
      'Action recognition',
      'Text detection'
    ],
    type: 'visual'
  },
  {
    id: 'transcribe',
    name: 'Transcribe',
    description: 'High-accuracy audio transcription and analysis model',
    features: [
      'Speech recognition',
      'Speaker diarization',
      'Language detection',
      'Sentiment analysis'
    ],
    type: 'audio'
  }
]

export default function IndexCreationStep({ onNext }: IndexCreationStepProps) {
  const [indexName, setIndexName] = useState('')
  const [selectedModels, setSelectedModels] = useState<string[]>([])
  const [error, setError] = useState('')

  const handleModelSelect = (modelId: string) => {
    console.log('Selecting model:', modelId)
    setSelectedModels(prev => {
      const newModels = prev.includes(modelId)
        ? prev.filter(id => id !== modelId)
        : [...prev, modelId]
      console.log('Updated selected models:', newModels)
      return newModels
    })
  }

  const handleSubmit = (e: React.MouseEvent) => {
    e.preventDefault()
    console.log('Submit clicked')
    console.log('Index name:', indexName)
    console.log('Selected models:', selectedModels)

    if (!indexName.trim()) {
      setError('Please enter an index name')
      return
    }
    if (selectedModels.length === 0) {
      setError('Please select at least one model')
      return
    }

    try {
      onNext({ name: indexName.trim(), models: selectedModels })
    } catch (error) {
      console.error('Error in handleSubmit:', error)
      setError('An error occurred while creating the index')
    }
  }

  return (
    <form onSubmit={(e) => e.preventDefault()} className="space-y-8">
      {/* Step indicator */}
      <div className="text-center">
        <span className="text-sm font-medium text-gray-500">Step 1/2</span>
        <h2 className="mt-2 text-2xl font-bold text-gray-900">Create Index</h2>
      </div>

      {/* Index name input */}
      <div className="space-y-2">
        <label htmlFor="indexName" className="block text-sm font-medium text-gray-700">
          Index Name
        </label>
        <input
          type="text"
          id="indexName"
          value={indexName}
          onChange={(e) => {
            setIndexName(e.target.value)
            setError('')
          }}
          className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
          placeholder="Enter a name for your index"
        />
      </div>

      {/* Model warning */}
      <div className="bg-yellow-50 p-4 rounded-lg">
        <p className="text-sm text-yellow-700">
          ⚠️ Model selection cannot be changed after index creation. Choose carefully.
        </p>
      </div>

      {/* Model selection */}
      <div className="space-y-4">
        <h3 className="text-lg font-medium text-gray-900">Select Models</h3>
        <div className="grid gap-4 md:grid-cols-2">
          {AVAILABLE_MODELS.map((model) => (
            <div
              key={model.id}
              className={cn(
                "relative p-6 border rounded-lg cursor-pointer transition-colors",
                selectedModels.includes(model.id)
                  ? "border-primary-500 bg-primary-50"
                  : "border-gray-200 hover:border-primary-300"
              )}
              onClick={() => handleModelSelect(model.id)}
              role="button"
              tabIndex={0}
            >
              {selectedModels.includes(model.id) && (
                <CheckCircleIcon className="absolute top-4 right-4 h-6 w-6 text-primary-600" />
              )}
              <h4 className="text-lg font-medium text-gray-900">{model.name}</h4>
              <p className="mt-2 text-sm text-gray-600">{model.description}</p>
              <ul className="mt-4 space-y-2">
                {model.features.map((feature, index) => (
                  <li key={index} className="text-sm text-gray-600">
                    • {feature}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>

      {/* Error message */}
      {error && (
        <div className="p-4 bg-red-50 text-red-700 rounded-lg">
          {error}
        </div>
      )}

      {/* Action buttons */}
      <div className="flex justify-end pt-6">
        <button
          type="button"
          onClick={handleSubmit}
          className="px-6 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2"
        >
          Next
        </button>
      </div>
    </form>
  )
} 