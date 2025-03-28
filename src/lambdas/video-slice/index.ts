import { LambdaContext, LambdaResponse } from '../../types/aws-lambda';
import { VideoMetadata, VideoStatus, VideoSegment, VideoProcessingJob } from '../../types/common';
import { 
  RekognitionClient,
  StartSegmentDetectionCommand,
  GetSegmentDetectionCommand,
  StartLabelDetectionCommand,
  StartFaceDetectionCommand,
  NotificationChannel,
  SegmentType,
  SegmentDetection,
  GetLabelDetectionCommand,
  GetFaceDetectionCommand,
} from '@aws-sdk/client-rekognition';
import { SQSClient, SendMessageCommand, GetQueueAttributesCommand } from '@aws-sdk/client-sqs';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { Client } from '@opensearch-project/opensearch';
import { defaultProvider } from '@aws-sdk/credential-provider-node';
import { AwsSigv4Signer } from '@opensearch-project/opensearch/aws';
import { S3Event, SNSEvent, SQSEvent } from 'aws-lambda';
import { spawn } from 'child_process';
// fs module for file system operations like reading/writing video files
import * as fs from 'fs';
// path module for handling file paths and directories
import * as path from 'path';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { DynamoDBDocumentClient, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';

const rekognition = new RekognitionClient({});
const sqs = new SQSClient({});
const getQueueAttributesCommand = new GetQueueAttributesCommand({
  QueueUrl: process.env.VIDEO_SLICING_QUEUE_URL,
  AttributeNames: ['ApproximateNumberOfMessages', 'ApproximateNumberOfMessagesNotVisible']
});
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
const EMBEDDING_SERVICE_URL = process.env.EMBEDDING_SERVICE_URL;

// Add a constant for the external embedding endpoint
const EXTERNAL_EMBEDDING_ENDPOINT = process.env.EXTERNAL_EMBEDDING_ENDPOINT || '';

export const handler = async (event: S3Event | SNSEvent | SQSEvent, _context: LambdaContext): Promise<LambdaResponse> => {
  try {
    console.log('Received event:', event);
    // Handle S3 event for new video upload, sample format below:
    // {
    //   Records: [
    //     {
    //       eventVersion: '2.1',
    //       eventSource: 'aws:s3',
    //       awsRegion: 'ap-northeast-1',
    //       eventTime: '2025-02-21T09:20:26.368Z',
    //       eventName: 'ObjectCreated:Put',
    //       userIdentity: [Object],
    //       requestParameters: [Object],
    //       responseElements: [Object],
    //       s3: [Object]
    //     }
    //   ]
    // }
    if ('Records' in event && 'eventSource' in event.Records[0] && event.Records[0].eventSource === 'aws:s3') {
      return handleS3Event(event as S3Event);
    }

    // Handle SNS notification from Rekognition, sample format below:
    // {
    //   Records: [
    //     {
    //       EventSource: 'aws:sns',
    //       EventVersion: '1.0',
    //       EventSubscriptionArn: '',
    //       Sns: [Object]
    //     }
    //   ]
    // }
    if ('Records' in event && 'EventSource' in event.Records[0] && event.Records[0].EventSource === 'aws:sns') {
      return handleSNSEvent(event as SNSEvent);
    }

    // Handle SQS message for video slicing, sample format below:
    // {
    //  Records: [
    //    {
    //      messageId: '3879ceb7-5c0f-4236-ae03-814654de7b88',
    //      receiptHandle: '',
    //      body: '{"videoIndex":"xx",
    //              "videoId":"yy",
    //              "segment":{"DurationFrames":19,
    //                        "DurationMillis":3000,
    //                        "DurationSMPTE":"00:00:03:00",
    //                        "EndFrameNumber":19,
    //                        "EndTimecodeSMPTE":"00:00:03:00",
    //                        "EndTimestampMillis":3000,
    //                        "ShotSegment":{"Confidence":99.9995346069336,
    //                                      "Index":0},
    //                        "StartFrameNumber":0,
    //                        "StartTimecodeSMPTE":"00:00:00:00",
    //                        "StartTimestampMillis":0,
    //                        "Type":"SHOT"},
    //                        "originalVideoKey":"RawVideos/2025-03-02/videoIndex/videoId/videoFileNameWithExtension"}',
    //      attributes: [Object],
    //      messageAttributes: {},
    //      md5OfBody: '',
    //      eventSource: 'aws:sqs',
    //      eventSourceARN: '',
    //      awsRegion: ''
    //    }
    //  ]
    // }
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

  // Validate the video format and codec for Rekognition compatibility, refer to https://aws.amazon.com/rekognition/faqs/
  try {
    // Download the video to a temporary location for validation
    const tempVideoPath = `/tmp/${videoId}_validation.mp4`;
    
    // Download the video file from S3
    const downloadCommand = new GetObjectCommand({
      Bucket: bucket,
      Key: key
    });
    
    const response = await s3.send(downloadCommand);
    if (response.Body) {
      // Convert the response body to a buffer and write to file
      const buf = Buffer.from(await response.Body.transformToByteArray());
      fs.writeFileSync(tempVideoPath, buf);
      console.log(`Downloaded video for validation, size: ${buf.length} bytes`);
    } else {
      throw new Error('Empty response body from S3 during validation');
    }
    
    // Use ffprobe to check the video codec and format
    const isValidVideo = await validateVideoForRekognition(tempVideoPath, videoId, videoIndex);
    
    // Clean up the temporary file
    try {
      fs.unlinkSync(tempVideoPath);
    } catch (err) {
      console.warn('Failed to clean up temporary validation file:', err);
    }
    
    if (!isValidVideo) {
      // Update the video status in OpenSearch to indicate incompatibility
      await updateVideoStatus(videoIndex, videoId, 'error', {
        error: 'Video format not compatible with Amazon Rekognition. Only H.264 codec in MP4 or MOV container is supported.'
      });
      
      return {
        statusCode: STATUS_CODES.BAD_REQUEST,
        headers: corsHeaders,
        body: JSON.stringify({ 
          error: 'Video format not compatible with Amazon Rekognition',
          message: 'Only H.264 codec in MP4 or MOV container is supported'
        })
      };
    }
    
    console.log('Video validation successful, proceeding with Rekognition jobs');
  } catch (validationError) {
    console.error('Error validating video:', validationError);
    
    // Update the video status in OpenSearch
    await updateVideoStatus(videoIndex, videoId, 'error', {
      error: `Video validation failed: ${validationError instanceof Error ? validationError.message : 'Unknown error'}`
    });
    
    return {
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      headers: corsHeaders,
      body: JSON.stringify({ 
        error: 'Video validation failed',
        details: validationError instanceof Error ? validationError.message : 'Unknown error'
      })
    };
  }

  // Start Rekognition jobs
  const notificationChannel: NotificationChannel = {
    SNSTopicArn: process.env.SNS_TOPIC_ARN,
    RoleArn: process.env.REKOGNITION_ROLE_ARN
  };

  // Start shot detection
  const shotDetectionResponse = await rekognition.send(new StartSegmentDetectionCommand({
    Video: { S3Object: { Bucket: bucket, Name: key } },
    NotificationChannel: notificationChannel,
    JobTag: `${videoIndex}-${videoId}-shots`,
    SegmentTypes: [SegmentType.SHOT]
  }));

  // Start label detection
  const labelDetectionResponse = await rekognition.send(new StartLabelDetectionCommand({
    Video: { S3Object: { Bucket: bucket, Name: key } },
    NotificationChannel: notificationChannel,
    JobTag: `${videoIndex}-${videoId}-labels`,
    MinConfidence: 90
  }));

  // Start face detection
  const faceDetectionResponse = await rekognition.send(new StartFaceDetectionCommand({
    Video: { S3Object: { Bucket: bucket, Name: key } },
    NotificationChannel: notificationChannel,
    JobTag: `${videoIndex}-${videoId}-faces`
  }));

  return {
    statusCode: STATUS_CODES.OK,
    headers: corsHeaders,
    body: JSON.stringify({
      message: 'Video processing started',
      videoId,
      jobIds: {
        shotDetection: shotDetectionResponse.JobId,
        labelDetection: labelDetectionResponse.JobId,
        faceDetection: faceDetectionResponse.JobId
      }
    })
  };
}

/**
 * Validates if a video file is compatible with Amazon Rekognition
 * 
 * Requirements:
 * - Video must be encoded using the H.264 codec
 * - Supported file formats are MPEG-4 and MOV
 * 
 * @param videoPath Path to the video file
 * @param videoId ID of the video
 * @param videoIndex Index of the video
 * @returns Boolean indicating if the video is valid for Rekognition
 */
async function validateVideoForRekognition(videoPath: string, videoId: string, videoIndex: string): Promise<boolean> {
  // Define ffprobe path - it's included in the FFmpeg Lambda layer
  const ffprobePath = process.env.LAMBDA_TASK_ROOT ? '/opt/bin/ffprobe' : 'ffprobe';
  
  try {
    // Use ffprobe to get the video codec and format information
    const ffprobeProcess = spawn(ffprobePath, [
      '-v', 'error',
      '-select_streams', 'v:0',  // Select video stream
      '-show_entries', 'stream=codec_name,codec_type:format=format_name,format_long_name',
      '-of', 'json',
      videoPath
    ]);
    
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
        console.error(`ffprobe stderr: ${data}`);
      });
      
      ffprobeProcess.on('error', (err) => {
        reject(err);
      });
    });
    
    // Parse the ffprobe output
    const videoInfo = JSON.parse(ffprobeOutput);
    console.log('Video information:', JSON.stringify(videoInfo, null, 2));
    
    // Extract codec and format information
    const videoCodec = videoInfo.streams?.[0]?.codec_name?.toLowerCase();
    const videoFormat = videoInfo.format?.format_name?.toLowerCase();
    const formatLongName = videoInfo.format?.format_long_name?.toLowerCase();
    
    console.log(`Video codec: ${videoCodec}, format: ${videoFormat}, format long name: ${formatLongName}`);
    
    // Check if the video is in a supported format
    const isH264 = videoCodec === 'h264';
    
    // Check for MP4 or MOV container formats
    // ffprobe may return formats like 'mov,mp4,m4a,3gp,3g2,mj2' for MP4/MOV files
    const isSupportedFormat = videoFormat && (
      videoFormat.includes('mp4') || 
      videoFormat.includes('mov') || 
      videoFormat.includes('quicktime')
    );
    
    const isValid = isH264 && isSupportedFormat;
    
    // Log validation result
    if (isValid) {
      console.log(`Video ID ${videoId} is compatible with Amazon Rekognition`);
    } else {
      console.warn(`Video ID ${videoId} is not compatible with Amazon Rekognition:`, {
        isH264,
        isSupportedFormat,
        videoCodec,
        videoFormat
      });
      
      // Update video status with more specific error message
      const errorMessage = !isH264 
        ? `Unsupported video codec: ${videoCodec}. Only H.264 is supported.`
        : `Unsupported video format: ${videoFormat}. Only MP4 and MOV containers are supported.`;
      
      await updateVideoStatus(videoIndex, videoId, 'error', {
        error: errorMessage
      });
    }
    
    return isValid;
  } catch (error) {
    console.error('Error validating video for Rekognition:', error);
    throw error;
  }
}

