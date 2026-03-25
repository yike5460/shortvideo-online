import { LambdaContext, LambdaResponse } from '../../types/aws-lambda';
import { VideoMetadata, VideoStatus, VideoSegment, VideoProcessingJob } from '../../types/common';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { Client } from '@opensearch-project/opensearch';
import { defaultProvider } from '@aws-sdk/credential-provider-node';
import { AwsSigv4Signer } from '@opensearch-project/opensearch/aws';
import { S3Event, SQSEvent } from 'aws-lambda';
import { spawn } from 'child_process';
// fs module for file system operations like reading/writing video files
import * as fs from 'fs';
// path module for handling file paths and directories
import * as path from 'path';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { DynamoDBDocumentClient, PutCommand, UpdateCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';

const sqs = new SQSClient({});
const s3 = new S3Client({});
const bedrockRuntime = new BedrockRuntimeClient({});
const bedrockMarengo = new BedrockRuntimeClient({ region: process.env.TWELVELABS_REGION || 'us-east-1' });
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
const dynamoClient = new DynamoDBClient({endpoint: process.env.INDEXES_TABLE_DYNAMODB_DNS_NAME});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
  'Access-Control-Allow-Credentials': 'true'
};
const STATUS_CODES = {
  OK: 200,
  CREATED: 201,
  BAD_REQUEST: 400,
  NOT_FOUND: 404,
  INTERNAL_SERVER_ERROR: 500
};

const MARENGO_MODEL_ID = process.env.BEDROCK_EMBEDDING_MODEL_ID || 'us.twelvelabs.marengo-embed-3-0-v1:0';
const TWELVELABS_MODEL_ID = process.env.TWELVELABS_MODEL_ID || 'global.twelvelabs.pegasus-1-2-v1:0';

