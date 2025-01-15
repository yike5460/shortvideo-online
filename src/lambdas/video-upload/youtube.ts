import { APIGatewayProxyEvent } from 'aws-lambda';
import { LambdaContext, LambdaResponse } from '../../types/aws-lambda';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { Client } from '@opensearch-project/opensearch';
import { defaultProvider } from '@aws-sdk/credential-provider-node';
import { AwsSigv4Signer } from '@opensearch-project/opensearch/aws';
import { v4 as uuidv4 } from 'uuid';
import { spawn } from 'child_process';
import { createReadStream } from 'fs';
import * as path from 'path';

// Initialize clients
const s3 = new S3Client({});
const sqs = new SQSClient({});
const openSearch = new Client({
  ...AwsSigv4Signer({
    region: process.env.AWS_REGION || 'us-east-1',
    service: 'es',
    getCredentials: () => {
      const credentialsProvider = defaultProvider();
      return credentialsProvider();
    },
  }),
  node: process.env.OPENSEARCH_ENDPOINT
});

interface YouTubeUploadRequest {
  videoUrl: string;
  metadata: {
    title?: string;
    description?: string;
    tags?: string[];
  };
}

export const handler = async (event: APIGatewayProxyEvent, _context: LambdaContext): Promise<LambdaResponse> => {
  try {
    if (!event.body) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Missing request body' })
      };
    }

    const request: YouTubeUploadRequest = JSON.parse(event.body);
    const videoId = uuidv4();
    const timestamp = new Date().toISOString().split('T')[0];
    const s3Key = `RawVideos/${timestamp}/${videoId}/original.mp4`;

    // Create initial OpenSearch document
    await openSearch.index({
      index: 'videos',
      id: videoId,
      body: {
        video_id: videoId,
        video_source: 'youtube',
        video_original_url: request.videoUrl,
        video_s3_path: s3Key,
        video_title: request.metadata?.title || '',
        video_description: request.metadata?.description || '',
        video_tags: request.metadata?.tags || [],
        status: 'downloading',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }
    });

    // Download from YouTube
    await downloadFromYoutube(request.videoUrl, videoId, s3Key);

    // Update OpenSearch status
    await openSearch.update({
      index: 'videos',
      id: videoId,
      body: {
        doc: {
          status: 'processing',
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
        key: s3Key
      })
    }));

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'YouTube video download initiated',
        videoId,
        status: 'processing'
      })
    };

  } catch (error) {
    console.error('YouTube download error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error'
      })
    };
  }
};

async function downloadFromYoutube(url: string, videoId: string, s3Key: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const tempPath = `/tmp/${videoId}`;
    const ytdl = spawn('yt-dlp', [
      '--format', 'best',
      '--output', tempPath,
      url
    ]);

    ytdl.stderr.on('data', (data) => {
      console.error(`yt-dlp error: ${data}`);
    });

    ytdl.on('close', async (code) => {
      if (code !== 0) {
        reject(new Error(`yt-dlp process exited with code ${code}`));
        return;
      }

      try {
        // Upload downloaded file to S3
        const fileStream = createReadStream(tempPath);
        await s3.send(new PutObjectCommand({
          Bucket: process.env.VIDEO_BUCKET,
          Key: s3Key,
          Body: fileStream,
          Metadata: {
            'video-source': 'youtube',
            'video-url': url
          }
        }));

        resolve();
      } catch (error) {
        reject(error);
      }
    });
  });
} 