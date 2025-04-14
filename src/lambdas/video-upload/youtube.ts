import { APIGatewayProxyEvent } from 'aws-lambda';
import { LambdaContext, LambdaResponse } from '../../types/aws-lambda';
import { VideoMetadata, VideoStatus } from '../../types/common';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { Client } from '@opensearch-project/opensearch';
import { defaultProvider } from '@aws-sdk/credential-provider-node';
import { AwsSigv4Signer } from '@opensearch-project/opensearch/aws';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { v4 as uuidv4 } from 'uuid';
import { spawn } from 'child_process';
import { createReadStream, promises as fs } from 'fs';
import * as path from 'path';
import { Readable } from 'stream';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';

// Initialize clients
const s3 = new S3Client({});
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

// Helper function to convert a readable stream to a buffer
async function streamToBuffer(stream: Readable): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    stream.on('error', reject);
    stream.on('end', () => resolve(Buffer.concat(chunks)));
  });
}
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
  'Access-Control-Allow-Credentials': 'true'
};

// Common settings for the OpenSearch index
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

interface YouTubeUploadRequest {
  videoUrl: string;
  metadata: {
    title?: string;
    description?: string;
    tags?: string[];
  };
  indexId?: string;  // Added to support custom index names
}

/**
 * Utility function to perform OpenSearch operations with retry logic
 */
