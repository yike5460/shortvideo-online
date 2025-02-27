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
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { Client } from '@opensearch-project/opensearch';
import { defaultProvider } from '@aws-sdk/credential-provider-node';
import { AwsSigv4Signer } from '@opensearch-project/opensearch/aws';
import { S3Event, SNSEvent, SQSEvent } from 'aws-lambda';

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
  const videoId = message.Video.S3ObjectName.split('/').pop()?.split('.')[0];
  const videoIndex = message.Video.S3ObjectName.split('/')[2];
  console.log('Processing Rekognition notification for job type:', message.API, 'jobId:', jobId, 'status:', status, 'videoIndex:', videoIndex, 'videoId:', videoId, 'message:', message);
  console.log('Video information before processing:', await openSearch.get({index: videoIndex, id: videoId}));

  try {
    if (status === 'SUCCEEDED') {
      // Get job results based on job type
      if (message.API === 'StartSegmentDetection') {
        const segments = await getSegmentDetectionResults(jobId);
        await updateVideoSegments(videoIndex, videoId, segments);
      } else if (message.API === 'StartLabelDetection') {
        const labels = await getLabelDetectionResults(jobId);
        await updateVideoLabels(videoIndex, videoId, labels);
      } else if (message.API === 'StartFaceDetection') {
        const faces = await getFaceDetectionResults(jobId);
        await updateVideoFaces(videoIndex, videoId, faces);
      }
    } else if (status === 'FAILED') {
      await updateVideoStatus(videoId, 'error', {
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

async function updateVideoStatus(videoId: string, status: VideoStatus, additionalFields?: Partial<VideoMetadata>) {
  await openSearch.update({
    index: 'videos',
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

async function updateVideoSegments(videoIndex: string, videoId: string, segments: SegmentDetection[]): Promise<void> {
  // First get existing video metadata
  const { body: existingVideo } = await openSearch.get({
    index: videoIndex,
    id: videoId
  });

  const processedSegments: VideoSegment[] = segments.map((segment, index) => ({
    segment_id: `${videoId}_${index}`,
    video_id: videoId,
    start_time: segment.StartTimestampMillis || 0,
    end_time: segment.EndTimestampMillis || 0,
    duration: segment.DurationMillis || 0,
    segment_visual: {
      segment_visual_description: segment.ShotSegment ? 'Shot boundary detected' : 'Technical cue detected',
    }
  }));

  // Update video metadata with new segments and status
  await openSearch.update({
    index: videoIndex,
    id: videoId,
    body: {
      doc: {
        video_status: 'ready_for_shots' as VideoStatus,
        video_segments: processedSegments,
        segment_count: processedSegments.length,
        total_duration: Math.max(...processedSegments.map(s => s.end_time)),
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
    index: 'videos',
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
    index: 'videos',
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