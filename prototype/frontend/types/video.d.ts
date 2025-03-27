import { VideoResult, VideoSegment } from '@/types';

// Extend VideoSegment to indicate all fields are required
declare module '@/types' {
  interface VideoSegment {
    segment_id: string;
    video_id: string;
    start_time: number;
    end_time: number;
    duration: number;
    confidence?: number;
    segment_visual?: {
      segment_visual_description?: string;
    };
    segment_video_thumbnail_url?: string;
    segment_video_url?: string;
    segment_audio?: {
      segment_audio_transcript?: string;
    };
  }

  interface VideoResult {
    id: string;
    indexId: string;
    title: string;
    description: string;
    videoThumbnailUrl: string;
    videoPreviewUrl: string;
    videoDuration: string;
    uploadDate: string;
    searchConfidence?: number;
    segments?: VideoSegment[];
    source?: 'local' | 'youtube' | 'merged';
    parentVideoId?: string;    // For merged segments to reference original video
    isMerged?: boolean;        // Flag to identify merged segments
  }
}
