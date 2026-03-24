import { apiRequest } from './client';

export interface SegmentTag {
  tagId: string;
  videoId: string;
  indexId: string;
  segmentId: string;
  startTime: number;
  endTime: number;
  duration: number;
  scene: {
    environment: 'indoor' | 'outdoor' | 'mixed';
    location: string;
    lighting: string;
    colorGrading: string;
  };
  subjects: Array<{
    type: string;
    description: string;
    action: string;
  }>;
  camera: {
    shotType: string;
    movement: string;
    composition: string;
  };
  emotion: {
    facialExpressions: Array<{
      type: string;
      intensity: 'low' | 'medium' | 'high';
    }>;
    overallMood: string;
    engagementLevel: string;
  };
  audio: {
    type: string;
    description: string;
  };
  summary: string;
  keywords: string[];
  emotionKeywords: string[];
  visualStyleKeywords: string[];
  category: string;
  emotionalIntensity: 'low' | 'medium' | 'high';
  utilityTags: string[];
  technicalTags: string[];
  tag: string;
  confidence: number;
  createdAt: string;
}

export interface AnalysisResult {
  videoId: string;
  indexId: string;
  totalSegments: number;
  analyzedSegments: number;
  processingTimeMs: number;
  tags: SegmentTag[];
}

export interface TagsResult {
  videoId: string;
  count: number;
  tags: SegmentTag[];
}

export async function startAnalysis(videoId: string, indexId: string): Promise<AnalysisResult> {
  return apiRequest(`/videos/analyze/${videoId}`, {
    method: 'POST',
    body: { indexId },
  });
}

export async function getTags(
  videoId: string,
  options?: { category?: string; tag?: string; format?: 'json' | 'csv' }
): Promise<TagsResult> {
  const params = new URLSearchParams();
  if (options?.category) params.set('category', options.category);
  if (options?.tag) params.set('tag', options.tag);
  if (options?.format) params.set('format', options.format);
  const qs = params.toString();
  return apiRequest(`/videos/analyze/${videoId}/tags${qs ? `?${qs}` : ''}`);
}

export async function exportTagsCSV(videoId: string): Promise<string> {
  const params = new URLSearchParams({ format: 'csv' });
  return apiRequest(`/videos/analyze/${videoId}/tags?${params.toString()}`);
}
