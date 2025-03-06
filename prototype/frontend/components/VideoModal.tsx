'use client'

import { Dialog, Transition } from '@headlessui/react'
import { Fragment, useState, useEffect } from 'react'
import { XMarkIcon } from '@heroicons/react/24/outline'
import { VideoResult } from '@/types'

interface VideoModalProps {
  video: VideoResult | null
  isOpen: boolean
  onClose: () => void
  viewMode?: 'play' | 'details'  // Add viewMode prop with default as 'play'
}

export default function VideoModal({ video, isOpen, onClose, viewMode = 'play' }: VideoModalProps) {
  // Use local state to track whether video is playing (for future use)
  const [isPlaying, setIsPlaying] = useState(false)
  // Add internal state to track the current view mode - initialize with the prop value
  const [currentViewMode, setCurrentViewMode] = useState<'play' | 'details'>(viewMode)
  
  // Update the internal view mode when the prop changes using useEffect
  useEffect(() => {
    setCurrentViewMode(viewMode);
  }, [viewMode]);

  // Safe check if we have a valid video
  if (!video) return null

  // Format upload date
  const formattedDate = video.uploadDate 
    ? new Date(video.uploadDate).toLocaleDateString(undefined, { 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric' 
      })
    : 'Unknown date'
    
  // Function to handle watch video button click
  const handleWatchVideo = () => {
    console.log('Watch Video clicked, switching to play mode');
    setCurrentViewMode('play');
  };

  return (
    <Transition appear show={isOpen} as={Fragment}>
      <Dialog as="div" className="relative z-50" onClose={onClose}>
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-300"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-200"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-black bg-opacity-75" />
        </Transition.Child>

        <div className="fixed inset-0 overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-4 text-center">
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-300"
              enterFrom="opacity-0 scale-95"
              enterTo="opacity-100 scale-100"
              leave="ease-in duration-200"
              leaveFrom="opacity-100 scale-100"
              leaveTo="opacity-0 scale-95"
            >
              <Dialog.Panel className="w-full max-w-4xl transform overflow-hidden rounded-lg bg-white text-left align-middle shadow-xl transition-all">
                <div className="absolute top-4 right-4 z-10">
                  <button
                    type="button"
                    className="rounded-full bg-white bg-opacity-80 p-2 text-gray-600 hover:bg-opacity-100 hover:text-gray-900 focus:outline-none"
                    onClick={onClose}
                  >
                    <XMarkIcon className="h-6 w-6" aria-hidden="true" />
                  </button>
                </div>

                {/* Conditional rendering based on viewMode */}
                {currentViewMode === 'play' ? (
                  // Video player view
                  <div className="relative">
                    <div className="aspect-video bg-black">
                      {video.videoPreviewUrl ? (
                        <video 
                          src={video.videoPreviewUrl} 
                          className="w-full h-full" 
                          controls 
                          autoPlay
                          onPlay={() => setIsPlaying(true)}
                          onPause={() => setIsPlaying(false)}
                        />
                      ) : (
                        <div className="flex items-center justify-center h-full">
                          <p className="text-white">Video preview not available</p>
                        </div>
                      )}
                    </div>
                    
                    {/* Video metadata below player */}
                    <div className="p-6">
                      <Dialog.Title as="h3" className="text-xl font-semibold text-gray-900">
                        {video.title || 'Untitled Video'}
                      </Dialog.Title>
                      <p className="mt-2 text-gray-600">
                        {video.description || 'No description available'}
                      </p>
                      <div className="mt-4 text-sm text-gray-500">
                        <p>Uploaded: {formattedDate}</p>
                        {video.videoDuration && <p>Duration: {video.videoDuration}</p>}
                      </div>
                    </div>
                  </div>
                ) : (
                  // Details view
                  <div className="p-6">
                    <Dialog.Title as="h3" className="text-xl font-semibold text-gray-900 mb-4">
                      Video Details
                    </Dialog.Title>
                    
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                      {/* Thumbnail preview */}
                      <div className="md:col-span-1">
                        {video.videoThumbnailUrl ? (
                          <img
                            src={video.videoThumbnailUrl}
                            alt={video.title || "Video thumbnail"}
                            className="w-full rounded-lg"
                          />
                        ) : (
                          <div className="aspect-video bg-gray-200 rounded-lg flex items-center justify-center">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                            </svg>
                          </div>
                        )}
                      </div>
                      
                      {/* Detailed information */}
                      <div className="md:col-span-2">
                        <h4 className="text-lg font-medium mb-2">{video.title || 'Untitled Video'}</h4>
                        <p className="text-gray-600 mb-4">{video.description || 'No description available'}</p>
                        
                        <div className="grid grid-cols-2 gap-4 text-sm">
                          <div>
                            <p className="text-gray-500">Uploaded</p>
                            <p className="font-medium">{formattedDate}</p>
                          </div>
                          <div>
                            <p className="text-gray-500">Duration</p>
                            <p className="font-medium">{video.videoDuration || 'Unknown'}</p>
                          </div>
                          <div>
                            <p className="text-gray-500">Format</p>
                            <p className="font-medium">{video.format || 'Unknown'}</p>
                          </div>
                          <div>
                            <p className="text-gray-500">Size</p>
                            <p className="font-medium">{video.size ? (video.size / (1024 * 1024)).toFixed(2) + ' MB' : 'Unknown'}</p>
                          </div>
                          <div>
                            <p className="text-gray-500">Index</p>
                            <p className="font-medium">{video.indexId || 'Default'}</p>
                          </div>
                          <div>
                            <p className="text-gray-500">Status</p>
                            <p className="font-medium capitalize">{video.status?.replace(/_/g, ' ') || 'Unknown'}</p>
                          </div>
                        </div>
                        
                        {/* Technical details section */}
                        <div className="mt-6">
                          <h5 className="font-medium mb-2">Technical Information</h5>
                          <div className="bg-gray-50 p-3 rounded-md overflow-auto text-sm font-mono text-gray-700">
                            <p>Video ID: {video.id}</p>
                            {video.videoS3Path && <p>S3 Path: {video.videoS3Path}</p>}
                            <p>Source: {video.source || 'Unknown'}</p>
                          </div>
                        </div>
                        
                        {/* Actions */}
                        <div className="mt-6 flex space-x-3">
                          <button
                            type="button"
                            className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none"
                            onClick={handleWatchVideo}
                          >
                            Watch Video
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
                
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </Dialog>
    </Transition>
  )
}
