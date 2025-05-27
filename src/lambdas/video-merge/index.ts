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

/**
 * Sanitize a name for use in file paths and S3 keys
 * Removes special characters, replaces spaces with underscores, and enforces length limits
 */
function sanitizeFileName(name: string): string {
  if (!name) return '';
  
  // Replace any characters that aren't alphanumeric, underscore, dash, or space
  // with underscores, then replace multiple spaces with a single underscore
  let sanitized = name
    .replace(/[^\w\s-]/g, '_')
    .replace(/\s+/g, '_');
    
  // Ensure the name doesn't exceed 100 characters, which is a reasonable limit for most file systems
  if (sanitized.length > 100) {
    sanitized = sanitized.substring(0, 100);
  }
  
  return sanitized;
}

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
    customName?: string;
    mergedVideoS3Path?: string;
    mergedThumbnailS3Path?: string;
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
  userId?: string;           // User ID for tracking merge jobs
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
  userId?: string;           // User ID for tracking merge jobs
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
    const originalMergedName = mergedName || `merged_${jobId}`;
    const mergedSegmentName = sanitizeFileName(originalMergedName);
    const mergedFilename = `${mergedSegmentName}.mp4`;
    
    console.log(`Using merged name: ${originalMergedName} (sanitized: ${mergedSegmentName})`);
    
    // Get the first segment to extract timestamp and path components
    const firstSegment = sortedSegments[0];
    
    if (!firstSegment.segment_video_s3_path) {
      throw new Error('First segment has no valid S3 path');
    }
    
    // Extract timestamp from original video path (format: RawVideos/2025-03-02/indexId/videoId/...)
    const pathParts = firstSegment.segment_video_s3_path.split('/');
    const timestamp = pathParts[1];
    
    // Extract indexId and videoId from the first segment for consistent S3 path structure
    // For cross-video merges, we'll use the first segment's indexId and videoId as the "parent"
    const parentIndexId = firstSegment.indexId;
    const parentVideoId = firstSegment.videoId;
    
    // Define S3 paths for merged video and its thumbnail using the same structure as video-upload/index.ts
    const mergedVideoS3Path = `ProcessedVideos/${timestamp}/${parentIndexId}/${parentVideoId}/merged/${mergedFilename}`;
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
    
    // Determine if we need to use complex filtering for transitions or resolution
    // Complex filtering is needed when:
    // 1. Default transition is not 'cut' (requires xfade filter)
    // 2. Resolution is not '720p' (requires scaling)
    // 3. Any segment has a non-cut transition type
    const needsComplexFiltering =
      mergeOptions.defaultTransition !== 'cut' ||
      mergeOptions.resolution !== '720p' ||
      sortedSegments.some(s => s.transitionType && s.transitionType !== 'cut');
    
    let ffmpegArgs: string[] = [];
    
    if (needsComplexFiltering) {
      console.log('Using complex filtering for transitions and/or resolution');
      
      // For transitions and resolution changes, we need to decode and re-encode
      const inputs: string[] = [];
      const filterComplex: string[] = [];
      
      // Add each input file
      for (let i = 0; i < downloadedSegments.length; i++) {
        inputs.push('-i', downloadedSegments[i]);
      }
      
      // Create filter complex string for transitions
      let lastOutput = '0:v';
      
      for (let i = 0; i < sortedSegments.length - 1; i++) {
        const segment = sortedSegments[i];
        const nextSegment = sortedSegments[i + 1];
        
        // Get transition type and duration for this segment
        const transitionType = segment.transitionType || mergeOptions.defaultTransition;
        const transitionDuration = segment.transitionDuration || mergeOptions.defaultTransitionDuration;
        
        // Skip complex filtering for 'cut' transitions
        if (transitionType === 'cut') {
          if (i === 0) {
            // For the first segment with cut transition, just use it directly
            // No filter needed yet, we'll use this as the base for concatenation
            continue;
          }
          
          // For subsequent segments with cut transition, concatenate with the previous output
          filterComplex.push(`[${lastOutput}][${i+1}:v]concat=n=2:v=1:a=0[v${i+1}]`);
          lastOutput = `v${i+1}`;
        } else {
          // For fade/dissolve transitions, use xfade filter
          const xfadeType = transitionType === 'fade' ? 'fade' : 'dissolve';
          const durationSec = transitionDuration / 1000; // Convert ms to seconds
          
          if (i === 0) {
            // For the first segment, we need to set up the initial input
            // The offset determines when the transition starts:
            // segment.duration/1000 - durationSec means the transition starts at the end of the first clip
            filterComplex.push(`[0:v][1:v]xfade=transition=${xfadeType}:duration=${durationSec}:offset=${segment.duration/1000 - durationSec}[v1]`);
            lastOutput = 'v1';
          } else {
            // For subsequent segments, use the previous output as the first input
            // and the next segment as the second input
            filterComplex.push(`[${lastOutput}][${i+1}:v]xfade=transition=${xfadeType}:duration=${durationSec}:offset=${durationSec}[v${i+1}]`);
            lastOutput = `v${i+1}`;
          }
        }
      }
      
      // Add scaling filter for resolution at the end of the video processing chain
      // This ensures the final output is at the requested resolution
      const resolution = mergeOptions.resolution === '720p' ? '1280:720' : '1920:1080';
      filterComplex.push(`[${lastOutput}]scale=${resolution}[vout]`);
      
      // Combine all audio streams into a single output stream
      // This creates a simple concatenation of all audio tracks
      const audioFilters: string[] = [];
      for (let i = 0; i < downloadedSegments.length; i++) {
        audioFilters.push(`[${i}:a]`);
      }
      filterComplex.push(`${audioFilters.join('')}concat=n=${downloadedSegments.length}:v=0:a=1[aout]`);
      
      // Build the complete FFmpeg command with filter complex
      // -filter_complex: Defines the complex filtering operations
      // -map: Maps the output streams to the final file
      // -c:v libx264: Use H.264 codec for video
      // -preset medium: Balance between encoding speed and compression efficiency
      // -c:a aac: Use AAC codec for audio
      ffmpegArgs = [
        ...inputs,
        '-filter_complex', filterComplex.join(';'),
        '-map', '[vout]',
        '-map', '[aout]',
        '-c:v', 'libx264',
        '-preset', 'medium',
        '-c:a', 'aac',
        mergedVideoPath
      ];
    } else {
      // Use simple concatenation for 'cut' transitions (current implementation)
      ffmpegArgs = [
        '-f', 'concat',            // Use concat demuxer
        '-safe', '0',              // Don't validate filenames
        '-i', concatFilePath,      // Input file listing segments
        '-c:v', 'copy',            // Copy video codec without re-encoding
        '-c:a', 'copy',            // Copy audio codec without re-encoding
        mergedVideoPath            // Output file
      ];
    }
    
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
      mergedThumbnailS3Path,
      customName: originalMergedName
    };
    
    // Calculate merged segment metadata
    const mergedSegmentId = `merged_${jobId}`;
    const startTime = sortedSegments[0].start_time;
    const endTime = sortedSegments[sortedSegments.length - 1].end_time;
    // const segmentDuration = endTime - startTime;
    // We use the duration from the ffprobe command instead of the endTime - startTime since the order of segments might be not in strict time order in scnarios that: (1) the segments are from different videos, (2) the segments are not in strict time order due to the drag and drop of segments by the user
    const segmentDuration = duration;
    
    // Create merged segment object
    const mergedSegment: VideoSegment = {
      segment_id: mergedSegmentId,
      video_id: parentVideoId,
      start_time: startTime,
      end_time: endTime,
      duration: segmentDuration,
      segment_video_s3_path: mergedVideoS3Path,
      segment_video_preview_url: mergedVideoUrl,
      segment_video_thumbnail_s3_path: mergedThumbnailS3Path,
      segment_video_thumbnail_url: mergedThumbnailUrl,
      segment_name: originalMergedName,
      segment_file_name: mergedSegmentName,
      segment_visual: {
        segment_visual_description: `Merged clip: ${originalMergedName} (${segments.length} segments)`
      }
    };
    
    // Update OpenSearch document with the merged segment
    try {
      // Get the OpenSearch document ID for the video
      const { body: searchResult } = await withRetry(
        async () => openSearch.search({
          index: parentIndexId,
          body: {
            query: {
              term: {
                video_id: parentVideoId
              }
            }
          }
        }),
        3,
        `Search for video ${parentVideoId} in index ${parentIndexId}`
      );
      
      if (!searchResult.hits || !searchResult.hits.hits || searchResult.hits.hits.length === 0) {
        throw new Error(`Video ${parentVideoId} not found in index ${parentIndexId}`);
      }
      
      // Extract document ID
      const documentId = searchResult.hits.hits[0]._id;
      
      // Update OpenSearch document
      await openSearch.update({
        index: parentIndexId,
        id: documentId,
        body: {
          script: {
            source: `
              // Initialize arrays if null
              if (ctx._source.video_segments == null) {
                ctx._source.video_segments = [];
              }
              if (ctx._source.merged_segments == null) {
                ctx._source.merged_segments = [];
              }
              
              // Add merged segment to both arrays
              // Keep in video_segments for backward compatibility
              ctx._source.video_segments.add(params.mergedSegment);
              
              // Add to dedicated merged_segments array
              ctx._source.merged_segments.add(params.mergedSegment);
              
              ctx._source.updated_at = params.updated_at;
            `,
            params: {
              mergedSegment: mergedSegment,
              updated_at: new Date().toISOString()
            }
          }
        }
      });
      
      console.log(`Successfully added merged segment to OpenSearch document for video ${parentVideoId}`);
    } catch (error) {
      console.error('Error updating OpenSearch document:', error);
      
      // Clean up S3 objects if OpenSearch update fails
      try {
        console.log(`Cleaning up S3 objects after OpenSearch update failure: ${mergedVideoS3Path} and ${mergedThumbnailS3Path}`);
        
        // Delete merged video from S3
        await s3.send(new DeleteObjectCommand({
          Bucket: bucketName,
          Key: mergedVideoS3Path
        }));
        
        // Delete thumbnail from S3
        await s3.send(new DeleteObjectCommand({
          Bucket: bucketName,
          Key: mergedThumbnailS3Path
        }));
        
        console.log('Successfully cleaned up S3 objects after OpenSearch update failure');
      } catch (cleanupError) {
        console.error('Error cleaning up S3 objects after OpenSearch update failure:', cleanupError);
      }
      
      // Re-throw the error to mark the job as failed
      throw new Error(`Failed to update OpenSearch document: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
    
    // Update job status to completed
    await updateMergeJobCompleted(jobId, userId, {
      ...result,
      mergedSegment
    });
    
    // Clean up temporary files
    try {
      await fs.promises.rm(`${tempDir}/merge_${jobId}`, { recursive: true, force: true });
    } catch (cleanupError) {
      console.warn('Error cleaning up temporary files:', cleanupError);
    }
    
    return {
      ...result,
      mergedSegment
    };
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

// The separate handleCrossVideoMerge and handleMergeSegments functions have been removed
// and replaced with the unified handleMergeRequest function below

/**
 * Create a merge job record in DynamoDB
 */
async function createMergeJob(jobId: string, userId: string, mergeParams: any): Promise<void> {
  const now = new Date().toISOString();
  
  // Calculate TTL (30 days from now)
  const ttl = Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60);
  console.log('Creating merge job record in DynamoDB for jobId:', jobId, 'userId:', userId, 'mergeParams:', mergeParams);
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
    UpdateExpression: 'SET #status = :status, progress = :progress, #result = :result, completedAt = :completedAt',
    ExpressionAttributeNames: {
      '#status': 'status',
      '#result': 'result'
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
    // Direct query with primary key (no change)
    const result = await docClient.send(new GetCommand({
      TableName: process.env.MERGE_JOBS_TABLE,
      Key: { jobId, userId }
    }));
    return result.Item as MergeJob || null;
  } else if (allowMissingUserId) {
    // Use StatusIndex instead of non-existent jobId-index
    // Query for all jobs with status 'queued' or 'processing' (most likely for recent jobs)
    const result = await docClient.send(new QueryCommand({
      TableName: process.env.MERGE_JOBS_TABLE,
      IndexName: 'StatusIndex',
      KeyConditionExpression: 'status = :status',
      ExpressionAttributeValues: {
        ':status': 'queued'
      }
    }));
    
    // If no queued jobs found, try processing jobs
    if (!result.Items || result.Items.length === 0) {
      const processingResult = await docClient.send(new QueryCommand({
        TableName: process.env.MERGE_JOBS_TABLE,
        IndexName: 'StatusIndex',
        KeyConditionExpression: 'status = :status',
        ExpressionAttributeValues: {
          ':status': 'processing'
        }
      }));
      
      // Filter results client-side to find the job with matching jobId
      const job = processingResult.Items?.find(item => item.jobId === jobId);
      return job as MergeJob || null;
    }
    
    // Filter results client-side to find the job with matching jobId
    const job = result.Items?.find(item => item.jobId === jobId);
    return job as MergeJob || null;
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
    // Get userId from query parameter if provided, otherwise from auth context
    const queryParams = event.queryStringParameters || {};
    const userId = queryParams.userId || event.requestContext.identity?.cognitoIdentityId || 'anonymous';
    
    console.log(`Getting status for job ${jobId} with userId ${userId}`);
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
    console.log('Received merge request:', request);
    // Determine if this is a cross-video merge or same-video merge
    const isCrossVideoMerge = request.items && Array.isArray(request.items);
    
    // Create job ID
    const jobId = uuidv4();
    
    // Get user ID from request context
    const userId = request.userId || 'anonymous';
    
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
        mergedName: mergedName ? mergedName.trim() : undefined, // Sanitize by trimming whitespace
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
        mergedName: mergedName ? mergedName.trim() : undefined, // Sanitize by trimming whitespace
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
        userId,  // Include userId in response for frontend polling
        status: 'queued',
        customName: mergeParams.mergedName // Include the custom name in the response
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
          
          // Extract jobId from the message
          const jobId = body.jobId;
          
          // Try to extract userId directly from the message parameters
          const userId = body.mergeParams?.userId;
          
          if (userId) {
            // If userId is in the message, use it directly
            console.log(`Using userId ${userId} from message parameters`);
            await _performVideoMerge(body.mergeParams, userId);
          } else {
            // Fall back to querying DynamoDB if userId is not in the message
            console.log(`No userId found in message parameters, querying DynamoDB for job ${jobId}`);
            const job = await getMergeJobStatus(jobId, undefined, true); // true = allow missing userId
            if (!job || !job.userId) {
              throw new Error('userId not found for job');
            }
            await _performVideoMerge(body.mergeParams, job.userId);
          }
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
