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
import { YouTubeCookieManager } from './youtube/cookie-manager';
// @ts-ignore
import * as multipart from 'lambda-multipart-parser';

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
    // Only handle POST /videos/youtube
    if (event.httpMethod !== 'POST') {
      return {
        statusCode: 405,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Method not allowed' })
      };
    }

    // Parse multipart form using lambda-multipart-parser
    const result = await multipart.parse(event);
    const videoUrl = result.videoUrl;
    const indexId = (result.indexId || 'videos').toLowerCase();
    const metadata = result.metadata ? JSON.parse(result.metadata) : {};
    const cookieFile = result.files.find((f: any) => f.fieldname === 'cookieFile');
    if (!videoUrl || !cookieFile) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Missing videoUrl or cookieFile' })
      };
    }
    const cookieFilePath = `/tmp/${cookieFile.filename}`;
    await fs.writeFile(cookieFilePath, cookieFile.content);
    // Debug: print out the uploaded cookie file content (first 20 lines, masked)
    try {
      const cookieContent = await fs.readFile(cookieFilePath, 'utf8');
      const cookieLines = cookieContent.split('\n').slice(0, 20).map(line => {
        if (line.startsWith('#') || line.trim() === '') return line;
        const parts = line.split('\t');
        if (parts.length >= 7) {
          return parts.slice(0, 6).join('\t') + '\t[MASKED]';
        }
        return line;
      });
      console.log(`[YouTube Download] Uploaded cookie file content (first 20 lines, masked):\n${cookieLines.join('\n')}`);
    } catch (err) {
      console.error('[YouTube Download] Failed to read uploaded cookie file for debug:', err);
    }

    // Generate videoId, s3Key, etc. as before
    const videoId = uuidv4();
    const timestamp = new Date().toISOString().split('T')[0];
    const videoFileName = `youtube_${Date.now()}.mp4`;
    const s3Key = `RawVideos/${timestamp}/${indexId}/${videoId}/${videoFileName}`;
    const createdAt = new Date().toISOString();
    
    // Check if the index exists and create if it doesn't
    try {
      const indexExists = await openSearch.indices.exists({ index: indexId });
      if (!indexExists.body) {
        console.log(`Index ${indexId} does not exist, creating it`);
        await openSearch.indices.create({ 
          index: indexId, 
          body: indexSettings 
        });
      }
    } catch (error) {
      console.error(`Error checking/creating index ${indexId}:`, error);
      // Continue anyway as the error might be that the index already exists
    }

    // Create initial metadata for both OpenSearch and DynamoDB
    const aossInitialBody: VideoMetadata = {
      video_index: indexId,
      video_id: videoId,
      video_s3_path: s3Key,
      video_name: videoFileName,
      video_source: 'youtube',
      video_title: metadata?.title || 'YouTube Video',
      video_description: metadata?.description || '',
      video_tags: metadata?.tags || [],
      video_status: 'downloading' as VideoStatus,
      created_at: createdAt,
      updated_at: createdAt
    };

    // Create initial entry in OpenSearch
    const indexResult = await withRetry(
      async () => openSearch.index({
        index: indexId,
        body: aossInitialBody
      }),
      3,
      `Index initial document for YouTube video ${videoId} in index ${indexId}`
    );
    
    // Record the indexId and videoId in DynamoDB
    await withRetry(
      async () => docClient.send(new PutCommand({
        TableName: process.env.INDEXES_TABLE,
        Item: {
          indexId,
          videoId,
          video_name: videoFileName,
          video_source: 'youtube',
          video_title: metadata?.title || 'YouTube Video',
          video_description: metadata?.description || '',
          video_tags: metadata?.tags || [],
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
      
      // Download the YouTube video using the provided cookie file
      await downloadFromYoutube(videoUrl, videoId, s3Key, indexId, cookieFilePath);
      
      // Process the video after download
      const thumbnailS3Path = s3Key.replace(/\.[^/.]+$/, '.jpg');
      await extractAndUploadThumbnail(s3Key, thumbnailS3Path);
      
      // Find the document ID from the search
      const { body: searchResult } = await openSearch.search({
        index: indexId,
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
          index: indexId,
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
          index: indexId,
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
            index: indexId,
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
              indexId,
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
      // Use ffmpeg to get video duration by parsing stderr
      const ffmpegPath = 'ffmpeg';
      const ffmpegCommand = ['-i', tempVideoPath];
      console.log(`Running ffmpeg command for duration: ${ffmpegPath} ${ffmpegCommand.join(' ')}`);
      const ffmpegProcess = spawn(ffmpegPath, ffmpegCommand);
      let ffmpegOutput = '';
      let ffmpegError = '';
      ffmpegProcess.stdout.on('data', (data) => {
        ffmpegOutput += data.toString();
      });
      ffmpegProcess.stderr.on('data', (data) => {
        ffmpegError += data.toString();
      });
      await new Promise<void>((resolve, reject) => {
        ffmpegProcess.on('close', (code) => {
          if (code === 0 || code === 1) { // ffmpeg returns 1 for info-only
            resolve();
          } else {
            reject(new Error(`ffmpeg process exited with code ${code}`));
          }
        });
      });
      // Parse duration from ffmpegError (ffmpeg prints info to stderr)
      const durationMatch = ffmpegError.match(/Duration: (\d+):(\d+):(\d+\.\d+)/);
      if (durationMatch) {
        const hours = parseInt(durationMatch[1], 10);
        const minutes = parseInt(durationMatch[2], 10);
        const seconds = parseFloat(durationMatch[3]);
        duration = ((hours * 60 + minutes) * 60 + seconds) * 1000; // ms
        console.log(`Video duration: ${duration}ms`);
      } else {
        console.warn('Could not parse duration from ffmpeg output');
      }
    } catch (probeError) {
      console.error('Error probing video duration with ffmpeg:', probeError);
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

async function downloadFromYoutube(url: string, videoId: string, s3Key: string, videoIndex: string, cookieFilePath: string): Promise<void> {
  console.log(`[YouTube Download] Starting download of video ${videoId} from URL: ${url}`);
  console.log(`[YouTube Download] Environment variables check:
    VIDEO_BUCKET: ${process.env.VIDEO_BUCKET ? 'Set' : 'MISSING!'}
    AWS_REGION: ${process.env.AWS_REGION || 'default'}`);
  
  const tempDir = '/tmp';
  const tempPath = `${tempDir}/${videoId}`;
  const cookiesTempPath = cookieFilePath;
  
  // Set LD_LIBRARY_PATH to include our custom lib directory
  process.env.LD_LIBRARY_PATH = '/opt/lib:' + (process.env.LD_LIBRARY_PATH || '');
  
  // Check if libz.so.1 and libnss3.so exists in our custom path
  try {
    await fs.access('/opt/lib/libz.so.1');
    console.log('[YouTube Download] Found libz.so.1 in custom path');
  } catch (error) {
    console.error('[YouTube Download] libz.so.1 not found in /opt/lib. Please ensure it is included in the Lambda layer.');
    throw new Error('Required library libz.so.1 not found in Lambda layer');
  }

  // Extract fresh YouTube cookies using the cookie manager, obsoleted by using the actual cookies file uploaded from the user
  // try {
  //   console.log('[YouTube Download] Extracting fresh YouTube cookies using headless Chrome');
  //   cookiesTempPath = await YouTubeCookieManager.extractCookies();
  //   console.log(`[YouTube Download] Successfully extracted cookies to ${cookiesTempPath}`);
  // } catch (error) {
  //   console.error('[YouTube Download] Failed to extract cookies:', error);
  //   // Try to use the fallback cookies file if it exists
  //   const fallbackCookiesPath = '/opt/bin/yt-dlp-cookies.txt';
  //   try {
  //     // Check if fallback cookie file exists
  //     await fs.access(fallbackCookiesPath);
  //     console.log(`[YouTube Download] Using fallback cookies from ${fallbackCookiesPath}`);
      
  //     // Copy the fallback cookies to temp folder
  //     const fallbackContent = await fs.readFile(fallbackCookiesPath, 'utf8');
  //     cookiesTempPath = path.join('/tmp', `youtube-fallback-cookies-${Date.now()}.txt`);
  //     await fs.writeFile(cookiesTempPath, fallbackContent);
  //     console.log(`[YouTube Download] Copied fallback cookies to ${cookiesTempPath}`);
  //   } catch (fallbackError) {
  //     console.error('[YouTube Download] No fallback cookies available:', fallbackError);
  //     throw new Error('Failed to extract YouTube cookies and no fallback available');
  //   }
  // }
  
  // // Check temp directory existence and permissions
  // try {
  //   const stats = await fs.stat(tempDir);
  //   console.log(`[YouTube Download] Temp directory exists: ${stats.isDirectory()}, Mode: ${stats.mode.toString(8)}`);
  // } catch (error: any) {
  //   console.error(`[YouTube Download] Temp directory check failed: ${error.message}`);
  // }

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

        // Clean up temporary files after successful upload
        try {
          await fs.unlink(tempPath);
          await fs.unlink(cookiesTempPath);
          console.log(`[YouTube Download] Cleaned up temporary files: ${tempPath} and cookies file`);
        } catch (error) {
          const unlinkError = error instanceof Error ? error : new Error('Unknown error');
          console.warn(`[YouTube Download] Failed to clean up temporary files: ${unlinkError.message}`);
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
