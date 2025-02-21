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

  const videoId = key.split('/').pop()?.split('.')[0];
  if (!videoId) throw new Error('Invalid video key format');

  // Start Rekognition jobs
  const notificationChannel: NotificationChannel = {
    SNSTopicArn: process.env.SNS_TOPIC_ARN,
    RoleArn: process.env.REKOGNITION_ROLE_ARN
  };

  // Start shot detection
  const shotDetectionResponse = await rekognition.send(new StartSegmentDetectionCommand({
    Video: { S3Object: { Bucket: bucket, Name: key } },
    NotificationChannel: notificationChannel,
    JobTag: `${videoId}-shots`,
    SegmentTypes: [SegmentType.SHOT]
  }));

  // Start label detection
  const labelDetectionResponse = await rekognition.send(new StartLabelDetectionCommand({
    Video: { S3Object: { Bucket: bucket, Name: key } },
    NotificationChannel: notificationChannel,
    JobTag: `${videoId}-labels`,
    MinConfidence: 80
  }));

  // Start face detection
  const faceDetectionResponse = await rekognition.send(new StartFaceDetectionCommand({
    Video: { S3Object: { Bucket: bucket, Name: key } },
    NotificationChannel: notificationChannel,
    JobTag: `${videoId}-faces`
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
  const videoId = message.Video.S3ObjectName.split('/')[2]; // Extract from S3 key

  console.log('Processing Rekognition notification for job:', jobId, 'status:', status, 'videoId:', videoId, 'message:', message);

  if (status === 'SUCCEEDED') {
    // Get job results based on job type
    if (message.API === 'StartSegmentDetection') {
      const segments = await getSegmentDetectionResults(jobId);
      await updateVideoSegments(videoId, segments);
    } else if (message.API === 'StartLabelDetection') {
      const labels = await getLabelDetectionResults(jobId);
      await updateVideoLabels(videoId, labels);
    } else if (message.API === 'StartFaceDetection') {
      const faces = await getFaceDetectionResults(jobId);
      await updateVideoFaces(videoId, faces);
    }
  } else if (status === 'FAILED') {
    await updateVideoStatus(videoId, 'error', {
      error: message.StatusMessage
    });
  }

  // Display the video information in aoss for debugging
  const fullVideoMetadata = await openSearch.get({
    index: 'videos',
    id: videoId
  });
  console.log('Video information:', fullVideoMetadata);

  return {
    statusCode: STATUS_CODES.OK,
    headers: corsHeaders,
    body: JSON.stringify({ message: 'Processed Rekognition notification' })
  };
}

async function processVideoJob(record: SQSEvent): Promise<void> {
  try {
    const job: VideoProcessingJob = JSON.parse(record.Records[0].body);
    console.log('Processing video job:', job);

    await updateVideoStatus(job.videoId, 'processing');

    const segmentDetectionResponse = await rekognition.send(new StartSegmentDetectionCommand({
      Video: {
        S3Object: {
          Bucket: job.bucket,
          Name: job.key
        }
      },
      SegmentTypes: ['SHOT', 'TECHNICAL_CUE'],
      Filters: {
        TechnicalCueFilter: {
          BlackFrame: { MaxPixelThreshold: 0.2, MinCoveragePercentage: 95 }
        }
      }
    }));

    const jobId = segmentDetectionResponse.JobId;
    if (!jobId) {
      throw new Error('Failed to start segment detection job');
    }

    const segments = await pollSegmentDetection(jobId);
    console.log('Detected segments:', segments);

    // Process segments and update OpenSearch
    const processedSegments: VideoSegment[] = segments.map((segment, index) => ({
      segment_id: `${job.videoId}_${index}`,
      video_id: job.videoId,
      start_time: segment.StartTimestampMillis || 0,
      end_time: segment.EndTimestampMillis || 0,
      duration: segment.DurationMillis || 0,
      segment_visual: {
        segment_visual_description: segment.TechnicalCueSegment 
          ? 'Technical cue detected'
          : 'Shot boundary detected'
      }
    }));

    // Batch index segments to OpenSearch
    const body = processedSegments.flatMap(segment => [
      { index: { _index: 'video_segments', _id: segment.segment_id } },
      segment
    ]);

    await openSearch.bulk({ body });

    // Update video status to ready
    await updateVideoStatus(job.videoId, 'ready', {
      segment_count: processedSegments.length,
      total_duration: Math.max(...processedSegments.map(s => s.end_time))
    });

  } catch (error) {
    console.error('Error processing video:', error);
    if (error instanceof Error) {
      await updateVideoStatus(JSON.parse(record.Records[0].body).videoId, 'error', {
        error: error.message
      });
    }
    throw error;
  }
}

async function pollSegmentDetection(jobId: string, maxAttempts = 60): Promise<any[]> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const response = await rekognition.send(new GetSegmentDetectionCommand({
      JobId: jobId
    }));

    if (response.JobStatus === 'SUCCEEDED') {
      return response.Segments || [];
    }

    if (response.JobStatus === 'FAILED') {
      throw new Error(`Segment detection failed: ${response.StatusMessage}`);
    }

    // Wait 5 seconds before next poll
    await new Promise(resolve => setTimeout(resolve, 5000));
  }

  throw new Error('Segment detection timed out');
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

async function updateVideoSegments(videoId: string, segments: SegmentDetection[]): Promise<void> {
  const processedSegments = segments.map((segment, index) => ({
    segment_id: `${videoId}_${index}`,
    video_id: videoId,
    start_time: segment.StartTimestampMillis || 0,
    end_time: segment.EndTimestampMillis || 0,
    duration: segment.DurationMillis || 0,
    segment_type: segment.ShotSegment ? 'shot' : 'technical_cue',
    confidence: segment.ShotSegment?.Confidence || segment.TechnicalCueSegment?.Confidence
  }));

  // Batch index segments to OpenSearch
  await openSearch.bulk({
    body: processedSegments.flatMap(segment => [
      { index: { _index: 'video_segments', _id: segment.segment_id } },
      segment
    ])
  });

  // Update video metadata with segment count
  await updateVideoStatus(videoId, 'ready_for_shots' as VideoStatus, {
    segment_count: processedSegments.length,
    total_duration: Math.max(...processedSegments.map(s => s.end_time))
  });
}

async function getLabelDetectionResults(jobId: string): Promise<any[]> {
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

async function updateVideoLabels(videoId: string, labels: any[]): Promise<void> {
  const processedLabels = labels.map((label, index) => {
    const visualObject = {
      label: label.Label.Name,
      confidence: label.Label.Confidence,
      bounding_box: label.Label.BoundingBox || { left: 0, top: 0, width: 0, height: 0 }
    };

    return {
      segment_id: `${videoId}_${index}`,
      video_id: videoId,
      start_time: label.Timestamp,
      end_time: label.Timestamp + 1000, // Assume 1 second duration
      duration: 1000,
      segment_visual: {
        segment_visual_objects: [visualObject],
        segment_visual_description: `Detected ${label.Label.Name}`
      }
    };
  });

  // Batch index to video_segments
  await openSearch.bulk({
    body: processedLabels.flatMap(segment => [
      { index: { _index: 'video_segments', _id: segment.segment_id } },
      segment
    ])
  });

  // Update video metadata
  await updateVideoStatus(videoId, 'ready_for_object' as VideoStatus, {
    video_segments: processedLabels
  });
}

async function getFaceDetectionResults(jobId: string): Promise<any[]> {
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

async function updateVideoFaces(videoId: string, faces: any[]): Promise<void> {
  const processedFaces = faces.map((face, index) => {
    const faceDetection = {
      confidence: face.Face.Confidence,
      bounding_box: face.Face.BoundingBox,
      person_name: undefined // Can be updated later with face recognition
    };

    return {
      segment_id: `${videoId}_face_${index}`,
      video_id: videoId,
      start_time: face.Timestamp,
      end_time: face.Timestamp + 1000, // Assume 1 second duration
      duration: 1000,
      segment_visual: {
        segment_visual_faces: [faceDetection],
        segment_visual_description: 'Face detected'
      }
    };
  });

  // Batch index to video_segments
  await openSearch.bulk({
    body: processedFaces.flatMap(segment => [
      { index: { _index: 'video_segments', _id: segment.segment_id } },
      segment
    ])
  });

  // Update video metadata
  await updateVideoStatus(videoId, 'ready_for_face' as VideoStatus, {
    video_segments: processedFaces
  });
} 