async function handleSNSEvent(event: SNSEvent): Promise<LambdaResponse> {
  const message = JSON.parse(event.Records[0].Sns.Message);
  const jobId = message.JobId;
  const status = message.Status;
  // e.g. RawVideos/2025-02-27/indexId/videoId/videoFileName
  const videoId = message.Video.S3ObjectName.split('/')[3];
  const videoIndex = message.Video.S3ObjectName.split('/')[2];

  console.log('Processing Rekognition notification for job type:', message.API, 'jobId:', jobId, 'status:', status, 'videoIndex:', videoIndex, 'videoId:', videoId, 'message:', message);

  try {
    if (status === 'SUCCEEDED') {
      // Get job results based on job type
      if (message.API === 'StartSegmentDetection') {
        const segments = await getSegmentDetectionResults(jobId);
        await sendSegmentSlicingRequest(videoIndex, videoId, segments);
      } else if (message.API === 'StartLabelDetection') {
        const labels = await getLabelDetectionResults(jobId);
        await updateVideoLabels(videoIndex, videoId, labels);
      } else if (message.API === 'StartFaceDetection') {
        const faces = await getFaceDetectionResults(jobId);
        await updateVideoFaces(videoIndex, videoId, faces);
      }
    } else if (status === 'FAILED') {
      await updateVideoStatus(videoIndex, videoId, 'error', {
        error: message.StatusMessage
      });
    }

  } catch (error) {
    console.error('Error in handle Rekognition notification for job type:', message.API, 'jobId:', jobId, 'error message:', error, 'videoId:', videoId, 'message:', message);
    return {
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }

  return {
    statusCode: STATUS_CODES.OK,
    headers: corsHeaders,
    body: JSON.stringify({ message: 'Processed Rekognition notification' })
  };
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
      segmentNumber // Use the sequential segment number instead of messageId
    );
    
    if (slicedSegments) {
      await updateVideoSegments(videoIndex, videoId, [slicedSegments]);
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
      // If the pending count is zero or negative, all segments have been processed and we can proceed with embedding
      if (pendingCount !== undefined && pendingCount <= 0) {
        console.log(`All segments for video ${videoId} have been processed, setting video_embed_completed flag`);
        
        // Set the completion flag
        await withRetry(
          async () => docClient.send(new UpdateCommand({
            TableName: process.env.INDEXES_TABLE,
            Key: { 
              indexId: videoIndex,
              videoId 
            },
            UpdateExpression: "SET video_status = :status, video_embed_completed = :completed",
            ExpressionAttributeValues: {
              ":status": "ready_for_video_embed",
              ":completed": true
            }
          })),
          3,
          `Set video embedding completion flag`
        );
        
        console.log(`Successfully set video_embed_completed flag for video ${videoId} in index ${videoIndex}`);
      } else {
        console.log(`Still ${pendingCount} segments remaining to process for video ${videoId}`);
      }
    } catch (err) {
      console.error(`Error updating segment counter for video ${videoId}:`, err);
      // Continue processing - don't fail the function just because counter update failed
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

    // Use update operation with document ID instead of updateByQuery
    await openSearch.update({
      index: videoIndex,
      id: documentId,
      body: {
        doc: {
          video_status: status,
          ...additionalFields,
          updated_at: new Date().toISOString()
        }
      }
    });
  } catch (error) {
    console.error(`Error updating status for video ${videoId} in index ${videoIndex}:`, error);
    throw error;
  }
}