async function withRetry<T>(
  operation: () => Promise<T>,
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

export const handler = async (event: APIGatewayProxyEvent, _context: LambdaContext): Promise<LambdaResponse> => {
  try {
    if (!event.body) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Missing request body' })
      };
    }

    const request: YouTubeUploadRequest = JSON.parse(event.body);
    const videoUrl = request.videoUrl;
    // Use the provided indexId or default to 'videos'
    const videoIndex = (request.indexId || 'videos').toLowerCase();
    const videoId = uuidv4();
    const timestamp = new Date().toISOString().split('T')[0];
    const videoFileName = `youtube_${Date.now()}.mp4`;
    const s3Key = `RawVideos/${timestamp}/${videoIndex}/${videoId}/${videoFileName}`;
    const createdAt = new Date().toISOString();
    
    // Check if the index exists and create if it doesn't
    try {
      const indexExists = await openSearch.indices.exists({ index: videoIndex });
      if (!indexExists.body) {
        console.log(`Index ${videoIndex} does not exist, creating it`);
        await openSearch.indices.create({ 
          index: videoIndex, 
          body: indexSettings 
        });
      }
    } catch (error) {
      console.error(`Error checking/creating index ${videoIndex}:`, error);
      // Continue anyway as the error might be that the index already exists
    }

    // Create initial metadata for both OpenSearch and DynamoDB
    const aossInitialBody: VideoMetadata = {
      video_index: videoIndex,
      video_id: videoId,
      video_s3_path: s3Key,
      video_name: videoFileName,
      video_source: 'youtube',
      video_title: request.metadata?.title || 'YouTube Video',
      video_description: request.metadata?.description || '',
      video_tags: request.metadata?.tags || [],
      video_status: 'downloading' as VideoStatus,
      created_at: createdAt,
      updated_at: createdAt
    };

    // Create initial entry in OpenSearch
    const indexResult = await withRetry(
      async () => openSearch.index({
        index: videoIndex,
        body: aossInitialBody
      }),
      3,
      `Index initial document for YouTube video ${videoId} in index ${videoIndex}`
    );
    
    // Record the indexId and videoId in DynamoDB
    await withRetry(
      async () => docClient.send(new PutCommand({
        TableName: process.env.INDEXES_TABLE,
        Item: {
          indexId: videoIndex,
          videoId,
          video_name: videoFileName,
          video_source: 'youtube',
          video_title: request.metadata?.title || 'YouTube Video',
          video_description: request.metadata?.description || '',
          video_tags: request.metadata?.tags || [],
          video_status: 'downloading' as VideoStatus,
          created_at: createdAt,
          updated_at: createdAt
        }
      })),
      3,
      `Record indexId and videoId in indexes table for YouTube video`
    );

    try {
      console.log(`[YouTube Download] Processing YouTube download synchronously`);
      
      // Download the YouTube video and wait for it to complete
      await downloadFromYoutube(videoUrl, videoId, s3Key, videoIndex);
      
      // Process the video after download
      const thumbnailS3Path = s3Key.replace(/\.[^/.]+$/, '.jpg');
      await extractAndUploadThumbnail(s3Key, thumbnailS3Path);
      
      // Find the document ID from the search
      const { body: searchResult } = await openSearch.search({
        index: videoIndex,
        body: {
          query: {
            term: {
              video_id: videoId
            }
          }
        }
      });
      
      if (searchResult.hits && searchResult.hits.hits && searchResult.hits.hits.length > 0) {
        const documentId = searchResult.hits.hits[0]._id;
        
        // Generate a video preview URL
        const getCommand = new GetObjectCommand({
          Bucket: process.env.VIDEO_BUCKET,
          Key: s3Key,
        });
        const videoPreviewUrl = await getSignedUrl(s3 as any, getCommand as any, { expiresIn: 3600 });
        
        // Generate thumbnail URL
        const getThumbnailCommand = new GetObjectCommand({
          Bucket: process.env.VIDEO_BUCKET,
          Key: thumbnailS3Path,
        });
        const thumbnailUrl = await getSignedUrl(s3 as any, getThumbnailCommand as any, { expiresIn: 3600 });

        // Update both OpenSearch and DynamoDB with the processed info
        await openSearch.update({
          index: videoIndex,
          id: documentId,
          body: {
            doc: {
              video_status: 'uploaded',
              video_preview_url: videoPreviewUrl,
              video_thumbnail_s3_path: thumbnailS3Path,
              video_thumbnail_url: thumbnailUrl,
              updated_at: new Date().toISOString()
            }
          }
        });
        
        console.log(`[YouTube Download] Video successfully processed - S3 event will trigger slicing: ${s3Key}`);
      }
      
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          videoId,
          message: 'YouTube video processed successfully',
          status: 'uploaded'
        })
      };
    } catch (error) {
      // Update the status in OpenSearch and DynamoDB to reflect the error
      try {
        // Find the document ID from the search
        const { body: searchResult } = await openSearch.search({
          index: videoIndex,
          body: {
            query: {
              term: {
                video_id: videoId
              }
            }
          }
        });
        
        if (searchResult.hits && searchResult.hits.hits && searchResult.hits.hits.length > 0) {
          const documentId = searchResult.hits.hits[0]._id;
          
          // Update status to error
          await openSearch.update({
            index: videoIndex,
            id: documentId,
            body: {
              doc: {
                video_status: 'failed',
                error: error instanceof Error ? error.message : 'Unknown error',
                updated_at: new Date().toISOString()
              }
            }
          });
          
          // Update DynamoDB as well
          await docClient.send(new PutCommand({
            TableName: process.env.INDEXES_TABLE,
            Item: {
              indexId: videoIndex,
              videoId,
              video_status: 'failed' as VideoStatus,
              error: error instanceof Error ? error.message : 'Unknown error',
              updated_at: new Date().toISOString()
            }
          }));
        }
      } catch (updateError) {
        console.error('Failed to update error status:', updateError);
      }
      
      // Re-throw the error to be caught by the main try/catch
      throw error;
    }

  } catch (error) {
    console.error('YouTube download error:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error'
      })
    };
  }
};

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
    await fs.mkdir(tempDir, { recursive: true });
    
    // Write the video data to the temp file
    const videoData = await streamToBuffer(videoResponse.Body as Readable);
    await fs.writeFile(tempVideoPath, videoData);
    
    console.log(`Downloaded video to ${tempVideoPath}`);
    
    // Probe the video to get its duration
    let duration = 0;
    try {
      // Use ffprobe to get video duration
      const ffprobePath = '/opt/bin/ffprobe';
      const ffprobeCommand = [
        '-v', 'error',
        '-show_entries', 'format=duration',
        '-of', 'default=noprint_wrappers=1:nokey=1',
        tempVideoPath
      ];
      
      console.log(`Running ffprobe command: ${ffprobePath} ${ffprobeCommand.join(' ')}`);
      
      // Check if ffprobe exists and is executable
      try {
        await fs.access(ffprobePath, fs.constants.X_OK);
        console.log(`Found executable ffprobe binary at ${ffprobePath}`);
      } catch (error) {
        console.error(`Error accessing ffprobe binary: ${error}`);
        throw new Error('ffprobe binary not found or not executable in Lambda layer');
      }
      
      const ffprobeProcess = spawn(ffprobePath, ffprobeCommand);
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
      await fs.access(tempThumbnailPath);
    } catch (error) {
      console.error('Thumbnail file was not created:', error);
      throw new Error('Failed to create thumbnail');
    }
    
    // Upload the thumbnail to S3
    const thumbnailData = await fs.readFile(tempThumbnailPath);
    
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
      await fs.unlink(tempVideoPath);
      await fs.unlink(tempThumbnailPath);
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

