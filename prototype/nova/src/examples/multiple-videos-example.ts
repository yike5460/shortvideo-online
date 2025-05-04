import { NovaClient } from '../utils/nova-client';
import path from 'path';
import fs from 'fs';
import { ContentType } from '../types/nova.types';

async function main() {
  try {
    // Paths to your local video files
    const videoPath1 = path.resolve(__dirname, '../../media/video1.mp4');
    const videoPath2 = path.resolve(__dirname, '../../media/video2.mp4');
    
    // Create a new Nova client
    const novaClient = new NovaClient();
    
    // Prepare video contents following the "placement matters" principle
    // Label each video for clear reference
    const videoContents: ContentType[] = [];
    
    // Add first video with label
    videoContents.push({ text: 'Video 1:' });
    const video1Base64 = fs.readFileSync(videoPath1).toString('base64');
    videoContents.push({
      video: {
        format: 'mp4',
        source: {
          bytes: video1Base64,
        },
      },
    });
    
    // Add second video with label
    videoContents.push({ text: 'Video 2:' });
    const video2Base64 = fs.readFileSync(videoPath2).toString('base64');
    videoContents.push({
      video: {
        format: 'mp4',
        source: {
          bytes: video2Base64,
        },
      },
    });
    
    // Define system messages for the model
    const systemMessages = [
      {
        text: 'You are an expert in video comparison. When given multiple videos, analyze the content and provide a detailed comparison between them.',
      },
    ];
    
    // Define the prompt to send with the videos
    const prompt = 'Compare the content of the two videos. What are the main differences and similarities between them?';
    
    // Process the videos with recommended inference parameters for video understanding
    const inferenceConfig = {
      maxTokens: 600,
      temperature: 0.1, // Slightly higher temperature for more creative comparison
      topP: 0.1,
      topK: 3, // Slightly higher topK for more nuanced response
    };
    
    console.log('Processing multiple videos...');
    const response = await novaClient.processMultipleVideos(
      videoContents,
      prompt,
      systemMessages,
      inferenceConfig
    );
    
    // Extract and print the text response
    const textResponse = novaClient.extractTextFromResponse(response);
    console.log('\nModel Response:');
    console.log(textResponse);
    
    // Print usage information
    console.log('\nToken Usage:');
    console.log(`Input Tokens: ${response.usage.inputTokens}`);
    console.log(`Output Tokens: ${response.usage.outputTokens}`);
    console.log(`Total Tokens: ${response.usage.totalTokens}`);
  } catch (error) {
    console.error('Error in multiple videos processing example:', error);
  }
}

// Run the example
main(); 