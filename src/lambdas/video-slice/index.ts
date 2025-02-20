import { S3Event, SQSEvent, LambdaContext, LambdaResponse } from '../../types/aws-lambda';
import { VideoMetadata, VideoStatus, VideoSegment, VideoProcessingJob } from '../../types/common';
import { 
  RekognitionClient,
  StartSegmentDetectionCommand,
  GetSegmentDetectionCommand,
  StartLabelDetectionCommand,
  StartFaceDetectionCommand,
  NotificationChannel,
  SegmentType,
  SegmentDetection
} from '@aws-sdk/client-rekognition';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { Client } from '@opensearch-project/opensearch';
import { defaultProvider } from '@aws-sdk/credential-provider-node';
import { AwsSigv4Signer } from '@opensearch-project/opensearch/aws';

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

export const handler = async (event: S3Event | SQSEvent, _context: LambdaContext): Promise<LambdaResponse> => {
  try {
    // Handle S3 event for new video upload
    if ('Records' in event && event.Records[0].eventSource === 'aws:s3') {
      const record = event.Records[0].s3;
      const bucket = record.bucket.name;
      const key = decodeURIComponent(record.object.key.replace(/\+/g, ' '));
      
      if (!key.startsWith('RawVideos/')) {
        process.stdout.write('Skipping non-raw video file: ' + key + '\n');
        return {
          statusCode: 200,
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

      // Store job metadata in SQS for tracking
      const metadata: VideoMetadata = {
        video_id: videoId,
        video_s3_path: bucket + '/' + key,
        job_id: shotDetectionResponse.JobId!,
        video_status: 'uploading',
        video_title: '',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      await sqs.send(new SendMessageCommand({
        QueueUrl: process.env.VIDEO_PROCESSING_QUEUE_URL,
        MessageBody: JSON.stringify(metadata),
        MessageAttributes: {
          jobType: {
            DataType: 'String',
            StringValue: 'SHOT_DETECTION'
          }
        }
      }));

      return {
        statusCode: 200,
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

    // Handle SQS event for Rekognition job completion
    if ('Records' in event && event.Records[0].eventSource === 'aws:sqs') {
      const record = JSON.parse(event.Records[0].body) as VideoMetadata;
      const { video_id, job_id, video_status } = record;

      if (video_status === 'ready') {
        // Get shot detection results
        const shotDetectionResult = await rekognition.send(new GetSegmentDetectionCommand({
          JobId: job_id
        }));

        // Process shots and create metadata
        const shots = shotDetectionResult.Segments?.map((segment: SegmentDetection) => ({
          timestamp: segment.StartTimestampMillis,
          duration: segment.DurationMillis,
          confidence: segment.ShotSegment?.Confidence,
          technical_cue: segment.TechnicalCueSegment?.Confidence
        }));

        // Update metadata with shot information
        const updatedMetadata: VideoMetadata = {
          ...record,
          video_segments: shots?.map((shot, index) => ({
            segment_id: `${video_id}_${index}`,
            video_id: video_id || '',
            start_time: shot.timestamp || 0,
            end_time: (shot.timestamp || 0) + (shot.duration || 0),
            duration: shot.duration || 0,
            confidence: shot.confidence,
            technical_cue: shot.technical_cue
          })),
          video_status: 'ready'
        };

        // Send to video processing queue for embedding generation
        await sqs.send(new SendMessageCommand({
          QueueUrl: process.env.VIDEO_PROCESSING_QUEUE_URL,
          MessageBody: JSON.stringify(updatedMetadata),
          MessageAttributes: {
            jobType: {
              DataType: 'String',
              StringValue: 'EMBEDDING_GENERATION'
            }
          }
        }));

        return {
          statusCode: 200,
          headers: corsHeaders,
          body: JSON.stringify({
            message: 'Shot detection completed',
            video_id,
            shots: shots?.length
          })
        };
      }
    }

    // If we get here, we didn't handle the event type
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Unsupported event type' })
    };

  } catch (error) {
    console.error('Error processing video:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error'
      })
    };
  }
};

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