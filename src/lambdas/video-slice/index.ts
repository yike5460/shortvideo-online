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

export const handler = async (event: S3Event | SNSEvent, _context: LambdaContext): Promise<LambdaResponse> => {
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
  // e.g. RawVideos/2025-02-27/kyiamzn/bc4d6c51-0238-484c-9c8a-81a605e08774/VoC05.mp4
  const videoId = message.Video.S3ObjectName.split('/')[3];
  const videoIndex = message.Video.S3ObjectName.split('/')[2];

  console.log('Processing Rekognition notification for job type:', message.API, 'jobId:', jobId, 'status:', status, 'videoIndex:', videoIndex, 'videoId:', videoId, 'message:', message);
  console.log('Video information before processing:', await openSearch.get({index: videoIndex, id: videoId}));

  try {
    if (status === 'SUCCEEDED') {
      // Get job results based on job type
      if (message.API === 'StartSegmentDetection') {
        const segments = await getSegmentDetectionResults(jobId);
        const slicedSegments = await processSegmentDetection(videoIndex, videoId, segments);
        await updateVideoSegments(videoIndex, videoId, slicedSegments);
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

    // Display the video information in aoss for debugging
    const fullVideoMetadata = await openSearch.get({
      index: videoIndex,
      id: videoId
    });
    console.log('Video information after processing:', fullVideoMetadata);
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

async function processSegmentDetection(videoIndex: string, videoId: string, segments: SegmentDetection[]): Promise<VideoSegment[]> {
  try {
    // 1. Check if the segments are already processed
    if (!segments || segments.length === 0) {
      console.log('No segments detected for video:', videoId);
      return [];
    }
    
    // 2. Get the original video (video_s3_path) from OpenSearch
    const { body: videoMetadata } = await openSearch.get({
      index: videoIndex,
      id: videoId
    });
    if (!videoMetadata) {
      console.log('Video metadata not found for video:', videoId);
      return [];
    }
    // The video_s3_path is in format `RawVideos/${timestamp}/${videoIndex}/${videoId}/${sanitizedFileName}`
    const originalVideoKey = videoMetadata.video_s3_path;
    if (!originalVideoKey) {
      console.log('Original video path not found for video:', videoId);
      return [];
    }
    
    // 3. For each segment, create a slice and store it in the appropriate S3 location
    const slicedSegments: VideoSegment[] = [];
    
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      const segmentId = `${videoId}_segment_${i + 1}`;
      const startTime = segment.StartTimestampMillis || 0;
      const endTime = segment.EndTimestampMillis || 0;
      const duration = segment.DurationMillis || 0;
      
      // Skip very short segments (less than 1 second)
      if (duration < 1000) {
        console.log(`Skipping short segment ${segmentId} with duration ${duration}ms`);
        continue;
      }
      
      // Create the output path for the sliced video, use the sanitized file name from the original video, in format `ProcessedVideos/${timestamp}/${videoIndex}/${videoId}/segments/sanitizedFileNameWithIndex`, e.g. the originalVideoKey is `RawVideos/2025-02-27/kyiamzn/bc4d6c51-0238-484c-9c8a-81a605e08774/VoC05.mp4`, the segmentVideoS3Path is `ProcessedVideos/2025-02-27/kyiamzn/bc4d6c51-0238-484c-9c8a-81a605e08774/segments/VoC05_001.mp4` and the keyframe is `ProcessedVideos/2025-02-27/kyiamzn/bc4d6c51-0238-484c-9c8a-81a605e08774/segments/VoC05_001.jpg`
      const segmentVideoS3Path = (() => {
        // Extract components from original key
        const [_, timestamp, indexId, vidId, filename] = originalVideoKey.split('/');
        
        // Split filename into name and extension
        const [name, ext] = filename.split('.');
        
        // Create segment number with padding
        const segmentNum = String(i + 1).padStart(3, '0');
        
        // Construct new key with same structure but under ProcessedVideos
        return [`ProcessedVideos/${timestamp}/${indexId}/${vidId}/segments/${name}_${segmentNum}.${ext}`, `ProcessedVideos/${timestamp}/${indexId}/${vidId}/segments/${name}_${segmentNum}.jpg`];
      })();
      
      // Use FFmpeg to slice the video and extract keyframes
      const bucket = process.env.VIDEO_BUCKET_NAME;
      const localInputPath = `/tmp/${videoId}_input.mp4`;
      const localOutputPath = `/tmp/${videoId}_segment_${i + 1}.mp4`;
      const localKeyframePath = `/tmp/${videoId}_keyframe_${i + 1}.jpg`;

      // Download the video segment from S3
      const command = new GetObjectCommand({
        Bucket: bucket,
        Key: originalVideoKey
      });

      // Get a signed URL for the original video
      const signedUrl = await getSignedUrl(s3 as any, command as any, { expiresIn: 3600 });

      // Use FFmpeg to download, slice the video, and extract keyframe
      try {
        // First, slice the video
        await new Promise<void>((resolve, reject) => {
          const startTimeSeconds = startTime / 1000;
          const durationSeconds = duration / 1000;
          
          // Use FFmpeg to slice the video directly from S3 URL to output file
          const ffmpegProcess = spawn('ffmpeg', [
            '-ss', startTimeSeconds.toString(),
            '-i', signedUrl,
            '-t', durationSeconds.toString(),
            '-c', 'copy',  // Copy codec for faster processing, TODO, re-codec to h264
            '-y',          // Overwrite output file
            localOutputPath
          ]);

          ffmpegProcess.on('close', (code) => {
            if (code === 0) {
              console.log(`Successfully sliced video segment ${i + 1}`);
              resolve();
            } else {
              console.error(`FFmpeg process exited with code ${code}`);
              reject(new Error(`FFmpeg slicing failed with code ${code}`));
            }
          });
        });

        // Then extract a keyframe from the middle of the segment
        await new Promise<void>((resolve, reject) => {
          // Extract a keyframe from the middle of the segment
          const keyframeProcess = spawn('ffmpeg', [
            '-i', localOutputPath,
            '-ss', '0',  // Start from the beginning of the slice
            '-frames:v', '1',  // Extract just one frame
            '-q:v', '2',  // High quality
            '-y',
            localKeyframePath
          ]);

          keyframeProcess.on('close', (code) => {
            if (code === 0) {
              console.log(`Successfully extracted keyframe for segment ${i + 1}`);
              resolve();
            } else {
              console.error(`FFmpeg keyframe process exited with code ${code}`);
              reject(new Error(`FFmpeg keyframe extraction failed with code ${code}`));
            }
          });
        });

        // Upload the segment and keyframe to S3
        await Promise.all([
          s3.send(new PutObjectCommand({
            Bucket: bucket,
            Key: segmentVideoS3Path[0],
            Body: fs.readFileSync(localOutputPath),
            ContentType: 'video/mp4'
          })),
          s3.send(new PutObjectCommand({
            Bucket: bucket,
            Key: segmentVideoS3Path[1],
            Body: fs.readFileSync(localKeyframePath),
            ContentType: 'image/jpeg'
          }))
        ]);

        console.log(`Successfully uploaded segment ${i + 1} and keyframe to S3`);

        // Clean up local files
        fs.unlinkSync(localOutputPath);
        fs.unlinkSync(localKeyframePath);

        // Add the segment to our results
        slicedSegments.push({
          segment_id: segmentId,
          video_id: videoId,
          start_time: startTime,
          end_time: endTime,
          duration: duration,
          video_s3_path: segmentVideoS3Path[0],
          segment_visual: {
            segment_visual_description: segment.ShotSegment ? 'Shot boundary detected' : 'Technical cue detected',
            segment_visual_keyframe_path: segmentVideoS3Path[1]
          }
        });   
      } catch (error) {
        console.error(`Error processing video segment ${i + 1}:`, error);
        // Continue with the next segment even if this one fails
      }
    }
 
    // Now update the video metadata in OpenSearch with the processed segments
    await openSearch.update({
      index: videoIndex,
      id: videoId,
      body: {
        doc: {
          video_status: 'processing_segments_complete' as VideoStatus,
          video_segments: slicedSegments,
          segment_count: slicedSegments.length,
          updated_at: new Date().toISOString()
        }
      }
    });

    console.log(`Updated video metadata in OpenSearch with ${slicedSegments.length} processed segments`);
    return slicedSegments;
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
        video_segments: segments,
        segment_count: segments.length,
        total_duration: Math.max(...segments.map(s => s.end_time)),
        updated_at: new Date().toISOString()
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
    segment_id: `${videoId}_label_${index}`,
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
    segment_id: `${videoId}_face_${index}`,
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