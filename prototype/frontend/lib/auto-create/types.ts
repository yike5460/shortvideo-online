export interface AutoCreateJob {
  jobId: string;
  userId: string;
  request: string;
  status: 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled';
  progress: number;
  createdAt: string;
  completedAt?: string;
  logs: string[];
  result?: {
    description: string;
    duration: number;
    originalRequest: string;
  };
  error?: string;
  estimatedDuration?: number;
  ttl?: number;
}

export interface CreationOptions {
  maxDuration?: number;
  preferredIndexes?: string[];
  selectedIndex?: string;
  outputFormat?: string;
  fastMode?: boolean;
}

export interface CreateJobRequest {
  request: string;
  userId: string;
  options?: CreationOptions;
}

export interface CreateJobResponse {
  jobId: string;
  status: 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled';
  estimatedDuration?: number;
}

export interface JobStatusResponse extends AutoCreateJob {}

export interface JobHistoryResponse {
  jobs: AutoCreateJob[];
}