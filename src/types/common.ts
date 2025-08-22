// Video metadata types
export interface VideoMetadata {  
  video_index: string;              // Index ID
  video_description?: string;       // Original video description    
  video_duration?: string;          // Total video duration in "HH:MM:SS"
  video_id?: string;
  video_name?: string;              // Original file name
  video_source?: string;     // Youtube URL or local video path
  video_s3_path?: string;           // S3 storage location
  video_preview_url?: string;       // Pre-signed URL for thumbnail (video thumbnail)
  video_size?: number;              // File size in bytes
  video_status?: VideoStatus;       // Current processing status
  video_summary?: string;           // Video summary, AI generated
  video_tags?: string[];            // Tags for the video
  video_title?: string;             // Video title
  video_thumbnail_s3_path?: string; // S3 path to thumbnail (image)
  video_thumbnail_url?: string;     // Pre-signed URL for thumbnail (image thumbnail)
  video_type?: string;              // MIME type
  
  created_at?: string;              // ISO timestamp
  updated_at?: string;              // ISO timestamp
  error?: string;                   // Error message if processing failed
  message?: string;                 // Status message for processing updates
  segment_count?: number;           // Number of detected segments
  job_id?: string;                  // Job ID for the video processing
  
  // Video conversion fields
  converted_video_s3_path?: string; // S3 path to H.264 converted video if conversion was needed
  original_codec?: string;          // Original video codec before conversion
  conversion_status?: string;       // Status of video conversion process
  
  is_merged?: boolean;              // Flag to identify if this is a merged video
  merged_name?: string;             // Original custom name for merged videos
  merged_file_name?: string;        // Sanitized file name for merged videos
  parent_video_id?: string;         // Original video ID for merged videos
  
  video_metadata?: SearchMetadata;  // Quick search metadata
  video_segments?: VideoSegment[];  // Video segments
  merged_segments?: VideoSegment[]; // Merged video segments
  video_objects?: TimestampedLabel[];
  video_faces?: FaceDetection[];
  segment_visual_ocr_text?: string[];    // Extracted text
}

export type VideoStatus = 
  | 'downloading'       // Initial state when video is being downloaded from YouTube
  | 'awaiting_upload'   // Initial state when pre-signed URL is generated
  | 'uploading'         // File is being uploaded to S3
  | 'uploaded'          // File upload completed
  | 'processing'        // Video is being processed (slicing/indexing)
  | 'ready_for_face'    // Video completed face detection
  | 'ready_for_object'  // Video completed object detection
  | 'ready_for_shots'   // Video completed shot detection
  | 'ready_for_video_embed'   // Video completed video embedding
  | 'ready_for_audio_embed'   // Video completed audio embedding
  | 'ready'             // Video is fully processed and searchable
  | 'error'             // Processing failed
  | 'deleted';          // Video was deleted

export type WebVideoStatus = 
  | 'processing'
  | 'completed'
  | 'failed'

export interface VideoSegment {
  segment_id?: string;        // Segment ID, will be updated once in segment detection, in format of `${videoId}_segment_${segmentNumber}`,
  video_id: string;
  start_time: number;        // Milliseconds from start, align with StartTimestampMillis in Rekognition response
  end_time: number;          // Milliseconds from start, align with EndTimestampMillis in Rekognition response
  duration: number;          // Segment duration in milliseconds, align with DurationMillis in Rekognition response
  segment_video_s3_path?: string;     // S3 storage location for each segment (shots)
  segment_video_preview_url?: string; // Pre-signed URL for thumbnail (video thumbnail)
  segment_video_thumbnail_s3_path?: string; // S3 path to thumbnail (image)
  segment_video_thumbnail_url?: string;     // Pre-signed URL for thumbnail (image thumbnail)
  segment_name?: string;      // Custom name for merged segments (original user input)
  segment_file_name?: string; // Sanitized file name used for storage (for merged segments)
  confidence?: number;        // Confidence score for the segment
  segment_audio?: {
    segment_audio_transcript?: string;     // Raw transcript text
    segment_audio_embedding?: number[];  // Audio embedding
    segment_audio_description?: string;    // Audio description
  };
  segment_visual?: {
    segment_visual_description?: string;    // Visual description
    segment_visual_embedding?: number[];    // Visual embedding
  };
}

// Define the categories, aliases, parents types
export interface NamedEntity {
  Name: string;
}

