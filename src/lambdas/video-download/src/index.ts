import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import axios from 'axios';
import { APIGatewayProxyEvent } from 'aws-lambda';
import {
  VideoUploadRequest,
  VideoUploadResponse,
  ErrorResponse,
  LambdaResponse
} from './types';

const s3Client = new S3Client({});
const sqsClient = new SQSClient({});

const createResponse = (statusCode: number, body: VideoUploadResponse | ErrorResponse): LambdaResponse => {
  return Promise.resolve({
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    },
    body: JSON.stringify(body)
  });
};

const validateRequest = (body: any): body is VideoUploadRequest => {
  return typeof body === 'object' && typeof body.videoUrl === 'string';
};

const generateUniqueFilename = (): string => {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(7);
  return `${timestamp}-${random}.mp4`;
};

export const handler = async (event: APIGatewayProxyEvent): LambdaResponse => {
  try {
    if (!event.body) {
      return createResponse(400, { error: 'Request body is required' });
    }

    const body = JSON.parse(event.body);
    
    if (!validateRequest(body)) {
      return createResponse(400, { error: 'Invalid request format' });
    }

    const { videoUrl, metadata } = body;

    // Download video with timeout and retry logic
    const response = await axios({
      method: 'GET',
      url: videoUrl,
      responseType: 'arraybuffer',
      timeout: 30000, // 30 second timeout
      maxContentLength: 100 * 1024 * 1024, // 100MB max size
      validateStatus: (status) => status === 200
    });

    const filename = generateUniqueFilename();

    // Upload to S3 with server-side encryption
    await s3Client.send(new PutObjectCommand({
      Bucket: process.env.RAW_VIDEOS_BUCKET!,
      Key: filename,
      Body: response.data,
      ContentType: 'video/mp4',
      ServerSideEncryption: 'AES256'
    }));

    // Send message to SQS with deduplication
    await sqsClient.send(new SendMessageCommand({
      QueueUrl: process.env.PROCESSING_QUEUE_URL!,
      MessageBody: JSON.stringify({
        bucket: process.env.RAW_VIDEOS_BUCKET,
        key: filename,
        metadata: metadata || {},
        timestamp: Date.now()
      }),
      MessageDeduplicationId: filename, // Prevent duplicate processing
      MessageGroupId: 'video-processing' // Ensure FIFO processing
    }));

    return createResponse(200, {
      message: 'Video uploaded successfully',
      videoId: filename
    });
  } catch (error) {
    console.error('Error:', error);

    if (axios.isAxiosError(error)) {
      return createResponse(400, {
        error: 'Failed to download video',
        details: error.message
      });
    }

    return createResponse(500, {
      error: 'Internal server error',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}; 