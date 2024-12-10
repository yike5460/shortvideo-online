export interface VideoSource {
  id: string
  label: string
}

export interface VideoSegment {
  startTime: number
  endTime: number
  text: string
  confidence: number
}

export interface VideoResult {
  id: string
  title: string
  description: string
  thumbnailUrl: string
  duration: number
  source: string
  sourceUrl: string
  uploadDate: string
  format: string
  resolution: string
  fileSize: string
  segments: VideoSegment[]
  previewUrl: string
} 