import { apiRequest } from './client';

export interface ClipSuggestion {
  clipId: string;
  title: string;
  description: string;
  startTime: number;
  endTime: number;
  duration: number;
  qualityScore: number;
  engagementScore: number;
  segments: string[];
  thumbnailUrl?: string;
  previewUrl?: string;
  tags: string[];
  style: string;
  aspectRatios: {
    landscape: { width: number; height: number };
    portrait: { width: number; height: number };
    square: { width: number; height: number };
  };
}

export interface AutoClipsResult {
  videoId: string;
  indexId: string;
  targetDuration: number;
  style: string;
  count: number;
  clips: ClipSuggestion[];
}

export type ClipStyle = 'highlights' | 'tutorial' | 'montage' | 'storytelling';

export async function generateAutoClips(
  videoId: string,
  indexId: string,
  options?: {
    targetDuration?: number;
    count?: number;
    style?: ClipStyle;
  }
): Promise<AutoClipsResult> {
  return apiRequest(`/videos/auto-clips/${videoId}`, {
    method: 'POST',
    body: {
      indexId,
      targetDuration: options?.targetDuration || 30,
      count: options?.count || 5,
      style: options?.style || 'highlights',
    },
  });
}