async function downloadFromYoutube(url: string, videoId: string, s3Key: string, videoIndex: string): Promise<void> {
  console.log(`[YouTube Download] Starting download of video ${videoId} from URL: ${url}`);
  console.log(`[YouTube Download] Environment variables check:
    VIDEO_BUCKET: ${process.env.VIDEO_BUCKET ? 'Set' : 'MISSING!'}
    AWS_REGION: ${process.env.AWS_REGION || 'default'}`);
  
  const tempDir = '/tmp';
  const tempPath = `${tempDir}/${videoId}`;
  const cookiesSourcePath = '/opt/bin/yt-dlp-cookies.txt';
  const cookiesTempPath = `${tempDir}/yt-dlp-cookies.txt`;
  
  // Set LD_LIBRARY_PATH to include our custom lib directory
  process.env.LD_LIBRARY_PATH = '/opt/lib:' + (process.env.LD_LIBRARY_PATH || '');
  
  // Check if libz.so.1 exists in our custom path
  try {
    await fs.access('/opt/lib/libz.so.1');
    console.log('[YouTube Download] Found libz.so.1 in custom path');
  } catch (error) {
    console.error('[YouTube Download] libz.so.1 not found in /opt/lib. Please ensure it is included in the Lambda layer.');
    throw new Error('Required library libz.so.1 not found in Lambda layer');
  }

  // Copy cookies file to temp directory
  try {
    const cookiesContent = await fs.readFile(cookiesSourcePath, 'utf8');
    await fs.writeFile(cookiesTempPath, cookiesContent);
    console.log('[YouTube Download] Successfully copied cookies file to temp directory');
  } catch (error) {
    console.error('[YouTube Download] Failed to copy cookies file:', error);
    throw new Error('Failed to copy cookies file to temp directory');
  }
  
  // Check temp directory existence and permissions
  try {
    const stats = await fs.stat(tempDir);
    console.log(`[YouTube Download] Temp directory exists: ${stats.isDirectory()}, Mode: ${stats.mode.toString(8)}`);
  } catch (error: any) {
    console.error(`[YouTube Download] Temp directory check failed: ${error.message}`);
  }
  
  console.log(`[YouTube Download] Launching yt-dlp process for URL: ${url}`);
  
  // Directly use the yt-dlp binary path
  const ytdlpPath = '/opt/bin/yt-dlp';
  
  // Check if the binary exists and is executable
  try {
    await fs.access(ytdlpPath, fs.constants.X_OK);
    console.log(`[YouTube Download] Found executable yt-dlp binary at ${ytdlpPath}`);
  } catch (error: any) {
    console.error(`[YouTube Download] Error accessing yt-dlp binary: ${error.message}`);
  }
  
  return new Promise<void>((resolve, reject) => {
    // Launch YouTube downloader process using the direct binary path
    const ytdl = spawn(ytdlpPath, [
      '--verbose',              // Added for more detailed logs
      '--format', 'best',       // Get best quality
      '--no-warnings',          // Suppress warnings
      '--no-check-certificate', // Skip certificate validation
      '--prefer-insecure',      // Use HTTP instead of HTTPS if available
      '--ignore-errors',        // Skip unavailable videos in a playlist
      '--force-ipv4',           // Force IPv4 to avoid IPv6 issues
      '--no-cache-dir',         // Don't use cache directory
      '--output', tempPath,     // Output path
      '--socket-timeout', '30', // Increase socket timeout
      '--retries', '10',        // Number of retries for HTTP requests
      '--cookies', cookiesTempPath, // Use cookies file from temp directory
      url
    ], {
      env: {
        ...process.env,
        LD_LIBRARY_PATH: '/opt/lib:' + (process.env.LD_LIBRARY_PATH || '')
      }
    });

    let stdoutData = '';
    ytdl.stdout.on('data', (data) => {
      const output = data.toString();
      stdoutData += output;
      console.log(`[YouTube Download stdout] ${output}`);
    });

    ytdl.stderr.on('data', (data) => {
      console.error(`[YouTube Download stderr] ${data.toString()}`);
    });

    ytdl.on('close', async (code) => {
      console.log(`[YouTube Download] yt-dlp process exited with code ${code}`);
      if (code !== 0) {
        const error = new Error(`yt-dlp process exited with code ${code}`);
        console.error(`[YouTube Download] Failed with code ${code}. Stdout: ${stdoutData}`);
        reject(error);
        return;
      }

      try {
        console.log(`[YouTube Download] Download completed, checking file at ${tempPath}`);
        
        // Verify the file exists before attempting to upload
        try {
          const stats = await fs.stat(tempPath);
          console.log(`[YouTube Download] Downloaded file info: 
            - Size: ${stats.size} bytes
            - Created: ${stats.birthtime}
            - Permissions: ${stats.mode.toString(8)}`);
          
          if (stats.size === 0) {
            throw new Error('Downloaded file has zero size');
          }
        } catch (error) {
          const statError = error instanceof Error ? error : new Error('Unknown error');
          console.error(`[YouTube Download] File stat check failed: ${statError.message}`);
          reject(new Error(`Failed to access downloaded file: ${statError.message}`));
          return;
        }
        
        // Upload downloaded file to S3
        console.log(`[YouTube Download] Starting upload to S3: ${process.env.VIDEO_BUCKET}/${s3Key}`);
        const fileStream = createReadStream(tempPath);
        
        // Track errors in the file stream
        fileStream.on('error', (err) => {
          console.error(`[YouTube Download] File stream error: ${err.message}`);
        });
        
        // Upload the file
        await s3.send(new PutObjectCommand({
          Bucket: process.env.VIDEO_BUCKET,
          Key: s3Key,
          Body: fileStream,
          Metadata: {
            'video-source': 'youtube',
            'video-url': url,
            'video-id': videoId,
            'video-index': videoIndex
          }
        }));
        
        console.log(`[YouTube Download] Successfully uploaded video to S3: ${s3Key}`);

        // Clean up temporary file after successful upload
        try {
          await fs.unlink(tempPath);
          console.log(`[YouTube Download] Cleaned up temporary file: ${tempPath}`);
        } catch (error) {
          const unlinkError = error instanceof Error ? error : new Error('Unknown error');
          console.warn(`[YouTube Download] Failed to clean up temporary file: ${unlinkError.message}`);
        }

        resolve();
      } catch (error) {
        console.error(`[YouTube Download] S3 upload error: ${error instanceof Error ? error.message : JSON.stringify(error)}`);
        console.error(`[YouTube Download] S3 upload error stack: ${error instanceof Error ? error.stack : 'No stack trace'}`);
        reject(error);
      }
    });
  });
}
