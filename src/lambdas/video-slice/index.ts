import { S3Event, SQSEvent, LambdaContext, LambdaResponse, VideoMetadata } from '../../types/aws-lambda';
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

const rekognition = new RekognitionClient({});
const sqs = new SQSClient({});

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
        videoId,
        bucket,
        key,
        jobId: shotDetectionResponse.JobId!,
        status: 'IN_PROGRESS',
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
      const { videoId, jobId, status } = record;

      if (status === 'SUCCEEDED') {
        // Get shot detection results
        const shotDetectionResult = await rekognition.send(new GetSegmentDetectionCommand({
          JobId: jobId
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
          shots,
          status: 'COMPLETED'
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
          body: JSON.stringify({
            message: 'Shot detection completed',
            videoId,
            shots: shots?.length
          })
        };
      }
    }

    // If we get here, we didn't handle the event type
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Unsupported event type' })
    };

  } catch (error) {
    console.error('Error processing video:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error'
      })
    };
  }
}; 