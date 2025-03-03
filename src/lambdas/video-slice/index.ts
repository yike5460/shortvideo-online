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
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
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

const rekognition = new RekognitionClient({});
const sqs = new SQSClient({});
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

const STATUS_CODES = {
  OK: 200,
  CREATED: 201,
  BAD_REQUEST: 400,
  NOT_FOUND: 404,
  INTERNAL_SERVER_ERROR: 500
};

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
      return handleVideoSlicingEvent(event as unknown as SQSEvent);
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
  if (!key.startsWith('RawVideos/')) {
    process.stdout.write('Skipping non-raw video file: ' + key + '\n');
    return {
      statusCode: STATUS_CODES.OK,
      headers: corsHeaders,
      body: JSON.stringify({ message: 'Skipped non-raw video file' })
    };
  }

  // The s3Key format is `RawVideos/${timestamp}/${videoIndex}/${videoId}/${sanitizedFileName}`
  const videoIndex = key.split('/')[2];
  const videoId = key.split('/').pop()?.split('.')[0];

  if (!videoId) throw new Error('Invalid video key format');

  // TODO, we need to do video valiation according to the Amazon Rekognition restriction: https://docs.aws.amazon.com/rekognition/latest/dg/video.html, e.g. The video must be encoded using the H.264 codec. The supported file formats are MPEG-4 and MOV.

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
    MinConfidence: 80
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
        // const slicedSegments = await processSegmentDetection(videoIndex, videoId, segments);
        // await updateVideoSegments(videoIndex, videoId, slicedSegments);
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

async function handleVideoSlicingEvent(event: SQSEvent): Promise<LambdaResponse> {
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
  await openSearch.update({
    index: videoIndex,
    id: videoId,
    body: {
      doc: {
        video_status: status,
        ...additionalFields,
        updated_at: new Date().toISOString()
      }
    }
  });
}

async function sendSegmentSlicingRequest(videoIndex: string, videoId: string, segments: SegmentDetection[]): Promise<void> {
  // Send a message to the video slicing queue per segment
  const queueUrl = process.env.VIDEO_SLICING_QUEUE_URL;
  if (!queueUrl) {
    throw new Error('VIDEO_SLICING_QUEUE_URL is not set');
  }
  
  // Get the original video (video_s3_path) from OpenSearch
  const { body: videoMetadata } = await openSearch.get({
    index: videoIndex,
    id: videoId
  });

  if (!videoMetadata || !videoMetadata.found) {
    console.warn('Video metadata not found for video:', videoId);
    return;
  }

  // The video_s3_path is in format `RawVideos/${timestamp}/${videoIndex}/${videoId}/${sanitizedFileName}`
  const originalVideoKey = videoMetadata._source.video_s3_path;
  if (!originalVideoKey) {
    console.warn('Original video path not found for video:', videoId);
    return;
  }

  // Sort segments by start time to ensure they're processed in chronological order
  const sortedSegments = [...segments].sort((a, b) => 
    (a.StartTimestampMillis || 0) - (b.StartTimestampMillis || 0)
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
        segmentNumber
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

    // Download the video segment from S3
    const command = new GetObjectCommand({
      Bucket: bucketName,
      Key: originalVideoKey
    });

    // Get a signed URL for the original video
    const signedUrl = await getSignedUrl(s3 as any, command as any, { expiresIn: 3600 });
    
    // console.log(`Generated signed URL for video: ${signedUrl.substring(0, 100)}...`);

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
      slicedSegment.video_s3_path = segmentVideoS3Path[0];
      slicedSegment.segment_visual = {
        segment_visual_description: segment.ShotSegment ? 'Shot boundary detected' : 'Technical cue detected',
        segment_visual_keyframe_path: segmentVideoS3Path[1],
      };

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

async function updateVideoSegments(videoIndex: string, videoId: string, segments: VideoSegment[]): Promise<void> {
  // First get existing video metadata
  const { body: existingVideo } = await openSearch.get({
    index: videoIndex,
    id: videoId
  });

  console.log('Existing video metadata before updating segments from Rekognition: ', existingVideo);

  // Update video metadata with new segments and status
  await openSearch.update({
    index: videoIndex,
    id: videoId,
    body: {
      doc: {
        video_status: 'ready_for_shots' as VideoStatus,
        // video_segments: segments,
        segment_count: segments.length,
        updated_at: new Date().toISOString(),
        // Update the each segment within the segments array with segment_id
        video_segments: segments.map(s => ({
          ...s,
          segment_id: s.segment_id || `unassigned_segment_id`
        }))
      }
    }
  });
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
  // First get existing video metadata
  const { body: existingVideo } = await openSearch.get({
    index: videoIndex,
    id: videoId
  });

  const processedSegments: VideoSegment[] = labels.map((label, index) => ({
    // segment_id: `${videoId}_label_${index}`,  it should be updated once in segment detection
    video_id: videoId,
    start_time: label.Timestamp,
    end_time: label.Timestamp + 1000, // Assume 1 second duration
    duration: 1000,
    segment_visual: {
      segment_visual_objects: [{
        label: label.Label.Name,
        confidence: label.Label.Confidence,
        bounding_box: label.Label.BoundingBox || { left: 0, top: 0, width: 0, height: 0 }
      }],
      segment_visual_description: `Detected ${label.Label.Name}`
    }
  }));

  // Merge with existing segments
  const allSegments = [...(existingVideo._source.video_segments || []), ...processedSegments];

  await openSearch.update({
    index: videoIndex,
    id: videoId,
    body: {
      doc: {
        video_status: 'ready_for_object' as VideoStatus,
        video_segments: allSegments,
        updated_at: new Date().toISOString()
      }
    }
  });
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
  // First get existing video metadata
  const { body: existingVideo } = await openSearch.get({
    index: videoIndex,
    id: videoId
  });

  const processedSegments: VideoSegment[] = faces.map((face, index) => ({
    // segment_id: `${videoId}_face_${index}`,  it should be updated once in segment detection
    video_id: videoId,
    start_time: face.Timestamp,
    end_time: face.Timestamp + 1000, // Assume 1 second duration
    duration: 1000,
    segment_visual: {
      segment_visual_faces: [{
        confidence: face.Face.Confidence,
        bounding_box: face.Face.BoundingBox,
        person_name: undefined // Can be updated later with face recognition
      }],
      segment_visual_description: 'Face detected'
    }
  }));

  // Merge with existing segments
  const allSegments = [...(existingVideo._source.video_segments || []), ...processedSegments];

  await openSearch.update({
    index: videoIndex,
    id: videoId,
    body: {
      doc: {
        video_status: 'ready_for_face' as VideoStatus,
        video_segments: allSegments,
        updated_at: new Date().toISOString()
      }
    }
  });
} 