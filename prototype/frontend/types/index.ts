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
  previewUrl: string
  duration: number
  source: string
  sourceUrl: string
  uploadDate: string
  format: string
  resolution: string
  fileSize: string
  segments: VideoSegment[]
}

export interface SearchOptions {
  visualSearch: boolean
  audioSearch: boolean
  minConfidence: number
  showConfidenceScores: boolean
  selectedIndex: string | null
}

export interface Index {
  id: string
  name: string
  status?: 'processing' | 'ready' | 'error'
  progress?: number
  error?: string
  createdAt?: string
  updatedAt?: string
  videoCount?: number
  totalDuration?: number
} 