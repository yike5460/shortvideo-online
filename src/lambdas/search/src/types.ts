import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { ApiResponse } from '@opensearch-project/opensearch';

export type SearchType = 'exact' | 'semantic';
export type SearchModality = 'visual' | 'audio' | 'text' | 'all';

export type EmbeddingVector = number[];

export interface SearchRequest {
  query: string;
  type?: SearchType;
  modality?: SearchModality;
  limit?: number;
  offset?: number;
}

export interface SearchHit {
  _id: string;
  _score: number;
  _source: {
    video_id: string;
    segment_start: number;
    segment_end: number;
    [key: string]: any;
  };
}

export interface SearchResponse extends ApiResponse<Record<string, any>, unknown> {
  body: {
    hits: {
      total: { value: number };
      hits: SearchHit[];
    };
  };
}

export interface ErrorResponse {
  error: string;
  details?: string;
}

export type LambdaResponse = Promise<APIGatewayProxyResult>; 