// Align with the VideoResult type in src/types/common.ts
export interface VideoSource {
  id: string
  label: string
}

export type VideoStatus = 
  | 'awaiting_upload'   // Initial state when pre-signed URL is generated
  | 'uploading'         // File is being uploaded to S3
  | 'uploaded'          // File upload completed
  | 'processing'        // Video is being processed (slicing/indexing)
  | 'ready_for_face'    // Video completed face detection
  | 'ready_for_object'   // Video completed object detection
  | 'ready_for_shots'   // Video completed shot detection
  | 'ready_for_video_embed'   // Video completed video embedding
  | 'ready_for_audio_embed'   // Video completed audio embedding
  | 'ready'             // Video is fully processed and searchable
  | 'error'             // Processing failed
  | 'deleted';          // Video was deleted

export interface VideoSegment {
  segment_id: string;
  video_id: string;
  start_time: number;        // Milliseconds from start
  end_time: number;          // Milliseconds from start
  duration: number;          // Segment duration in milliseconds
  segment_audio?: {
    segment_audio_transcript?: string;     // Raw transcript text
    segment_audio_semantic_embedding?: number[];  // Audio embedding
    segment_audio_description?: string;    // Audio description
  };
  segment_visual?: {
    segment_visual_keyframe_path?: string;  // S3 path to keyframe
    segment_visual_description?: string;    // Visual description
    segment_visual_objects?: VisualObject[];
    segment_visual_faces?: FaceDetection[];
    segment_visual_embedding?: number[];    // Visual embedding
    segment_visual_ocr_text?: string[];    // Extracted text
  };
}

export interface VisualObject {
  label: string;
  confidence: number;
  bounding_box: BoundingBox;
}

export interface FaceDetection {
  person_name?: string;
  confidence: number;
  bounding_box: BoundingBox;
}

export interface BoundingBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface VideoResult {
  id: string;
  title: string;
  description: string;
  thumbnailUrl: string;
  previewUrl: string;
  duration: number;
  source: 'local' | 'youtube';
  sourceUrl?: string;
  uploadDate: string;
  format: string;
  status: VideoStatus;
  size: number;
  metadata?: SearchMetadata;
  segments?: VideoSegment[];
  searchConfidence?: number;
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
  selectedIndex: string | null
  searchType: 'text' | 'image' | 'video' | 'audio'
  searchQuery: string
  exactMatch: boolean
  topK: number
  weights: {
    text: number
    image: number
    video: number
    audio: number
  };
  minConfidence: number
  showConfidenceScores: boolean
  confidencePreset: ConfidencePreset
  confidenceAdjustment: ConfidenceAdjustment
}