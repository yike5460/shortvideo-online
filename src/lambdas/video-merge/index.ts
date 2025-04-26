import { APIGatewayProxyEvent } from 'aws-lambda';
import { LambdaResponse } from '../../types/aws-lambda';
import { VideoSegment } from '../../types/common';
import { S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Client } from '@opensearch-project/opensearch';
import { defaultProvider } from '@aws-sdk/credential-provider-node';
import { AwsSigv4Signer } from '@opensearch-project/opensearch/aws';
import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs';
import { Readable } from 'stream';
import { spawn } from 'child_process';

// Initialize clients
const s3 = new S3Client({});
const openSearch = new Client({
  ...AwsSigv4Signer({
    region: process.env.AWS_REGION || 'us-east-1',
    service: 'aoss',
    getCredentials: () => {
      const credentialsProvider = defaultProvider();
      return credentialsProvider();
    },
  }),
  node: process.env.OPENSEARCH_ENDPOINT
});

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
  'Access-Control-Allow-Credentials': 'true'
};

// Status codes
const STATUS_CODES = {
  OK: 200,
  CREATED: 201,
  BAD_REQUEST: 400,
  NOT_FOUND: 404,
  INTERNAL_SERVER_ERROR: 500
};

// Enhanced interface for merge segments request with merge options
interface MergeSegmentsRequest {
  indexId: string;           // The index the segments belong to
  videoId: string;           // The original video ID
  segmentIds: string[];      // IDs of segments to merge
  mergedName?: string;       // Optional custom name for the merged segment
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

// Interface for cross-video merge request
interface CrossVideoMergeRequest {
  items: {
    indexId: string;
    videoId: string;
    segmentId: string;
    transitionType?: 'cut' | 'fade' | 'dissolve';
    transitionDuration?: number;
  }[];
  mergedName?: string;
  mergeOptions: {
    resolution: '720p' | '1080p';
    defaultTransition: 'cut' | 'fade' | 'dissolve';
    defaultTransitionDuration: number;
  };
}

/**
 * Format duration in milliseconds to HH:MM:SS format
 */
function formatDuration(ms: number): string {
  if (!ms) return '00:00:00';
  
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

/**
 * Helper function to convert a readable stream to a buffer
 */
async function streamToBuffer(stream: Readable): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    stream.on('error', reject);
    stream.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

/**
 * Utility function to perform OpenSearch operations with retry logic
 */
async function withRetry<T>(
  operation: () => Promise<T>,
  maxRetries: number = 5,
  operationName: string = 'OpenSearch operation'
): Promise<T> {
  let retries = 0;
  
  while (true) {
    try {
      return await operation();
    } catch (error) {
      retries++;
      
      if (retries >= maxRetries) {
        console.error(`Failed ${operationName} after ${maxRetries} retries:`, error);
        throw error;
      }
      
      console.warn(`${operationName} failed (retry ${retries}/${maxRetries}):`, error);
      
      // Exponential backoff: 4s, 16s, 64s, 256s, 1024s
      const delay = Math.pow(4, retries) * 1000;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

/**
 * Get segment details from OpenSearch
 */
async function getSegmentDetails(indexId: string, videoId: string, segmentIds: string[]): Promise<any[]> {
  const { body: searchResult } = await withRetry(
    async () => openSearch.search({
      index: indexId,
      body: {
        query: {
          term: {
            video_id: videoId
          }
        }
      }
    }),
    3,
    `Search for segments of video ${videoId} in index ${indexId}`
  );
  
  if (!searchResult.hits || !searchResult.hits.hits || searchResult.hits.hits.length === 0) {
    throw new Error(`Video ${videoId} not found in index ${indexId}`);
  }
  
  // Extract video segments from the search result
  const videoDocument = searchResult.hits.hits[0]._source;
  const videoSegments = videoDocument.video_segments || [];
  
  // Filter segments by segmentIds
  const filteredSegments = videoSegments.filter((segment: any) =>
    segmentIds.includes(segment.segment_id)
  );
  
  return filteredSegments;
}

/**
 * Get a single segment detail from OpenSearch
 */
async function getSegmentDetail(indexId: string, videoId: string, segmentId: string): Promise<VideoSegment | null> {
  const { body: searchResult } = await withRetry(
    async () => openSearch.search({
      index: indexId,
      body: {
        query: {
          term: {
            video_id: videoId
          }
        }
      }
    }),
    3,
    `Search for segment ${segmentId} of video ${videoId} in index ${indexId}`
  );
  
  if (!searchResult.hits || !searchResult.hits.hits || searchResult.hits.hits.length === 0) {
    console.error(`Video ${videoId} not found in index ${indexId}`);
    return null;
  }
  
  // Extract video segments from the search result
  const videoDocument = searchResult.hits.hits[0]._source;
  const videoSegments = videoDocument.video_segments || [];
  
  // Find the segment with the matching ID
  const segment = videoSegments.find((s: any) => s.segment_id === segmentId);
  
  if (!segment) {
    console.error(`Segment ${segmentId} not found in video ${videoId}`);
    return null;
  }
  
  return segment;
}

/**
 * Handle merging video segments from different videos
 */
async function handleCrossVideoMerge(event: APIGatewayProxyEvent): Promise<LambdaResponse> {
  try {
    const request: CrossVideoMergeRequest = JSON.parse(event.body!);
    const { items, mergedName, mergeOptions } = request;

    console.log(`Handling cross-video merge request for ${items.length} segments`);
    
    // Validate request parameters
    if (!items || items.length < 2 || !mergeOptions) {
      return {
        statusCode: STATUS_CODES.BAD_REQUEST,
        headers: corsHeaders,
        body: JSON.stringify({
          error: 'Invalid request parameters',
          details: 'At least 2 items and mergeOptions are required'
        })
      };
    }

    // Create a merged segment name if not provided
    const mergedSegmentName = mergedName || `cross_merged_${Date.now()}`;
    
    // Return success response with placeholder
    return {
      statusCode: STATUS_CODES.OK,
      headers: corsHeaders,
      body: JSON.stringify({
        message: 'Cross-video segments merge initiated',
        mergedName: mergedSegmentName,
        itemCount: items.length
      })
    };
    
  } catch (error) {
    console.error('Error merging cross-video segments:', error);
    return {
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      headers: corsHeaders,
      body: JSON.stringify({
        error: 'Failed to merge cross-video segments',
        details: error instanceof Error ? error.message : 'Unknown error'
      })
    };
  }
}

/**
 * Handle the merging of video segments from the same video
 */
async function handleMergeSegments(event: APIGatewayProxyEvent): Promise<LambdaResponse> {
  try {
    const request: MergeSegmentsRequest = JSON.parse(event.body!);
    const { indexId, videoId, segmentIds, mergedName, mergeOptions } = request;

    console.log(`Handling segment merge request for video ${videoId} in index ${indexId}, segments: ${segmentIds.join(', ')}`);
    
    // Validate request parameters
    if (!indexId || !videoId || !segmentIds || segmentIds.length < 2) {
      return {
        statusCode: STATUS_CODES.BAD_REQUEST,
        headers: corsHeaders,
        body: JSON.stringify({
          error: 'Invalid request parameters',
          details: 'indexId, videoId, and at least 2 segmentIds are required'
        })
      };
    }

    // Create a merged segment name if not provided
    const mergedSegmentName = mergedName || `merged_${Date.now()}`;
    
    // Return success response with placeholder
    return {
      statusCode: STATUS_CODES.OK,
      headers: corsHeaders,
      body: JSON.stringify({
        message: 'Segments merge initiated',
        indexId,
        videoId,
        segmentCount: segmentIds.length,
        mergedName: mergedSegmentName
      })
    };
    
  } catch (error) {
    console.error('Error merging segments:', error);
    return {
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      headers: corsHeaders,
      body: JSON.stringify({
        error: 'Failed to merge segments',
        details: error instanceof Error ? error.message : 'Unknown error'
      })
    };
  }
}

/**
 * Handle getting the status of a merge job
 */
async function handleGetMergeStatus(event: APIGatewayProxyEvent, jobId: string): Promise<LambdaResponse> {
  // This is a placeholder for future implementation
  // In a real implementation, we would check the status of the merge job in DynamoDB
  return {
    statusCode: STATUS_CODES.OK,
    headers: corsHeaders,
    body: JSON.stringify({
      jobId,
      status: 'completed',
      message: 'Merge job completed successfully'
    })
  };
}

/**
 * Lambda handler for video merge operations
 */
export const handler = async (event: APIGatewayProxyEvent): Promise<LambdaResponse> => {
  try {
    // For GET & DELETE requests, we don't need to check for body
    if (event.httpMethod !== 'GET' && event.httpMethod !== 'DELETE' && !event.body) {
      return {
        statusCode: STATUS_CODES.BAD_REQUEST,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Missing request body' })
      };
    }

    // Handle different endpoints based on the path and method
    const path = event.path.toLowerCase();
    const method = event.httpMethod;

    // API Path:
    // POST /videos/merge - Merge segments from the same video
    // POST /videos/cross-merge - Merge segments from different videos
    // GET /videos/merge/{jobId} - Get merge job status

    if (method === 'POST') {
      if (path.endsWith('/videos/merge') || path.endsWith('/videos/merge/')) {
        return handleMergeSegments(event);
      } else if (path.endsWith('/videos/cross-merge') || path.endsWith('/videos/cross-merge/')) {
        return handleCrossVideoMerge(event);
      }
    } else if (method === 'GET' && path.includes('/videos/merge/')) {
      const jobId = path.split('/').pop();
      return {
        statusCode: STATUS_CODES.OK,
        headers: corsHeaders,
        body: JSON.stringify({ message: `Get merge status for job ${jobId}` })
      };
    }

    return {
      statusCode: STATUS_CODES.NOT_FOUND,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Invalid endpoint' })
    };

  } catch (error) {
    console.error('Error:', error);
    return {
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      headers: corsHeaders,
      body: JSON.stringify({
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error'
      })
    };
  }
};
