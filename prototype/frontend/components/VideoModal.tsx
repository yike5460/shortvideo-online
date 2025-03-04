'use client'

import { Dialog } from '@headlessui/react'
import { XMarkIcon } from '@heroicons/react/24/outline'
import { VideoResult } from '@/types'

interface VideoModalProps {
  video: VideoResult | null;
  isOpen: boolean;
  onClose: () => void;
}

export default function VideoModal({ video, isOpen, onClose }: VideoModalProps) {
  if (!video) return null;

  return (
    <Dialog
      open={isOpen}
      onClose={onClose}
      className="relative z-50"
      as="div"
    >
      <div className="fixed inset-0 bg-black/70" aria-hidden="true" />
      
      <div className="fixed inset-0 flex items-center justify-center p-4">
        <Dialog.Panel className="mx-auto max-w-4xl w-full bg-white rounded-xl shadow-xl overflow-hidden">
          <div className="relative">
            <button
              type="button"
              onClick={onClose}
              className="absolute top-4 right-4 z-10 p-2 rounded-full bg-black/50 text-white hover:bg-black/70 focus:outline-none"
            >
              <XMarkIcon className="h-6 w-6" />
            </button>
            
            <div>
              <div className="aspect-video w-full">
                <video
                  src={video.videoPreviewUrl}
                  controls
                  autoPlay
                  className="w-full h-full object-contain"
                >
                  Your browser does not support the video tag.
                </video>
              </div>
              
              <div className="p-6">
                <div className="flex justify-between items-center mb-4">
                  <Dialog.Title className="text-xl font-medium">
                    {video.title || video.description || "Untitled Video"}
                  </Dialog.Title>
                </div>
                
                {/* Optional metadata section */}
                {(video.id || video.indexId) && (
                  <div className="flex gap-4 mb-4 text-sm text-gray-500">
                    {video.id && (
                      <div className="flex items-center gap-1">
                        <span>video-id: {video.id.substring(0, 8) || 'unknown'}...</span>
                        <button className="text-gray-400 hover:text-gray-600" type="button">
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                          </svg>
                        </button>
                      </div>
                    )}
                    
                    {video.indexId && (
                      <div className="flex items-center gap-1">
                        <span>index-id: {video.indexId.substring(0, 8) || 'none'}...</span>
                        <button className="text-gray-400 hover:text-gray-600" type="button">
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                          </svg>
                        </button>
                      </div>
                    )}
                  </div>
                )}
                
                {video.description && (
                  <p className="mt-2 text-gray-600">
                    {video.description}
                  </p>
                )}
                
                <div className="mt-4 flex items-center justify-between text-sm text-gray-500">
                  <span>Uploaded: {new Date(video.uploadDate || Date.now()).toLocaleDateString()}</span>
                  <span>Duration: {video.videoDuration || '00:00:00'}</span>
                </div>
              </div>
            </div>
          </div>
        </Dialog.Panel>
      </div>
    </Dialog>
  );
} 