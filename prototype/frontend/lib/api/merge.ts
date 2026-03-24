import { apiRequest } from './client';

export interface MergeParams {
  indexId: string;
  videoId: string;
  segmentIds: string[];
  segmentsData?: any[];
  mergedName?: string;
  userId?: string;
  mergeOptions?: {
    resolution: '720p' | '1080p';
    transition: 'cut' | 'fade' | 'dissolve';
    transitionDuration: number;
    clipTransitions?: {
      segmentId: string;
      transitionType: 'cut' | 'fade' | 'dissolve';
      transitionDuration: number;
    }[];
  };
}

export async function initiateVideoMerge(params: MergeParams): Promise<string> {
  const result = await apiRequest<{ jobId: string }>('/videos/merge', {
    method: 'POST',
    body: params,
  });
  return result.jobId;
}

export async function getMergeJobStatus(jobId: string, userId: string): Promise<any> {
  return apiRequest(`/videos/merge/${jobId}?userId=${encodeURIComponent(userId)}`);
}
