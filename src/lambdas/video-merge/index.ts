import { APIGatewayProxyEvent, SQSEvent, SQSRecord } from 'aws-lambda';
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
import { SQSClient, SendMessageCommand, DeleteMessageCommand } from '@aws-sdk/client-sqs';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, GetCommand, UpdateCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';

// Initialize clients
const s3 = new S3Client({});
const sqs = new SQSClient({});
const dynamoClient = new DynamoDBClient({endpoint: process.env.INDEXES_TABLE_DYNAMODB_DNS_NAME});
const docClient = DynamoDBDocumentClient.from(dynamoClient);
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

// Define interface for merge job
interface MergeJob {
  jobId: string;
  userId: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  progress: number;
  createdAt: string;
  completedAt?: string;
  mergeParams: any;
  result?: {
    mergedVideoUrl?: string;
    thumbnailUrl?: string;
    duration?: number;
  };
  errorMessage?: string; // Changed from error to errorMessage
  ttl?: number; // Time-to-live for automatic cleanup
}

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
 * Private function to perform video merging (common logic for both same-video and cross-video merges)
 */
async function _performVideoMerge(params: {
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
  jobId: string;
}, userId: string): Promise<any> {

  const { items, mergedName, mergeOptions, jobId } = params;
  try {
    // Update job status to processing
    await updateMergeJobStatus(jobId, userId, 'processing', 10);
    
    console.log(`Processing merge job ${jobId} with ${items.length} segments`);
    
    // Collect all segments from different videos
    const segments = [];
    for (const item of items) {
      const segment = await getSegmentDetail(item.indexId, item.videoId, item.segmentId);
      if (segment) {
        segments.push({
          ...segment,
          indexId: item.indexId,
          videoId: item.videoId,
          transitionType: item.transitionType || mergeOptions.defaultTransition,
          transitionDuration: item.transitionDuration || mergeOptions.defaultTransitionDuration
        });
      } else {
        throw new Error(`Segment ${item.segmentId} not found in video ${item.videoId} in index ${item.indexId}`);
      }
    }
    
    if (segments.length === 0) {
      throw new Error('No valid segments found for merging');
    }
    
    await updateMergeJobStatus(jobId, userId, 'processing', 30);
    
    // Sort segments by their order if specified, otherwise keep the original order
    const sortedSegments = [...segments];
    
    // Create a merged segment name if not provided
    const mergedSegmentName = mergedName || `merged_${jobId}`;
    const mergedFilename = `${mergedSegmentName}.mp4`;
    
    // Get the first segment to extract timestamp and path components
    const firstSegment = sortedSegments[0];
    
    if (!firstSegment.segment_video_s3_path) {
      throw new Error('First segment has no valid S3 path');
    }
    
    // Extract timestamp from original video path (format: RawVideos/2025-03-02/indexId/videoId/...)
    const pathParts = firstSegment.segment_video_s3_path.split('/');
    const timestamp = pathParts[1];
    
    // Define S3 paths for merged video and its thumbnail
    const mergedVideoS3Path = `ProcessedVideos/${timestamp}/merged/${jobId}/${mergedFilename}`;
    const mergedThumbnailS3Path = mergedVideoS3Path.replace(/\.mp4$/i, '.jpg');
    
    // Create temporary directory for processing
    const tempDir = '/tmp';
    await fs.promises.mkdir(`${tempDir}/merge_${jobId}`, { recursive: true });
    
    // Download all segments to local storage
    const downloadedSegments = [];
    for (let i = 0; i < sortedSegments.length; i++) {
      const segment = sortedSegments[i];
      const segmentS3Path = segment.segment_video_s3_path;
      
      if (!segmentS3Path) {
        console.warn(`Segment ${segment.segment_id} has no S3 path, skipping`);
        continue;
      }
      
      // Create local path for the segment
      const localPath = `${tempDir}/merge_${jobId}/segment_${i}.mp4`;
      downloadedSegments.push(localPath);
      
      // Download segment from S3
      const getCommand = new GetObjectCommand({
        Bucket: process.env.VIDEO_BUCKET!,
        Key: segmentS3Path
      });
      
      const response = await s3.send(getCommand);
      
      if (response.Body) {
        // Convert the response body to a buffer and write to file
        const data = await streamToBuffer(response.Body as Readable);
        await fs.promises.writeFile(localPath, data);
      } else {
        throw new Error(`Failed to download segment from S3: ${segmentS3Path}`);
      }
    }
    
    await updateMergeJobStatus(jobId, userId, 'processing', 50);
    
    // Create FFmpeg concat file
    const concatFilePath = `${tempDir}/merge_${jobId}/concat_list.txt`;
    let content = '';
    
    // Create file content in FFmpeg concat format
    for (const path of downloadedSegments) {
      content += `file '${path}'\n`;
    }
    
    // Write content to file
    await fs.promises.writeFile(concatFilePath, content);
    
    // Merge video segments using FFmpeg
    const mergedVideoPath = `${tempDir}/merge_${jobId}/merged_output.mp4`;
    
    // FFmpeg command to concatenate videos
    const ffmpegArgs = [
      '-f', 'concat',            // Use concat demuxer
      '-safe', '0',              // Don't validate filenames
      '-i', concatFilePath,      // Input file listing segments
      '-c:v', 'copy',            // Copy video codec without re-encoding
      '-c:a', 'copy',            // Copy audio codec without re-encoding
      mergedVideoPath            // Output file
    ];
    
    console.log(`Running FFmpeg command: ffmpeg ${ffmpegArgs.join(' ')}`);
    
    // Execute FFmpeg command
    const ffmpegProcess = spawn('ffmpeg', ffmpegArgs);
    
    // Wait for the process to complete
    await new Promise<void>((resolve, reject) => {
      ffmpegProcess.on('close', (code) => {
        if (code === 0) {
          console.log('Successfully merged video segments');
          resolve();
        } else {
          reject(new Error(`FFmpeg process exited with code ${code}`));
        }
      });
      
      ffmpegProcess.stderr.on('data', (data) => {
        console.log(`FFmpeg stderr: ${data}`);
      });
    });
    
    await updateMergeJobStatus(jobId, userId, 'processing', 70);
    
    // Generate thumbnail from video
    const thumbnailPath = `${tempDir}/merge_${jobId}/thumbnail.jpg`;
    
    // FFmpeg command to extract a thumbnail
    const thumbnailArgs = [
      '-i', mergedVideoPath,     // Input file
      '-ss', '00:00:01',         // Position at 1 second
      '-vframes', '1',           // Extract 1 frame
      '-q:v', '2',               // High quality
      thumbnailPath              // Output file
    ];
    
    // Execute FFmpeg command
    const thumbnailProcess = spawn('ffmpeg', thumbnailArgs);
    
    // Wait for the process to complete
    await new Promise<void>((resolve, reject) => {
      thumbnailProcess.on('close', (code) => {
        if (code === 0) {
          console.log('Successfully extracted thumbnail');
          resolve();
        } else {
          reject(new Error(`FFmpeg process exited with code ${code}`));
        }
      });
      
      thumbnailProcess.stderr.on('data', (data) => {
        console.log(`FFmpeg stderr: ${data}`);
      });
    });
    
    await updateMergeJobStatus(jobId, userId, 'processing', 80);
    
    // Upload merged video and thumbnail to S3
    const bucketName = process.env.VIDEO_BUCKET!;
    
    // Upload merged video
    await s3.send(new PutObjectCommand({
      Bucket: bucketName,
      Key: mergedVideoS3Path,
      Body: fs.readFileSync(mergedVideoPath),
      ContentType: 'video/mp4'
    }));
    
    // Upload thumbnail
    await s3.send(new PutObjectCommand({
      Bucket: bucketName,
      Key: mergedThumbnailS3Path,
      Body: fs.readFileSync(thumbnailPath),
      ContentType: 'image/jpeg'
    }));
    
    await updateMergeJobStatus(jobId, userId, 'processing', 90);
    
    // Generate signed URLs
    const videoCommand = new GetObjectCommand({
      Bucket: bucketName,
      Key: mergedVideoS3Path
    });
    
    const thumbnailCommand = new GetObjectCommand({
      Bucket: bucketName,
      Key: mergedThumbnailS3Path
    });
    
    const [mergedVideoUrl, mergedThumbnailUrl] = await Promise.all([
      getSignedUrl(s3 as any, videoCommand as any, { expiresIn: 3600 }),
      getSignedUrl(s3 as any, thumbnailCommand as any, { expiresIn: 3600 })
    ]);
    
    // Get video duration
    const duration = await getVideoDuration(mergedVideoPath);
    
    // Create result object
    const result = {
      mergedVideoUrl,
      thumbnailUrl: mergedThumbnailUrl,
      duration,
      mergedVideoS3Path,
      mergedThumbnailS3Path
    };
    
    // Update job status to completed
    await updateMergeJobCompleted(jobId, userId, result);
    
    // Clean up temporary files
    try {
      await fs.promises.rm(`${tempDir}/merge_${jobId}`, { recursive: true, force: true });
    } catch (cleanupError) {
      console.warn('Error cleaning up temporary files:', cleanupError);
    }
    
    return result;
  } catch (error) {
    // Update job status to failed
    await updateMergeJobFailed(jobId, userId, error instanceof Error ? error.message : 'Unknown error');
    throw error;
  }
}

