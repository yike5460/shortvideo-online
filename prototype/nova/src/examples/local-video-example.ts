import { NovaClient } from '../utils/nova-client';
import path from 'path';
import fs from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';

// Promisify exec
const execAsync = promisify(exec);

// The maximum size of the video file to process, 25 MB for base64, and 1GB for S3 URI, refer to https://docs.aws.amazon.com/nova/latest/userguide/modalities-video.html#:~:text=The%20Amazon%20Nova%20models%20allow,S3%20URI%20for%20video%20understanding.
const MAX_RECOMMENDED_SIZE_MB = 25;

/**
 * Sleep for a specified number of milliseconds
 * @param ms Milliseconds to sleep
 * @returns Promise that resolves after the specified time
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Get video duration and format information using ffprobe
 * @param videoPath Path to the video file
 * @returns Promise that resolves with duration in seconds and other metadata
 */
async function getVideoMetadata(videoPath: string): Promise<{ duration: number, width: number, height: number, format: string }> {
  try {
    // Run ffprobe command to get video metadata in JSON format
    const { stdout } = await execAsync(
      `ffprobe -v error -select_streams v:0 -show_entries stream=width,height,duration,codec_name -show_entries format=duration -of json "${videoPath}"`
    );
    
    const data = JSON.parse(stdout);
    
    // Get duration from format (more reliable) or from stream if format duration is not available
    let duration: number;
    if (data.format && data.format.duration) {
      duration = parseFloat(data.format.duration);
    } else if (data.streams && data.streams[0] && data.streams[0].duration) {
      duration = parseFloat(data.streams[0].duration);
    } else {
      throw new Error('Could not determine video duration');
    }
    
    // Get width, height from first video stream
    const width = data.streams && data.streams[0] ? data.streams[0].width : 0;
    const height = data.streams && data.streams[0] ? data.streams[0].height : 0;
    const format = data.streams && data.streams[0] ? data.streams[0].codec_name : 'unknown';
    
    return { duration, width, height, format };
  } catch (error) {
    console.error('Error getting video metadata:', error);
    throw new Error(`Failed to get video metadata: ${error}`);
  }
}

/**
 * Calculate the optimal FPS based on video duration according to Nova documentation
 * @param durationInSeconds Video duration in seconds
 * @returns The calculated optimal FPS for sampling
 */
function calculateOptimalFps(durationInSeconds: number): number {
  // Convert seconds to minutes for easier comparison
  const durationInMinutes = durationInSeconds / 60;
  
  // For videos <= 16 minutes, use 1 FPS
  if (durationInMinutes <= 16) {
    return 1.0;
  }
  
  // For videos > 16 minutes, calculate FPS to maintain 960 frames total
  // 960 frames / (duration in seconds) = frames per second
  const optimalFps = 960 / durationInSeconds;
  
  return optimalFps;
}

/**
 * Format seconds to HH:MM:SS format
 * @param seconds Total seconds
 * @returns Formatted time string
 */
function formatTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Retry a function with exponential backoff
 * @param fn Function to retry
 * @param retries Maximum number of retries
 * @param initialDelay Initial delay in milliseconds
 * @param maxDelay Maximum delay in milliseconds
 * @returns Promise that resolves with the function result
 */
async function retryWithExponentialBackoff<T>(
  fn: () => Promise<T>,
  retries: number = 5,
  initialDelay: number = 1000,
  maxDelay: number = 60000
): Promise<T> {
  let currentDelay = initialDelay;
  let attempts = 0;
  
  while (true) {
    try {
      return await fn();
    } catch (error: any) {
      attempts++;
      
      // If we've reached the maximum number of retries, throw the error
      if (attempts >= retries) {
        throw error;
      }
      
      // Check if the error is a throttling error
      const isThrottlingError = error.toString().includes('ThrottlingException') ||
                               error.toString().includes('TooManyRequestsException') ||
                               error.toString().includes('Too many requests');
      
      // If it's not a throttling error, throw it
      if (!isThrottlingError) {
        throw error;
      }
      
      // Calculate the next delay with jitter (±20%)
      const jitter = currentDelay * (0.8 + Math.random() * 0.4);
      const nextDelay = Math.min(jitter, maxDelay);
      
      console.log(`API throttling detected. Retrying in ${(nextDelay/1000).toFixed(1)} seconds... (Attempt ${attempts} of ${retries})`);
      await sleep(nextDelay);
      
      // Exponential backoff: double the delay for the next attempt
      currentDelay = currentDelay * 2;
    }
  }
}

