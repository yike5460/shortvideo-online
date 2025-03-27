import { APIGatewayProxyEvent } from 'aws-lambda';
import { LambdaContext, LambdaResponse } from '../../types/aws-lambda';
import { VideoMetadata, VideoStatus, VideoResult, WebVideoStatus } from '../../types/common';
import { S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand, HeadObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { Client } from '@opensearch-project/opensearch';
import { defaultProvider } from '@aws-sdk/credential-provider-node';
import { AwsSigv4Signer } from '@opensearch-project/opensearch/aws';
import { v4 as uuidv4 } from 'uuid';
import * as path from 'path';
import { DynamoDBDocumentClient, PutCommand, DeleteCommand, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import * as fs from 'fs';
import { Readable } from 'stream';
import { spawn } from 'child_process';

// Initialize clients
const s3 = new S3Client({});
const sqs = new SQSClient({});
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
const dynamoClient = new DynamoDBClient({endpoint: process.env.INDEXES_TABLE_DYNAMODB_DNS_NAME});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
  'Access-Control-Allow-Credentials': 'true'
};

// Status codes
const STATUS_CODES = {
  OK: 200,
  CREATED: 201,
  BAD_REQUEST: 400,
  NOT_FOUND: 404,
  INTERNAL_SERVER_ERROR: 500
};

const indexSettings = {
  settings: {
    number_of_shards: 1,
    number_of_replicas: 0,
    "index.knn": true  // Enable k-NN for this index
  },

  mappings: {
    properties: {
      video_index: { type: 'keyword' },
      video_description: { type: 'text' },
      video_duration: { type: 'text' },
      video_id: { type: 'keyword' },
      video_name: { type: 'keyword' },
      video_source: { type: 'keyword' },
      video_s3_path: { type: 'keyword' },
      video_size: { type: 'integer' },
      video_status: { type: 'keyword' },
      video_summary: { type: 'text' },
      video_tags: { type: 'keyword' },
      video_title: { type: 'text' },
      video_thumbnail_s3_path: { type: 'keyword' },
      video_thumbnail_url: { type: 'keyword' },
      video_preview_url: { type: 'keyword' },
      video_type: { type: 'keyword' },

      created_at: { type: 'date' },
      updated_at: { type: 'date' },
      error: { type: 'text' },
      segment_count: { type: 'integer' },
      job_id: { type: 'keyword' },

      video_metadata: { type: 'object' },
      video_segments: { 
        type: 'nested',
        properties: {
          segment_id: { type: 'keyword' },
          start_time: { type: 'float' },
          end_time: { type: 'float' },
          duration: { type: 'float' },
          segment_s3_path: { type: 'keyword' },
          segment_visual: {
            type: 'object',
            properties: {
              segment_visual_description: { type: 'text' },
              segment_visual_embedding: { 
                type: 'knn_vector',
                dimension: 2048,
                method: {
                  name: "hnsw",
                  space_type: "cosinesimil",
                  parameters: {
                    ef_construction: 1024,
                    m: 16
                  }
                }
              }
            }
          },
          segment_audio: {
            type: 'object',
            properties: {
              segment_audio_description: { type: 'text' },
              segment_audio_embedding: { 
                type: 'knn_vector',
                dimension: 2048,
                method: {
                  name: "hnsw",
                  space_type: "cosinesimil",
                  parameters: {
                    ef_construction: 1024,
                    m: 16
                  }
                }
              }
            }
          }
        }
      }
    }
  }
};

interface PresignRequest {
  fileName: string;
  fileType: string;
  fileSize: number;
  indexId: string;
  multipleUpload?: boolean; // Flag to indicate if this is part of a multiple upload operation
  metadata: {
    title?: string;
    description?: string;
    tags?: string[];
  };
}

interface CompleteUploadRequest {
  indexId: string;
  videoId: string;
}

interface MergeSegmentsRequest {
  indexId: string;           // The index the segments belong to
  videoId: string;           // The original video ID
  segmentIds: string[];      // IDs of segments to merge
  mergedName?: string;       // Optional custom name for the merged segment
}

/**
 * Utility function to perform OpenSearch operations with retry logic
 * @param operation Function that performs the OpenSearch operation
 * @param maxRetries Maximum number of retry attempts
 * @param operationName Name of the operation for logging
 * @returns Result of the operation
 */
async function withRetry<T>(
  operation: () => Promise<T>,
  // increase maxRetries to 5 since we're using OpenSearch Serverless which the refresh: true is not supported, refer to https://repost.aws/community/users/USiotOGJ78So2L1_DskJDcgQ
  maxRetries: number = 5, 
  operationName: string = 'OpenSearch operation'
): Promise<T> {
  let retries = 0;
  
  while (true) {
    try {
      return await operation();
    } catch (error) {
      retries++;
      
      if (retries >= maxRetries) {
        console.error(`Failed ${operationName} after ${maxRetries} retries:`, error);
        throw error;
      }
      
      console.warn(`${operationName} failed (retry ${retries}/${maxRetries}):`, error);
      
      // Exponential backoff: 4s, 16s, 64s, 256s, 1024s
      const delay = Math.pow(4, retries) * 1000;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

export const handler = async (event: APIGatewayProxyEvent): Promise<LambdaResponse> => {
  try {
    // For GET & DELETE requests, we don't need to check for body
    if (event.httpMethod !== 'GET' && event.httpMethod !== 'DELETE' && !event.body) {
      return {
        statusCode: STATUS_CODES.BAD_REQUEST,
        headers: corsHeaders,  // Add CORS headers even for errors
        body: JSON.stringify({ error: 'Missing request body' })
      };
    }

    // Handle different endpoints based on the path and method
    const path = event.path.toLowerCase();
    const method = event.httpMethod;

    // Overall API Path:
    // ```http
    //   GET    /videos                         - List all videos
    //   GET    /videos/{indexId}               - Get video details
    //   GET    /videos/status?index={indexId}  - Get index status
    //   POST   /videos/upload                  - Start upload
    //   POST   /videos/upload/{videoId}/complete - Complete upload
    //   DELETE /videos/?index={indexId}?videoId={videoId}     - Delete specific video or all videos under index
    // ```

    if (method === 'GET') {
      // Handle status endpoint
      if (path.endsWith('/videos/status') || path.endsWith('/videos/status/')) {
        return handleGetIndexStatus(event);
      }
      // Handle query string for specific index, e.g. /videos?index=videos or wildcard search across all indexes, e.g. /videos or /videos/
      else if (path === '/videos' || path.endsWith('/videos/')) {
        return handleListVideos(event);
      }
    } else if (method === 'POST') {
      if (path.endsWith('/upload')) {
        return handlePresignRequest(event);
      } else if (path.endsWith('/complete')) {
        return handleCompleteUpload(event);
      } else if (path.endsWith('/merge')) {
        return handleMergeSegments(event);
      }
    } else if (method === 'DELETE' && (path === '/videos' || path.endsWith('/videos/'))) {
      // Handle video deletion using query parameters: /videos/?index={indexId}?videoId={videoId}
      return handleDeleteVideo(event);
    }

    return {
      statusCode: STATUS_CODES.NOT_FOUND,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Invalid endpoint' })
    };

  } catch (error) {
    console.error('Error:', error);
    return {
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      headers: corsHeaders,  // Add CORS headers for errors too
      body: JSON.stringify({
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error'
      })
    };
  }
};

async function handleListVideos(event: APIGatewayProxyEvent): Promise<LambdaResponse> {
  // If the indexId is provided in the query string e.g. /videos?index=videos, use that index, otherwise it's wildcard search across all indexes
  try {
    const queryParams = event.queryStringParameters || {};
    // extract the index from the query string e.g. /videos/?index=videos
    const indexId = event.queryStringParameters?.index;
    // Check if merged segments should be included
    const includeMerged = queryParams.includeMerged === 'true';
    
    // Add pagination parameters
    const pageSize = 20;  // Limit number of videos per request
    const page = parseInt(queryParams.page || '1', 10);
    const from = (page - 1) * pageSize;
    
    // Determine which index to search
    const searchIndex = indexId || '*';

    // Define source fields
    const sourceFields = [
      'video_id',
      'video_index',
      'video_title', 
      'video_description',
      'video_s3_path',
      'video_preview_url',
      'video_duration',
      'video_type',
      'video_status',
      'video_size',
      'created_at',
      'video_thumbnail_s3_path',
      'video_thumbnail_url'
    ];

    // Only include merged_segments if requested
    if (includeMerged) {
      sourceFields.push('merged_segments');
    }
    
    // Create the search query
    const searchQuery = {
      index: searchIndex,
      body: {
        query: {
          bool: {
            must_not: [
              { term: { video_status: 'deleted' } }
            ]
          }
        },
        size: pageSize,
        from: from,
        // Only return necessary fields
        _source: sourceFields
      }
    };
    
    // Try to sort by created_at, but don't fail if it doesn't exist
    try {
      // First try with sorting
      const { body } = await openSearch.search({
        ...searchQuery,
        body: {
          ...searchQuery.body,
          sort: [{ created_at: { order: 'desc' } }]
        }
      });
      
      return await formatSearchResults(body, page, pageSize, from, includeMerged);
    } catch (sortError) {
      console.warn('Error sorting by created_at, trying without sort:', sortError);
      
      // If sorting fails, try again without sorting
      const { body } = await openSearch.search(searchQuery);

      console.log('Search results without sort: ', body);
      return await formatSearchResults(body, page, pageSize, from, includeMerged);
    }
  } catch (error) {
    console.error('Error listing videos:', error);
    // Return empty results instead of an error
    return {
      statusCode: STATUS_CODES.OK,
      headers: corsHeaders,
      body: JSON.stringify({
        videos: [],
        total: 0,
        hasMore: false,
        page: 1,
        pageSize: 20
      })
    };
  }
}

async function formatSearchResults(body: any, page: number, pageSize: number, from: number, includeMerged: boolean = false): Promise<LambdaResponse> {
  if (!body.hits || !body.hits.hits) {
    return {
      statusCode: STATUS_CODES.OK,
      headers: corsHeaders,
      body: JSON.stringify({
        videos: [],
        total: 0,
        hasMore: false,
        page,
        pageSize
      })
    };
  }

  // Refresh the thumbnail URL using the pre-signed URL
  const refreshvideoPreviewUrl = async (s3Path: string): Promise<string> => {
    // Extract the key from the original video path, `RawVideos/${timestamp}/${videoIndex}/${videoId}/${sanitizedFileName}`, e.g. RawVideos/2025-03-02/videos/ABC123/video.mp4
    const getCommand = new GetObjectCommand({
      Bucket: process.env.VIDEO_BUCKET,
      Key: s3Path,
    });
    return await getSignedUrl(s3 as any, getCommand as any, { expiresIn: 3600 });
  };

  // Format the duration as a human-readable string (HH:MM:SS) helper function
  const formatDuration = (ms: number): string => {
    if (!ms) return '00:00:00';
    
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  };

  // Process regular videos
  const videos: VideoResult[] = await Promise.all(body.hits.hits.map(async (hit: any) => {
    // Use dummy s3 path for thumbnail if it doesn't exist, avoid error like "No value provided for input HTTP label: Key"
    const videoPreviewUrlValue = await refreshvideoPreviewUrl(hit._source.video_s3_path || 'dummy_s3_path');
    const thumbnailUrlValue = await refreshvideoPreviewUrl(hit._source.video_thumbnail_s3_path || 'dummy_s3_path');
    return {
      id: hit._id,
      title: hit._source.video_title || '',
      description: hit._source.video_description || '',
      videoS3Path: hit._source.video_s3_path,
      videoPreviewUrl: videoPreviewUrlValue,
      videoThumbnailS3Path: hit._source.video_thumbnail_s3_path,
      videoThumbnailUrl: thumbnailUrlValue,
      videoDuration: hit._source.video_duration || '00:00:00',
      source: 'local' as const,
      uploadDate: hit._source.created_at,
      format: hit._source.video_type,
      status: hit._source.video_status,
      size: hit._source.video_size,
      indexId: hit._source.video_index || 'videos',
      segments: []
    };
  }));

  // Process merged segments if requested
  let mergedVideos: VideoResult[] = [];
  if (includeMerged) {
    // Get all docs that have merged_segments
    const docsWithMergedSegments = body.hits.hits.filter((hit: any) => 
      hit._source.merged_segments && Array.isArray(hit._source.merged_segments) && hit._source.merged_segments.length > 0
    );
    
    if (docsWithMergedSegments.length > 0) {
      // Extract and process all merged segments
      for (const doc of docsWithMergedSegments) {
        const parentVideoId = doc._source.video_id;
        const indexId = doc._source.video_index || 'videos';
        
        // Convert each merged segment to a VideoResult
        const docMergedVideos = await Promise.all(doc._source.merged_segments.map(async (segment: any) => {
          // Generate fresh signed URLs
          const videoUrl = await refreshvideoPreviewUrl(segment.segment_video_s3_path || 'dummy_s3_path');
          const thumbnailUrl = await refreshvideoPreviewUrl(segment.segment_video_thumbnail_s3_path || 'dummy_s3_path');
          
          const title = segment.segment_visual?.segment_visual_description || 
                       `Merged: ${doc._source.video_title || 'Untitled'} (${segment.start_time}-${segment.end_time})`;
          
          return {
            id: segment.segment_id,
            title: title,
            description: segment.segment_visual?.segment_visual_description || '',
            videoS3Path: segment.segment_video_s3_path,
            videoPreviewUrl: videoUrl,
            videoThumbnailS3Path: segment.segment_video_thumbnail_s3_path,
            videoThumbnailUrl: thumbnailUrl,
            videoDuration: formatDuration(segment.duration * 1000) || '00:00:00',
            source: 'merged' as const, // Add a new source type for merged segments
            uploadDate: doc._source.updated_at || doc._source.created_at,
            format: 'mp4',
            status: 'ready' as VideoStatus, // Merged segments are always ready
            size: 0, // We may not have size info for merged segments
            indexId: indexId,
            parentVideoId: parentVideoId, // Add reference to parent video
            isMerged: true,  // Flag to identify as merged segment
            segments: []
          };
        }));
        
        mergedVideos = [...mergedVideos, ...docMergedVideos];
      }
    }
  }

  // Combine regular videos and merged segments
  const allVideos = includeMerged ? [...videos, ...mergedVideos] : videos;

  return {
    statusCode: STATUS_CODES.OK,
    headers: corsHeaders,
    body: JSON.stringify({
      videos: allVideos,
      total: body.hits.total?.value || videos.length,
      // TODO: Web should use hasMore to determine if there are more pages
      hasMore: (body.hits.total?.value || 0) > (from + pageSize),
      page,
      pageSize
    })
  };
}

/**
 * Handle getting the status of an index
 * This endpoint returns the overall status of videos in an index
 */
async function handleGetIndexStatus(event: APIGatewayProxyEvent): Promise<LambdaResponse> {
  try {
    const queryParams = event.queryStringParameters || {};
    // Transform the indexId to lowercase
    const indexId = (queryParams.index || 'videos').toLowerCase();
    
    if (!indexId) {
      return {
        statusCode: STATUS_CODES.BAD_REQUEST,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Missing index parameter' })
      };
    }

    // Parse videoIds parameter if provided
    const videoIds = queryParams.videoIds ? queryParams.videoIds.split(',') : undefined;
    
    // Parse pagination parameters
    const page = parseInt(queryParams.page || '1', 10);
    const pageSize = parseInt(queryParams.pageSize || '20', 10);
    const offset = (page - 1) * pageSize;
    
    // Build filter expression for DynamoDB
    let filterExpression = "indexId = :indexId AND (attribute_not_exists(video_status) OR video_status <> :deletedStatus)";
    const expressionAttributeValues: Record<string, any> = {
      ":indexId": indexId,
      ":deletedStatus": "deleted"
    };
    
    // Add videoIds filter if provided
    if (videoIds && videoIds.length > 0) {
      // DynamoDB doesn't support direct IN operator, so we need to build an OR expression
      const videoIdExpressions = videoIds.map((_, idx) => `videoId = :vid${idx}`);
      filterExpression += ` AND (${videoIdExpressions.join(' OR ')})`;
      
      videoIds.forEach((id, idx) => {
        expressionAttributeValues[`:vid${idx}`] = id;
      });
    }
    
    console.log(`Getting status for index: ${indexId} with filter: ${filterExpression} and values:`, expressionAttributeValues);

    // Use a single scan operation to get all items
    const scanParams = {
      TableName: process.env.INDEXES_TABLE,
      FilterExpression: filterExpression,
      ExpressionAttributeValues: expressionAttributeValues,
      // Select: 'COUNT' as const
      // Use a reasonable maximum limit - we don't expect thousands of videos per index
      Limit: 1000
    };
    
    const scanResult = await withRetry(
      async () => docClient.send(new ScanCommand(scanParams)),
      3,
      `Count videos from DynamoDB for index ${indexId}`
    );
    console.log("Scan result: ", scanResult)

    // Get all items and total count
    const allItems = scanResult.Items || []
    const totalCount = scanResult.Count || 0

    // Apply pagination in memory
    const paginatedItems = allItems.slice(offset, offset + pageSize);

    console.log("paginatedItems result: ", paginatedItems)

    // Transform DynamoDB items to match the expected format
    const videos = paginatedItems.map((item: any) => ({
      id: item.videoId,
      name: item.video_name || 'Untitled Video',
      size: item.video_size,
      type: item.video_type,
      title: item.video_title || 'Untitled',
      description: item.video_description || '',
      tags: item.video_tags || [],
      status: item.video_status,
      video_embed_completed: item.video_embed_completed || false,
      video_faces_completed: item.video_faces_completed || false,
      video_objects_completed: item.video_objects_completed || false,
      video_shots_completed: item.video_shots_completed || false,
      error: item.error,
      uploadDate: item.updated_at
    }));

    // Define which statuses are considered "complete"
    const completeStatuses: VideoStatus[] = [
      'ready'
    ];

    // Define which statuses are considered "in progress" but not error
    const processingStatuses: VideoStatus[] = [
      'awaiting_upload', 
      'uploading', 
      'uploaded', 
      'processing',
      'ready_for_face',
      'ready_for_object',
      'ready_for_shots',
      'ready_for_video_embed',
      'ready_for_audio_embed'
    ];
    
    // Define which statuses are considered errors
    const errorStatuses: VideoStatus[] = ['error'];

    // Count videos by their processing flags
    const completedCount = videos.filter((v: any) => 
      // Consider a video complete when all required flags are true, using shot and embed flags for now
      v.video_embed_completed === true &&
      v.video_shots_completed === true
    ).length;

    const failedCount = videos.filter((v: any) => 
      errorStatuses.includes(v.status)
    ).length;

    // Videos that are not complete and not failed are considered processing
    const processingCount = videos.length - completedCount - failedCount;

    // Aggregate statuses in consideration of flag-based completion
    let status: WebVideoStatus = 'processing';
    if (failedCount > 0) {
      status = 'failed';
    } else if (processingCount === 0 && videos.length > 0) {
      status = 'completed';
    }
    
    // Calculate detailed progress based on flags
    const calculateVideoProgress = (video: any): number => {
      if (errorStatuses.includes(video.status)) {
        return 0;
      }
      
      // Count how many processing steps are complete
      let completedSteps = 0;
      let totalSteps = 4; // We have 4 flags to check
      
      if (video.video_embed_completed === true) completedSteps++;
      if (video.video_faces_completed === true) completedSteps++;
      if (video.video_objects_completed === true) completedSteps++;
      if (video.video_shots_completed === true) completedSteps++;
      
      return (completedSteps / totalSteps) * 100;
    };
    
    // Calculate overall progress as average of individual video progresses
    const progress = videos.length > 0 
      ? Math.round(videos.reduce((sum, video) => sum + calculateVideoProgress(video), 0) / videos.length) 
      : 100;

    // Update the video_status if all the flags are true, using shot and embed flags for now
    for (const video of videos) {
      if (video.video_embed_completed === true &&
        video.video_shots_completed === true) {
        video.status = 'ready' as VideoStatus;
      }
    }

    const failedVideos = videos
      .filter((v: any) => errorStatuses.includes(v.status))
      .sort((a: any, b: any) => new Date(b.uploadDate).getTime() - new Date(a.uploadDate).getTime());

    const processingVideos = videos
      .filter((v: any) => processingStatuses.includes(v.status))
      .sort((a: any, b: any) => new Date(b.uploadDate).getTime() - new Date(a.uploadDate).getTime());

    const completedVideos = videos
      .filter((v: any) => completeStatuses.includes(v.status))
      .sort((a: any, b: any) => new Date(b.uploadDate).getTime() - new Date(a.uploadDate).getTime());

    const response = {
      // Overall status information
      status,
      progress,
      videoCount: totalCount,
      completedCount,
      failedCount,
      processingCount,

      failedVideos: failedVideos.map(v => ({
        id: v.id,
        name: v.name || 'Untitled Video',
        status: v.status,
      })),

      processingVideos: processingVideos.map(v => ({
        id: v.id,
        name: v.name || 'Untitled Video',
        status: v.status,
      })),

      completedVideos: completedVideos.map(v => ({
        id: v.id,
        name: v.name || 'Untitled Video',
        status: v.status,
      })),

      // Pagination metadata
      pagination: {
        page,
        pageSize,
        totalPages: Math.ceil(totalCount / pageSize),
        totalCount
      }
    };
    
    return {
      statusCode: STATUS_CODES.OK,
      headers: corsHeaders,
      body: JSON.stringify(response)
    };
  } catch (error) {
    console.error('Error getting index status:', error);
    return {
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      headers: corsHeaders,
      body: JSON.stringify({ 
        error: 'Failed to get index status',
        details: error instanceof Error ? error.message : 'Unknown error'
      })
    };
  }
}

async function handleDeleteVideo(event: APIGatewayProxyEvent): Promise<LambdaResponse> {
  try {
    const queryParams = event.queryStringParameters || {};
    const indexId = queryParams.index;
    const videoId = queryParams.videoId;

    // Validate required parameters
    if (!indexId) {
      return {
        statusCode: STATUS_CODES.BAD_REQUEST,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Missing required query parameter: index' })
      };
    }

    // If videoId is provided, delete a specific video
    if (videoId) {
      const { body: searchResult } = await openSearch.get({
        index: indexId,
        id: videoId,
        // Only fetch required fields
        _source: [
          'video_s3_path',
        ]
      });

      if (!searchResult.found) {
        return {
          statusCode: STATUS_CODES.NOT_FOUND,
          headers: corsHeaders,
          body: JSON.stringify({ error: `Video ${videoId} not found in index ${indexId}` })
        };
      }

      // Extract the S3 key of the uploaded raw video, in format RawVideos/2025-03-02/indexId/videoId/videoFileNameWithExtension
      const videoS3Path = searchResult._source.video_s3_path;
      if (!videoS3Path) {
        throw new Error('Video S3 path not found in metadata');
      }

      // Get the folder level of the videoS3Path (without the filename)
      const pathParts = videoS3Path.split('/');
      const rawVideoS3PathPrefix = pathParts.slice(0, -1).join('/');
      
      // Get the folder level of the processed video, in format ProcessedVideos/2025-03-02/indexId/videoId/
      const processedVideoS3PathPrefix = rawVideoS3PathPrefix.replace('RawVideos', 'ProcessedVideos');

      console.log(`Deleting video ${videoId} from S3 at raw prefix: ${rawVideoS3PathPrefix} and processed prefix: ${processedVideoS3PathPrefix}`);

      // Function to delete all objects with a given prefix
      const deleteObjectsWithPrefix = async (prefix: string) => {
        try {
          // List all objects with the prefix
          const { Contents } = await s3.send(new ListObjectsV2Command({
            Bucket: process.env.VIDEO_BUCKET,
            Prefix: prefix
          }));

          if (!Contents || Contents.length === 0) {
            console.log(`No objects found with prefix: ${prefix}`);
            return;
          }

          console.log(`Found ${Contents.length} objects to delete with prefix: ${prefix}`);

          // Delete each object
          for (const object of Contents) {
            if (object.Key) {
              console.log(`Deleting object: ${object.Key}`);
              await s3.send(new DeleteObjectCommand({
                Bucket: process.env.VIDEO_BUCKET,
                Key: object.Key
              }));
            }
          }
          
          console.log(`Successfully deleted all objects with prefix: ${prefix}`);
        } catch (err) {
          console.warn(`Error deleting objects with prefix ${prefix}:`, err);
        }
      };

      // Delete all raw video objects
      await deleteObjectsWithPrefix(rawVideoS3PathPrefix);
      
      // Delete all processed video objects including segments
      await deleteObjectsWithPrefix(processedVideoS3PathPrefix);
      
      // Also check and delete segments folder if it exists
      const segmentsPrefix = `${processedVideoS3PathPrefix}/segments`;
      await deleteObjectsWithPrefix(segmentsPrefix);

      // Remove the videoId from the index
      await openSearch.delete({
        index: indexId,
        id: videoId
      });

      // Remove the entry from the DynamoDB indexes table
      try {
        console.log(`Deleting DynamoDB entry for indexId=${indexId}, videoId=${videoId}`);
        await docClient.send(new DeleteCommand({
          TableName: process.env.INDEXES_TABLE,
          Key: {
            "indexId": indexId,
            "videoId": videoId
          }
        }));
        console.log('Successfully deleted DynamoDB entry');
      } catch (dynamoError) {
        console.error('Error deleting from DynamoDB:', dynamoError);
        // Continue with the process even if DynamoDB deletion fails
      }

      return {
        statusCode: STATUS_CODES.OK,
        headers: corsHeaders,
        body: JSON.stringify({ 
          message: 'Video deleted successfully',
          videoId,
          indexId
        })
      };
    } else {
      // If only indexId is provided, delete all videos under the index
      const { body: searchResult } = await openSearch.search({
        index: indexId,
        body: {
          query: {
            match_all: {}
          },
          size: 1000, // Limit to 1000 videos per batch
          _source: ['video_s3_path', 'video_id']
        }
      });

      if (!searchResult.hits || !searchResult.hits.hits || searchResult.hits.hits.length === 0) {
        return {
          statusCode: STATUS_CODES.NOT_FOUND,
          headers: corsHeaders,
          body: JSON.stringify({ 
            message: 'No videos found in index',
            indexId
          })
        };
      }

      const videos = searchResult.hits.hits;
      console.log(`Found ${videos.length} videos to delete in index ${indexId}`);

      // Delete each video from OpenSearch and DynamoDB
      const deletePromises = videos.map(async (video: any) => {
        const videoId = video._source.video_id;
        const videoS3Path = video._source.video_s3_path;
        
        try {
          // Delete from OpenSearch
          await openSearch.delete({
            index: indexId,
            id: videoId
          });
          
          // Delete from DynamoDB
          try {
            await docClient.send(new DeleteCommand({
              TableName: process.env.INDEXES_TABLE,
              Key: {
                "indexId": indexId,
                "videoId": videoId
              }
            }));
          } catch (dynamoError) {
            console.error(`Failed to delete DynamoDB entry for video ${videoId}:`, dynamoError);
          }

          // Function to delete all objects with a given prefix
          const deleteObjectsWithPrefix = async (prefix: string) => {
            try {
              // List all objects with the prefix
              const { Contents } = await s3.send(new ListObjectsV2Command({
                Bucket: process.env.VIDEO_BUCKET,
                Prefix: prefix
              }));

              if (!Contents || Contents.length === 0) {
                return;
              }

              // Delete each object
              for (const object of Contents) {
                if (object.Key) {
                  await s3.send(new DeleteObjectCommand({
                    Bucket: process.env.VIDEO_BUCKET,
                    Key: object.Key
                  }));
                }
              }
            } catch (err) {
              console.warn(`Error deleting objects with prefix ${prefix}:`, err);
            }
          };

          // Get folder paths and delete objects
          if (videoS3Path) {
            const pathParts = videoS3Path.split('/');
            const rawVideoS3PathPrefix = pathParts.slice(0, -1).join('/');
            const processedVideoS3PathPrefix = rawVideoS3PathPrefix.replace('RawVideos', 'ProcessedVideos');
            
            // Delete from S3
            await deleteObjectsWithPrefix(rawVideoS3PathPrefix);
            await deleteObjectsWithPrefix(processedVideoS3PathPrefix);
            await deleteObjectsWithPrefix(`${processedVideoS3PathPrefix}/segments`);
          }
          
          return { videoId, success: true };
        } catch (err) {
          console.error(`Failed to delete video ${videoId}:`, err);
          return { videoId, success: false, error: err };
        }
      });

      const results = await Promise.allSettled(deletePromises);
      const successful = results.filter(r => r.status === 'fulfilled' && (r.value as any).success).length;
      const failed = results.length - successful;

      return {
        statusCode: STATUS_CODES.OK,
        headers: corsHeaders,
        body: JSON.stringify({ 
          message: `Bulk deletion completed. ${successful} videos deleted, ${failed} failed.`,
          indexId,
          totalProcessed: results.length,
          successful,
          failed
        })
      };
    }
  } catch (error) {
    console.error('Error deleting video:', error);
    return {
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      headers: corsHeaders,
      body: JSON.stringify({ 
        error: 'Failed to delete video',
        details: error instanceof Error ? error.message : 'Unknown error'
      })
    };
  }
}

async function handlePresignRequest(event: APIGatewayProxyEvent): Promise<LambdaResponse> {
  try {
    const request: PresignRequest = JSON.parse(event.body!);
    console.log('Presign request: ', request);
    // The video index will now be passed from the frontend with default value 'videos', note the index must be lowercase
    const videoIndex = (request.indexId || 'videos').toLowerCase();
    const videoId = uuidv4();
    // Get current date in YYYY-MM-DD format, e.g. '2024-01-25'
    const timestamp = new Date().toISOString().split('T')[0];
    // Sanitize the file name by replacing spaces (and optionally other characters) with underscores
    const sanitizedFileName = request.fileName.replace(/\s+/g, '_');
    // Add the video index to the S3 key
    const s3Key = `RawVideos/${timestamp}/${videoIndex}/${videoId}/${sanitizedFileName}`;

    const createdAt = new Date().toISOString();
    // Align body schema with VideoMetadata
    const aossInitialBody: VideoMetadata = {
      video_index: videoIndex,
      video_id: videoId,
      video_s3_path: s3Key,
      video_name: request.fileName,
      video_size: request.fileSize,
      video_type: request.fileType,
      video_title: request.metadata?.title || path.basename(request.fileName),
      video_description: request.metadata?.description || '',
      video_tags: request.metadata?.tags || [],
      video_status: 'awaiting_upload' as VideoStatus,
      created_at: createdAt,
      updated_at: createdAt
    };

    // Create the index if it doesn't exist
    try {
      const indexExists = await openSearch.indices.exists({ index: videoIndex });
      if (!indexExists.body) {
        console.log(`Index ${videoIndex} does not exist, creating it`);
        // Use the indexSettings object to create the index
        try {
          const createResult = await openSearch.indices.create({ 
            index: videoIndex, 
            body: indexSettings 
          });
          console.log(`Successfully created index ${videoIndex}`);
        } catch (createError: any) {
        // If this is a multiple upload request, ignore "resource_already_exists_exception" errors, as another parallel request might have created the index already
          if (request.multipleUpload && createError.message && createError.message.includes('resource_already_exists_exception')) {
            console.log(`Index ${videoIndex} was created by another parallel request, continuing...`);
          } else {
            // For other errors or if not a multiple upload, rethrow
            throw createError;
          }
        }
      }
    } catch (indexError) {
    // If this is not a critical error for multiple uploads, continue
      if (!(request.multipleUpload && indexError instanceof Error && 
 indexError.message.includes('resource_already_exists_exception'))) {
        throw indexError;
      }
    }

    // Create initial OpenSearch document with error handling
    // For VECTORSEARCH OpenSearch Serverless collections, don't specify ID directly
    const indexResult = await withRetry(
      async () => openSearch.index({
        index: videoIndex,
        // Remove 'id' parameter - AOSS DON'T SUPPORT ID in VECTORSEARCH, refer to https://github.com/langchain-ai/langchainjs/issues/4346, thus we need to search all the items in the index using video_id field and find the auto-generated ID to update the document, instead of using the videoId as the ID to get the document directly
        // id: videoId, 
        body: aossInitialBody
        // Remove refresh: true as it's not supported in OpenSearch Serverless
      }),
      3,
      `Index initial document for video ${videoId} in index ${videoIndex}`
    );
    console.log(`Successfully indexed initial document for video ${videoId} in index ${videoIndex}, index result: ${JSON.stringify(indexResult)}`);

    // Generate pre-signed URL for S3 upload
    const command = new PutObjectCommand({
      Bucket: process.env.VIDEO_BUCKET!,
      Key: s3Key,
      ContentType: request.fileType,
      Metadata: {
        'video-index': videoIndex,
        'video-id': videoId,
        'title': request.metadata?.title || '',
        'description': request.metadata?.description || '',
        'tags': JSON.stringify(request.metadata?.tags || [])
      }
    });

    const uploadUrl = await getSignedUrl(s3 as any, command as any, { expiresIn: 3600 });

    // Record the indexId and videoId in the indexes table
    await withRetry(
      async () => docClient.send(new PutCommand({
        TableName: process.env.INDEXES_TABLE,
        Item: {
          indexId: videoIndex,
          videoId,
          video_name: request.fileName,
          video_size: request.fileSize,
          video_type: request.fileType,
          video_title: request.metadata?.title || path.basename(request.fileName),
          video_description: request.metadata?.description || '',
          video_tags: request.metadata?.tags || [],
          video_status: 'awaiting_upload' as VideoStatus,
          created_at: createdAt,
          updated_at: ''
        }
      })),
      3,
      `Record indexId and videoId in indexes table`
    );
    
    return {
      statusCode: STATUS_CODES.OK,
      headers: corsHeaders,
      body: JSON.stringify({
        uploadUrl,
        videoId,
        videoIndex,
        expiresIn: 3600
      })
    };
  } catch (error) {
    console.error('Error generating pre-signed URL:', error);
    return {
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      headers: corsHeaders,
      body: JSON.stringify({ error: (error as Error).message || 'Failed to generate pre-signed URL' })
    };
  }
}

async function handleCompleteUpload(event: APIGatewayProxyEvent): Promise<LambdaResponse> {
  const request: CompleteUploadRequest = JSON.parse(event.body!);
  // Transform the indexId to lowercase
  const indexId = (request.indexId || 'videos').toLowerCase();
  const { videoId } = request;

  console.log(`Handling complete upload for video ${videoId} in index ${indexId}`);

  // Display all the items in the index
  const { body: searchResult } = await withRetry(
    async () => openSearch.search({
      index: indexId,
      body: { query: { match_all: {} } }
    }),
    3,
    `Display all the items in the index ${indexId}`
  );
  console.log(`All items in the index ${indexId}:`, searchResult);
  
  try {
    // For OpenSearch Serverless VECTORSEARCH, we can't directly get by ID
    // Instead, search for the document using the video_id field
    const { body: searchResult } = await withRetry(
      async () => openSearch.search({
        index: indexId,
        body: {
          query: {
            term: {
              video_id: videoId
            }
          }
        }
      }),
      3,
      `Search for video ${videoId} in index ${indexId}`
    );

    if (!searchResult.hits || !searchResult.hits.hits || searchResult.hits.hits.length === 0) {
      // Waiting the index to be updated then retry the search
      await new Promise(resolve => setTimeout(resolve, 3000));
      console.log(`Waiting for the index to be updated then retry the search for video ${videoId} in index ${indexId}`);
      return handleCompleteUpload(event);
    }

    console.log(`Updated search result for video ${videoId} in index ${indexId}:`, searchResult.hits.hits[0]);
    
    // Extract the S3 key of the uploaded video from the first hit
    const videoDocument = searchResult.hits.hits[0]._source;
    // Get the OpenSearch document ID (the auto-generated one)
    const documentId = searchResult.hits.hits[0]._id;
    
    // Extract the S3 key of the uploaded video, in format RawVideos/2025-03-02/indexId/videoId/videoFileNameWithExtension
    const videoS3Path = videoDocument.video_s3_path;
    if (!videoS3Path) {
      throw new Error('Video S3 path not found in metadata');
    }
    
    // Generate a video preview url for the video and thumbnail url for the thumbnail image
    // If the video path is RawVideos/2025-03-02/indexId/videoId/videoFileName.mp4
    // The thumbnail path will be RawVideos/2025-03-02/indexId/videoId/videoFileName.jpg
    const thumbnailS3Path = videoS3Path.replace(/\.[^/.]+$/, '.jpg');
    
    // Extract thumbnail and get video duration
    const { thumbnailUrl, duration } = await extractAndUploadThumbnail(videoS3Path, thumbnailS3Path);

    // Generate a video preview url for the video
    const getCommand = new GetObjectCommand({
      Bucket: process.env.VIDEO_BUCKET,
      Key: videoS3Path,
    });
    const videoPreviewUrl = await getSignedUrl(s3 as any, getCommand as any, { expiresIn: 3600 });

    // Use UpdateCommand to update only specific attributes:
    await withRetry(
      async () => docClient.send(new UpdateCommand({
        TableName: process.env.INDEXES_TABLE,
        Key: { 
          indexId,
          videoId 
        },
        UpdateExpression: "SET video_status = :status, updated_at = :updated_at",
        ExpressionAttributeValues: {
          ":status": "uploaded",
          ":updated_at": new Date().toISOString()
        }
      })),
      3,
      `Update indexes table with status uploaded and updated_at`
    );

    // Format the duration as a human-readable string (HH:MM:SS)
    const formatDuration = (ms: number): string => {
      if (!ms) return '00:00:00';
      
      const totalSeconds = Math.floor(ms / 1000);
      const hours = Math.floor(totalSeconds / 3600);
      const minutes = Math.floor((totalSeconds % 3600) / 60);
      const seconds = totalSeconds % 60;
      
      return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    };

    // Use update operation with document ID instead of updateByQuery
    // This is better supported in OpenSearch Serverless
    await withRetry(
      async () => openSearch.update({
        index: indexId,
        id: documentId, // Use the document ID from search results
        body: {
          doc: {
            video_status: 'uploaded',
            video_preview_url: videoPreviewUrl,
            video_thumbnail_s3_path: thumbnailS3Path,
            video_thumbnail_url: thumbnailUrl,
            video_duration: formatDuration(duration),
            updated_at: new Date().toISOString()
          }
        }
      }),
      3,
      `Update OpenSearch with additional metadata for video ${videoId} in index ${indexId}`
    );

    return {
      statusCode: STATUS_CODES.OK,
      headers: corsHeaders,
      body: JSON.stringify({
        message: 'Upload completed successfully',
        indexId,
        videoId,
        status: 'processing',
        videoPreviewUrl
      })
    };
  } catch (error) {
    console.error('Error completing upload:', error);
    return {
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      body: JSON.stringify({ error: error }),
      headers: corsHeaders
    }
  }
}

async function extractAndUploadThumbnail(videoS3Path: string, thumbnailS3Path: string): Promise<{ thumbnailUrl: string; duration: number }> {
  try {
    console.log(`Extracting thumbnail from video: ${videoS3Path} to ${thumbnailS3Path}`);
    
    // Create temporary file paths for processing
    const tempDir = '/tmp';
    const tempVideoPath = `${tempDir}/${Date.now()}-video.mp4`;
    const tempThumbnailPath = `${tempDir}/${Date.now()}-thumbnail.jpg`;
    
    // Download the video from S3
    const bucketName = process.env.VIDEO_BUCKET;
    if (!bucketName) {
      throw new Error('VIDEO_BUCKET environment variable is not set');
    }
    
    // Download the video file
    const getObjectCommand = new GetObjectCommand({
      Bucket: bucketName,
      Key: videoS3Path
    });
    
    const videoResponse = await s3.send(getObjectCommand);
    
    // Write the video to a temporary file
    if (!videoResponse.Body) {
      throw new Error('Failed to get video content from S3');
    }
    
    // Create the temp directory if it doesn't exist
    await fs.promises.mkdir(tempDir, { recursive: true });
    
    // Write the video data to the temp file
    const videoData = await streamToBuffer(videoResponse.Body as Readable);
    await fs.promises.writeFile(tempVideoPath, videoData);
    
    console.log(`Downloaded video to ${tempVideoPath}`);
    
    // Probe the video to get its duration
    let duration = 0;
    try {
      // Use ffprobe to get video duration
      const ffprobeCommand = [
        '-v', 'error',
        '-show_entries', 'format=duration',
        '-of', 'default=noprint_wrappers=1:nokey=1',
        tempVideoPath
      ];
      
      console.log(`Running ffprobe command: ffprobe ${ffprobeCommand.join(' ')}`);
      
      const ffprobeProcess = spawn('ffprobe', ffprobeCommand);
      let ffprobeOutput = '';
      
      ffprobeProcess.stdout.on('data', (data) => {
        ffprobeOutput += data.toString();
      });
      
      // Wait for the process to complete
      await new Promise<void>((resolve, reject) => {
        ffprobeProcess.on('close', (code) => {
          if (code === 0) {
            console.log('Successfully probed video duration');
            resolve();
          } else {
            reject(new Error(`ffprobe process exited with code ${code}`));
          }
        });
        
        ffprobeProcess.stderr.on('data', (data) => {
          console.log(`ffprobe stderr: ${data}`);
        });
      });
      
      // Parse the duration (in seconds) and convert to milliseconds
      duration = parseFloat(ffprobeOutput.trim()) * 1000;
      console.log(`Video duration: ${duration}ms`);
    } catch (probeError) {
      console.error('Error probing video duration:', probeError);
      // Continue with thumbnail extraction even if duration probe fails
    }
    
    // Use ffmpeg to extract a thumbnail from the video
    const ffmpegCommand = [
      '-i', tempVideoPath,
      '-ss', '00:00:06', // Take frame at 6 seconds instead of 1 second to avoid black frames
      '-vframes', '1',   // Extract 1 frame
      '-q:v', '2',       // High quality
      tempThumbnailPath
    ];
    
    console.log(`Running ffmpeg command: ffmpeg ${ffmpegCommand.join(' ')}`);
    
    // Execute ffmpeg command
    const ffmpegProcess = spawn('ffmpeg', ffmpegCommand);
    
    // Wait for the process to complete
    await new Promise<void>((resolve, reject) => {
      ffmpegProcess.on('close', (code) => {
        if (code === 0) {
          console.log('Successfully extracted thumbnail');
          resolve();
        } else {
          reject(new Error(`ffmpeg process exited with code ${code}`));
        }
      });
      
      ffmpegProcess.stderr.on('data', (data) => {
        console.log(`ffmpeg stderr: ${data}`);
      });
    });
    
    // Check if thumbnail was created
    try {
      await fs.promises.access(tempThumbnailPath);
    } catch (error) {
      console.error('Thumbnail file was not created:', error);
      throw new Error('Failed to create thumbnail');
    }
    
    // Upload the thumbnail to S3
    const thumbnailData = await fs.promises.readFile(tempThumbnailPath);
    
    const putObjectCommand = new PutObjectCommand({
      Bucket: bucketName,
      Key: thumbnailS3Path,
      Body: thumbnailData,
      ContentType: 'image/jpeg'
    });
    
    await s3.send(putObjectCommand);
    console.log(`Uploaded thumbnail to S3: ${thumbnailS3Path}`);
    
    // Generate a signed URL for the thumbnail
    const getSignedUrlCommand = new GetObjectCommand({
      Bucket: bucketName,
      Key: thumbnailS3Path
    });
    
    const thumbnailUrl = await getSignedUrl(s3 as any, getSignedUrlCommand as any, { expiresIn: 3600 });
    
    // Clean up temporary files
    try {
      await fs.promises.unlink(tempVideoPath);
      await fs.promises.unlink(tempThumbnailPath);
      console.log('Cleaned up temporary files');
    } catch (cleanupError) {
      console.warn('Failed to clean up temporary files:', cleanupError);
    }
    
    return { thumbnailUrl, duration };
  } catch (error) {
    console.error('Error extracting and uploading thumbnail:', error);
    
    // If thumbnail extraction fails, create a default signed URL without the thumbnail
    const getSignedUrlCommand = new GetObjectCommand({
      Bucket: process.env.VIDEO_BUCKET,
      Key: thumbnailS3Path
    });
    
    // Return a signed URL even if the thumbnail doesn't exist yet
    // The client can handle missing thumbnails gracefully
    const thumbnailUrl = await getSignedUrl(s3 as any, getSignedUrlCommand as any, { expiresIn: 3600 });
    return { thumbnailUrl, duration: 0 };
  }
}

/**
 * Handle the merging of video segments
 */
async function handleMergeSegments(event: APIGatewayProxyEvent): Promise<LambdaResponse> {
  try {
    const request: MergeSegmentsRequest = JSON.parse(event.body!);
    const { indexId, videoId, segmentIds, mergedName } = request;

    console.log(`Handling segment merge request for video ${videoId} in index ${indexId}, segments: ${segmentIds.join(', ')}`);
    
    // Validate request parameters
    if (!indexId || !videoId || !segmentIds || segmentIds.length < 2) {
      return {
        statusCode: STATUS_CODES.BAD_REQUEST,
        headers: corsHeaders,
        body: JSON.stringify({ 
          error: 'Invalid request parameters',
          details: 'indexId, videoId, and at least 2 segmentIds are required'
        })
      };
    }

    // Get the original video info to extract timestamp and other metadata
    const { body: videoSearchResult } = await withRetry(
      async () => openSearch.search({
        index: indexId,
        body: {
          query: {
            term: {
              video_id: videoId
            }
          }
        }
      }),
      3,
      `Search for video ${videoId} in index ${indexId}`
    );

    if (!videoSearchResult.hits || !videoSearchResult.hits.hits || videoSearchResult.hits.hits.length === 0) {
      return {
        statusCode: STATUS_CODES.NOT_FOUND,
        headers: corsHeaders,
        body: JSON.stringify({ error: `Video ${videoId} not found in index ${indexId}` })
      };
    }

    // Extract video document and its OpenSearch ID
    const videoDocument = videoSearchResult.hits.hits[0]._source;
    const documentId = videoSearchResult.hits.hits[0]._id;
    
    // Get the original video S3 path to extract timestamp and path components
    const videoS3Path = videoDocument.video_s3_path;
    if (!videoS3Path) {
      return {
        statusCode: STATUS_CODES.BAD_REQUEST,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Original video S3 path not found' })
      };
    }

    // Extract timestamp from original video path (format: RawVideos/2025-03-02/indexId/videoId/...)
    const pathParts = videoS3Path.split('/');
    console.log("pathParts: ", pathParts);

    const timestamp = pathParts[1];
    
    // Get segments info
    const segments = await getSegmentDetails(indexId, videoId, segmentIds);
    
    if (!segments || segments.length === 0) {
      return {
        statusCode: STATUS_CODES.NOT_FOUND,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'No segments found for the provided IDs' })
      };
    }
    
    // Sort segments by start_time
    const sortedSegments = [...segments].sort((a, b) => a.start_time - b.start_time);
    
    // Create a merged segment name if not provided
    const mergedSegmentName = mergedName || `merged_${Date.now()}`;
    const mergedFilename = `${mergedSegmentName}.mp4`;
    
    // Define S3 paths for merged video and its thumbnail
    const mergedVideoS3Path = `ProcessedVideos/${timestamp}/${indexId}/${videoId}/merged/${mergedFilename}`;
    const mergedThumbnailS3Path = mergedVideoS3Path.replace(/\.mp4$/i, '.jpg');
    
    // Create temporary directory for processing
    const tempDir = '/tmp';
    await fs.promises.mkdir(`${tempDir}/merge_${videoId}`, { recursive: true });
    
    // Download all segments to local storage
    const downloadedSegments = await downloadSegmentsToLocalStorage(segments);
    
    // Create FFmpeg concat file
    const concatFilePath = `${tempDir}/merge_${videoId}/concat_list.txt`;
    await createFFmpegConcatFile(downloadedSegments, concatFilePath);
    
    // Merge segments using FFmpeg
    const mergedVideoPath = `${tempDir}/merge_${videoId}/merged_output.mp4`;
    await mergeVideoSegments(concatFilePath, mergedVideoPath);
    
    // Generate thumbnail for merged video
    const mergedThumbnailPath = `${tempDir}/merge_${videoId}/merged_thumbnail.jpg`;
    await generateThumbnail(mergedVideoPath, mergedThumbnailPath);
    
    // Upload merged video and thumbnail to S3
    const bucketName = process.env.VIDEO_BUCKET!;
    
    // Upload merged video
    await s3.send(new PutObjectCommand({
      Bucket: bucketName, 
      Key: mergedVideoS3Path,
      Body: fs.readFileSync(mergedVideoPath),
      ContentType: 'video/mp4'
    }));
    
    // Upload thumbnail
    await s3.send(new PutObjectCommand({
      Bucket: bucketName,
      Key: mergedThumbnailS3Path,
      Body: fs.readFileSync(mergedThumbnailPath),
      ContentType: 'image/jpeg'
    }));
    
    // Generate signed URLs
    const videoCommand = new GetObjectCommand({
      Bucket: bucketName,
      Key: mergedVideoS3Path
    });
    
    const thumbnailCommand = new GetObjectCommand({
      Bucket: bucketName,
      Key: mergedThumbnailS3Path
    });
    
    const [mergedVideoUrl, mergedThumbnailUrl] = await Promise.all([
      getSignedUrl(s3 as any, videoCommand as any, { expiresIn: 3600 }),
      getSignedUrl(s3 as any, thumbnailCommand as any, { expiresIn: 3600 })
    ]);
    
    // Calculate merged segment metadata
    const mergedSegmentId = `${videoId}_merged_${Date.now()}`;
    const startTime = sortedSegments[0].start_time;
    const endTime = sortedSegments[sortedSegments.length - 1].end_time;
    const duration = endTime - startTime;
    
    // Create merged segment object
    const mergedSegment = {
      segment_id: mergedSegmentId,
      video_id: videoId,
      start_time: startTime,
      end_time: endTime,
      duration: duration,
      segment_video_s3_path: mergedVideoS3Path,
      segment_video_preview_url: mergedVideoUrl,
      segment_video_thumbnail_s3_path: mergedThumbnailS3Path,
      segment_video_thumbnail_url: mergedThumbnailUrl,
      segment_visual: {
        segment_visual_description: `Merged clip from ${sortedSegments.length} segments`
      }
    };
    
    // Add merged segment to OpenSearch document
    try {
      await openSearch.update({
        index: indexId,
        id: documentId,
        body: {
          script: {
            source: `
              // Initialize arrays if null
              if (ctx._source.video_segments == null) {
                ctx._source.video_segments = [];
              }
              if (ctx._source.merged_segments == null) {
                ctx._source.merged_segments = [];
              }
              
              // Add merged segment to both arrays
              // Keep in video_segments for backward compatibility
              ctx._source.video_segments.add(params.mergedSegment);
              
              // Add to dedicated merged_segments array
              ctx._source.merged_segments.add(params.mergedSegment);
              
              ctx._source.updated_at = params.updated_at;
            `,
            params: {
              mergedSegment: mergedSegment,
              updated_at: new Date().toISOString()
            }
          }
        }
      });
      
      console.log(`Successfully added merged segment to OpenSearch document for video ${videoId}`);
    } catch (error) {
      console.error('Error updating OpenSearch document:', error);
      
      // Clean up S3 objects if OpenSearch update fails
      try {
        await s3.send(new DeleteObjectCommand({
          Bucket: bucketName,
          Key: mergedVideoS3Path
        }));
        
        await s3.send(new DeleteObjectCommand({
          Bucket: bucketName,
          Key: mergedThumbnailS3Path
        }));
      } catch (cleanupError) {
        console.warn('Error cleaning up S3 objects after failed update:', cleanupError);
      }
      
      return {
        statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
        headers: corsHeaders,
        body: JSON.stringify({ 
          error: 'Failed to update metadata for merged segment',
          details: error instanceof Error ? error.message : 'Unknown error'
        })
      };
    }
    
    // Clean up temporary files
    try {
      await fs.promises.rm(`${tempDir}/merge_${videoId}`, { recursive: true, force: true });
    } catch (cleanupError) {
      console.warn('Error cleaning up temporary files:', cleanupError);
    }
    
    // Return success response
    return {
      statusCode: STATUS_CODES.OK,
      headers: corsHeaders,
      body: JSON.stringify({
        message: 'Segments merged successfully',
        mergedSegment: mergedSegment
      })
    };
    
  } catch (error) {
    console.error('Error merging segments:', error);
    return {
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      headers: corsHeaders,
      body: JSON.stringify({ 
        error: 'Failed to merge segments', 
        details: error instanceof Error ? error.message : 'Unknown error'
      })
    };
  }
}

/**
 * Get segment details from OpenSearch
 */
async function getSegmentDetails(indexId: string, videoId: string, segmentIds: string[]): Promise<any[]> {
  const { body: searchResult } = await withRetry(
    async () => openSearch.search({
      index: indexId,
      body: {
        query: {
          term: {
            video_id: videoId
          }
        }
      }
    }),
    3,
    `Search for segments of video ${videoId} in index ${indexId}`
  );
  
  if (!searchResult.hits || !searchResult.hits.hits || searchResult.hits.hits.length === 0) {
    throw new Error(`Video ${videoId} not found in index ${indexId}`);
  }
  
  // Extract video segments from the search result
  const videoDocument = searchResult.hits.hits[0]._source;
  const videoSegments = videoDocument.video_segments || [];
  
  // Filter segments by segmentIds, in format of `${videoId}_segment_${segmentNumber}`
  const filteredSegments = videoSegments.filter((segment: any) => 
    segmentIds.includes(segment.segment_id)
  );
  
  return filteredSegments;
}

/**
 * Download segments to local storage
 */
async function downloadSegmentsToLocalStorage(segments: any[]): Promise<string[]> {
  const tempDir = '/tmp';
  const localPaths: string[] = [];
  const bucketName = process.env.VIDEO_BUCKET!;
  
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    const segmentS3Path = segment.segment_video_s3_path;
    
    if (!segmentS3Path) {
      console.warn(`Segment ${segment.segment_id} has no S3 path, skipping`);
      continue;
    }
    
    // Create local path for the segment
    const localPath = `${tempDir}/segment_${i}.mp4`;
    localPaths.push(localPath);
    
    // Download segment from S3
    const getCommand = new GetObjectCommand({
      Bucket: bucketName,
      Key: segmentS3Path
    });
    
    const response = await s3.send(getCommand);
    
    if (response.Body) {
      // Convert the response body to a buffer and write to file
      const data = await streamToBuffer(response.Body as Readable);
      await fs.promises.writeFile(localPath, data);
    } else {
      throw new Error(`Failed to download segment from S3: ${segmentS3Path}`);
    }
  }
  
  return localPaths;
}

/**
 * Create FFmpeg concat file
 */
async function createFFmpegConcatFile(segmentPaths: string[], outputPath: string): Promise<void> {
  let content = '';
  
  // Create file content in FFmpeg concat format
  for (const path of segmentPaths) {
    content += `file '${path}'\n`;
  }
  
  // Write content to file
  await fs.promises.writeFile(outputPath, content);
}

/**
 * Merge video segments using FFmpeg
 */
async function mergeVideoSegments(concatFilePath: string, outputPath: string): Promise<void> {
  // FFmpeg command to concatenate videos
  const ffmpegArgs = [
    '-f', 'concat',            // Use concat demuxer
    '-safe', '0',              // Don't validate filenames
    '-i', concatFilePath,      // Input file listing segments
    '-c:v', 'copy',            // Copy video codec without re-encoding
    '-c:a', 'copy',            // Copy audio codec without re-encoding
    outputPath                 // Output file
  ];
  
  console.log(`Running FFmpeg command: ffmpeg ${ffmpegArgs.join(' ')}`);
  
  // Execute FFmpeg command
  const ffmpegProcess = spawn('ffmpeg', ffmpegArgs);
  
  // Wait for the process to complete
  await new Promise<void>((resolve, reject) => {
    ffmpegProcess.on('close', (code) => {
      if (code === 0) {
        console.log('Successfully merged video segments');
        resolve();
      } else {
        reject(new Error(`FFmpeg process exited with code ${code}`));
      }
    });
    
    ffmpegProcess.stderr.on('data', (data) => {
      console.log(`FFmpeg stderr: ${data}`);
    });
  });
}

/**
 * Generate thumbnail from video
 */
async function generateThumbnail(videoPath: string, outputPath: string): Promise<void> {
  // FFmpeg command to extract a thumbnail
  const ffmpegArgs = [
    '-i', videoPath,          // Input file
    '-ss', '00:00:01',        // Position at 1 second
    '-vframes', '1',          // Extract 1 frame
    '-q:v', '2',              // High quality
    outputPath                // Output file
  ];
  
  console.log(`Running FFmpeg command: ffmpeg ${ffmpegArgs.join(' ')}`);
  
  // Execute FFmpeg command
  const ffmpegProcess = spawn('ffmpeg', ffmpegArgs);
  
  // Wait for the process to complete
  await new Promise<void>((resolve, reject) => {
    ffmpegProcess.on('close', (code) => {
      if (code === 0) {
        console.log('Successfully extracted thumbnail');
        resolve();
      } else {
        reject(new Error(`FFmpeg process exited with code ${code}`));
      }
    });
    
    ffmpegProcess.stderr.on('data', (data) => {
      console.log(`FFmpeg stderr: ${data}`);
    });
  });
}

// Helper function to convert a readable stream to a buffer
async function streamToBuffer(stream: Readable): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    stream.on('error', reject);
    stream.on('end', () => resolve(Buffer.concat(chunks)));
  });
}
