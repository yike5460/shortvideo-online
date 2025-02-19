import { APIGatewayProxyEvent } from 'aws-lambda';
import { LambdaContext, LambdaResponse } from '../../types/aws-lambda';
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
    if (!event.body) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Missing request body' }),
        headers: {}
      };
    }

    // Handle different endpoints based on the path
    const path = event.path.toLowerCase();
    
    // Overall API Path:
    // ```http
    //   /videos/upload                         POST - Start upload
    //   /videos/upload/{uploadId}/complete     POST - Complete upload
    //   /videos/youtube                        POST - YouTube upload
    //   /videos/status/{videoId}              GET  - Check status
    //   /search                               POST - Search videos
    // ```
    if (path.endsWith('/upload')) {
      return handlePresignRequest(event);
    } else if (path.endsWith('/complete')) {
      return handleCompleteUpload(event);
    } else {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: 'Invalid endpoint' }),
        headers: {}
      };
    }

  } catch (error) {
    console.error('Error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error'
      }),
      headers: {}
    };
  }
};

async function handlePresignRequest(event: APIGatewayProxyEvent): Promise<LambdaResponse> {
  const request: PresignRequest = JSON.parse(event.body!);
  const videoId = uuidv4();
  const timestamp = new Date().toISOString().split('T')[0];
  const s3Key = `RawVideos/${timestamp}/${videoId}/original${path.extname(request.fileName)}`;

  // Create initial OpenSearch document
  await openSearch.index({
    index: 'videos',
    id: videoId,
    body: {
      video_id: videoId,
      video_s3_path: s3Key,
      video_name: request.fileName,
      video_size: request.fileSize,
      video_type: request.fileType,
      video_title: request.metadata?.title || path.basename(request.fileName),
      video_description: request.metadata?.description || '',
      video_tags: request.metadata?.tags || [],
      status: 'awaiting_upload',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }
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

  const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 3600 }); // URL expires in 1 hour

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
      doc: {
        status: 'completed',
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
} 