import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

export interface VideoMetadata {
  title?: string;
  description?: string;
  tags?: string[];
  [key: string]: any;
}

export interface VideoUploadRequest {
  videoUrl: string;
  metadata?: VideoMetadata;
}

export interface VideoUploadResponse {
  message: string;
  videoId: string;
}

export interface ErrorResponse {
  error: string;
  details?: string;
}

export type LambdaResponse = Promise<APIGatewayProxyResult>; 