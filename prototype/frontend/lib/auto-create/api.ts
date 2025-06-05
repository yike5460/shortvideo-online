import { 
  AutoCreateJob, 
  CreateJobRequest, 
  CreateJobResponse, 
  JobStatusResponse, 
  JobHistoryResponse 
} from './types';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || '';

export async function createAutoCreateJob(request: CreateJobRequest): Promise<AutoCreateJob> {
  const response = await fetch(`${API_BASE_URL}/auto-create`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    throw new Error(`Failed to create job: ${response.statusText}`);
  }

  const data: CreateJobResponse = await response.json();
  
  // Return a basic job object with the response data
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
  const url = new URL(`${API_BASE_URL}/auto-create/jobs/${jobId}`);
  if (userId) {
    url.searchParams.append('userId', userId);
  }
  
  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to get job status: ${response.statusText}`);
  }

  const data: JobStatusResponse = await response.json();
  return data;
}

export async function getJobHistory(userId?: string): Promise<AutoCreateJob[]> {
  const url = new URL(`${API_BASE_URL}/auto-create/jobs`);
  if (userId) {
    url.searchParams.append('userId', userId);
  }
  
  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to get job history: ${response.statusText}`);
  }

  const data: JobHistoryResponse = await response.json();
  return data.jobs;
}

export async function cancelJob(jobId: string): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/auto-create/jobs/${jobId}/cancel`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to cancel job: ${response.statusText}`);
  }
}

// Server-Sent Events for real-time updates
export function subscribeToJobUpdates(
  jobId: string,
  onUpdate: (job: AutoCreateJob) => void,
  onError?: (error: Error) => void,
  userId?: string
): () => void {
  const url = new URL(`${API_BASE_URL}/auto-create/stream/${jobId}`);
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

  eventSource.onerror = (event) => {
    console.error('SSE connection error:', event);
    onError?.(new Error('Connection error'));
  };

  // Return cleanup function
  return () => {
    eventSource.close();
  };
}