'use client'

import { useState, useCallback } from 'react'
import { useDropzone } from 'react-dropzone'
import { CloudArrowUpIcon, XMarkIcon } from '@heroicons/react/24/outline'
import { cn } from '@/lib/utils'

interface UploadStepProps {
  onNext: (files: File[]) => void
  onBack: () => void
}

export default function UploadStep({ onNext, onBack }: UploadStepProps) {
  const [selectedFiles, setSelectedFiles] = useState<File[]>([])
  const [error, setError] = useState<string>('')

  const validateFile = (file: File) => {
    // Duration check will be done on server side
    const maxSize = 2 * 1024 * 1024 * 1024 // 2GB
    
    if (file.size > maxSize) {
      throw new Error('File size must be less than 2GB')
    }

    // Basic video format validation
    const validFormats = ['video/mp4', 'video/quicktime', 'video/x-msvideo']
    if (!validFormats.includes(file.type)) {
      throw new Error('Invalid file format. Please upload MP4, MOV, or AVI files')
    }
  }

  const onDrop = useCallback((acceptedFiles: File[]) => {
    try {
      acceptedFiles.forEach(validateFile)
      setSelectedFiles(prev => [...prev, ...acceptedFiles])
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid file')
    }
  }, [])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'video/*': ['.mp4', '.mov', '.avi']
    },
    maxSize: 2 * 1024 * 1024 * 1024 // 2GB
  })

  const removeFile = (index: number) => {
    setSelectedFiles(prev => prev.filter((_, i) => i !== index))
  }

  return (
    <div className="space-y-8">
      {/* Step indicator */}
      <div className="text-center">
        <span className="text-sm font-medium text-gray-500">Step 2/2</span>
        <h2 className="mt-2 text-2xl font-bold text-gray-900">Upload Videos</h2>
      </div>

      {/* Upload zone */}
      <div
        {...getRootProps()}
        className={cn(
          "border-2 border-dashed rounded-lg p-12 text-center cursor-pointer transition-colors",
          isDragActive ? "border-primary-500 bg-primary-50" : "border-gray-300 hover:border-primary-400"
        )}
      >
        <input {...getInputProps()} />
        <CloudArrowUpIcon className="mx-auto h-12 w-12 text-gray-400" />
        <p className="mt-4 text-lg font-medium text-gray-900">
          Drag and drop your videos here
        </p>
        <p className="mt-2 text-sm text-gray-500">
          or click to browse files
        </p>
      </div>

      {/* Requirements */}
      <div className="bg-gray-50 rounded-lg p-4">
        <h3 className="text-sm font-medium text-gray-900">Requirements:</h3>
        <ul className="mt-2 text-sm text-gray-600 space-y-1">
          <li>• Duration: 4 seconds - 30 minutes (Free plan) / 2 hours (Pro plan)</li>
          <li>• Resolution: 360p - 4K</li>
          <li>• File size: Up to 2GB</li>
          <li>• Formats: MP4, MOV, AVI</li>
        </ul>
      </div>

      {/* Selected files */}
      {selectedFiles.length > 0 && (
        <div className="space-y-4">
          <h3 className="text-lg font-medium text-gray-900">Selected Files</h3>
          <div className="space-y-2">
            {selectedFiles.map((file, index) => (
              <div
                key={index}
                className="flex items-center justify-between bg-white p-4 rounded-lg border"
              >
                <div>
                  <p className="font-medium text-gray-900">{file.name}</p>
                  <p className="text-sm text-gray-500">
                    {(file.size / (1024 * 1024)).toFixed(2)} MB
                  </p>
                </div>
                <button
                  onClick={() => removeFile(index)}
                  className="p-2 text-gray-400 hover:text-gray-600"
                >
                  <XMarkIcon className="h-5 w-5" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Error message */}
      {error && (
        <div className="p-4 bg-red-50 text-red-700 rounded-lg">
          {error}
        </div>
      )}

      {/* Action buttons */}
      <div className="flex justify-between pt-6">
        <button
          onClick={onBack}
          className="px-6 py-2 text-gray-600 hover:text-gray-900"
        >
          Back
        </button>
        <button
          onClick={() => onNext(selectedFiles)}
          disabled={selectedFiles.length === 0}
          className="px-6 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Start Indexing
        </button>
      </div>
    </div>
  )
} 