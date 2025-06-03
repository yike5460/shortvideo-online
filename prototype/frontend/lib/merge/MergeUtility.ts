'use client';

import { VideoSegment } from '@/types';

export interface MergeOptions {
  resolution: '720p' | '1080p';
  transition: 'cut' | 'fade' | 'dissolve';
  transitionDuration: number;
  clipTransitions?: {
    segmentId: string;
    transitionType: 'cut' | 'fade' | 'dissolve';
    transitionDuration: number;
  }[];
}

export interface MergeParams {
  indexId: string;
  videoId: string;
  segmentIds: string[];
  segmentsData?: VideoSegment[];  // Add support for complete segment data
  mergedName?: string;
  userId?: string;
  mergeOptions?: MergeOptions;
}

export interface MergeCallbacks {
  onProgress?: (progress: number) => void;
  onComplete?: (result: any) => void;
  onFailed?: (error: string) => void;
}

export class MergeUtility {
  private pollingInterval: NodeJS.Timeout | null = null;
  private API_ENDPOINT = process.env.NEXT_PUBLIC_API_URL;
  
  // Initiate a merge job
  async initiateVideoMerge(params: MergeParams): Promise<string> {
    const response = await fetch(`${this.API_ENDPOINT}/videos/merge`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(params),
    });
    
    if (!response.ok) {
      throw new Error(`Failed to merge segments: ${response.statusText}`);
    }
    
    const result = await response.json();
    return result.jobId;
  }
  
  // Poll for job status
  pollMergeJobStatus(jobId: string, userId: string, callbacks: MergeCallbacks): void {
    const checkInterval = 5000; // Check every 5 seconds
    const maxAttempts = 60;     // Maximum 5 minutes (60 * 5 seconds)
    let attempts = 0;
    
    // Clear any existing intervals
    this.cancelPolling();
    
    // Start polling
    this.pollingInterval = setInterval(async () => {
      attempts++;
      console.log(`Checking merge job status (attempt ${attempts}/${maxAttempts})...`);
      
      try {
        // Call the API to get job status
        const response = await fetch(`${this.API_ENDPOINT}/videos/merge/${jobId}?userId=${encodeURIComponent(userId)}`);
        
        if (!response.ok) {
          throw new Error(`Failed to get job status: ${response.statusText}`);
        }
        
        const jobStatus = await response.json();
        console.log('Job status:', jobStatus);
        
        // Update UI based on job status
        if (jobStatus.status === 'completed') {
          // Clear interval
          this.cancelPolling();
          
          // Call onComplete callback
          if (callbacks.onComplete) {
            callbacks.onComplete(jobStatus.result);
          }
        } else if (jobStatus.status === 'failed') {
          // Clear interval
          this.cancelPolling();
          
          // Call onFailed callback
          if (callbacks.onFailed) {
            callbacks.onFailed(jobStatus.errorMessage || 'Merge process failed');
          }
        } else if (jobStatus.status === 'processing') {
          // Call onProgress callback
          if (callbacks.onProgress) {
            callbacks.onProgress(jobStatus.progress || 0);
          }
        }
      } catch (error) {
        console.error('Error checking job status:', error);
      }
      
      // If max attempts reached
      if (attempts >= maxAttempts) {
        this.cancelPolling();
        
        // Call onFailed callback
        if (callbacks.onFailed) {
          callbacks.onFailed('Merge process timed out. The video might still be processing.');
        }
      }
    }, checkInterval);
  }
  
  // Cancel polling
  cancelPolling(): void {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
  }
}

// Export singleton instance
export const mergeUtility = new MergeUtility();