export const handler = async (event: S3Event | SQSEvent, _context: LambdaContext): Promise<LambdaResponse> => {
  try {
    console.log('Received event:', event);
    // Handle S3 event for new video upload
    if ('Records' in event && 'eventSource' in event.Records[0] && event.Records[0].eventSource === 'aws:s3') {
      return handleS3Event(event as S3Event);
    }

    // Handle SQS message for video segment processing
    if ('Records' in event && 'eventSource' in event.Records[0] && event.Records[0].eventSource === 'aws:sqs') {
      return handleSQSEvent(event as unknown as SQSEvent);
    }

    return {
      statusCode: STATUS_CODES.BAD_REQUEST,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Unsupported event type' })
    };
  } catch (error) {
    console.error('Error processing video:', error);
    return {
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }
};

/**
 * Handle S3 event: download video, run FFmpeg scene detection, send segments to SQS
 */
async function handleS3Event(event: S3Event): Promise<LambdaResponse> {
  const record = event.Records[0].s3;
  const bucket = record.bucket.name;
  const key = decodeURIComponent(record.object.key.replace(/\+/g, ' '));

  console.log('Processing video slice for key:', key, 'bucket:', bucket);

  // Skip non-raw video files and non video suffix files
  if (!key.startsWith('RawVideos/') || (!key.endsWith('.mp4') && !key.endsWith('.mov'))) {
    console.log('Skipping non-raw video file: ' + key + '\n');
    return {
      statusCode: STATUS_CODES.OK,
      headers: corsHeaders,
      body: JSON.stringify({ message: 'Skipped non-raw video file' })
    };
  }

  // The s3Key format is `RawVideos/${timestamp}/${videoIndex}/${videoId}/${sanitizedFileNameWithExtension}`
  const videoIndex = key.split('/')[2];
  const videoId = key.split('/')[3];

  if (!videoId) throw new Error('Invalid video key format');

  try {
    // Update status to processing
    await updateVideoStatus(videoIndex, videoId, 'processing', {
      message: 'Starting FFmpeg scene detection'
    });

    // Download video to /tmp for FFmpeg processing
    const tempVideoPath = `/tmp/${videoId}_input.mp4`;

    const downloadCommand = new GetObjectCommand({
      Bucket: bucket,
      Key: key
    });

    const response = await s3.send(downloadCommand);
    if (response.Body) {
      const buf = Buffer.from(await response.Body.transformToByteArray());
      fs.writeFileSync(tempVideoPath, buf);
      console.log(`Downloaded video for scene detection, size: ${buf.length} bytes`);
    } else {
      throw new Error('Empty response body from S3');
    }

    // Run FFmpeg scene detection to find segment boundaries
    const sceneTimestamps = await detectScenes(tempVideoPath);
    console.log(`Detected ${sceneTimestamps.length} scene changes:`, sceneTimestamps);

    // Get total video duration using ffprobe
    const totalDuration = await getVideoDuration(tempVideoPath);
    console.log(`Total video duration: ${totalDuration}ms`);

    // Build segment list from scene timestamps
    const segments = buildSegmentsFromScenes(sceneTimestamps, totalDuration);
    console.log(`Built ${segments.length} segments from scene detection`);

    // Subdivide long segments (>20s)
    const subdividedSegments = subdivideSegments(segments, 20000);
    console.log(`Original segments: ${segments.length}, After subdivision: ${subdividedSegments.length}`);

    // Clean up temp video file
    try { fs.unlinkSync(tempVideoPath); } catch (err) { console.warn('Failed to clean up temp file:', err); }

    // Store segment detection results in DynamoDB for preview
    await storeSegmentDetectionResults(videoIndex, videoId, subdividedSegments);

    // Send segments to SQS for per-segment processing
    await sendSegmentSlicingRequest(videoIndex, videoId, subdividedSegments);

    return {
      statusCode: STATUS_CODES.OK,
      headers: corsHeaders,
      body: JSON.stringify({
        message: 'Video scene detection completed, segments queued for processing',
        videoId,
        segmentCount: subdividedSegments.length
      })
    };
  } catch (error) {
    console.error('Error in scene detection:', error);

    await updateVideoStatus(videoIndex, videoId, 'error', {
      error: `Scene detection failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    });

    return {
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      headers: corsHeaders,
      body: JSON.stringify({
        error: 'Scene detection failed',
        details: error instanceof Error ? error.message : 'Unknown error'
      })
    };
  }
}

/**
 * Run FFmpeg scene detection on a local video file.
 * Returns an array of timestamps (in milliseconds) where scene changes occur.
 */
async function detectScenes(videoPath: string): Promise<number[]> {
  const ffmpegPath = process.env.LAMBDA_TASK_ROOT ? '/opt/bin/ffmpeg' : 'ffmpeg';

  return new Promise<number[]>((resolve, reject) => {
    const timestamps: number[] = [];

    // Use FFmpeg scene detection filter
    // The 'select' filter with gt(scene,0.3) detects scene changes
    // The 'showinfo' filter outputs frame info including timestamps
    const ffmpegProcess = spawn(ffmpegPath, [
      '-i', videoPath,
      '-filter:v', "select='gt(scene,0.3)',showinfo",
      '-f', 'null',
      '-'
    ]);

    let stderr = '';

    ffmpegProcess.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    ffmpegProcess.on('close', (code) => {
      // FFmpeg outputs to stderr, parse showinfo output for timestamps
      // showinfo lines look like: [Parsed_showinfo_1 @ ...] n:   0 pts:  12345 pts_time:1.234567 ...
      const lines = stderr.split('\n');
      for (const line of lines) {
        const match = line.match(/pts_time:\s*([\d.]+)/);
        if (match) {
          const timestampMs = Math.round(parseFloat(match[1]) * 1000);
          timestamps.push(timestampMs);
        }
      }

      console.log(`FFmpeg scene detection completed (exit code ${code}), found ${timestamps.length} scene changes`);
      resolve(timestamps);
    });

    ffmpegProcess.on('error', (err) => {
      console.error('FFmpeg scene detection error:', err);
      reject(err);
    });
  });
}

/**
 * Get video duration in milliseconds using ffprobe
 */
async function getVideoDuration(videoPath: string): Promise<number> {
  const ffprobePath = process.env.LAMBDA_TASK_ROOT ? '/opt/bin/ffprobe' : 'ffprobe';

  return new Promise<number>((resolve, reject) => {
    const ffprobeProcess = spawn(ffprobePath, [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      videoPath
    ]);

    let output = '';

    ffprobeProcess.stdout.on('data', (data) => {
      output += data.toString();
    });

    ffprobeProcess.on('close', (code) => {
      if (code === 0) {
        const durationMs = Math.round(parseFloat(output.trim()) * 1000);
        resolve(durationMs);
      } else {
        reject(new Error(`ffprobe exited with code ${code}`));
      }
    });

    ffprobeProcess.on('error', reject);
  });
}

/**
 * Build segment definitions from scene change timestamps.
 * Each segment spans from one scene change to the next.
 */
function buildSegmentsFromScenes(sceneTimestamps: number[], totalDurationMs: number): Array<{
  StartTimestampMillis: number;
  EndTimestampMillis: number;
  DurationMillis: number;
}> {
  const segments: Array<{
    StartTimestampMillis: number;
    EndTimestampMillis: number;
    DurationMillis: number;
  }> = [];

  // If no scene changes detected, treat the whole video as one segment
  if (sceneTimestamps.length === 0) {
    segments.push({
      StartTimestampMillis: 0,
      EndTimestampMillis: totalDurationMs,
      DurationMillis: totalDurationMs
    });
    return segments;
  }

  // Sort timestamps
  const sortedTimestamps = [...sceneTimestamps].sort((a, b) => a - b);

  // First segment: 0 to first scene change
  if (sortedTimestamps[0] > 0) {
    segments.push({
      StartTimestampMillis: 0,
      EndTimestampMillis: sortedTimestamps[0],
      DurationMillis: sortedTimestamps[0]
    });
  }

  // Middle segments: between consecutive scene changes
  for (let i = 0; i < sortedTimestamps.length - 1; i++) {
    const start = sortedTimestamps[i];
    const end = sortedTimestamps[i + 1];
    segments.push({
      StartTimestampMillis: start,
      EndTimestampMillis: end,
      DurationMillis: end - start
    });
  }

  // Last segment: last scene change to end of video
  const lastTimestamp = sortedTimestamps[sortedTimestamps.length - 1];
  if (lastTimestamp < totalDurationMs) {
    segments.push({
      StartTimestampMillis: lastTimestamp,
      EndTimestampMillis: totalDurationMs,
      DurationMillis: totalDurationMs - lastTimestamp
    });
  }

  return segments;
}

/**
 * Subdivides long segments (>maxDurationMs) into smaller chunks
 */
function subdivideSegments(segments: Array<{
  StartTimestampMillis: number;
  EndTimestampMillis: number;
  DurationMillis: number;
}>, maxDurationMs: number = 20000): Array<{
  StartTimestampMillis: number;
  EndTimestampMillis: number;
  DurationMillis: number;
}> {
  const subdividedSegments: Array<{
    StartTimestampMillis: number;
    EndTimestampMillis: number;
    DurationMillis: number;
  }> = [];

  segments.forEach((segment, originalIndex) => {
    const duration = segment.DurationMillis;
    const startTime = segment.StartTimestampMillis;
    const endTime = segment.EndTimestampMillis;

    if (duration <= maxDurationMs) {
      subdividedSegments.push(segment);
    } else {
      const numSubdivisions = Math.ceil(duration / maxDurationMs);
      const subSegmentDuration = duration / numSubdivisions;

      console.log(`Subdividing segment ${originalIndex + 1} with duration ${duration}ms into ${numSubdivisions} sub-segments of ~${Math.round(subSegmentDuration)}ms each`);

      for (let i = 0; i < numSubdivisions; i++) {
        const subStartTime = startTime + (i * subSegmentDuration);
        const subEndTime = i === numSubdivisions - 1 ? endTime : startTime + ((i + 1) * subSegmentDuration);
        const subDuration = subEndTime - subStartTime;

        subdividedSegments.push({
          StartTimestampMillis: Math.round(subStartTime),
          EndTimestampMillis: Math.round(subEndTime),
          DurationMillis: Math.round(subDuration)
        });
      }
    }
  });

  return subdividedSegments;
}

async function handleSQSEvent(event: SQSEvent): Promise<LambdaResponse> {
  try {
    // Parse the SQS message body
    const { videoIndex, videoId, segment, originalVideoKey, segmentNumber } = JSON.parse(event.Records[0].body);

    // Make sure we have the bucket name from environment variables
    const bucketName = process.env.VIDEO_BUCKET;
    if (!bucketName) {
      throw new Error('VIDEO_BUCKET environment variable is not set');
    }

    // Pass the bucket name and segment number explicitly to the processing function
    const slicedSegments = await processSegmentDetection(
      videoIndex,
      videoId,
      segment,
      originalVideoKey,
      bucketName,
      segmentNumber
    );

    if (slicedSegments) {
      await updateVideoSegments(videoIndex, videoId, [slicedSegments]);
      // Also update the DynamoDB record with the complete segment data
      await updateDynamoDBSegment(videoIndex, videoId, slicedSegments);
    }

    // Use DynamoDB's atomic operations to decrement the pending segments counter
    try {
      console.log(`Decrementing pending_segments_count for video ${videoId} in index ${videoIndex}`);

      // Atomically decrement the counter
      const result = await withRetry(
        async () => docClient.send(new UpdateCommand({
          TableName: process.env.INDEXES_TABLE,
          Key: {
            indexId: videoIndex,
            videoId
          },
          UpdateExpression: "ADD pending_segments_count :decrement",
          ExpressionAttributeValues: {
            ":decrement": -1
          },
          ReturnValues: "UPDATED_NEW"
        })),
        3,
        `Atomically decrement pending segments count`
      );

      console.log(`Updated pending_segments_count result:`, result);

      // Check if this was the last segment (counter reached zero or negative)
      const pendingCount = result.Attributes?.pending_segments_count;
      if (pendingCount !== undefined && pendingCount <= 0) {
        console.log(`All segments for video ${videoId} have been processed, marking as ready`);

        // Set the completion flag and mark video as ready
        await withRetry(
          async () => docClient.send(new UpdateCommand({
            TableName: process.env.INDEXES_TABLE,
            Key: {
              indexId: videoIndex,
              videoId
            },
            UpdateExpression: "SET video_status = :status, video_embed_completed = :completed, video_shots_completed = :shots_completed",
            ExpressionAttributeValues: {
              ":status": "ready",
              ":completed": true,
              ":shots_completed": true
            }
          })),
          3,
          `Set video completion flags`
        );

        // Also update OpenSearch status to ready
        await updateVideoStatus(videoIndex, videoId, 'ready', {
          message: 'All segments processed and embeddings generated'
        });

        console.log(`Successfully marked video ${videoId} as ready`);
      } else {
        console.log(`Still ${pendingCount} segments remaining to process for video ${videoId}`);
      }
    } catch (err) {
      console.error(`Error updating segment counter for video ${videoId}:`, err);
    }

    return {
      statusCode: STATUS_CODES.OK,
      headers: corsHeaders,
      body: JSON.stringify({
        message: 'Video slicing completed',
        videoId,
        videoIndex,
        segmentNumber,
        segmentId: slicedSegments?.segment_id
      })
    };
  } catch (error) {
    console.error('Error processing video segments:', error);
    throw error; // Re-throw to trigger Lambda retry mechanism
  }
}

async function updateVideoStatus(videoIndex: string, videoId: string, status: VideoStatus, additionalFields?: Partial<VideoMetadata>) {
  try {
    // First search for the document to get its OpenSearch document ID
    const { body: searchResult } = await openSearch.search({
      index: videoIndex,
      body: {
        query: {
          term: {
            video_id: videoId
          }
        }
      }
    });

    if (!searchResult.hits || !searchResult.hits.hits || searchResult.hits.hits.length === 0) {
      // Waiting the index to be updated then retry the search
      await new Promise(resolve => setTimeout(resolve, 3000));
      console.log(`Waiting for the index to be updated then retry the search for video ${videoId} in index ${videoIndex}`);
      return updateVideoStatus(videoIndex, videoId, status, additionalFields);
    }

    console.log(`video status updated search result for video ${videoId} in index ${videoIndex}:`, searchResult.hits.hits[0]);

    // Get the OpenSearch document ID
    const documentId = searchResult.hits.hits[0]._id;

    // Use withRetry for the OpenSearch update operation to handle version conflicts
    await withRetry(
      async () => openSearch.update({
        index: videoIndex,
        id: documentId,
        body: {
          doc: {
            video_status: status,
            ...additionalFields,
            updated_at: new Date().toISOString()
          }
        }
      }),
      5,
      `Update status for video ${videoId} in index ${videoIndex}`
    );
  } catch (error) {
    console.error(`Error updating status for video ${videoId} in index ${videoIndex}:`, error);
    throw error;
  }
}

async function sendSegmentSlicingRequest(videoIndex: string, videoId: string, segments: Array<{
  StartTimestampMillis: number;
  EndTimestampMillis: number;
  DurationMillis: number;
}>): Promise<void> {
  const queueUrl = process.env.VIDEO_SLICING_QUEUE_URL;
  if (!queueUrl) {
    throw new Error('VIDEO_SLICING_QUEUE_URL is not set');
  }

  // Search for the video to get its S3 path
  const { body: searchResult } = await openSearch.search({
    index: videoIndex,
    body: {
      query: {
        term: {
          video_id: videoId
        }
      }
    }
  });

  if (!searchResult.hits || !searchResult.hits.hits || searchResult.hits.hits.length === 0) {
    await new Promise(resolve => setTimeout(resolve, 3000));
    console.log(`Waiting for the index to be updated then retry the search for video ${videoId} in index ${videoIndex}`);
    return sendSegmentSlicingRequest(videoIndex, videoId, segments);
  }

  const videoMetadata = searchResult.hits.hits[0]._source;
  const originalVideoKey = videoMetadata.video_s3_path;
  if (!originalVideoKey) {
    console.warn('Original video path not found for video:', videoId);
    return;
  }

  // Sort segments by start time
  const sortedSegments = [...segments].sort((a, b) => a.StartTimestampMillis - b.StartTimestampMillis);

  const totalSegmentsCount = sortedSegments.length;
  console.log(`Initializing pending_segments_count to ${totalSegmentsCount} for video ${videoId} in index ${videoIndex}`);

  await withRetry(
    async () => docClient.send(new UpdateCommand({
      TableName: process.env.INDEXES_TABLE,
      Key: {
        indexId: videoIndex,
        videoId
      },
      UpdateExpression: "SET video_status = :status, video_shots_completed = :video_shots_completed, pending_segments_count = :count",
      ExpressionAttributeValues: {
        ":status": "processing",
        ":video_shots_completed": false,
        ":count": totalSegmentsCount
      }
    })),
    3,
    `Initialize pending segments count to ${totalSegmentsCount}`
  );

  // Send a message to the video slicing queue per segment
  for (let i = 0; i < sortedSegments.length; i++) {
    const segment = sortedSegments[i];
    const segmentNumber = i + 1;

    const isFifoQueue = queueUrl.endsWith('.fifo');

    const commandParams: any = {
      QueueUrl: queueUrl,
      MessageBody: JSON.stringify({
        videoIndex,
        videoId,
        segment,
        originalVideoKey,
        segmentNumber,
        totalSegments: totalSegmentsCount
      })
    };

    if (isFifoQueue) {
      const groupNumber = segmentNumber % 10;
      commandParams.MessageGroupId = `${videoId}-group-${groupNumber}`;
      commandParams.MessageDeduplicationId = `${videoId}-segment-${segmentNumber}-${Date.now()}`;
    }

    const command = new SendMessageCommand(commandParams);

    try {
      await sqs.send(command);
    } catch (error) {
      console.error('Error sending segment slicing request:', error, " for the segment:", segment);
    }
  }
}

async function processSegmentDetection(
  videoIndex: string,
  videoId: string,
  segment: { StartTimestampMillis: number; EndTimestampMillis: number; DurationMillis: number },
  originalVideoKey: string,
  bucketName: string,
  segmentNumber: number
): Promise<VideoSegment | null> {
  try {
    console.log(`Processing segment detection for video ${videoId} in index ${videoIndex}, segment number: ${segmentNumber}, segment: ${JSON.stringify(segment)}, originalVideoKey: ${originalVideoKey} and bucketName: ${bucketName}`);

    if (!segment) {
      console.warn('No segments detected for video:', videoId);
      return null;
    }

    const slicedSegment: VideoSegment = {
      segment_id: `${videoId}_segment_${segmentNumber}`,
      video_id: videoId,
      start_time: segment.StartTimestampMillis || 0,
      end_time: segment.EndTimestampMillis || 0,
      duration: segment.DurationMillis || 0,
    }

    // Skip very short segments (less than 1 second)
    if (slicedSegment.duration < 1000) {
      console.warn(`Skipping short segment ${slicedSegment.segment_id} with duration ${slicedSegment.duration}ms`);
      return null;
    }

    // Create the output path for the sliced video
    const segmentVideoS3Path = (() => {
      const [_, timestamp, indexId, vidId, filename] = originalVideoKey.split('/');
      const [name, ext] = filename.split('.');
      const paddedSegmentNum = String(segmentNumber).padStart(3, '0');
      return [`ProcessedVideos/${timestamp}/${indexId}/${vidId}/segments/${name}_${paddedSegmentNum}.${ext}`,
              `ProcessedVideos/${timestamp}/${indexId}/${vidId}/segments/${name}_${paddedSegmentNum}.jpg`];
    })();

    // Use FFmpeg to slice the video and extract keyframes
    const localInputPath = `/tmp/${videoId}_input.mp4`;
    const localOutputPath = `/tmp/${videoId}_segment_${segmentNumber}.mp4`;
    const localKeyframePath = `/tmp/${videoId}_keyframe_${segmentNumber}.jpg`;

    const ffmpegPath = process.env.LAMBDA_TASK_ROOT ? '/opt/bin/ffmpeg' : 'ffmpeg';

    // Ensure ffmpeg exists and has execute permissions
    try {
      const { exec } = require('child_process');
      await new Promise((resolve, reject) => {
        exec(`${ffmpegPath} -version`, (error: any, stdout: any, stderr: any) => {
          if (error) {
            console.error(`Error checking ffmpeg: ${error}`);
            reject(error);
            return;
          }
          console.log(`ffmpeg version: ${stdout.substring(0, 100)}`);
          resolve(stdout);
        });
      });
    } catch (error) {
      console.error('FFmpeg check failed:', error);
      throw new Error('FFmpeg not accessible or not executable');
    }

    try {
      // Download the original video to a local file
      console.log(`Downloading video from S3 to ${localInputPath}`);
      const response = await s3.send(new GetObjectCommand({
        Bucket: bucketName,
        Key: originalVideoKey
      }));

      if (response.Body) {
        const buf = Buffer.from(await response.Body.transformToByteArray());
        fs.writeFileSync(localInputPath, buf);
      } else {
        throw new Error('Empty response body from S3');
      }

      // Slice the video using FFmpeg
      await new Promise<void>((resolve, reject) => {
        const startTimeSeconds = slicedSegment.start_time / 1000;
        const durationSeconds = slicedSegment.duration / 1000;
        const preset = durationSeconds > 20 ? 'veryfast' : 'medium';

        console.log(`Running ffmpeg to slice video (preset: ${preset}): -ss ${startTimeSeconds} -t ${durationSeconds}`);

        const ffmpegProcess = spawn(ffmpegPath, [
          '-ss', startTimeSeconds.toString(),
          '-i', localInputPath,
          '-t', durationSeconds.toString(),
          '-c:v', 'libx264',
          '-preset', preset,
          '-crf', '23',
          '-c:a', 'aac',
          '-b:a', '128k',
          '-y',
          localOutputPath
        ]);

        ffmpegProcess.on('close', (code) => {
          if (code === 0) {
            console.log(`Successfully sliced video segment ${segmentNumber}`);
            resolve();
          } else {
            console.error(`FFmpeg process exited with code ${code}`);
            reject(new Error(`FFmpeg slicing failed with code ${code}`));
          }
        });

        ffmpegProcess.on('error', (err) => {
          console.error('FFmpeg process error:', err);
          reject(err);
        });
      });

      // Extract a keyframe from the segment
      await new Promise<void>((resolve, reject) => {
        console.log(`Extracting keyframe from segment ${segmentNumber}`);

        const keyframeProcess = spawn(ffmpegPath, [
          '-i', localOutputPath,
          '-ss', '0',
          '-frames:v', '1',
          '-q:v', '2',
          '-y',
          localKeyframePath
        ]);

        keyframeProcess.on('close', (code) => {
          if (code === 0) {
            console.log(`Successfully extracted keyframe for segment ${segmentNumber}`);
            resolve();
          } else {
            console.error(`FFmpeg keyframe process exited with code ${code}`);
            reject(new Error(`FFmpeg keyframe extraction failed with code ${code}`));
          }
        });

        keyframeProcess.on('error', (err) => {
          console.error('FFmpeg keyframe process error:', err);
          reject(err);
        });
      });

      // Check that the files were created
      if (!fs.existsSync(localOutputPath)) {
        throw new Error(`Output video file was not created: ${localOutputPath}`);
      }

      if (!fs.existsSync(localKeyframePath)) {
        throw new Error(`Keyframe file was not created: ${localKeyframePath}`);
      }

      console.log(`Files created successfully, uploading to S3`);

      // Upload the segment and keyframe to S3
      await Promise.all([
        s3.send(new PutObjectCommand({
          Bucket: bucketName,
          Key: segmentVideoS3Path[0],
          Body: fs.readFileSync(localOutputPath),
          ContentType: 'video/mp4'
        })),
        s3.send(new PutObjectCommand({
          Bucket: bucketName,
          Key: segmentVideoS3Path[1],
          Body: fs.readFileSync(localKeyframePath),
          ContentType: 'image/jpeg'
        }))
      ]);

      // Get signed URLs
      const keyframeCommand = new GetObjectCommand({
        Bucket: bucketName,
        Key: segmentVideoS3Path[1]
      });
      const keyframeSignedUrl = await getSignedUrl(s3 as any, keyframeCommand as any, { expiresIn: 3600 });

      const segmentCommand = new GetObjectCommand({
        Bucket: bucketName,
        Key: segmentVideoS3Path[0]
      });
      const segmentSignedUrl = await getSignedUrl(s3 as any, segmentCommand as any, { expiresIn: 3600 });

      console.log(`Successfully uploaded segment ${segmentNumber} and keyframe to S3`);

      slicedSegment.segment_video_s3_path = segmentVideoS3Path[0];
      slicedSegment.segment_video_thumbnail_s3_path = segmentVideoS3Path[1];
      slicedSegment.segment_video_preview_url = segmentSignedUrl;
      slicedSegment.segment_video_thumbnail_url = keyframeSignedUrl;
      slicedSegment.segment_visual = {
        segment_visual_description: 'Scene detected by FFmpeg',
      };

      // Generate embeddings using TwelveLabs Marengo Embed 3.0
      try {
        console.log('Generating embeddings for segment', segmentVideoS3Path[0]);

        const segmentDescription = slicedSegment.segment_visual?.segment_visual_description || '';
        const embeddings = await generateEmbedding(localKeyframePath, segmentDescription);

        if (embeddings.vision_embedding) {
          console.log(`Successfully generated vision embedding for segment ${segmentNumber}, length: ${embeddings.vision_embedding.length}`);
          slicedSegment.segment_visual.segment_visual_embedding = embeddings.vision_embedding;
        } else {
          console.warn(`No vision embedding generated for segment ${segmentNumber}`);
        }

        if (embeddings.audio_embedding) {
          console.log(`Successfully generated audio embedding for segment ${segmentNumber}, length: ${embeddings.audio_embedding.length}`);
          slicedSegment.segment_audio = {
            segment_audio_embedding: embeddings.audio_embedding
          };
        } else {
          console.warn(`No audio embedding generated for segment ${segmentNumber}`);
        }
      } catch (error) {
        console.error('Error generating embeddings:', error);
      }

      // Clean up local files after embedding generation
      try {
        fs.unlinkSync(localInputPath);
        fs.unlinkSync(localOutputPath);
        fs.unlinkSync(localKeyframePath);
        console.log(`Cleaned up temporary files`);
      } catch (cleanupError) {
        console.warn(`Warning: Failed to clean up some temporary files:`, cleanupError);
      }

      return slicedSegment;
    } catch (error) {
      console.error(`Error processing video segment ${segmentNumber}:`, error);
      return null;
    }
  } catch (error) {
    console.error('Error processing video segments:', error);
    throw error;
  }
}

/**
 * Generate a visual embedding for a keyframe image using TwelveLabs Marengo Embed 3.0.
 * Returns a 512-dimensional embedding vector, or null on failure.
 */
async function generateVisualEmbedding(keyframePath: string): Promise<number[] | null> {
  try {
    const imageBuffer = fs.readFileSync(keyframePath);
    const base64Image = imageBuffer.toString('base64');

    const response = await bedrockMarengo.send(new InvokeModelCommand({
      modelId: MARENGO_MODEL_ID,
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify({
        inputType: 'image',
        image: { mediaSource: { base64String: base64Image } }
      })
    }));

    const result = JSON.parse(new TextDecoder().decode(response.body));
    if (result.data?.[0]?.embedding && Array.isArray(result.data[0].embedding)) {
      const embedding = result.data[0].embedding as number[];
      console.log(`Generated visual embedding via Marengo Embed 3.0, length: ${embedding.length}`);
      return embedding;
    }
    console.warn('Unexpected response format from Marengo Embed 3.0:', JSON.stringify(result).substring(0, 200));
    return null;
  } catch (error) {
    console.error('Error generating visual embedding via Marengo Embed 3.0:', error);
    return null;
  }
}

/**
 * Generate a text embedding using TwelveLabs Marengo Embed 3.0.
 * Returns a 512-dimensional embedding vector, or null on failure.
 */
async function generateTextEmbedding(text: string): Promise<number[] | null> {
  if (!text || text.trim().length === 0) return null;

  try {
    const response = await bedrockMarengo.send(new InvokeModelCommand({
      modelId: MARENGO_MODEL_ID,
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify({
        inputType: 'text',
        text: { inputText: text }
      })
    }));

    const result = JSON.parse(new TextDecoder().decode(response.body));
    if (result.data?.[0]?.embedding && Array.isArray(result.data[0].embedding)) {
      console.log(`Generated text embedding via Marengo Embed 3.0, length: ${result.data[0].embedding.length}`);
      return result.data[0].embedding as number[];
    }
    console.warn('Unexpected response format from Marengo Embed 3.0');
    return null;
  } catch (error) {
    console.error('Error generating text embedding via Marengo Embed 3.0:', error);
    return null;
  }
}

/**
 * Generate embeddings for a video segment using TwelveLabs Marengo Embed 3.0.
 * Both visual and audio embeddings are 512-dim in the Marengo unified embedding space.
 * - Visual embedding: from keyframe image via Marengo (512-dim)
 * - Audio embedding: from segment description text via Marengo (512-dim)
 */
async function generateEmbedding(keyframePath: string, segmentDescription: string): Promise<{
  vision_embedding: number[] | null;
  audio_embedding: number[] | null;
}> {
  console.log('Generating embeddings for keyframe:', keyframePath);
  const defaultResponse = { vision_embedding: null, audio_embedding: null };

  try {
    const [visionEmbedding, audioEmbedding] = await Promise.all([
      generateVisualEmbedding(keyframePath),
      generateTextEmbedding(segmentDescription)
    ]);

    console.log(`Vision embedding length: ${visionEmbedding?.length || 0}, Audio embedding length: ${audioEmbedding?.length || 0}`);

    return {
      vision_embedding: visionEmbedding,
      audio_embedding: audioEmbedding
    };
  } catch (error) {
    console.error('Error generating embeddings:', error);
    return defaultResponse;
  }
}

/**
 * Store segment detection results in DynamoDB for preview purposes
 */
async function storeSegmentDetectionResults(videoIndex: string, videoId: string, segments: Array<{
  StartTimestampMillis: number;
  EndTimestampMillis: number;
  DurationMillis: number;
}>): Promise<void> {
  try {
    const videoSegments: VideoSegment[] = segments.map((segment, index) => ({
      segment_id: `${videoId}_segment_${index + 1}`,
      video_id: videoId,
      start_time: segment.StartTimestampMillis || 0,
      end_time: segment.EndTimestampMillis || 0,
      duration: segment.DurationMillis || 0,
      segment_name: `Segment ${index + 1}`,
      segment_visual: {
        segment_visual_description: 'Scene detected by FFmpeg'
      }
    }));

    await withRetry(
      async () => docClient.send(new UpdateCommand({
        TableName: process.env.INDEXES_TABLE,
        Key: {
          indexId: videoIndex,
          videoId
        },
        UpdateExpression: "SET video_segments = :segments, segment_count = :count, video_status = :status, updated_at = :updated_at",
        ExpressionAttributeValues: {
          ":segments": videoSegments,
          ":count": videoSegments.length,
          ":status": "processing",
          ":updated_at": new Date().toISOString()
        }
      })),
      3,
      `Store segment detection results for video ${videoId} in index ${videoIndex}`
    );

    console.log(`Successfully stored ${videoSegments.length} segment detection results for video ${videoId} in index ${videoIndex}`);
  } catch (error) {
    console.error(`Error storing segment detection results for video ${videoId}:`, error);
    throw error;
  }
}

/**
 * Update a single segment in the DynamoDB video_segments array
 */
async function updateDynamoDBSegment(videoIndex: string, videoId: string, processedSegment: VideoSegment): Promise<void> {
  try {
    console.log(`Updating DynamoDB segment ${processedSegment.segment_id} for video ${videoId} in index ${videoIndex}`);

    const getResult = await docClient.send(new GetCommand({
      TableName: process.env.INDEXES_TABLE,
      Key: {
        indexId: videoIndex,
        videoId
      }
    }));

    if (!getResult.Item || !getResult.Item.video_segments) {
      console.warn(`No video segments found in DynamoDB for video ${videoId}`);
      return;
    }

    const segments = getResult.Item.video_segments as VideoSegment[];
    const segmentIndex = segments.findIndex(s => s.segment_id === processedSegment.segment_id);

    if (segmentIndex === -1) {
      console.warn(`Segment ${processedSegment.segment_id} not found in DynamoDB array`);
      return;
    }

    await withRetry(
      async () => docClient.send(new UpdateCommand({
        TableName: process.env.INDEXES_TABLE,
        Key: {
          indexId: videoIndex,
          videoId
        },
        UpdateExpression: `SET video_segments[${segmentIndex}].segment_video_s3_path = :video_path, video_segments[${segmentIndex}].segment_video_thumbnail_s3_path = :thumbnail_path, video_segments[${segmentIndex}].segment_video_preview_url = :preview_url, video_segments[${segmentIndex}].segment_video_thumbnail_url = :thumbnail_url`,
        ExpressionAttributeValues: {
          ":video_path": processedSegment.segment_video_s3_path,
          ":thumbnail_path": processedSegment.segment_video_thumbnail_s3_path,
          ":preview_url": processedSegment.segment_video_preview_url,
          ":thumbnail_url": processedSegment.segment_video_thumbnail_url
        }
      })),
      3,
      `Update DynamoDB segment ${processedSegment.segment_id}`
    );

    console.log(`Successfully updated DynamoDB segment ${processedSegment.segment_id} for video ${videoId}`);
  } catch (error) {
    console.error(`Error updating DynamoDB segment ${processedSegment.segment_id}:`, error);
  }
}

/**
 * Utility function to perform operations with retry logic and exponential backoff
 */
async function withRetry<T>(
  operation: () => Promise<T>,
  maxRetries: number = 6,
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

      const delay = Math.pow(4, retries) * 1000;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

async function updateVideoSegments(videoIndex: string, videoId: string, segments: VideoSegment[]): Promise<void> {
  console.log('Segments to update: ', segments, '\nwith visual embedding length: ', segments.map(s => s.segment_visual?.segment_visual_embedding?.length), '\nwith audio embedding length: ', segments.map(s => s.segment_audio?.segment_audio_embedding?.length));

  try {
    const { body: searchResult } = await openSearch.search({
      index: videoIndex,
      body: {
        query: {
          term: {
            video_id: videoId
          }
        }
      }
    });

    if (!searchResult.hits || !searchResult.hits.hits || searchResult.hits.hits.length === 0) {
      await new Promise(resolve => setTimeout(resolve, 3000));
      console.log(`Waiting for the index to be updated then retry the search for video ${videoId} in index ${videoIndex}`);
      return updateVideoSegments(videoIndex, videoId, segments);
    }

    console.log(`video segments updated search result for video ${videoId} in index ${videoIndex}:`, searchResult.hits.hits[0]);

    const documentId = searchResult.hits.hits[0]._id;

    const formattedSegments = segments.map(segment => ({
      ...segment,
      segment_id: segment.segment_id || `unassigned_segment_id`,
      segment_visual: {
        ...segment.segment_visual,
        segment_visual_embedding: segment.segment_visual?.segment_visual_embedding || []
      },
      ...(segment.segment_audio?.segment_audio_embedding &&
           Array.isArray(segment.segment_audio.segment_audio_embedding) &&
           segment.segment_audio.segment_audio_embedding.length > 0
        ? {
            segment_audio: {
              segment_audio_embedding: segment.segment_audio.segment_audio_embedding
            }
          }
        : {})
    }));

    try {
      await withRetry(
        async () => openSearch.update({
          index: videoIndex,
          id: documentId,
          body: {
            script: {
              source: `
                // Initialize video_segments array if null
                if (ctx._source.video_segments == null) {
                  ctx._source.video_segments = [];
                }

                // Update existing segments with new data or add new ones
                for (int i = 0; i < params.newSegments.length; i++) {
                  def newSegment = params.newSegments[i];
                  def found = false;

                  // Try to find existing segment with same segment_id
                  for (int j = 0; j < ctx._source.video_segments.length; j++) {
                    if (ctx._source.video_segments[j].segment_id == newSegment.segment_id) {
                      // Update existing segment with new data (merge)
                      ctx._source.video_segments[j] = newSegment;
                      found = true;
                      break;
                    }
                  }

                  // If not found, add as new segment
                  if (!found) {
                    ctx._source.video_segments.add(newSegment);
                  }
                }

                // Update the segment count and status
                ctx._source.segment_count = ctx._source.video_segments.length;
                ctx._source.video_status = params.video_status;
                ctx._source.updated_at = params.updated_at;
              `,
              params: {
                newSegments: formattedSegments.map(segment => {
                  const formattedSegment = {
                    ...segment,
                    segment_id: segment.segment_id || `unassigned_segment_id`,
                    segment_visual: {
                      ...segment.segment_visual,
                      segment_visual_embedding: segment.segment_visual?.segment_visual_embedding || []
                    }
                  };

                  if (segment.segment_audio &&
                      Array.isArray(segment.segment_audio.segment_audio_embedding) &&
                      segment.segment_audio.segment_audio_embedding.length > 0) {
                    formattedSegment.segment_audio = {
                      segment_audio_embedding: segment.segment_audio.segment_audio_embedding
                    };
                  }

                  return formattedSegment;
                }),
                video_status: 'processing',
                updated_at: new Date().toISOString(),
              }
            }
          }
        }),
        6,
        `Update segments for video ${videoId} in index ${videoIndex}`
      );
      console.log(`Successfully updated segments for video ${videoId} in index ${videoIndex}`);
    } catch (updateError) {
      console.error(`Error during script update for video ${videoId} after retries:`, updateError);
    }
  } catch (error) {
    console.error(`Error updating video segments for video ${videoId} in index ${videoIndex}:`, error);
    throw error;
  }
}
