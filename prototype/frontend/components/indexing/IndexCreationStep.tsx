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
  disabled?: boolean
}

interface IndexCreationStepProps {
  onNext: (data: { name: string; models: string[] }) => void
}

const AVAILABLE_MODELS: Model[] = [
  {
    id: 'unified-video-text',
    name: 'OmniSpectra v1.0',
    description: 'Advanced multimodal embedding model that unifies video and text in a shared embedding space',
    features: [
      'Largest video embedding model (3B parameters)',
      'Native video processing with temporal preservation', 
      'Unified multimodal representation',
      'Absolute time alignment for temporal information',
      'Bidirectional cross-modal retrieval',
      'Bilingual support (Chinese & English)'
    ],
    type: 'visual'
  },
  {
    id: 'unified-audio-video-text',
    name: 'OmniSpectra v2.0 (Coming Soon)',
    description: 'Enhanced multimodal model with audio support and improved retrieval capabilities',
    features: [
      'Audio embedding support',
      'Second-level video retrieval precision',
      'Optimized computation for real-time retrieval',
      'Combined audio-visual content matching',
      'Extended multimodal search capabilities'
    ],
    type: 'visual',
    disabled: true
  }
]

export default function IndexCreationStep({ onNext }: IndexCreationStepProps) {
  const [indexName, setIndexName] = useState('')
  const [selectedModels, setSelectedModels] = useState<string[]>([])
  const [error, setError] = useState('')

  const handleModelSelect = (modelId: string, disabled?: boolean) => {
    if (disabled) return
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
        <h3 className="text-lg font-medium text-gray-900">Index Name</h3>
        <input
          type="text"
          id="indexName"
          value={indexName}
          onChange={(e) => {
            setIndexName(e.target.value)
            setError('')
          }}
          className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
          placeholder="E.g., 'Documentary' - Name for organizing your searchable video collection"
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
                "relative p-6 border rounded-lg transition-colors",
                model.disabled 
                  ? "border-gray-200 opacity-60 cursor-not-allowed" 
                  : "cursor-pointer",
                !model.disabled && selectedModels.includes(model.id)
                  ? "border-primary-500 bg-primary-50"
                  : "border-gray-200",
                !model.disabled && !selectedModels.includes(model.id) && "hover:border-primary-300"
              )}
              onClick={() => handleModelSelect(model.id, model.disabled)}
              role={model.disabled ? "presentation" : "button"}
              tabIndex={model.disabled ? -1 : 0}
            >
              {model.disabled && (
                <div className="absolute top-0 right-0 bg-gray-500 text-white text-xs font-bold px-2 py-1 rounded-bl-lg rounded-tr-lg">
                  Coming Soon
                </div>
              )}
              
              {selectedModels.includes(model.id) && !model.disabled && (
                <CheckCircleIcon className="absolute top-4 right-4 h-6 w-6 text-primary-600" />
              )}
              <h4 className="text-lg font-medium text-gray-900 flex items-center">
                {model.id === 'unified-video-text' ? (
                  <span className="mr-2 inline-flex">
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-primary-600">
                      <circle cx="12" cy="12" r="10" stroke="currentColor" fill="none" opacity="0.2" />
                      <path d="M6 12C6 12 8 8 12 8C16 8 18 12 18 12C18 12 16 16 12 16C8 16 6 12 6 12Z" stroke="currentColor" fill="none" />
                      <circle cx="12" cy="12" r="3" stroke="currentColor" fill="none" />
                      <line x1="5" y1="19" x2="19" y2="5" stroke="currentColor" strokeWidth="1" />
                      <line x1="5" y1="5" x2="19" y2="19" stroke="currentColor" strokeWidth="1" />
                    </svg>
                  </span>
                ) : (
                  <span className="mr-2 inline-flex">
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-gray-400">
                      <circle cx="12" cy="12" r="10" stroke="currentColor" fill="none" opacity="0.2" />
                      <path d="M6 12C6 12 8 8 12 8C16 8 18 12 18 12C18 12 16 16 12 16C8 16 6 12 6 12Z" stroke="currentColor" fill="none" />
                      <circle cx="12" cy="12" r="3" stroke="currentColor" fill="none" />
                      <path d="M3 10C4.5 11.5 4.5 12.5 3 14" stroke="currentColor" strokeWidth="1" />
                      <path d="M21 10C19.5 11.5 19.5 12.5 21 14" stroke="currentColor" strokeWidth="1" />
                      <path d="M8 8l8 8" strokeDasharray="1 1" stroke="currentColor" />
                      <path d="M16 8l-8 8" strokeDasharray="1 1" stroke="currentColor" />
                    </svg>
                  </span>
                )}
                {model.name}
              </h4>
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
