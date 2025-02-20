// {
//     "video_id": "string",  // Unique identifier for the video
//     "video_original_path": "string",  // Youtube URL or local video path
//     "video_s3_path": "string",  // S3 storage location
//     "video_title": "string",  // Video title
//     "video_description": "string",  // Original video description    
//     "video_duration": "string",  // Total video duration in SMPTE format
//     "video_summary": "string",  // Video summary, AI generated
//     // Here the video segment is general concept of the video shot, which is "a series of interrelated consecutive pictures taken contiguously by a single camera and representing a continuous action in time and space. "
//     "video_segments": [
//         {
//             "segment_id": "string",
//             "segment_start_time": "string",  // SMPTE format
//             "segment_end_time": "string",    // SMPTE format
//             "segment_duration": "string",  // SMPTE format
//             "segment_audio": {
//                 "segment_audio_transcript": "string",  // Raw transcript text
//                 "segment_audio_semantic_embedding": [0.0],  // Audio embedding
//                 "segment_audio_description": "string"  // Audio description, AI generated
//             },
//             "segment_visual": {
//                 "segment_visual_keyframe_path": "string",  // S3 path to keyframe
//                 "segment_visual_description": "string",  // Visual description, AI generated
//                 // Object detection results
//                 "segment_visual_objects": [
//                     {
//                         "label": "string",  // Object label (e.g., "hummingbird", "person")
//                         "confidence": "float",
//                         "bounding_box": {
//                             "left": "float",
//                             "top": "float",
//                             "width": "float",
//                             "height": "float"
//                         },
//                     }
//                 ],
//                 // Face detection results
//                 "segment_visual_faces": [
//                     {
//                         "person_name": "string",  // Identified person (e.g., "Joe Biden")
//                         "confidence": "float",
//                         "bounding_box": {
//                             "left": "float",
//                             "top": "float",
//                             "width": "float",
//                             "height": "float"
//                         }
//                     }
//                 ],
//                 "segment_visual_embedding": [0.0],  // Visual embedding for image similarity search
//                 "segment_visual_ocr_text": ["string"]  // Extracted text from images
//             }
//         }
//     ],
//     // Quick search data - used for initial search
//     "video_metadata": {
//         "exact_match_keywords": {
//             "visual": ["string"],  // All visual objects and faces for exact matching
//             "audio": ["string"],   // Important phrases and keywords from audio
//             "text": ["string"]     // OCR and caption text for exact matching
//         },
//         "semantic_vectors": {
//             "visual_embedding": [0.0],  // A numerical vector representing the overall visual content of the video. Used for finding visually similar videos or when searching with an image query.
//             "text_embedding": [0.0],    // A numerical vector representing the semantic meaning of all text content. Used for fuzzy text search where exact matches aren't required (e.g., searching for "birds" might match "parrots" or "hummingbirds").
//             "audio_embedding": [0.0]    // A numerical vector representing the audio content. Used for finding videos with similar audio content or when searching with an audio query.
//         }
//     }
// }

// Video metadata types
export interface VideoMetadata {
  video_id: string;
  video_original_path?: string;     // Youtube URL or local video path
  video_s3_path: string;            // S3 storage location
  video_title: string;              // Video title
  video_description?: string;       // Original video description    
  video_duration?: number;          // Total video duration in milliseconds
  video_summary?: string;           // Video summary, AI generated
  video_name?: string;              // Original file name
  video_size?: number;              // File size in bytes
  video_type?: string;              // MIME type
  video_status: VideoStatus;        // Current processing status
  created_at: string;               // ISO timestamp
  updated_at: string;               // ISO timestamp
  error?: string;                   // Error message if processing failed
  segment_count?: number;           // Number of detected segments
  total_duration?: number;          // Total duration in milliseconds
  job_id?: string;                  // Job ID for the video processing

  video_segments?: VideoSegment[];  // Video segments
  video_metadata?: SearchMetadata;  // Quick search metadata
}

export type VideoStatus = 
  | 'awaiting_upload'   // Initial state when pre-signed URL is generated
  | 'uploading'         // File is being uploaded to S3
  | 'uploaded'          // File upload completed
  | 'processing'        // Video is being processed (slicing/indexing)
  | 'ready'            // Video is fully processed and searchable
  | 'error'            // Processing failed
  | 'deleted';         // Video was deleted

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
