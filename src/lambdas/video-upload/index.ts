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
import { DynamoDBDocumentClient, PutCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
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
    number_of_replicas: 0
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
      video_segments: { type: 'object' }
    }
  }
};

interface PresignRequest {
  fileName: string;
  fileType: string;
  fileSize: number;
  indexId: string;
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

/**
 * Utility function to perform OpenSearch operations with retry logic
 * @param operation Function that performs the OpenSearch operation
 * @param maxRetries Maximum number of retry attempts
 * @param operationName Name of the operation for logging
 * @returns Result of the operation
 */
async function withRetry<T>(
  operation: () => Promise<T>, 
  maxRetries: number = 3, 
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
      
      // Exponential backoff: 4s, 16s, 64s
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
    // extra the index from the query string e.g. /videos/?index=videos
    const indexId = event.queryStringParameters?.index;
    
    // Add pagination parameters
    const pageSize = 20;  // Limit number of videos per request
    const page = parseInt(queryParams.page || '1', 10);
    const from = (page - 1) * pageSize;
    
    // Determine which index to search
    const searchIndex = indexId || '*';
    
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
        _source: [
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
        ]
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
      
      return await formatSearchResults(body, page, pageSize, from);
    } catch (sortError) {
      console.warn('Error sorting by created_at, trying without sort:', sortError);
      
      // If sorting fails, try again without sorting
      const { body } = await openSearch.search(searchQuery);

      console.log('Search results without sort: ', body);
      return await formatSearchResults(body, page, pageSize, from);
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

async function formatSearchResults(body: any, page: number, pageSize: number, from: number): Promise<LambdaResponse> {
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
      indexId: hit._source.video_index || 'videos'
    };
  }));

  return {
    statusCode: STATUS_CODES.OK,
    headers: corsHeaders,
    body: JSON.stringify({
      videos,
      total: body.hits.total?.value || videos.length,
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
    
    // Query OpenSearch for videos in this index with retry logic
    const { body } = await withRetry(
      async () => openSearch.search({
        index: indexId,
        body: {
          query: {
            bool: {
              must_not: [
                { term: { video_status: 'deleted' } }
              ]
            }
          },
          size: 100, // Limit to 100 videos
          _source: ['video_id', 'video_status', 'video_title', 'error', 'created_at']
        }
      }),
      3,
      `Search videos in index ${indexId}`
    );
    console.log(`Getting status for index: ${indexId} with body: ${JSON.stringify(body)}`);

    // Count videos by status
    const videos = body.hits.hits.map((hit: any) => ({
      id: hit._id,
      status: hit._source.video_status,
      title: hit._source.video_title,
      error: hit._source.error,
      uploadDate: hit._source.created_at,
      videoPreviewUrl: hit._source.video_preview_url
    }));
    
    const videoCount = videos.length;
    
    // Define which statuses are considered "complete"
    const completeStatuses: VideoStatus[] = ['ready'];
    
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
    
    // Check if a video has completed all processing steps
    // A video is considered fully processed if it has reached the 'ready_for_face', 
    // 'ready_for_object', and 'ready_for_shots' statuses
    const isFullyProcessed = (status: string): boolean => {
      return status === 'ready' || 
        (status === 'ready_for_face' || status === 'ready_for_object' || status === 'ready_for_shots');
    };
    
    // Count videos by their processing state
    const completedCount = videos.filter((v: any) => 
      completeStatuses.includes(v.status) || isFullyProcessed(v.status)
    ).length;
    
    const processingCount = videos.filter((v: any) => 
      processingStatuses.includes(v.status) && !isFullyProcessed(v.status)
    ).length;
    
    const failedCount = videos.filter((v: any) => 
      errorStatuses.includes(v.status)
    ).length;
    
    // Aggregate statuses in consideration of our support for multiple video statuses handling
    let status: WebVideoStatus = 'processing';
    if (videoCount === 0) {
      status = 'completed'; // No videos is technically "complete"
    } else if (failedCount > 0) {
      status = 'failed';
    } else if (processingCount === 0) {
      status = 'completed';
    }
    
    // Calculate progress percentage
    const progress = videoCount > 0 
      ? Math.round((completedCount / videoCount) * 100) 
      : 100;
    
    // Get the most recently created video
    const currentVideo = videos.sort((a: any, b: any) => new Date(b.uploadDate).getTime() - new Date(a.uploadDate).getTime())[0];
    
    // Format response to match IndexStatus interface in IndexProgress.tsx
    const response = {
      status,
      progress,
      videoCount,
      completedCount,
      failedCount,
      processingCount,
      currentVideo: currentVideo ? {
        id: currentVideo.id,
        name: currentVideo.title || 'Untitled Video',
        status: currentVideo.status,
        thumbnail: videos.videoPreviewUrl
      } : undefined
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

// Obsolete for now
async function handleGetVideo(videoId: string, indexId?: string): Promise<LambdaResponse> {
  try {
    // Use the provided index or default to 'videos'
    const searchIndex = indexId || 'videos';
    
    const { body } = await openSearch.get({
      index: searchIndex,
      id: videoId,
      // Only fetch required fields
      _source: [
        'video_index',
        'video_title',
        'video_description',
        'video_s3_path',
        'video_duration',
        'video_type',
        'video_status',
        'video_size',
        'created_at',
        // Only include basic segment info
        'video_segments.segment_id',
        'video_segments.start_time',
        'video_segments.end_time',
        'video_segments.duration',
        'video_segments.segment_visual.segment_visual_description'
      ]
    });

    if (!body.found || body._source.video_status === 'deleted') {
      return {
        statusCode: STATUS_CODES.NOT_FOUND,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Video not found' })
      };
    }

    // Transform to minimal VideoResult interface
    const video: VideoResult = {
      id: videoId,
      indexId: body._source.video_index || searchIndex,
      title: body._source.video_title || '',
      description: body._source.video_description || '',
      videoPreviewUrl: '', // Will be generated separately
      videoS3Path: body._source.video_s3_path,
      videoDuration: body._source.video_duration || '00:00:00',
      source: 'local' as const,
      uploadDate: body._source.created_at,
      format: body._source.video_type,
      status: body._source.video_status,
      size: body._source.video_size,
      // Only include essential segment information
      segments: (body._source.video_segments || []).map((segment: any) => ({
        segment_id: segment.segment_id,
        start_time: segment.start_time,
        end_time: segment.end_time,
        duration: segment.duration,
        description: segment.segment_visual?.segment_visual_description || ''
      }))
    };

    return {
      statusCode: STATUS_CODES.OK,
      headers: corsHeaders,
      body: JSON.stringify(video)
    };
  } catch (error) {
    console.error('Error getting video:', error);
    return {
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Failed to get video details' })
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
          _source: ['video_s3_path']
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
        const videoId = video._id;
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
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    // Create the index if it doesn't exist
    const indexExists = await openSearch.indices.exists({ index: videoIndex });
    if (!indexExists.body) {
      console.log(`Index ${videoIndex} does not exist, creating it`);
      // Use the indexSettings object to create the index
      const createResult = await withRetry(
        async () => openSearch.indices.create({ 
          index: videoIndex, 
          body: indexSettings 
        }),
        3,
        `Create index ${videoIndex}`
      );
      console.log(`Successfully created index ${videoIndex}`);
    }

    // Create initial OpenSearch document with error handling
    const indexResult = await withRetry(
      async () => openSearch.index({
        index: videoIndex,
        id: videoId,
        body: aossInitialBody
      }),
      3,
      `Index initial document for video ${videoId} in index ${videoIndex}`
    );
    console.log(`Successfully indexed initial document for video ${videoId} in index ${videoIndex}`);

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

  try {
    // Verify the video exists in OpenSearch
    const { body: searchResult } = await withRetry(
      async () => openSearch.get({
        index: indexId,
        id: videoId
      }),
      3,
      `Get video ${videoId} from index ${indexId}`
    );

    if (!searchResult.found) {
      return {
        statusCode: STATUS_CODES.NOT_FOUND,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Video not found for video index ' + videoId })
      };
    }
    
    // Extract the S3 key of the uploaded video, in format RawVideos/2025-03-02/indexId/videoId/videoFileNameWithExtension
    const videoS3Path = searchResult._source.video_s3_path;
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

    // Record the indexId and videoId in the indexes table
    await withRetry(
      async () => docClient.send(new PutCommand({
        TableName: process.env.INDEXES_TABLE,
        Item: {
          indexId,
          videoId,
          video_status: 'uploaded' as VideoStatus,
          updated_at: new Date().toISOString()
        }
      })),
      3,
      `Record indexId and videoId in indexes table`
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

    // Update the video metadata in OpenSearch with the thumbnail URL and duration
    await withRetry(
      async () => openSearch.update({
        index: indexId,
        id: videoId,
        body: {
          doc: {  // Wrap update fields in 'doc'
            video_status: 'uploaded' as VideoStatus,
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

// Helper function to convert a readable stream to a buffer
async function streamToBuffer(stream: Readable): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    stream.on('error', reject);
    stream.on('end', () => resolve(Buffer.concat(chunks)));
  });
}