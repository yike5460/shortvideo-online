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
      prev.some((s) => s.start_time === segment.start_time)
        ? prev.filter((s) => s.start_time !== segment.start_time)
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

  const formatResolution = (video: VideoResult) => {
    // Use size property instead of resolution
    return video.format || 'Unknown';
  };

  const formatFileSize = (video: VideoResult) => {
    // Use size property instead of fileSize
    if (!video.size) return 'Unknown';
    
    const sizeInMB = video.size / (1024 * 1024);
    if (sizeInMB < 1) {
      return `${Math.round(video.size / 1024)} KB`;
    } else if (sizeInMB < 1024) {
      return `${Math.round(sizeInMB * 10) / 10} MB`;
    } else {
      return `${Math.round(sizeInMB / 102.4) / 10} GB`;
    }
  };

  const renderSegments = (video: VideoResult) => {
    if (!video.segments || video.segments.length === 0) {
      return (
        <div className="text-gray-500 text-sm italic">
          No segments available
        </div>
      );
    }
    
    return (
      <div className="space-y-2">
        {video.segments.map((segment, index) => (
          <div 
            key={segment.segment_id || index} 
            className="p-2 bg-gray-50 rounded border border-gray-100 hover:bg-gray-100 cursor-pointer"
            onClick={() => handleSegmentSelect(segment)}
          >
            <div className="flex justify-between items-center">
              <span className="text-sm font-medium">
                {Math.floor(segment.start_time / 60)}:{String(segment.start_time % 60).padStart(2, '0')} - {Math.floor(segment.end_time / 60)}:{String(segment.end_time % 60).padStart(2, '0')}
              </span>
              <span className="text-xs text-gray-500">
                {Math.floor(segment.duration / 60)}:{String(segment.duration % 60).padStart(2, '0')}
              </span>
            </div>
            {segment.segment_visual?.segment_visual_description && (
              <p className="text-xs text-gray-600 mt-1 line-clamp-2">
                {segment.segment_visual.segment_visual_description}
              </p>
            )}
          </div>
        ))}
      </div>
    );
  };

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
            <span className="ml-2 text-gray-900">{formatResolution(video)}</span>
          </div>
          <div>
            <span className="text-gray-500">Resolution:</span>
            <span className="ml-2 text-gray-900">{formatResolution(video)}</span>
          </div>
          <div>
            <span className="text-gray-500">Size:</span>
            <span className="ml-2 text-gray-900">{formatFileSize(video)}</span>
          </div>
        </div>
      </div>

      {/* Video Player */}
      {playingSegment && (
        <div className="aspect-video rounded-lg overflow-hidden bg-black">
          <ReactPlayer
            url={`${video.sourceUrl}#t=${playingSegment.start_time},${playingSegment.end_time}`}
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
          {renderSegments(video)}
        </div>
      </div>
    </div>
  )
} 