// Define a new interface for label instances
export interface LabelInstance {
  boundingBox: BoundingBox;
  confidence: number;
}

// Define a new interface for detailed label info
export interface LabelInfo {
  name: string;
  categories: NamedEntity[];
  aliases: NamedEntity[];
  parents: NamedEntity[];
  confidence: number;
  instances: LabelInstance[];
}

// Define a new interface for timestamp-grouped labels
export interface TimestampedLabel {
  timestamp: number;
  labels: LabelInfo[];
}

export interface FaceLandmark {
  type: string;
  x: number;
  y: number;
}

export interface FacePose {
  pitch: number;
  roll: number;
  yaw: number;
}

export interface FaceQuality {
  brightness: number;
  sharpness: number;
}

export interface FaceDetection {
  confidence: number;
  bounding_box: BoundingBox;
  landmarks?: FaceLandmark[];
  pose?: FacePose;
  quality?: FaceQuality;
  timestamp?: number;
}

export interface BoundingBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

// Quick search metadata
export interface SearchMetadata {
  exact_match_keywords: {
    visual: string[];    // All visual objects and faces
    audio: string[];     // Important phrases and keywords
    text: string[];      // OCR and caption text
  };
  semantic_vectors: {
    visual_embedding?: number[];  // Overall visual content vector
    text_embedding?: number[];    // Semantic text vector
    audio_embedding?: number[];   // Audio content vector
  };
}

export type ConfidencePreset = 'low' | 'medium' | 'high'
export type ConfidenceAdjustment = 'less' | 'default' | 'more'

export interface SearchOptions {
  visualSearch: boolean
  audioSearch: boolean
  minConfidence: number
  showConfidenceScores: boolean
  selectedIndex: string | null
  confidencePreset: ConfidencePreset
  confidenceAdjustment: ConfidenceAdjustment
}

// Processing job types
export interface VideoProcessingJob {
  videoId: string;
  bucket: string;
  key: string;
  metadata?: {
    fileName?: string;
    fileSize?: number;
    fileType?: string;
  };
}

// Add OpenSearch result type with confidence
export interface OpenSearchHit {
  _id: string;
  _score: number; // This is the OpenSearch confidence score
  _source: any;
}

// Align with the web frontend in frontend/types/index.ts
export interface VideoResult {
  id: string;
  title: string;
  description: string;
  videoPreviewUrl: string;
  videoS3Path: string;
  videoDuration: string;
  videoThumbnailS3Path?: string;  // S3 path to thumbnail (image)
  videoThumbnailUrl?: string;     // Pre-signed URL for thumbnail (image thumbnail)
  source: 'local' | 'youtube' | 'merged';  // Added 'merged' source type
  uploadDate: string;
  format: string;
  status: VideoStatus;
  size: number;
  segments: VideoSegment[];
  searchConfidence?: number; // Add OpenSearch confidence score
  indexId: string;
  parentVideoId?: string;    // For merged segments to reference original video
  isMerged?: boolean;        // Flag to identify merged segments
  customName?: string;       // Custom name for merged videos (original user input)
  fileName?: string;         // Sanitized file name used for storage (for merged videos)
  video_objects?: TimestampedLabel[]; // Add filtered video objects with categories and aliases
}

// Define status types for merge jobs
export type MergeJobStatus = 'queued' | 'processing' | 'completed' | 'failed';

// Define merge job result interface
export interface MergeJobResult {
  mergedVideoUrl?: string;      // Pre-signed URL for the merged video
  thumbnailUrl?: string;        // Pre-signed URL for the thumbnail
  duration?: number;            // Duration of the merged video in milliseconds
  customName?: string;          // Original custom name provided by the user
  mergedVideoS3Path?: string;   // S3 path to the merged video
  mergedThumbnailS3Path?: string; // S3 path to the thumbnail
  mergedSegment?: VideoSegment; // The merged segment data
}

// Define merge job interface
export interface MergeJob {
  jobId: string;               // Unique identifier for the job
  userId: string;              // User who created the job
  status: MergeJobStatus;      // Current status of the job
  progress: number;            // Progress percentage (0-100)
  createdAt: string;           // ISO timestamp when job was created
  completedAt?: string;        // ISO timestamp when job was completed
  mergeParams: any;            // Original merge parameters
  result?: MergeJobResult;     // Result data when job is completed
  errorMessage?: string;       // Error message if job failed
}