/**
 * Get video duration using FFmpeg
 */
async function getVideoDuration(videoPath: string): Promise<number> {
  try {
    // Use ffprobe to get video duration
    const ffprobeCommand = [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      videoPath
    ];
    
    const ffprobeProcess = spawn('ffprobe', ffprobeCommand);
    let ffprobeOutput = '';
    
    ffprobeProcess.stdout.on('data', (data) => {
      ffprobeOutput += data.toString();
    });
    
    // Wait for the process to complete
    await new Promise<void>((resolve, reject) => {
      ffprobeProcess.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`ffprobe process exited with code ${code}`));
        }
      });
      
      ffprobeProcess.stderr.on('data', (data) => {
        console.log(`ffprobe stderr: ${data}`);
      });
    });
    
    // Parse the duration (in seconds) and convert to milliseconds
    return parseFloat(ffprobeOutput.trim()) * 1000;
  } catch (error) {
    console.error('Error getting video duration:', error);
    return 0;
  }
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

    // Create job ID
    const jobId = uuidv4();
    
    // Get user ID from event (in a real implementation, this would come from auth)
    const userId = event.requestContext.identity?.cognitoIdentityId || 'anonymous';
    
    // Create merge parameters for unified function
    const mergeParams = {
      items,
      mergedName,
      mergeOptions,
      jobId,
      userId
    };
    
    // Create job record in DynamoDB
    await createMergeJob(jobId, userId, mergeParams);
    
    // Queue the job
    await queueMergeJob(jobId, mergeParams);
    
    return {
      statusCode: STATUS_CODES.OK,
      headers: corsHeaders,
      body: JSON.stringify({
        message: 'Cross-video merge job created and queued',
        jobId,
        status: 'queued'
      })
    };
  } catch (error) {
    console.error('Error creating cross-video merge job:', error);
    return {
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      headers: corsHeaders,
      body: JSON.stringify({
        error: 'Failed to create cross-video merge job',
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

    // Create job ID
    const jobId = uuidv4();
    
    // Get user ID from event (in a real implementation, this would come from auth)
    const userId = event.requestContext.identity?.cognitoIdentityId || 'anonymous';
    
    // Create merge parameters for unified function
    const mergeParams = {
      items: segmentIds.map(segmentId => ({
        indexId,
        videoId,
        segmentId,
        // Default transition settings
        transitionType: (mergeOptions?.transition || 'cut') as 'cut' | 'fade' | 'dissolve',
        transitionDuration: mergeOptions?.transitionDuration || 500
      })),
      mergedName,
      mergeOptions: {
        resolution: (mergeOptions?.resolution || '720p') as '720p' | '1080p',
        defaultTransition: (mergeOptions?.transition || 'cut') as 'cut' | 'fade' | 'dissolve',
        defaultTransitionDuration: mergeOptions?.transitionDuration || 500
      },
      jobId,
      userId
    };
    
    // Create job record in DynamoDB
    await createMergeJob(jobId, userId, mergeParams);
    
    // Queue the job
    await queueMergeJob(jobId, mergeParams);
    
    return {
      statusCode: STATUS_CODES.OK,
      headers: corsHeaders,
      body: JSON.stringify({
        message: 'Merge job created and queued',
        jobId,
        status: 'queued'
      })
    };
  } catch (error) {
    console.error('Error creating merge job:', error);
    return {
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      headers: corsHeaders,
      body: JSON.stringify({
        error: 'Failed to create merge job',
        details: error instanceof Error ? error.message : 'Unknown error'
      })
    };
  }
}

/**
 * Create a merge job record in DynamoDB
 */
async function createMergeJob(jobId: string, userId: string, mergeParams: any): Promise<void> {
  const now = new Date().toISOString();
  
  // Calculate TTL (30 days from now)
  const ttl = Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60);
  
  const job: MergeJob = {
    jobId,
    userId,
    status: 'queued',
    progress: 0,
    createdAt: now,
    mergeParams,
    ttl
  };
  
  await docClient.send(new PutCommand({
    TableName: process.env.MERGE_JOBS_TABLE,
    Item: job
  }));
}

/**
 * Queue a merge job in SQS
 */
async function queueMergeJob(jobId: string, mergeParams: any): Promise<void> {
  await sqs.send(new SendMessageCommand({
    QueueUrl: process.env.VIDEO_MERGE_QUEUE_URL,
    MessageBody: JSON.stringify({
      jobId,
      mergeParams
    }),
    MessageGroupId: jobId, // Required for FIFO queues
    MessageDeduplicationId: jobId // Using jobId as deduplication ID
  }));
}

/**
 * Update merge job status
 */
async function updateMergeJobStatus(jobId: string, userId: string, status: 'processing', progress: number): Promise<void> {
  await docClient.send(new UpdateCommand({
    TableName: process.env.MERGE_JOBS_TABLE,
    Key: { jobId, userId },
    UpdateExpression: 'SET #status = :status, progress = :progress',
    ExpressionAttributeNames: {
      '#status': 'status'
    },
    ExpressionAttributeValues: {
      ':status': status,
      ':progress': progress
    }
  }));
}

/**
 * Update merge job to completed
 */
async function updateMergeJobCompleted(jobId: string, userId: string, result: any): Promise<void> {
  const now = new Date().toISOString();
  
  await docClient.send(new UpdateCommand({
    TableName: process.env.MERGE_JOBS_TABLE,
    Key: { jobId, userId },
    UpdateExpression: 'SET #status = :status, progress = :progress, result = :result, completedAt = :completedAt',
    ExpressionAttributeNames: {
      '#status': 'status'
    },
    ExpressionAttributeValues: {
      ':status': 'completed',
      ':progress': 100,
      ':result': result,
      ':completedAt': now
    }
  }));
}

/**
 * Update merge job to failed
 */
async function updateMergeJobFailed(jobId: string, userId: string, errorMessage: string): Promise<void> {
  const now = new Date().toISOString();
  
  await docClient.send(new UpdateCommand({
    TableName: process.env.MERGE_JOBS_TABLE,
    Key: { jobId, userId },
    UpdateExpression: 'SET #status = :status, errorMessage = :errorMessage, completedAt = :completedAt',
    ExpressionAttributeNames: {
      '#status': 'status'
    },
    ExpressionAttributeValues: {
      ':status': 'failed',
      ':errorMessage': errorMessage,
      ':completedAt': now
    }
  }));
}

/**
 * Get merge job status
 */
async function getMergeJobStatus(jobId: string, userId?: string, allowMissingUserId?: boolean): Promise<MergeJob | null> {
  if (userId) {
    const result = await docClient.send(new GetCommand({
      TableName: process.env.MERGE_JOBS_TABLE,
      Key: { jobId, userId }
    }));
    return result.Item as MergeJob || null;
  } else if (allowMissingUserId) {
    // Scan for the jobId (inefficient, but needed for SQS handler)
    const result = await docClient.send(new QueryCommand({
      TableName: process.env.MERGE_JOBS_TABLE,
      IndexName: 'jobId-index',
      KeyConditionExpression: 'jobId = :jobId',
      ExpressionAttributeValues: { ':jobId': jobId }
    }));
    return (result.Items && result.Items[0]) as MergeJob || null;
  } else {
    throw new Error('userId is required');
  }
}

/**
 * List merge jobs for a user
 */
async function listMergeJobs(userId: string): Promise<MergeJob[]> {
  const result = await docClient.send(new QueryCommand({
    TableName: process.env.MERGE_JOBS_TABLE,
    IndexName: 'UserIdIndex',
    KeyConditionExpression: 'userId = :userId',
    ExpressionAttributeValues: {
      ':userId': userId
    },
    ScanIndexForward: false // Sort by createdAt in descending order
  }));
  
  return result.Items as MergeJob[] || [];
}

/**
 * Handle getting the status of a merge job
 */
async function handleGetMergeStatus(event: APIGatewayProxyEvent, jobId: string): Promise<LambdaResponse> {
  try {
    const userId = event.requestContext.identity?.cognitoIdentityId || 'anonymous';
    const job = await getMergeJobStatus(jobId, userId);
    
    if (!job) {
      return {
        statusCode: STATUS_CODES.NOT_FOUND,
        headers: corsHeaders,
        body: JSON.stringify({ error: `Job ${jobId} not found` })
      };
    }
    
    return {
      statusCode: STATUS_CODES.OK,
      headers: corsHeaders,
      body: JSON.stringify(job)
    };
  } catch (error) {
    console.error(`Error getting job status for ${jobId}:`, error);
    return {
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      headers: corsHeaders,
      body: JSON.stringify({
        error: 'Failed to get job status',
        details: error instanceof Error ? error.message : 'Unknown error'
      })
    };
  }
}

/**
 * Unified handler for all merge requests
 */
async function handleMergeRequest(event: APIGatewayProxyEvent): Promise<LambdaResponse> {
  try {
    const request = JSON.parse(event.body!);
    
    // Determine if this is a cross-video merge or same-video merge
    const isCrossVideoMerge = request.items && Array.isArray(request.items);
    
    // Create job ID
    const jobId = uuidv4();
    
    // Get user ID from event
    const userId = event.requestContext.identity?.cognitoIdentityId || 'anonymous';
    
    let mergeParams: any;
    
    if (isCrossVideoMerge) {
      // Handle as cross-video merge
      const { items, mergedName, mergeOptions } = request as CrossVideoMergeRequest;
      
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
      
      // Create merge parameters
      mergeParams = {
        items,
        mergedName,
        mergeOptions,
        jobId,
        userId
      };
    } else {
      // Handle as same-video merge
      const { indexId, videoId, segmentIds, mergedName, mergeOptions } = request as MergeSegmentsRequest;
      
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
      
      // Create merge parameters
      mergeParams = {
        items: segmentIds.map(segmentId => ({
          indexId,
          videoId,
          segmentId,
          // Default transition settings
          transitionType: (mergeOptions?.transition || 'cut') as 'cut' | 'fade' | 'dissolve',
          transitionDuration: mergeOptions?.transitionDuration || 500
        })),
        mergedName,
        mergeOptions: {
          resolution: (mergeOptions?.resolution || '720p') as '720p' | '1080p',
          defaultTransition: (mergeOptions?.transition || 'cut') as 'cut' | 'fade' | 'dissolve',
          defaultTransitionDuration: mergeOptions?.transitionDuration || 500
        },
        jobId: jobId,
        userId
      };
    }
    
    // Create job record in DynamoDB
    await createMergeJob(jobId, userId, mergeParams);
    
    // Queue the job
    await queueMergeJob(jobId, mergeParams);
    
    return {
      statusCode: STATUS_CODES.OK,
      headers: corsHeaders,
      body: JSON.stringify({
        message: 'Merge job created and queued',
        jobId,
        status: 'queued'
      })
    };
  } catch (error) {
    console.error('Error creating merge job:', error);
    return {
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      headers: corsHeaders,
      body: JSON.stringify({
        error: 'Failed to create merge job',
        details: error instanceof Error ? error.message : 'Unknown error'
      })
    };
  }
}

/**
 * Lambda handler for video merge operations
 */
export const handler = async (event: APIGatewayProxyEvent | SQSEvent): Promise<LambdaResponse | void> => {
  try {
    // Check if this is an SQS event
    if ('Records' in event && Array.isArray(event.Records)) {
      // Process SQS messages
      for (const record of event.Records) {
        const body = JSON.parse(record.body);
        try {
          console.log(`Processing merge job from SQS: ${JSON.stringify(body)}`);
          // userId is not in mergeParams, so fetch it from DynamoDB first
          const jobId = body.mergeParams.jobId;
          // Get the job to extract userId
          const job = await getMergeJobStatus(jobId, undefined, true); // true = allow missing userId
          if (!job || !job.userId) {
            throw new Error('userId not found for job');
          }
          await _performVideoMerge(body.mergeParams, job.userId);
        } catch (error) {
          console.error('Error processing merge job:', error);
          // Don't throw here to prevent the message from being reprocessed
          // The job status will be updated to failed in _performVideoMerge
        }
      }
      return; // No response needed for SQS events
    }

    // Handle API Gateway events
    const apiEvent = event as APIGatewayProxyEvent;
    
    // For GET & DELETE requests, we don't need to check for body
    if (apiEvent.httpMethod !== 'GET' && apiEvent.httpMethod !== 'DELETE' && !apiEvent.body) {
      return {
        statusCode: STATUS_CODES.BAD_REQUEST,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Missing request body' })
      };
    }

    // Handle different endpoints based on the path and method
    const path = apiEvent.path.toLowerCase();
    const method = apiEvent.httpMethod;

    // API Path:
    // POST /videos/merge - Merge segments from the same video
    // POST /videos/cross-merge - Merge segments from different videos
    // GET /videos/merge/{jobId} - Get merge job status
    // GET /videos/merge - List user's merge jobs

    if (method === 'POST') {
      if (path.endsWith('/videos/merge') || path.endsWith('/videos/merge/') ||
          path.endsWith('/videos/cross-merge') || path.endsWith('/videos/cross-merge/')) {
        return handleMergeRequest(apiEvent);
      }
    } else if (method === 'GET') {
      if (path.includes('/videos/merge/') && !path.endsWith('/videos/merge/')) {
        // Get specific job status
        const jobId = path.split('/').pop();
        if (!jobId) {
          return {
            statusCode: STATUS_CODES.BAD_REQUEST,
            headers: corsHeaders,
            body: JSON.stringify({ error: 'Missing job ID' })
          };
        }
        return handleGetMergeStatus(apiEvent, jobId);
      } else if (path.endsWith('/videos/merge') || path.endsWith('/videos/merge/')) {
        // List user's jobs
        const userId = apiEvent.requestContext.identity?.cognitoIdentityId || 'anonymous';
        const jobs = await listMergeJobs(userId);
        return {
          statusCode: STATUS_CODES.OK,
          headers: corsHeaders,
          body: JSON.stringify({ jobs })
        };
      }
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
