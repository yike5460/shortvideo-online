import { APIGatewayProxyEvent } from 'aws-lambda';
import { LambdaContext, LambdaResponse, VideoUploadRequest } from '../../types/aws-lambda';
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
  node: process.env.OPENSEARCH_DOMAIN
});

export const handler = async (event: APIGatewayProxyEvent, _context: LambdaContext): Promise<LambdaResponse> => {
  try {
    if (!event.body) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Missing request body' })
      };
    }

    const request: VideoUploadRequest = JSON.parse(event.body);
    const videoId = uuidv4();
    const timestamp = new Date().toISOString().split('T')[0];
    const s3Key = `RawVideos/${timestamp}/${videoId}/${path.basename(request.path)}`;

    // Create initial OpenSearch document
    await openSearch.index({
      index: 'videos',
      id: videoId,
      body: {
        video_id: videoId,
        video_original_path: request.path,
        video_s3_path: s3Key,
        video_title: request.metadata?.title || path.basename(request.path),
        video_description: request.metadata?.description || '',
        status: 'uploading',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }
    });

    if (request.source === 'youtube') {
      // Download from YouTube using youtube-dl
      await downloadFromYoutube(request.path, videoId, s3Key);
    } else {
      // Upload local file to S3
      await uploadLocalFile(request.path, s3Key);
    }

    // Update OpenSearch status
    await openSearch.update({
      index: 'videos',
      id: videoId,
      body: {
        doc: {
          status: 'uploaded',
          updated_at: new Date().toISOString()
        }
      }
    });

    // Trigger video processing
    await sqs.send(new SendMessageCommand({
      QueueUrl: process.env.VIDEO_PROCESSING_QUEUE_URL,
      MessageBody: JSON.stringify({
        videoId,
        bucket: process.env.VIDEO_BUCKET,
        key: s3Key,
        metadata: request.metadata
      })
    }));

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'Video upload initiated',
        videoId,
        status: 'processing'
      })
    };

  } catch (error) {
    console.error('Upload error:', error);
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
    const ytdl = spawn('youtube-dl', [
      '--format', 'best',
      '--output', tempPath,
      url
    ]);

    ytdl.stderr.on('data', (data) => {
      console.error(`youtube-dl error: ${data}`);
    });

    ytdl.on('close', async (code) => {
      if (code !== 0) {
        reject(new Error(`youtube-dl process exited with code ${code}`));
        return;
      }

      try {
        // Upload downloaded file to S3
        const fileStream = createReadStream(tempPath);
        await s3.send(new PutObjectCommand({
          Bucket: process.env.VIDEO_BUCKET,
          Key: s3Key,
          Body: fileStream
        }));

        resolve();
      } catch (error) {
        reject(error);
      }
    });
  });
}

async function uploadLocalFile(localPath: string, s3Key: string): Promise<void> {
  const s3cmd = spawn('s3cmd', [
    'put',
    localPath,
    `s3://${process.env.VIDEO_BUCKET}/${s3Key}`,
    '--quiet'
  ]);

  return new Promise((resolve, reject) => {
    s3cmd.stderr.on('data', (data) => {
      console.error(`s3cmd error: ${data}`);
    });

    s3cmd.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`s3cmd process exited with code ${code}`));
      }
    });
  });
} 