async function sendSegmentSlicingRequest(videoIndex: string, videoId: string, segments: SegmentDetection[]): Promise<void> {
  // Send a message to the video slicing queue per segment
  const queueUrl = process.env.VIDEO_SLICING_QUEUE_URL;
  if (!queueUrl) {
    throw new Error('VIDEO_SLICING_QUEUE_URL is not set');
  }
  
  // Search for the video by video_id instead of getting it directly by ID
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
    return sendSegmentSlicingRequest(videoIndex, videoId, segments);
  }

  // Extract video metadata from the search result
  const videoMetadata = searchResult.hits.hits[0]._source;

  // The video_s3_path is in format `RawVideos/${timestamp}/${videoIndex}/${videoId}/${sanitizedFileName}`
  const originalVideoKey = videoMetadata.video_s3_path;
  if (!originalVideoKey) {
    console.warn('Original video path not found for video:', videoId);
    return;
  }

  // Sort segments by start time to ensure they're processed in chronological order
  const sortedSegments = [...segments].sort((a, b) => 
    (a.StartTimestampMillis || 0) - (b.StartTimestampMillis || 0)
  );

  console.log('Sorted segments: ', sortedSegments, '\nlength: ', sortedSegments.length);
  // Initialize a counter for pending segment embeddings in DynamoDB
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
        ":status": "ready_for_shots",
        ":video_shots_completed": true,
        ":count": totalSegmentsCount
      }
    })),
    3,
    `Initialize pending segments count to ${totalSegmentsCount}`
  );
  
  // Send a message to the video slicing queue per segment with sequential segment numbers
  for (let i = 0; i < sortedSegments.length; i++) {
    const segment = sortedSegments[i];
    const segmentNumber = i + 1; // Start from 1 for human readability
    
    // Check if we're using a FIFO queue
    const isFifoQueue = queueUrl.endsWith('.fifo');
    
    // Create the base command parameters
    const commandParams: any = {
      QueueUrl: queueUrl,
      MessageBody: JSON.stringify({ 
        videoIndex, 
        videoId, 
        segment, 
        originalVideoKey,
        segmentNumber,
        totalSegments: totalSegmentsCount // Include total segments count
      })
    };
    
    // Add FIFO-specific attributes if needed
    if (isFifoQueue) {
      // Create multiple message groups for better parallelism
      // This distributes processing across different message groups
      // We'll create 10 message groups per video to allow parallel processing
      const groupNumber = segmentNumber % 10; // Split into 10 groups (0-9)
      
      commandParams.MessageGroupId = `${videoId}-group-${groupNumber}`; // Distribute across groups
      commandParams.MessageDeduplicationId = `${videoId}-segment-${segmentNumber}-${Date.now()}`; // Ensure uniqueness with timestamp
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
  segment: SegmentDetection,
  originalVideoKey: string,
  bucketName: string,
  segmentNumber: number
): Promise<VideoSegment | null> {
  try {
    console.log(`Processing segment detection for video ${videoId} in index ${videoIndex}, segment number: ${segmentNumber}, segment: ${JSON.stringify(segment)}, originalVideoKey: ${originalVideoKey} and bucketName: ${bucketName}`);
    // Check if the segments are already processed
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
    
    // Create the output path for the sliced video, use the sanitized file name from the original video, in format `ProcessedVideos/${timestamp}/${videoIndex}/${videoId}/segments/sanitizedFileNameWithIndex`, e.g. the originalVideoKey is `RawVideos/2025-02-27/kyiamzn/bc4d6c51-0238-484c-9c8a-81a605e08774/VoC05.mp4`, the segmentVideoS3Path is `ProcessedVideos/2025-02-27/kyiamzn/bc4d6c51-0238-484c-9c8a-81a605e08774/segments/VoC05_001.mp4` and the keyframe is `ProcessedVideos/2025-02-27/kyiamzn/bc4d6c51-0238-484c-9c8a-81a605e08774/segments/VoC05_001.jpg`
    const segmentVideoS3Path = (() => {
      // Extract components from original key
      const [_, timestamp, indexId, vidId, filename] = originalVideoKey.split('/');
      
      // Split filename into name and extension
      const [name, ext] = filename.split('.');
      
      // Create segment number with padding (001, 002, etc.)
      const paddedSegmentNum = String(segmentNumber).padStart(3, '0');
      
      // Construct new key with same structure but under ProcessedVideos
      return [`ProcessedVideos/${timestamp}/${indexId}/${vidId}/segments/${name}_${paddedSegmentNum}.${ext}`, 
              `ProcessedVideos/${timestamp}/${indexId}/${vidId}/segments/${name}_${paddedSegmentNum}.jpg`];
    })();
    
    // Use FFmpeg to slice the video and extract keyframes
    const localInputPath = `/tmp/${videoId}_input.mp4`;
    const localOutputPath = `/tmp/${videoId}_segment_${segmentNumber}.mp4`;
    const localKeyframePath = `/tmp/${videoId}_keyframe_${segmentNumber}.jpg`;

    // Define ffmpeg path explicitly - it's in the Lambda layer
    const ffmpegPath = process.env.LAMBDA_TASK_ROOT ? '/opt/bin/ffmpeg' : 'ffmpeg';
    
    // Ensure ffmpeg exists and has execute permissions
    try {
      // Use child_process.exec to check if ffmpeg is executable
      const { exec } = require('child_process');
      await new Promise((resolve, reject) => {
        exec(`${ffmpegPath} -version`, (error: any, stdout: any, stderr: any) => {
          if (error) {
            console.error(`Error checking ffmpeg: ${error}`);
            console.error(`stderr: ${stderr}`);
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

    // Use FFmpeg to download, slice the video, and extract keyframe
    try {
      // First, download the original video to a local file
      console.log(`Downloading video from S3 to ${localInputPath}`);
      const response = await s3.send(new GetObjectCommand({
        Bucket: bucketName,
        Key: originalVideoKey
      }));
      
      if (response.Body) {
        // Convert the response body to a buffer and write to file
        const buf = Buffer.from(await response.Body.transformToByteArray());
        fs.writeFileSync(localInputPath, buf);
        // console.log(`Downloaded video file, size: ${buf.length} bytes`);
      } else {
        throw new Error('Empty response body from S3');
      }

      // Now slice the video using the downloaded file
      await new Promise<void>((resolve, reject) => {
        const startTimeSeconds = slicedSegment.start_time / 1000;
        const durationSeconds = slicedSegment.duration / 1000;
        
        // Choose preset based on segment duration
        // For longer segments, use a faster preset to prevent Lambda timeouts
        // For shorter segments, we can afford better quality
        const preset = durationSeconds > 20 ? 'veryfast' : 'medium';
        
        console.log(`Running ffmpeg to slice video and re-encode to H.264 (preset: ${preset}): ${ffmpegPath} -ss ${startTimeSeconds} -i ${localInputPath} -t ${durationSeconds} -c:v libx264 -preset ${preset} -crf 23 -c:a aac -b:a 128k -y ${localOutputPath}`);
        
        // Use FFmpeg to slice the video from local file and re-encode to H.264
        const ffmpegProcess = spawn(ffmpegPath, [
          '-ss', startTimeSeconds.toString(),
          '-i', localInputPath,
          '-t', durationSeconds.toString(),
          '-c:v', 'libx264',  // Encode to H.264
          '-preset', preset,  // Dynamic preset based on segment duration
          '-crf', '23',       // Constant Rate Factor for quality control (lower is better quality, 23 is default)
          '-c:a', 'aac',      // Re-encode audio to AAC
          '-b:a', '128k',     // Audio bitrate
          '-y',               // Overwrite output file
          localOutputPath
        ]);

        // Capture and log ffmpeg output
        // ffmpegProcess.stdout.on('data', (data) => {
        //   console.log(`ffmpeg stdout: ${data}`);
        // });

        // ffmpegProcess.stderr.on('data', (data) => {
        //   console.log(`ffmpeg stderr: ${data}`);
        // });

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

      // Then extract a keyframe from the middle of the segment
      await new Promise<void>((resolve, reject) => {
        console.log(`Extracting keyframe: ${ffmpegPath} -i ${localOutputPath} -ss 0 -frames:v 1 -q:v 2 -y ${localKeyframePath}`);
        
        // Extract a keyframe from the beginning of the slice
        const keyframeProcess = spawn(ffmpegPath, [
          '-i', localOutputPath,
          '-ss', '0',  // Start from the beginning of the slice
          '-frames:v', '1',  // Extract just one frame
          '-q:v', '2',  // High quality
          '-y',
          localKeyframePath
        ]);

        // Capture and log ffmpeg output
        // keyframeProcess.stdout.on('data', (data) => {
        //   console.log(`keyframe ffmpeg stdout: ${data}`);
        // });

        // keyframeProcess.stderr.on('data', (data) => {
        //   console.log(`keyframe ffmpeg stderr: ${data}`);
        // });

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
      
      // Get a signed URL for the keyframe
      const keyframeCommand = new GetObjectCommand({
        Bucket: bucketName,
        Key: segmentVideoS3Path[1]
      });
      const keyframeSignedUrl = await getSignedUrl(s3 as any, keyframeCommand as any, { expiresIn: 3600 });

      // Get a signed URL for the segment
      const segmentCommand = new GetObjectCommand({
        Bucket: bucketName,
        Key: segmentVideoS3Path[0]
      });
      const segmentSignedUrl = await getSignedUrl(s3 as any, segmentCommand as any, { expiresIn: 3600 });

      console.log(`Successfully uploaded segment ${segmentNumber} and keyframe to S3`);

      // Clean up local files
      try {
        fs.unlinkSync(localInputPath);
        fs.unlinkSync(localOutputPath);
        fs.unlinkSync(localKeyframePath);
        console.log(`Cleaned up temporary files`);
      } catch (cleanupError) {
        console.warn(`Warning: Failed to clean up some temporary files:`, cleanupError);
      }

      // Add the segment to our results
      slicedSegment.segment_video_s3_path = segmentVideoS3Path[0];
      slicedSegment.segment_video_thumbnail_s3_path = segmentVideoS3Path[1];
      slicedSegment.segment_video_preview_url = segmentSignedUrl;
      slicedSegment.segment_video_thumbnail_url = keyframeSignedUrl;
      slicedSegment.segment_visual = {
        segment_visual_description: segment.ShotSegment ? 'Shot boundary detected' : 'Technical cue detected',
      };

      // Check if the embedding service is running
      try {
        await ensureEmbeddingServiceRunning();
        console.log('Embedding service is running, and generating embedding for the segment ', segmentVideoS3Path[0], ' in bucket ', bucketName);
        // Generate embedding for the segment
        const embedding = await generateEmbedding(bucketName, segmentVideoS3Path[0]);
        if (embedding) {
          console.log('Successfully generated embedding for the segment ', segmentVideoS3Path[0], ' in bucket ', bucketName);
          slicedSegment.segment_visual.segment_visual_embedding = embedding;
        } else {
          console.error('Failed to generate embedding for the segment ', segmentVideoS3Path[0], ' in bucket ', bucketName);
        }
      } catch (error) {
        console.error('Error ensuring embedding service is running:', error);
      }

      return slicedSegment;
    } catch (error) {
      console.error(`Error processing video segment ${segmentNumber}:`, error);
      // Continue with the next segment even if this one fails, but note since we set the batch size to 1, there is only one message in the batch
      return null;
    }
  } catch (error) {
    console.error('Error processing video segments:', error);
    throw error;
  }
}

// Function to check if the embedding service is running and start it if not
async function ensureEmbeddingServiceRunning(): Promise<void> {
  try {
    // Try to ping the embedding service
    const response = await fetch(`${EXTERNAL_EMBEDDING_ENDPOINT}/health`, {
      method: 'GET',
    });
    
    // The response is a json object with the status field:
    // ```json
    // {
    //   "status": "healthy"
    // }
    // ```
    const data = await response.json() as { status: string };
    if (data.status === 'healthy') {
      console.log('Embedding service is already running');
      return;
    }
    console.error('Embedding service is not running, please start it');
  } catch (error) {
    console.error('Error checking embedding service status:', error);
  }
}

// Function to generate embedding using the embedding service
async function generateEmbedding(bucket: string, key: string): Promise<number[]> {
  console.log('Generating embedding for video in bucket ', bucket, ' and key ', key);
  // First try the external embedding endpoint if available
  if (EXTERNAL_EMBEDDING_ENDPOINT) {
    try {
      console.log(`Using external embedding endpoint: ${EXTERNAL_EMBEDDING_ENDPOINT}`);
      const response = await fetch(`${EXTERNAL_EMBEDDING_ENDPOINT}/embed-video`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        // Follow the format of the internal embedding service, using schema below:
        // ```json
        // {
        //   "bucket": "your-s3-bucket",
        //   "key": "path/to/video.mp4"
        // }
        // ```
        body: JSON.stringify({ bucket, key }),
      });

      // The response is a json object with the embedding field:
      // ```json
      // {
      //   "embedding": [...]
      // }
      // ```
      const data = await response.json() as { embedding: number[] };
      console.log(`Successfully generated embedding using external service for ${key}`);
      return data.embedding;
    } catch (error) {
      console.error('Error calling external embedding service:', error);
      // Fall back to internal service
      return [];
    }
  }
  
  console.log('No external embedding service available, falling back to internal embedding service');
  // Fall back to internal embedding service
  try {
    const response = await fetch(`${EMBEDDING_SERVICE_URL}/embed-video`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ bucket, key }),
    });

    // The response is a json object with the embedding field:
    // ```json
    // {
    //   "embedding": [...]
    // }
    // ```
    const data = await response.json() as { embedding: number[] };
    console.log(`Successfully generated embedding using internal service for ${key}`);
    return data.embedding;
  } catch (error) {
    console.error('Error calling internal embedding service:', error);
    return [];
  }
}

async function getSegmentDetectionResults(jobId: string): Promise<SegmentDetection[]> {
  // Refer to https://docs.aws.amazon.com/rekognition/latest/dg/segment-api.html for the response format
  const segments: SegmentDetection[] = [];
  let nextToken: string | undefined;

  do {
    const response = await rekognition.send(new GetSegmentDetectionCommand({
      JobId: jobId,
      NextToken: nextToken
    }));

    if (response.Segments) {
      segments.push(...response.Segments);
    }
    nextToken = response.NextToken;
  } while (nextToken);

  return segments;
}

/**
 * Utility function to perform OpenSearch operations with retry logic
 * @param operation Function that performs the OpenSearch operation
 * @param maxRetries Maximum number of retry attempts
 * @param operationName Name of the operation for logging
 * @returns Result of the operation
 */
async function withRetry<T>(
  operation: () => Promise<T>,
  // increase maxRetries to 5 since we're using OpenSearch Serverless which the refresh: true is not supported, refer to https://repost.aws/community/users/USiotOGJ78So2L1_DskJDcgQ
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

async function updateVideoSegments(videoIndex: string, videoId: string, segments: VideoSegment[]): Promise<void> {
  console.log('Segments to update: ', segments, '\nwith embedding: ', segments.map(s => s.segment_visual?.segment_visual_embedding), '\ntype: ', typeof segments[0].segment_visual?.segment_visual_embedding, '\nlength: ', segments.map(s => s.segment_visual?.segment_visual_embedding?.length));
  
  try {
    // First search for the document to get the OpenSearch document ID and existing segments
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
      return updateVideoSegments(videoIndex, videoId, segments);
    }

    console.log(`video segments updated search result for video ${videoId} in index ${videoIndex}:`, searchResult.hits.hits[0]);

    // Get the OpenSearch document ID and existing document
    const documentId = searchResult.hits.hits[0]._id;
    const existingDoc = searchResult.hits.hits[0]._source;
    
    // Initialize or merge the segments
    const existingSegments = existingDoc.video_segments || [];
    const updatedSegments = [...existingSegments];
    
    // Add new segments, there is only one segment in the segments array
    for (const segment of segments) {
      updatedSegments.push({
        ...segment,
        segment_id: segment.segment_id || `unassigned_segment_id`,
        // Update the embedding field if it exists
        segment_visual: {
          ...segment.segment_visual,
          segment_visual_embedding: segment.segment_visual?.segment_visual_embedding || []
        }
      });
    }

    // Use standard update operation with document ID, TODO: insert the segments into existing segments instead of update since the refresh: true is not supported in the aoss and the video_segement can be stale and new updates will be overwritten, and the segment_count should be accumulated instead of updated
    try {
      await openSearch.update({
        index: videoIndex,
        id: documentId,
        body: {
          script: {
            source: `
              // Initialize video_segments array if null
              if (ctx._source.video_segments == null) {
                ctx._source.video_segments = [];
              }
              
              // Add each new segment to the array
              for (int i = 0; i < params.newSegments.length; i++) {
                ctx._source.video_segments.add(params.newSegments[i]);
              }
              
              // Update the segment count and status
              ctx._source.segment_count = ctx._source.video_segments.length;
              ctx._source.video_status = params.video_status;
              ctx._source.updated_at = params.updated_at;
            `,
            params: {
              newSegments: segments.map(segment => ({
                ...segment,
                segment_id: segment.segment_id || `unassigned_segment_id`,
                segment_visual: {
                  ...segment.segment_visual,
                  segment_visual_embedding: segment.segment_visual?.segment_visual_embedding || []
                }
              })),
              video_status: 'ready_for_shots',
              updated_at: new Date().toISOString(),
            }
          }
        }
      });
      console.log(`Successfully updated segments for video ${videoId} in index ${videoIndex}`);
    } catch (updateError) {
      console.error(`Error during script update for video ${videoId}:`, updateError);
    }
  } catch (error) {
    console.error(`Error updating video segments for video ${videoId} in index ${videoIndex}:`, error);
    throw error;
  }
}

async function getLabelDetectionResults(jobId: string): Promise<any[]> {
  // Refer to https://docs.aws.amazon.com/rekognition/latest/dg/labels-detecting-labels-video.html for the response format
  const labels: any[] = [];
  let nextToken: string | undefined;

  do {
    const response = await rekognition.send(new GetLabelDetectionCommand({
      JobId: jobId,
      NextToken: nextToken,
      SortBy: 'TIMESTAMP'
    }));

    if (response.Labels) {
      labels.push(...response.Labels);
    }
    nextToken = response.NextToken;
  } while (nextToken);

  return labels;
}

async function updateVideoLabels(videoIndex: string, videoId: string, labels: any[]): Promise<void> {
  try {
    // First get existing video metadata using search instead of direct ID get
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
      return updateVideoLabels(videoIndex, videoId, labels);
    }

    console.log(`video labels updated search result for video ${videoId} in index ${videoIndex}:`, searchResult.hits.hits[0]);
    const documentId = searchResult.hits.hits[0]._id;
    
    // Define types for better TypeScript support
    interface LabelInfo {
      name: string;
      categories: any[];
      aliases: any[];
      parents: any[];
      confidence: number;
      instances: Array<{
        boundingBox: any;
        confidence: number;
      }>;
    }
    
    interface TimestampedLabels {
      [timestamp: string]: LabelInfo[];
    }

    // Organize labels by timestamp to match the Rekognition structure
    const labelsByTimestamp: TimestampedLabels = {};
    labels.forEach(label => {
      const timestamp = label.Timestamp.toString();
      if (!labelsByTimestamp[timestamp]) {
        labelsByTimestamp[timestamp] = [];
      }
      labelsByTimestamp[timestamp].push({
        name: label.Label.Name,
        categories: label.Label.Categories || [],
        aliases: label.Label.Aliases || [],
        parents: label.Label.Parents || [],
        // Confidence is a float, convert to number
        confidence: label.Label.Confidence,
        instances: label.Label.Instances?.map((instance: any) => ({
          boundingBox: instance.BoundingBox,
          confidence: instance.Confidence
        })) || []
      });
    });

    // Convert to array structure for easier processing in OpenSearch
    const formattedLabels = Object.entries(labelsByTimestamp).map(([timestamp, labelArray]: [string, LabelInfo[]]) => ({
      timestamp: parseInt(timestamp),
      labels: labelArray
    }));

    // Use script-based update for AOSS compatibility
    await openSearch.update({
      index: videoIndex,
      id: documentId,
      body: {
        script: {
          source: `
            // Set video_objects with our formatted label structure
            ctx._source.video_objects = params.formattedLabels;
            ctx._source.video_status = params.video_status;
            ctx._source.updated_at = params.updated_at;
          `,
          params: {
            formattedLabels: formattedLabels,
            video_status: "ready_for_object",
            updated_at: new Date().toISOString()
          }
        }
      }
    });
    console.log(`Successfully updated video labels for video ${videoId} in index ${videoIndex}`);

    // Use UpdateCommand to update only specific attributes, also update video_objects_completed flag to true
    await withRetry(
      async () => docClient.send(new UpdateCommand({
        TableName: process.env.INDEXES_TABLE,
        Key: { 
          indexId: videoIndex,
          videoId 
        },
        UpdateExpression: "SET video_status = :status, video_objects_completed = :video_objects_completed",
        ExpressionAttributeValues: {
          ":status": "ready_for_object",
          ":video_objects_completed": true
        }
      })),
      3,
      `Update indexes table with status ready_for_object`
    );

  } catch (error) {
    console.error(`Error updating video labels for video ${videoId}:`, error);
    throw error;
  }
}

async function getFaceDetectionResults(jobId: string): Promise<any[]> {
  // Refer to https://docs.aws.amazon.com/rekognition/latest/dg/faces-sqs-video.html for the response format
  const faces: any[] = [];
  let nextToken: string | undefined;

  do {
    const response = await rekognition.send(new GetFaceDetectionCommand({
      JobId: jobId,
      NextToken: nextToken
    }));

    if (response.Faces) {
      faces.push(...response.Faces);
    }
    nextToken = response.NextToken;
  } while (nextToken);

  return faces;
}

async function updateVideoFaces(videoIndex: string, videoId: string, faces: any[]): Promise<void> {
  try {
    // First get existing video metadata using search instead of direct ID get
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
      return updateVideoFaces(videoIndex, videoId, faces);
    }

    console.log(`video faces updated search result for video ${videoId} in index ${videoIndex}:`, searchResult.hits.hits[0]);
    const documentId = searchResult.hits.hits[0]._id;
    const existingVideo = searchResult.hits.hits[0]._source;

    // Update the video_faces field with enhanced face data
    existingVideo.video_faces = faces.map(face => {
      // Map bounding box with appropriate casing
      const boundingBox = {
        left: face.Face.BoundingBox?.Left || 0,
        top: face.Face.BoundingBox?.Top || 0,
        width: face.Face.BoundingBox?.Width || 0,
        height: face.Face.BoundingBox?.Height || 0
      };

      // Map landmarks if present
      const landmarks = face.Face.Landmarks?.map((landmark: any) => ({
        type: landmark.Type.toLowerCase(),
        x: landmark.X,
        y: landmark.Y
      }));

      // Map pose if present
      const pose = face.Face.Pose ? {
        pitch: face.Face.Pose.Pitch,
        roll: face.Face.Pose.Roll,
        yaw: face.Face.Pose.Yaw
      } : undefined;

      // Map quality if present
      const quality = face.Face.Quality ? {
        brightness: face.Face.Quality.Brightness,
        sharpness: face.Face.Quality.Sharpness
      } : undefined;

      // Return complete face detection object
      return {
        confidence: face.Face.Confidence,
        bounding_box: boundingBox,
        landmarks: landmarks,
        pose: pose,
        quality: quality,
        timestamp: face.Timestamp
      };
    });

    // Use standard update with document ID instead of updateByQuery
    await openSearch.update({
      index: videoIndex,
      id: documentId,
      body: {
        doc: existingVideo
      }
    });
    console.log(`Successfully updated video faces for video ${videoId} in index ${videoIndex}`);

    // Use UpdateCommand to update only specific attributes, also update video_faces_completed flag to true
    await withRetry(
      async () => docClient.send(new UpdateCommand({
        TableName: process.env.INDEXES_TABLE,
        Key: { 
          indexId: videoIndex,
          videoId 
        },
        UpdateExpression: "SET video_status = :status, video_faces_completed = :video_faces_completed",
        ExpressionAttributeValues: {
          ":status": "ready_for_face",
          ":video_faces_completed": true
        }
      })),
      3,
      `Update indexes table with status ready_for_face`
    );

  } catch (error) {
    console.error(`Error updating video faces for video ${videoId}:`, error);
    throw error;
  }
}
