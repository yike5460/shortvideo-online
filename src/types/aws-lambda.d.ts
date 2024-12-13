import { Context as LambdaContext } from 'aws-lambda';

declare global {
  namespace NodeJS {
    interface ProcessEnv {
      VIDEO_BUCKET: string;
      QUEUE_URL: string;
      OPENSEARCH_DOMAIN: string;
      REDIS_ENDPOINT: string;
      SNS_TOPIC_ARN: string;
      REKOGNITION_ROLE_ARN: string;
      AWS_REGION: string;
      BEDROCK_EMBEDDING_MODEL: string;
    }
  }
}

export interface LambdaResponse {
  statusCode: number;
  body: string;
}

export interface S3Event {
  Records: {
    eventVersion: string;
    eventSource: 'aws:s3';
    awsRegion: string;
    eventTime: string;
    eventName: string;
    s3: {
      s3SchemaVersion: string;
      bucket: {
        name: string;
        arn: string;
      };
      object: {
        key: string;
        size: number;
        eTag: string;
      };
    };
  }[];
}

export interface SQSEvent {
  Records: {
    messageId: string;
    receiptHandle: string;
    body: string;
    attributes: {
      ApproximateReceiveCount: string;
      SentTimestamp: string;
      SenderId: string;
      ApproximateFirstReceiveTimestamp: string;
    };
    messageAttributes: Record<string, any>;
    md5OfBody: string;
    eventSource: 'aws:sqs';
    eventSourceARN: string;
    awsRegion: string;
  }[];
}

export interface APIGatewayProxyEvent {
  body: string | null;
  headers: Record<string, string>;
  multiValueHeaders: Record<string, string[]>;
  httpMethod: string;
  isBase64Encoded: boolean;
  path: string;
  pathParameters: Record<string, string> | null;
  queryStringParameters: Record<string, string> | null;
  multiValueQueryStringParameters: Record<string, string[]> | null;
  stageVariables: Record<string, string> | null;
  requestContext: any;
  resource: string;
}

export interface VideoMetadata {
  videoId: string;
  bucket: string;
  key: string;
  jobId: string;
  status: string;
  shots?: any[];
  labels?: any[];
  faces?: any[];
}

export interface SearchQuery {
  text?: string;
  audio?: string;
  image?: string;
  weights?: {
    text?: number;
    audio?: number;
    image?: number;
  };
  exact_match?: boolean;
  top_k?: number;
}

export interface VideoUploadRequest {
  source: 'youtube' | 'local';
  path: string;
  metadata?: {
    title?: string;
    description?: string;
    tags?: string[];
  };
}

export { LambdaContext }; 