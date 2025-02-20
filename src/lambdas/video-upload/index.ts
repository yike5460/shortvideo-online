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

interface PresignRequest {
  fileName: string;
  fileType: string;
  fileSize: number;
  metadata: {
    title?: string;
    description?: string;
    tags?: string[];
  };
}

interface CompleteUploadRequest {
  videoId: string;
  fileName: string;
  fileSize: number;
  fileType: string;
}

export const handler = async (event: APIGatewayProxyEvent): Promise<LambdaResponse> => {
  try {
    // For GET requests, we don't need to check for body
    if (event.httpMethod !== 'GET' && !event.body) {
      return {
        statusCode: 400,
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
      statusCode: 404,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Invalid endpoint' })
    };

  } catch (error) {
    console.error('Error:', error);
    return {
      statusCode: 500,
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
        size: 100
      }
    });

    // Transform to match frontend VideoResult interface
    const videos: VideoResult[] = body.hits.hits.map((hit: any) => ({
      id: hit._id,
      title: hit._source.video_title,
      description: hit._source.video_description || '',
      thumbnailUrl: hit._source.video_thumbnail_url || '', // TODO: Generate thumbnails
      previewUrl: hit._source.video_s3_path,
      duration: hit._source.video_duration || 0,
      source: 'upload',
      sourceUrl: hit._source.video_s3_path,
      uploadDate: hit._source.created_at,
      format: hit._source.video_type,
      status: hit._source.video_status,
      size: hit._source.video_size,
      segments: hit._source.video_segments || []
    }));

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify(videos)
    };
  } catch (error) {
    console.error('Error listing videos:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Failed to list videos' })
    };
  }
}

async function handleGetVideo(videoId: string): Promise<LambdaResponse> {
  try {
    const { body } = await openSearch.get({
      index: 'videos',
      id: videoId
    });

    if (!body.found || body._source.video_status === 'deleted') {
      return {
        statusCode: 404,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Video not found' })
      };
    }

    // Transform to match frontend VideoResult interface
    const video: VideoResult = {
      id: body._id,
      title: body._source.video_title || '',
      description: body._source.video_description || '',
      thumbnailUrl: body._source.video_thumbnail_url || '', // TODO: Generate thumbnails
      previewUrl: body._source.video_s3_path,
      duration: body._source.video_duration || 0,
      source: 'upload',
      sourceUrl: body._source.video_s3_path,
      uploadDate: body._source.created_at,
      format: body._source.video_type,
      status: body._source.video_status,
      size: body._source.video_size,
      segments: body._source.video_segments || []
    };

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify(video)
    };
  } catch (error) {
    console.error('Error getting video:', error);
    return {
      statusCode: 500,
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
        statusCode: 404,
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
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ message: 'Video deleted successfully' })
    };
  } catch (error) {
    console.error('Error deleting video:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Failed to delete video' })
    };
  }
}

async function handlePresignRequest(event: APIGatewayProxyEvent): Promise<LambdaResponse> {
  const request: PresignRequest = JSON.parse(event.body!);
  const videoId = uuidv4();
  const timestamp = new Date().toISOString().split('T')[0];
  const s3Key = `RawVideos/${timestamp}/${videoId}/original${path.extname(request.fileName)}`;

  // Align body schema with VideoMetadata
  const aossInitialBody: VideoMetadata = {
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

  // Create initial OpenSearch document
  await openSearch.index({
    index: 'videos',
    id: videoId,
    body: aossInitialBody
  });

  // Test the OpenSearch connection
  const { body: testResult } = await openSearch.search({
    index: 'videos',
    body: {
      query: { match_all: {} }
    }
  });

  console.log('OpenSearch test result:', testResult);

  // Generate pre-signed URL
  const command = new PutObjectCommand({
    Bucket: process.env.VIDEO_BUCKET,
    Key: s3Key,
    ContentType: request.fileType,
    Metadata: {
      'video-id': videoId,
      'title': request.metadata?.title || '',
      'description': request.metadata?.description || '',
      'tags': request.metadata?.tags ? JSON.stringify(request.metadata.tags) : '[]'
    }
  });

  const uploadUrl = await getSignedUrl(s3 as any, command as any, { expiresIn: 3600 }); // URL expires in 1 hour

  return {
    statusCode: 200,
    headers: corsHeaders,
    body: JSON.stringify({
      uploadUrl,
      videoId,
      expiresIn: 3600
    })
  };
}

async function handleCompleteUpload(event: APIGatewayProxyEvent): Promise<LambdaResponse> {
  const request: CompleteUploadRequest = JSON.parse(event.body!);
  const { videoId, fileName, fileSize, fileType } = request;

  try {
    // Verify the video exists in OpenSearch
    const { body: searchResult } = await openSearch.get({
      index: 'videos',
      id: videoId
    });

    if (!searchResult.found) {
      return {
        statusCode: 404,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Video not found for video index ' + videoId })
      };
    }

    console.log('Search result before update:', searchResult);

    // Update OpenSearch with additional metadata
    await openSearch.update({
      index: 'videos',
      id: videoId,
      body: {
        doc: {  // Wrap update fields in 'doc'
          video_status: 'uploaded' as VideoStatus,
          updated_at: new Date().toISOString()
        }
      }
    });

    // Queue processing job
    await sqs.send(new SendMessageCommand({
      QueueUrl: process.env.QUEUE_URL,
      MessageBody: JSON.stringify({
        videoId,
        bucket: process.env.VIDEO_BUCKET,
        key: searchResult._source.video_s3_path
      })
    }));

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        message: 'Upload completed successfully',
        videoId,
        status: 'processing'
      })
    };
  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Internal server error' }),
      headers: corsHeaders
    }
  }
}