// npm run example:local-video -- media/small/Beach_small.mp4
async function main() {
  try {
    // Check if a specific video file is provided as a command-line argument
    const specifiedVideo = process.argv[2];
    
    // List of video files to process
    let videoFiles: string[] = [];
    
    if (specifiedVideo) {
      // Process the specified video file
      const videoPath = path.resolve(specifiedVideo);
      if (fs.existsSync(videoPath)) {
        videoFiles.push(videoPath);
        console.log(`Processing specified video: ${videoPath}`);
      } else {
        throw new Error(`Specified video file not found: ${videoPath}`);
      }
    } else {
      // Scan the media directory for all video files
      const mediaDir = path.resolve(__dirname, '../../media');
      
      // Check if the media directory exists
      if (!fs.existsSync(mediaDir)) {
        throw new Error(`Media directory not found: ${mediaDir}`);
      }
      
      // Get all files in the media directory
      const files = fs.readdirSync(mediaDir);
      
      // Filter for video files (common video extensions)
      const videoExtensions = ['.mp4', '.avi', '.mov', '.mkv', '.webm'];
      videoFiles = files
        .filter(file => {
          const ext = path.extname(file).toLowerCase();
          return videoExtensions.includes(ext);
        })
        .map(file => path.join(mediaDir, file));
      
      if (videoFiles.length === 0) {
        throw new Error(`No video files found in media directory: ${mediaDir}`);
      }
      
      console.log(`Found ${videoFiles.length} video files to process:`);
      videoFiles.forEach(file => console.log(`- ${path.basename(file)}`));
      console.log('\n');
    }
    
    // Filter out videos that are too large
    const sizeCheckedVideos = videoFiles.filter(videoPath => {
      try {
        const stats = fs.statSync(videoPath);
        const fileSizeInMB = stats.size / (1024 * 1024);
        const isWithinLimit = fileSizeInMB <= MAX_RECOMMENDED_SIZE_MB;
        
        if (!isWithinLimit) {
          console.warn(`⚠️ Skipping video that exceeds ${MAX_RECOMMENDED_SIZE_MB}MB: ${path.basename(videoPath)} (${fileSizeInMB.toFixed(2)}MB)`);
          console.warn(`Consider using a smaller video file or compressing this one.`);
        }
        
        return isWithinLimit;
      } catch (error) {
        console.error(`Error checking file size for ${videoPath}:`, error);
        return false;
      }
    });
    
    if (sizeCheckedVideos.length === 0) {
      console.error('\n❌ Error: No suitable video files found for processing.');
      console.error(`All videos exceed the recommended size limit of ${MAX_RECOMMENDED_SIZE_MB}MB.`);
      console.error('\nTry one of the following:');
      console.error('1. Add smaller video files to the media directory');
      console.error('2. Compress your videos to reduce file size');
      console.error('3. Specify a smaller video file directly: npm run example:local-video -- /path/to/small-video.mp4');
      return;
    }
    
    // Create a new Nova client with the Lite model to match what's in the JavaScript examples.
    /*Note nova premier models are not supported in internal account yet, 
    • amazon.nova-premier-v1:0:8k - Nova Premier with 8K context window
    • amazon.nova-premier-v1:0:20k - Nova Premier with 20K context window
    • amazon.nova-premier-v1:0:1000k - Nova Premier with 1000K context window
    • amazon.nova-premier-v1:0:mm - Nova Premier multimodal variant
    • amazon.nova-premier-v1:0 - Standard Nova Premier*/

    const novaClient = new NovaClient('amazon.nova-pro-v1:0');

    // Define system messages for the model
    const systemMessages = [
      {
        text: 'You are an expert video analyst. When given a video, provide a detailed description of the content and identify key events or actions with precise timestamps.',
      },
      // Mandarin system message
      // {
      //   text: '你是视频分析专家。当给定一个视频时，提供视频内容的详细描述，并用精确的时间戳识别关键事件或动作。',
      // },
    ];
    
    // Process each video file
    const results = [];
    for (const videoPath of sizeCheckedVideos) {
      console.log(`\nProcessing video: ${path.basename(videoPath)}...`);
      
      try {
        console.log(`Video file: ${videoPath}`);
        console.log(`Model ID: amazon.nova-pro-v1:0`);
        
        // Get video metadata using ffprobe
        console.log("Getting video metadata...");
        const videoMetadata = await getVideoMetadata(videoPath);
        console.log(`Video duration: ${videoMetadata.duration.toFixed(2)} seconds (${formatTime(videoMetadata.duration)})`);
        console.log(`Video resolution: ${videoMetadata.width}x${videoMetadata.height}`);
        console.log(`Video format: ${videoMetadata.format}`);
        
        // Calculate optimal FPS based on video duration
        const optimalFps = calculateOptimalFps(videoMetadata.duration);
        console.log(`Calculated optimal FPS: ${optimalFps.toFixed(4)}`);
        
        // Estimate token usage
        const estimatedFrames = Math.min(960, Math.ceil(videoMetadata.duration * optimalFps));
        const estimatedTokens = estimatedFrames * 288; // Approximately 288 tokens per frame based on the table
        console.log(`Estimated frames to be sampled: ${estimatedFrames}`);
        console.log(`Estimated input token usage: ${estimatedTokens}`);
        
        // Define the prompt to send with the video - include FPS and start time
        const startTime = "00:00:00"; // Start time is always 0 for full video
        const prompt = `Please describe the video content and identify key events or actions in shots granularity with precise timestamps. 
FPS sampling rate: ${optimalFps.toFixed(4)}
Video start time: ${startTime}
Video duration: ${formatTime(videoMetadata.duration)}

For each shot, use the format: [MM:SS - MM:SS] Description of the shot.
Ensure each timestamp is accurate to the content being described.
Don't miss any shots and details in the video.

For example:
[00:00:00 - 00:01:00] A person is walking down a street.
[00:01:00 - 00:02:00] A car drives by.
[00:02:00 - 00:03:00] A person is talking on the phone.`;
        
        // Process the video with recommended inference parameters for video understanding
        // Simplified to match JavaScript examples
        const inferenceConfig = {
          maxTokens: 400, // Increased from 300 to accommodate more detailed timestamps
        };
        
        const response = await retryWithExponentialBackoff(
          async () => {
            return await novaClient.processLocalVideo(
              videoPath,
              prompt,
              systemMessages,
              inferenceConfig
            );
          }
        );
        
        // Extract the text response
        const textResponse = novaClient.extractTextFromResponse(response);
        
        // Store the result
        results.push({
          videoPath,
          fileName: path.basename(videoPath),
          response: textResponse,
          metadata: {
            duration: videoMetadata.duration,
            fps: optimalFps,
            resolution: `${videoMetadata.width}x${videoMetadata.height}`,
            format: videoMetadata.format
          },
          usage: response.usage
        });
        
        // Print the result for this video
        console.log(`\nResults for ${path.basename(videoPath)}:`);
        console.log(textResponse);
        
        console.log('\nToken Usage:');
        console.log(`Input Tokens: ${response.usage.inputTokens}`);
        console.log(`Output Tokens: ${response.usage.outputTokens}`);
        console.log(`Total Tokens: ${response.usage.totalTokens}`);
        console.log('-----------------------------------------------');
      } catch (error: any) {
        console.error(`Error processing video ${path.basename(videoPath)}:`, error);
        // Provide more helpful error messages
        if (error.toString && error.toString().includes('ValidationException')) {
          console.error('\nThis appears to be a validation error with the API request.');
          console.error('Possible causes:');
          console.error('- The video file may be too large or in an unsupported format');
          console.error('- The video content may be corrupted');
          console.error('- There may be an issue with the AWS API service');
          console.error('\nTry using a different, smaller video file.');
        } else if (error.toString && error.toString().includes('ffprobe')) {
          console.error('\nError with ffprobe:');
          console.error('Make sure ffmpeg/ffprobe is installed on your system.');
          console.error('Installation instructions:');
          console.error('- macOS: brew install ffmpeg');
          console.error('- Ubuntu/Debian: sudo apt install ffmpeg');
          console.error('- Windows: Download from https://ffmpeg.org/download.html');
        }
        // Continue with next video instead of stopping the entire batch
        console.log('-----------------------------------------------');
      }
    }
    
    // Print summary of batch processing
    if (results.length > 0) {
      console.log('\n=== BATCH PROCESSING SUMMARY ===');
      console.log(`Total videos processed successfully: ${results.length} of ${sizeCheckedVideos.length}`);
      
      if (results.length > 0) {
        // Calculate total token usage
        const totalInputTokens = results.reduce((sum, result) => sum + result.usage.inputTokens, 0);
        const totalOutputTokens = results.reduce((sum, result) => sum + result.usage.outputTokens, 0);
        const totalTokens = results.reduce((sum, result) => sum + result.usage.totalTokens, 0);
        
        console.log('\nTotal Token Usage:');
        console.log(`Input Tokens: ${totalInputTokens}`);
        console.log(`Output Tokens: ${totalOutputTokens}`);
        console.log(`Total Tokens: ${totalTokens}`);
        
        // Save the batch results to a file
        const resultsOutput = results.map(result => ({
          fileName: result.fileName,
          description: result.response,
          metadata: result.metadata,
          tokenUsage: result.usage
        }));
        
        const outputPath = path.resolve(__dirname, '../../media/batch-results.json');
        fs.writeFileSync(outputPath, JSON.stringify(resultsOutput, null, 2));
        console.log(`\nBatch results saved to: ${outputPath}`);
      }
    } else {
      console.log('\n❌ No videos were processed successfully.');
      console.log('Please try using smaller video files (under 25MB (base64) is recommended for testing).');
    }
  } catch (error) {
    console.error('Error in video processing example:', error);
  }
}

// Run the example
main(); 