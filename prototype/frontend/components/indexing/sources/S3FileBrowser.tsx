'use client'

import { useState, useEffect } from 'react'
import { MagnifyingGlassIcon, ChevronDownIcon } from '@heroicons/react/24/outline'
import { cn } from '@/lib/utils'
import { connectorsApi } from '@/lib/api'

interface S3File {
  name: string
  key: string
  size: number
  lastModified: string
  type: string
}

interface S3FileBrowserProps {
  connectorId: string | null
  onFileSelect: (files: Array<{ name: string; size: number; key: string; bucket: string }>) => void
  disabled?: boolean
}

export default function S3FileBrowser({
  connectorId,
  onFileSelect,
  disabled = false
}: S3FileBrowserProps) {
  const [buckets, setBuckets] = useState<string[]>([])
  const [selectedBucket, setSelectedBucket] = useState<string | null>(null)
  const [files, setFiles] = useState<S3File[]>([])
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set())
  const [isLoadingBuckets, setIsLoadingBuckets] = useState(false)
  const [isLoadingFiles, setIsLoadingFiles] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [continuationToken, setContinuationToken] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)

  // Fetch buckets when connector changes
  useEffect(() => {
    if (!connectorId) {
      setBuckets([])
      setSelectedBucket(null)
      return
    }

    const fetchBuckets = async () => {
      setIsLoadingBuckets(true)
      setError(null)
      try {
        const data = await connectorsApi.fetchBuckets(connectorId)
        setBuckets(data)
        
        // If we have buckets and none is selected, select the first one
        if (data.length > 0 && !selectedBucket) {
          setSelectedBucket(data[0])
        }
      } catch (err) {
        console.error('Error fetching S3 buckets:', err)
        setError(err instanceof Error ? err.message : 'Failed to load S3 buckets')
      } finally {
        setIsLoadingBuckets(false)
      }
    }

    fetchBuckets()
  }, [connectorId, selectedBucket])

  // Fetch files when bucket changes or search query changes
  useEffect(() => {
    if (!connectorId || !selectedBucket) {
      setFiles([])
      return
    }

    const fetchFiles = async (token?: string) => {
      setIsLoadingFiles(true)
      setError(null)
      try {
        let params = ''
        if (searchQuery) {
          params += `prefix=${encodeURIComponent(searchQuery)}&`
        }
        if (token) {
          params += `continuationToken=${encodeURIComponent(token)}`
        }

        const data = await connectorsApi.fetchFiles(connectorId, selectedBucket, params)
        
        if (token) {
          // Append to existing files if using continuation token
          setFiles(prev => [...prev, ...data.files])
        } else {
          // Replace files if this is a new search/bucket
          setFiles(data.files)
        }
        
        // Update continuation token and hasMore flag
        setContinuationToken(data.nextContinuationToken || null)
        setHasMore(!!data.nextContinuationToken)
      } catch (err) {
        console.error('Error fetching S3 files:', err)
        setError(err instanceof Error ? err.message : 'Failed to load S3 files')
      } finally {
        setIsLoadingFiles(false)
      }
    }

    // Reset continuation token and fetch files
    setContinuationToken(null)
    fetchFiles()
  }, [connectorId, selectedBucket, searchQuery])

  const handleBucketChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setSelectedBucket(e.target.value)
    setSelectedFiles(new Set())
  }

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    // The search will be triggered by the useEffect when searchQuery changes
  }

  const handleLoadMore = () => {
    if (connectorId && selectedBucket && continuationToken) {
      // Fetch more files using the continuation token
      const fetchMoreFiles = async () => {
        setIsLoadingFiles(true)
        setError(null)
        try {
          let params = ''
          if (searchQuery) {
            params += `prefix=${encodeURIComponent(searchQuery)}&`
          }
          params += `continuationToken=${encodeURIComponent(continuationToken)}`

          const data = await connectorsApi.fetchFiles(connectorId, selectedBucket!, params)
          
          // Append to existing files
          setFiles(prev => [...prev, ...data.files])
          
          // Update continuation token and hasMore flag
          setContinuationToken(data.nextContinuationToken || null)
          setHasMore(!!data.nextContinuationToken)
        } catch (err) {
          console.error('Error fetching more S3 files:', err)
          setError(err instanceof Error ? err.message : 'Failed to load more S3 files')
        } finally {
          setIsLoadingFiles(false)
        }
      }
      
      fetchMoreFiles()
    }
  }

  const toggleFileSelection = (key: string) => {
    const newSelectedFiles = new Set(selectedFiles)
    if (newSelectedFiles.has(key)) {
      newSelectedFiles.delete(key)
    } else {
      newSelectedFiles.add(key)
    }
    setSelectedFiles(newSelectedFiles)
    
    // Call onFileSelect with the selected files
    if (selectedBucket) {
      const selectedFileObjects = files
        .filter(file => newSelectedFiles.has(file.key))
        .map(file => ({
          name: file.name,
          size: file.size,
          key: file.key,
          bucket: selectedBucket
        }))
      
      onFileSelect(selectedFileObjects)
    }
  }

  // Format file size to human-readable format
  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes'
    
    const k = 1024
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }

  // Format date to relative time (e.g., "2 days ago")
  const formatDate = (dateString: string): string => {
    const date = new Date(dateString)
    const now = new Date()
    const diffTime = Math.abs(now.getTime() - date.getTime())
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24))
    
    if (diffDays === 0) {
      return 'Today'
    } else if (diffDays === 1) {
      return 'Yesterday'
    } else if (diffDays < 7) {
      return `${diffDays} days ago`
    } else if (diffDays < 30) {
      const diffWeeks = Math.floor(diffDays / 7)
      return `${diffWeeks} ${diffWeeks === 1 ? 'week' : 'weeks'} ago`
    } else {
      return date.toLocaleDateString()
    }
  }

  // Filter files to only show video files
  const videoFiles = files.filter(file => {
    const extension = file.name.split('.').pop()?.toLowerCase()
    return extension === 'mp4' || extension === 'mov' || extension === 'avi'
  })

  return (
    <div className="space-y-4">
      {/* Bucket selector */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Bucket
        </label>
        <select
          value={selectedBucket || ''}
          onChange={handleBucketChange}
          disabled={disabled || isLoadingBuckets || buckets.length === 0}
          className="w-full rounded-lg border border-gray-300 px-4 py-2 focus:border-primary-500 focus:ring-primary-500 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isLoadingBuckets ? (
            <option value="">Loading buckets...</option>
          ) : buckets.length === 0 ? (
            <option value="">No buckets available</option>
          ) : (
            buckets.map((bucket) => (
              <option key={bucket} value={bucket}>
                {bucket}
              </option>
            ))
          )}
        </select>
      </div>

      {/* Search bar */}
      <form onSubmit={handleSearch} className="flex gap-2">
        <div className="relative flex-1">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <MagnifyingGlassIcon className="h-5 w-5 text-gray-400" />
          </div>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search files..."
            disabled={disabled || !selectedBucket}
            className="w-full rounded-lg border border-gray-300 pl-10 pr-4 py-2 focus:border-primary-500 focus:ring-primary-500 disabled:opacity-50 disabled:cursor-not-allowed"
          />
        </div>
        <button
          type="submit"
          disabled={disabled || !selectedBucket}
          className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Search
        </button>
      </form>

      {/* File listing */}
      <div className="border rounded-lg overflow-hidden">
        {/* Table header */}
        <div className="grid grid-cols-12 bg-gray-50 border-b px-4 py-2 font-medium text-sm text-gray-500 sticky top-0 z-10">
          <div className="col-span-5">Name</div>
          <div className="col-span-2">Size</div>
          <div className="col-span-2">Type</div>
          <div className="col-span-3">Modified</div>
        </div>

        {/* Table body */}
        <div className="divide-y max-h-80 overflow-y-auto">
          {isLoadingFiles && files.length === 0 ? (
            <div className="px-4 py-8 text-center text-gray-500">
              Loading files...
            </div>
          ) : videoFiles.length === 0 ? (
            <div className="px-4 py-8 text-center text-gray-500">
              {searchQuery ? 'No matching files found' : 'No video files in this bucket'}
            </div>
          ) : (
            videoFiles.map((file) => (
              <div
                key={file.key}
                className={cn(
                  "grid grid-cols-12 px-4 py-3 hover:bg-gray-50 cursor-pointer",
                  selectedFiles.has(file.key) && "bg-primary-50"
                )}
                onClick={() => toggleFileSelection(file.key)}
              >
                <div className="col-span-5 flex items-center">
                  <input
                    type="checkbox"
                    checked={selectedFiles.has(file.key)}
                    onChange={() => toggleFileSelection(file.key)}
                    className="mr-3 h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded"
                  />
                  <span className="truncate">{file.name}</span>
                </div>
                <div className="col-span-2">{formatFileSize(file.size)}</div>
                <div className="col-span-2 uppercase text-xs">{file.name.split('.').pop()}</div>
                <div className="col-span-3">{formatDate(file.lastModified)}</div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Load more button */}
      {hasMore && (
        <div className="flex justify-center">
          <button
            onClick={handleLoadMore}
            disabled={isLoadingFiles || disabled}
            className="px-4 py-2 text-primary-600 bg-white border border-primary-300 rounded-lg hover:bg-primary-50 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLoadingFiles ? 'Loading...' : 'Load More'}
          </button>
        </div>
      )}

      {/* Error message */}
      {error && (
        <div className="p-4 bg-red-50 text-red-700 rounded-lg">
          {error}
        </div>
      )}
    </div>
  )
}