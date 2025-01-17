'use client'

import { useState, useCallback } from 'react'
import { useDropzone } from 'react-dropzone'
import { CloudArrowUpIcon, XMarkIcon } from '@heroicons/react/24/outline'
import { cn } from '@/lib/utils'
import axios from 'axios'

// API configuration
const API_ENDPOINT = process.env.NEXT_PUBLIC_API_URL || ''

interface UploadStepProps {
  onNext: (files: File[], uploadIds: string[]) => void
  onBack: () => void
}

interface UploadProgress {
  progress: number
  status: 'pending' | 'uploading' | 'completed' | 'error'
  error?: string
}

interface YouTubeUpload {
  url: string
  title?: string
  description?: string
  tags?: string[]
}

export default function UploadStep({ onNext, onBack }: UploadStepProps) {
  const [selectedFiles, setSelectedFiles] = useState<File[]>([])
  const [youtubeUrl, setYoutubeUrl] = useState('')
  const [error, setError] = useState<string>('')
  const [uploadProgress, setUploadProgress] = useState<Record<string, UploadProgress>>({})
  const [isUploading, setIsUploading] = useState(false)

  const validateFile = (file: File) => {
    const maxSize = 2 * 1024 * 1024 * 1024 // 2GB
    
    if (file.size > maxSize) {
      throw new Error('File size must be less than 2GB')
    }

    const validFormats = ['video/mp4', 'video/quicktime', 'video/x-msvideo']
    if (!validFormats.includes(file.type)) {
      throw new Error('Invalid file format. Please upload MP4, MOV, or AVI files')
    }
  }

  const onDrop = useCallback((acceptedFiles: File[]) => {
    try {
      acceptedFiles.forEach(validateFile)
      setSelectedFiles(prev => [...prev, ...acceptedFiles])
      acceptedFiles.forEach(file => {
        setUploadProgress(prev => ({
          ...prev,
          [file.name]: { progress: 0, status: 'pending' }
        }))
      })
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
    maxSize: 2 * 1024 * 1024 * 1024, // 2GB
    disabled: isUploading
  })

  const removeFile = (index: number) => {
    const fileToRemove = selectedFiles[index]
    setSelectedFiles(prev => prev.filter((_, i) => i !== index))
    setUploadProgress(prev => {
      const newProgress = { ...prev }
      delete newProgress[fileToRemove.name]
      return newProgress
    })
  }

  const uploadFile = async (file: File): Promise<string> => {
    try {
      console.log('Uploading file:', file.name, 'to endpoint:', `${API_ENDPOINT}/videos/upload`)
      // Get pre-signed URL
      const response = await axios.post(`${API_ENDPOINT}/videos/upload`, {
        fileName: file.name,
        fileType: file.type,
        fileSize: file.size,
        metadata: {
          title: file.name,
          description: '',
          tags: []
        }
      }, {
        headers: {
          'Content-Type': 'application/json'
        }
      })

      console.log('Pre-signed URL response:', response.data)
      const { uploadUrl, videoId } = response.data

      // Upload to S3 using pre-signed URL
      await axios.put(uploadUrl, file, {
        headers: {
          'Content-Type': file.type
        },
        onUploadProgress: (progressEvent) => {
          const progress = progressEvent.loaded / progressEvent.total! * 100
          setUploadProgress(prev => ({
            ...prev,
            [file.name]: { 
              ...prev[file.name],
              progress,
              status: 'uploading'
            }
          }))
        }
      })

      // Notify backend that upload is complete
      await axios.post(`${API_ENDPOINT}/videos/upload/${videoId}/complete`, {
        fileName: file.name,
        fileSize: file.size,
        fileType: file.type
      }, {
        headers: {
          'Content-Type': 'application/json'
        }
      })

      setUploadProgress(prev => ({
        ...prev,
        [file.name]: { 
          ...prev[file.name],
          progress: 100,
          status: 'completed'
        }
      }))

      return videoId

    } catch (err) {
      console.error('Upload error:', err)
      setUploadProgress(prev => ({
        ...prev,
        [file.name]: { 
          ...prev[file.name],
          status: 'error',
          error: err instanceof Error ? err.message : 'Upload failed'
        }
      }))
      throw err
    }
  }

  const uploadYouTubeVideo = async (youtubeUrl: string): Promise<string> => {
    try {
      console.log('Uploading YouTube video:', youtubeUrl)
      const response = await axios.post(`${API_ENDPOINT}/videos/youtube`, {
        videoUrl: youtubeUrl,
        metadata: {
          title: '',
          description: '',
          tags: []
        }
      }, {
        headers: {
          'Content-Type': 'application/json'
        }
      })

      console.log('YouTube upload response:', response.data)
      return response.data.videoId
    } catch (err) {
      console.error('YouTube upload error:', err)
      throw err
    }
  }

  const handleUpload = async () => {
    setIsUploading(true)
    setError('')
    
    try {
      const uploadPromises: Promise<string>[] = []

      // Handle local file uploads
      if (selectedFiles.length > 0) {
        uploadPromises.push(...selectedFiles.map(file => uploadFile(file)))
      }

      // Handle YouTube upload
      if (youtubeUrl) {
        uploadPromises.push(uploadYouTubeVideo(youtubeUrl))
      }

      const uploadIds = await Promise.all(uploadPromises)
      onNext(selectedFiles, uploadIds)
    } catch (err) {
      setError('Failed to upload one or more files. Please try again.')
    } finally {
      setIsUploading(false)
    }
  }

  return (
    <div className="space-y-8">
      {/* Step indicator */}
      <div className="text-center">
        <span className="text-sm font-medium text-gray-500">Step 2/2</span>
        <h2 className="mt-2 text-2xl font-bold text-gray-900">Upload Videos</h2>
      </div>

      {/* YouTube URL input */}
      <div className="space-y-4">
        <h3 className="text-lg font-medium text-gray-900">Upload from YouTube</h3>
        <div className="flex gap-4">
          <input
            type="text"
            value={youtubeUrl}
            onChange={(e) => setYoutubeUrl(e.target.value)}
            placeholder="Enter YouTube URL"
            className="flex-1 rounded-lg border border-gray-300 px-4 py-2 focus:border-primary-500 focus:ring-primary-500"
            disabled={isUploading}
          />
        </div>
      </div>

      {/* Upload zone */}
      <div className="space-y-4">
        <h3 className="text-lg font-medium text-gray-900">Or Upload Local Files</h3>
        <div
          {...getRootProps()}
          className={cn(
            "border-2 border-dashed rounded-lg p-12 text-center cursor-pointer transition-colors",
            isDragActive ? "border-primary-500 bg-primary-50" : "border-gray-300 hover:border-primary-400",
            isUploading && "opacity-50 cursor-not-allowed"
          )}
        >
          <input {...getInputProps()} />
          <CloudArrowUpIcon className="mx-auto h-12 w-12 text-gray-400" />
          <p className="mt-4 text-lg font-medium text-gray-900">
            {isUploading ? "Upload in progress..." : "Drag and drop your videos here"}
          </p>
          <p className="mt-2 text-sm text-gray-500">
            {isUploading ? "Please wait while we upload your videos" : "or click to browse files"}
          </p>
        </div>
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
                <div className="flex-1">
                  <p className="font-medium text-gray-900">{file.name}</p>
                  <p className="text-sm text-gray-500">
                    {(file.size / (1024 * 1024)).toFixed(2)} MB
                  </p>
                  {uploadProgress[file.name] && (
                    <div className="mt-2">
                      <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                        <div 
                          className={cn(
                            "h-full transition-all duration-300",
                            uploadProgress[file.name].status === 'completed' ? 'bg-green-500' :
                            uploadProgress[file.name].status === 'error' ? 'bg-red-500' :
                            'bg-primary-500'
                          )}
                          style={{ width: `${uploadProgress[file.name].progress}%` }}
                        />
                      </div>
                      {uploadProgress[file.name].error && (
                        <p className="text-sm text-red-500 mt-1">
                          {uploadProgress[file.name].error}
                        </p>
                      )}
                    </div>
                  )}
                </div>
                {!isUploading && (
                  <button
                    onClick={() => removeFile(index)}
                    className="p-2 text-gray-400 hover:text-gray-600"
                  >
                    <XMarkIcon className="h-5 w-5" />
                  </button>
                )}
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
          disabled={isUploading}
          className="px-6 py-2 text-gray-600 hover:text-gray-900 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Back
        </button>
        <button
          onClick={handleUpload}
          disabled={(selectedFiles.length === 0 && !youtubeUrl) || isUploading}
          className={cn(
            "px-6 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed",
            isUploading && "bg-primary-400"
          )}
        >
          {isUploading ? "Uploading..." : "Start Indexing"}
        </button>
      </div>
    </div>
  )
} 