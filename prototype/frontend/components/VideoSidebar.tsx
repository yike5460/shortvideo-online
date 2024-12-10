import { useState } from 'react'
import { VideoResult, VideoSegment } from '@/types'
import ReactPlayer from 'react-player/lazy'
import { ArrowDownTrayIcon, PlayIcon } from '@heroicons/react/24/outline'

interface VideoSidebarProps {
  video: VideoResult
}

export default function VideoSidebar({ video }: VideoSidebarProps) {
  const [selectedSegments, setSelectedSegments] = useState<VideoSegment[]>([])
  const [playingSegment, setPlayingSegment] = useState<VideoSegment | null>(null)

  const handleSegmentSelect = (segment: VideoSegment) => {
    setSelectedSegments((prev) =>
      prev.some((s) => s.startTime === segment.startTime)
        ? prev.filter((s) => s.startTime !== segment.startTime)
        : [...prev, segment]
    )
  }

  const handleDownload = async () => {
    // TODO: Implement download functionality through Cloudflare Worker
    try {
      const response = await fetch('/api/download', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          videoId: video.id,
          segments: selectedSegments,
        }),
      })
      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${video.title}-segments.mp4`
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)
    } catch (error) {
      console.error('Download failed:', error)
    }
  }

  return (
    <div className="bg-white rounded-lg shadow-sm p-6 space-y-6">
      {/* Video Metadata */}
      <div className="space-y-4">
        <h2 className="text-xl font-semibold text-gray-900">{video.title}</h2>
        <p className="text-sm text-gray-600">{video.description}</p>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <span className="text-gray-500">Duration:</span>
            <span className="ml-2 text-gray-900">
              {Math.floor(video.duration / 60)}:{String(video.duration % 60).padStart(2, '0')}
            </span>
          </div>
          <div>
            <span className="text-gray-500">Format:</span>
            <span className="ml-2 text-gray-900">{video.format}</span>
          </div>
          <div>
            <span className="text-gray-500">Resolution:</span>
            <span className="ml-2 text-gray-900">{video.resolution}</span>
          </div>
          <div>
            <span className="text-gray-500">Size:</span>
            <span className="ml-2 text-gray-900">{video.fileSize}</span>
          </div>
        </div>
      </div>

      {/* Video Player */}
      {playingSegment && (
        <div className="aspect-video rounded-lg overflow-hidden bg-black">
          <ReactPlayer
            url={`${video.sourceUrl}#t=${playingSegment.startTime},${playingSegment.endTime}`}
            width="100%"
            height="100%"
            controls
            playing
          />
        </div>
      )}

      {/* Segments List */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-medium text-gray-900">Matching Segments</h3>
          {selectedSegments.length > 0 && (
            <button
              onClick={handleDownload}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-lg hover:bg-primary-700"
            >
              <ArrowDownTrayIcon className="w-4 h-4" />
              Download Selected
            </button>
          )}
        </div>
        <div className="space-y-3 max-h-[400px] overflow-y-auto">
          {video.segments.map((segment) => (
            <div
              key={segment.startTime}
              className="flex items-center gap-4 p-3 rounded-lg hover:bg-gray-50"
            >
              <input
                type="checkbox"
                checked={selectedSegments.some((s) => s.startTime === segment.startTime)}
                onChange={() => handleSegmentSelect(segment)}
                className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
              />
              <button
                onClick={() => setPlayingSegment(segment)}
                className="flex-1 flex items-center gap-3 text-left"
              >
                <PlayIcon className="w-5 h-5 text-gray-400" />
                <div className="flex-1">
                  <p className="text-sm text-gray-900 line-clamp-2">{segment.text}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <p className="text-xs text-gray-500">
                      {Math.floor(segment.startTime / 60)}:{String(segment.startTime % 60).padStart(2, '0')} -{' '}
                      {Math.floor(segment.endTime / 60)}:{String(segment.endTime % 60).padStart(2, '0')}
                    </p>
                    <span className="text-xs text-gray-400">•</span>
                    <p className="text-xs text-gray-500">
                      Confidence: {Math.round(segment.confidence * 100)}%
                    </p>
                  </div>
                </div>
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
} 