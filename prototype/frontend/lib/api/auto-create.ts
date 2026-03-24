import { apiRequest, getFullUrl } from './client';
import {
  AutoCreateJob,
  CreateJobRequest,
  CreateJobResponse,
  JobStatusResponse,
  JobHistoryResponse,
} from '../auto-create/types';

export async function createAutoCreateJob(request: CreateJobRequest): Promise<AutoCreateJob> {
  const data = await apiRequest<CreateJobResponse>('/auto-create', {
    method: 'POST',
    body: request,
  });

  return {
    jobId: data.jobId,
    userId: request.userId,
    request: request.request,
    status: data.status,
    progress: 0,
    createdAt: new Date().toISOString(),
    logs: [],
    estimatedDuration: data.estimatedDuration,
  };
}

export async function getJobStatus(jobId: string, userId?: string): Promise<AutoCreateJob> {
  const params = userId ? `?userId=${encodeURIComponent(userId)}` : '';
  return apiRequest(`/auto-create/jobs/${jobId}${params}`);
}

export async function getJobHistory(userId?: string): Promise<AutoCreateJob[]> {
  const params = userId ? `?userId=${encodeURIComponent(userId)}` : '';
  const data = await apiRequest<JobHistoryResponse>(`/auto-create/jobs${params}`);
  return data.jobs;
}

export async function cancelJob(jobId: string, userId?: string): Promise<void> {
  const params = userId ? `?userId=${encodeURIComponent(userId)}` : '';
  await apiRequest(`/auto-create/jobs/${jobId}/cancel${params}`, { method: 'POST' });
}

export function subscribeToJobUpdates(
  jobId: string,
  onUpdate: (job: AutoCreateJob) => void,
  onError?: (error: Error) => void,
  userId?: string
): () => void {
  const url = new URL(getFullUrl(`/auto-create/stream/${jobId}`));
  if (userId) {
    url.searchParams.append('userId', userId);
  }

  const eventSource = new EventSource(url.toString());

  eventSource.onmessage = (event) => {
    try {
      const job: AutoCreateJob = JSON.parse(event.data);
      onUpdate(job);
    } catch (error) {
      console.error('Failed to parse job update:', error);
      onError?.(new Error('Failed to parse job update'));
    }
  };

  eventSource.onerror = () => {
    onError?.(new Error('Connection error'));
  };

  return () => {
    eventSource.close();
  };
}
