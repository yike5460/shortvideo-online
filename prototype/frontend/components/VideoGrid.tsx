import { useState } from 'react'
import { VideoResult } from '@/types'
import ReactPlayer from 'react-player/lazy'
import { CheckIcon } from '@heroicons/react/24/outline'

interface VideoGridProps {
  videos: VideoResult[]
  onVideoSelect: (video: VideoResult | null) => void
  selectedVideo: VideoResult | null
}

export default function VideoGrid({ videos, onVideoSelect, selectedVideo }: VideoGridProps) {
  const [hoveredVideo, setHoveredVideo] = useState<string | null>(null)

  if (!Array.isArray(videos)) {
    console.error('Videos prop is not an array:', videos)
    return null
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {videos.map((video) => (
        <div
          key={video.id}
          className="relative group bg-white rounded-lg shadow-sm hover:shadow-md transition-shadow duration-200"
          onMouseEnter={() => setHoveredVideo(video.id)}
          onMouseLeave={() => setHoveredVideo(null)}
        >
          <div className="aspect-video relative rounded-t-lg overflow-hidden">
            {hoveredVideo === video.id ? (
              <ReactPlayer
                url={video.videoPreviewUrl}
                width="100%"
                height="100%"
                playing
                muted
                loop
              />
            ) : (
              <img
                src={video.videoThumbnailUrl}
                alt={video.title}
                className="w-full h-full object-cover"
              />
            )}
            <div className="absolute top-2 right-2">
              <label className="inline-flex items-center">
                <input
                  type="checkbox"
                  className="hidden"
                  checked={selectedVideo?.id === video.id}
                  onChange={() => onVideoSelect(selectedVideo?.id === video.id ? null : video)}
                />
                <span
                  className={`w-6 h-6 flex items-center justify-center rounded-full border-2 ${
                    selectedVideo?.id === video.id
                      ? 'bg-primary-600 border-primary-600'
                      : 'bg-white border-gray-300'
                  }`}
                >
                  {selectedVideo?.id === video.id && (
                    <CheckIcon className="w-4 h-4 text-white" />
                  )}
                </span>
              </label>
            </div>
          </div>

          <div className="p-4">
            <h3 className="text-lg font-semibold text-gray-900 line-clamp-1">{video.title}</h3>
            <p className="mt-1 text-sm text-gray-500 line-clamp-2">{video.description}</p>
            <div className="mt-2 flex items-center gap-2 text-sm text-gray-600">
              <span>{new Date(video.uploadDate).toLocaleDateString()}</span>
              <span>•</span>
              {/* The video duration is in the format of HH:MM:SS */}
              <span>{video.videoDuration}</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
} 