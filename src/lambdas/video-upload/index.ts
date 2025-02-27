import { APIGatewayProxyEvent } from 'aws-lambda';
import { LambdaContext, LambdaResponse } from '../../types/aws-lambda';
import { VideoMetadata, VideoStatus, VideoResult } from '../../types/common';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { Client } from '@opensearch-project/opensearch';
import { defaultProvider } from '@aws-sdk/credential-provider-node';
import { AwsSigv4Signer } from '@opensearch-project/opensearch/aws';
import { v4 as uuidv4 } from 'uuid';
import * as path from 'path';

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
  // Update the mappings to match the VideoMetadata schema
  mappings: {
    properties: {
      video_index: { type: 'keyword' },
      video_description: { type: 'text' },
      video_duration: { type: 'integer' },
      video_id: { type: 'keyword' },
      video_name: { type: 'keyword' },
      video_original_path: { type: 'keyword' },
      video_s3_path: { type: 'keyword' },
      video_size: { type: 'integer' },
      video_status: { type: 'keyword' },
      video_summary: { type: 'text' },
      video_tags: { type: 'keyword' },
      video_title: { type: 'text' },
      video_type: { type: 'keyword' },

      created_at: { type: 'date' },
      updated_at: { type: 'date' },
      error: { type: 'text' },
      segment_count: { type: 'integer' },
      total_duration: { type: 'integer' },
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

export const handler = async (event: APIGatewayProxyEvent): Promise<LambdaResponse> => {
  try {
    // For GET requests, we don't need to check for body
    if (event.httpMethod !== 'GET' && !event.body) {
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
    //   GET    /videos/{videoId}               - Get video details
    //   POST   /videos/upload                  - Start upload
    //   POST   /videos/upload/{videoId}/complete - Complete upload
    //   DELETE /videos/{videoId}               - Delete video
    // ```

    if (method === 'GET') {
      if (path === '/videos' || path.endsWith('/videos/')) {
        return handleListVideos();
      } else if (path.startsWith('/videos/')) {
        const videoId = path.split('/').pop();
        if (videoId) {
          return handleGetVideo(videoId);
        }
      }
    } else if (method === 'POST') {
      if (path.endsWith('/upload')) {
        return handlePresignRequest(event);
      } else if (path.endsWith('/complete')) {
        return handleCompleteUpload(event);
      }
    } else if (method === 'DELETE' && path.startsWith('/videos/')) {
      const videoId = path.split('/').pop();
      if (videoId) {
        return handleDeleteVideo(videoId);
      }
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

async function handleListVideos(): Promise<LambdaResponse> {
  try {
    // Add pagination parameters
    const pageSize = 20;  // Limit number of videos per request
    
    const { body } = await openSearch.search({
      index: 'videos',
      body: {
        query: {
          bool: {
            must_not: [
              { term: { video_status: 'deleted' } }
            ]
          }
        },
        sort: [{ created_at: { order: 'desc' } }],
        size: pageSize,
        // Only return necessary fields
        _source: [
          'video_id',
          'video_title',
          'video_description',
          'video_s3_path',
          'video_duration',
          'video_type',
          'video_status',
          'video_size',
          'created_at'
        ]
      }
    });

    // Transform to minimal VideoResult interface
    const videos: VideoResult[] = body.hits.hits.map((hit: any) => ({
      id: hit._id,
      title: hit._source.video_title || '',
      description: hit._source.video_description || '',
      thumbnailUrl: '', // Will be generated separately
      previewUrl: hit._source.video_s3_path,
      duration: hit._source.video_duration || 0,
      source: 'local' as const,
      uploadDate: hit._source.created_at,
      format: hit._source.video_type,
      status: hit._source.video_status,
      size: hit._source.video_size
    }));

    return {
      statusCode: STATUS_CODES.OK,
      headers: corsHeaders,
      body: JSON.stringify({
        videos,
        total: body.hits.total.value,
        hasMore: body.hits.total.value > pageSize
      })
    };
  } catch (error) {
    console.error('Error listing videos:', error);
    return {
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Failed to list videos' })
    };
  }
}

async function handleGetVideo(videoId: string): Promise<LambdaResponse> {
  try {
    const { body } = await openSearch.get({
      index: 'videos',
      id: videoId,
      // Only fetch required fields
      _source: [
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
      title: body._source.video_title || '',
      description: body._source.video_description || '',
      thumbnailUrl: '', // Will be generated separately
      previewUrl: body._source.video_s3_path,
      duration: body._source.video_duration || 0,
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

async function handleDeleteVideo(videoId: string): Promise<LambdaResponse> {
  try {
    // First get the video to check if it exists and get S3 path
    const { body } = await openSearch.get({
      index: 'videos',
      id: videoId
    });

    if (!body.found) {
      return {
        statusCode: STATUS_CODES.NOT_FOUND,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Video not found' })
      };
    }

    // Update video status to deleted
    await openSearch.update({
      index: 'videos',
      id: videoId,
      body: {
        doc: {
          video_status: 'deleted' as VideoStatus,
          updated_at: new Date().toISOString()
        }
      }
    });

    // Optional: Delete from S3 (you might want to keep files for a while)
    // await s3.send(new DeleteObjectCommand({
    //   Bucket: process.env.VIDEO_BUCKET,
    //   Key: body._source.video_s3_path
    // }));

    return {
      statusCode: STATUS_CODES.OK,
      headers: corsHeaders,
      body: JSON.stringify({ message: 'Video deleted successfully' })
    };
  } catch (error) {
    console.error('Error deleting video:', error);
    return {
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Failed to delete video' })
    };
  }
}

async function handlePresignRequest(event: APIGatewayProxyEvent): Promise<LambdaResponse> {
  try {
    const request: PresignRequest = JSON.parse(event.body!);
    console.log('Presign request: ', request);
    // The video index will now be passed from the frontend with default value 'videos'
    const videoIndex = request.indexId || 'videos';
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
    try {
      const indexExists = await openSearch.indices.exists({ index: videoIndex });
      if (!indexExists.body) {
        console.log(`Index ${videoIndex} does not exist, creating it`);
        // Use the indexSettings object to create the index
        await openSearch.indices.create({ 
          index: videoIndex, 
          body: indexSettings 
        });
        console.log(`Successfully created index ${videoIndex}`);
      }
    } catch (error) {
      // Log the error but continue - we'll try to create the document anyway
      console.error(`Error checking/creating index ${videoIndex}:`, error);
      // If the error is not that the index already exists, try to create it
      if ((error as any).meta?.body?.error?.type !== 'resource_already_exists_exception') {
        try {
          console.log(`Attempting to create index ${videoIndex} after error`);
          await openSearch.indices.create({ 
            index: videoIndex,
            body: indexSettings 
          });
          console.log(`Successfully created index ${videoIndex} after error`);
        } catch (createError) {
          console.error(`Failed second attempt to create index ${videoIndex}:`, createError);
          // Continue anyway - the document creation might still work if the index exists
        }
      }
    }

    // Create initial OpenSearch document with error handling
    try {
      await openSearch.index({
        index: videoIndex,
        id: videoId,
        body: aossInitialBody
      });
      console.log(`Successfully indexed initial document for video ${videoId} in index ${videoIndex}`);
    } catch (indexError) {
      console.error(`Error indexing initial document for video ${videoId} in index ${videoIndex}:`, indexError);
      // If we can't index the document, we should still return a pre-signed URL
      // but log the error for debugging
    }

    // Test the OpenSearch connection - make this optional with error handling
    try {
      const { body: testResult } = await openSearch.search({
        index: videoIndex,
        body: {
          query: { match_all: {} }
        }
      });
      console.log(`OpenSearch test query result: ${JSON.stringify(testResult)}`);
    } catch (searchError) {
      // This is just a test query, so we can continue if it fails
      console.warn(`OpenSearch test query failed for index ${videoIndex}:`, searchError);
    }

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
  const { indexId, videoId } = request;
  console.log('Complete upload request: ', request);
  try {
    // Verify the video exists in OpenSearch
    const { body: searchResult } = await openSearch.get({
      index: indexId,
      id: videoId
    });

    if (!searchResult.found) {
      return {
        statusCode: STATUS_CODES.NOT_FOUND,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Video not found for video index ' + videoId })
      };
    }

    console.log('Search result before update:', searchResult);

    // Update OpenSearch with additional metadata
    await openSearch.update({
      index: indexId,
      id: videoId,
      body: {
        doc: {  // Wrap update fields in 'doc'
          video_status: 'uploaded' as VideoStatus,
          updated_at: new Date().toISOString()
        }
      }
    });

    // Queue processing job, using S3 event instead of SQS for now
    // await sqs.send(new SendMessageCommand({
    //   QueueUrl: process.env.QUEUE_URL,
    //   MessageBody: JSON.stringify({
    //     videoId,
    //     bucket: process.env.VIDEO_BUCKET,
    //     key: searchResult._source.video_s3_path
    //   })
    // }));

    return {
      statusCode: STATUS_CODES.OK,
      headers: corsHeaders,
      body: JSON.stringify({
        message: 'Upload completed successfully',
        indexId,
        videoId,
        status: 'processing'
      })
    };
  } catch (error) {
    return {
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      body: JSON.stringify({ error: error }),
      headers: corsHeaders
    }
  }
}