import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import * as fs from 'fs';
import * as path from 'path';
import { NovaResponse, SystemMessage, ContentType, InferenceConfig, Message } from '../types/nova.types';
import dotenv from 'dotenv';

dotenv.config();

// Define interface for Bedrock API request body
interface BedrockRequestBody {
  messages: Message[];
  inferenceConfig: {
    maxTokens?: number;
    temperature?: number;
    topP?: number;
    topK?: number;
    stopSequences?: string[];
  };
  system?: SystemMessage[];
  [key: string]: any; // Allow for additional properties
}

export class NovaClient {
  private client: BedrockRuntimeClient;
  private modelId: string;

  constructor(modelId?: string) {
    this.client = new BedrockRuntimeClient({
      region: process.env.AWS_REGION || 'us-east-1',
    });
    // Make sure to use the correct model ID format
    // For Nova, model IDs should include the region prefix if necessary
    this.modelId = modelId || process.env.NOVA_MODEL_ID || 'amazon.nova-pro-v1:0';
  }

  /**
   * Process a local video file
   * @param videoPath Path to the local video file
   * @param prompt The prompt to send with the video
   * @param systemMessages Optional system messages
   * @param inferenceConfig Optional inference configuration
   * @returns The model response
   */
  public async processLocalVideo(
    videoPath: string,
    prompt: string,
    systemMessages?: SystemMessage[],
    inferenceConfig?: InferenceConfig
  ): Promise<NovaResponse> {
    try {
      const videoFormat = path.extname(videoPath).slice(1).toLowerCase();
      
      // Check file size before attempting to read
      const stats = fs.statSync(videoPath);
      const fileSizeInMB = stats.size / (1024 * 1024);
      console.log(`Video file size: ${fileSizeInMB.toFixed(2)} MB`);
      
      // Warn if file is large - might hit API limits
      if (fileSizeInMB > 10) {
        console.warn(`WARNING: Video file is ${fileSizeInMB.toFixed(2)} MB, which may exceed API limits. Consider reducing the file size.`);
      }
      
      // Read video file as binary data and encode as base64
      const videoBuffer = fs.readFileSync(videoPath);
      const videoBase64 = videoBuffer.toString('base64');

      // Following the format from the JavaScript SDK v3 examples
      const requestBody: BedrockRequestBody = {
        messages: [
          {
            role: 'user',
            content: [
              {
                video: {
                  format: videoFormat,
                  source: {
                    bytes: videoBase64
                  }
                }
              },
              {
                text: prompt
              }
            ]
          }
        ],
        inferenceConfig: {
          maxTokens: inferenceConfig?.maxTokens || 300
        }
      };

      // Add system messages if provided
      if (systemMessages && systemMessages.length > 0) {
        requestBody.system = systemMessages;
      }
      
      console.log(`Invoking model: ${this.modelId}`);
      console.log(`Request structure: ${Object.keys(requestBody).join(', ')}`);
      
      // Format matches JavaScript SDK v3 examples for Bedrock
      const command = new InvokeModelCommand({
        modelId: this.modelId,
        contentType: "application/json",
        accept: "application/json",
        body: JSON.stringify(requestBody)
      });

      const response = await this.client.send(command);
      const responseBody = JSON.parse(
        new TextDecoder().decode(response.body)
      ) as NovaResponse;
      
      return responseBody;
    } catch (error) {
      console.error('Error processing local video:', error);
      throw error;
    }
  }

  /**
   * Process a video from an S3 bucket
   * @param s3Uri S3 URI of the video file (s3://bucket-name/object-key)
   * @param format Video format (e.g., 'mp4')
   * @param prompt The prompt to send with the video
   * @param bucketOwner Optional bucket owner account ID
   * @param systemMessages Optional system messages
   * @param inferenceConfig Optional inference configuration
   * @returns The model response
   */
  public async processS3Video(
    s3Uri: string,
    format: string,
    prompt: string,
    bucketOwner?: string,
    systemMessages?: SystemMessage[],
    inferenceConfig?: InferenceConfig
  ): Promise<NovaResponse> {
    try {
      // Following the format from the JavaScript SDK v3 examples
      const requestBody: BedrockRequestBody = {
        messages: [
          {
            role: 'user',
            content: [
              {
                video: {
                  format: format,
                  source: {
                    s3Location: {
                      uri: s3Uri,
                      ...(bucketOwner && { bucketOwner })
                    }
                  }
                }
              },
              {
                text: prompt
              }
            ]
          }
        ],
        inferenceConfig: {
          maxTokens: inferenceConfig?.maxTokens || 300
        }
      };

      // Add system messages if provided
      if (systemMessages && systemMessages.length > 0) {
        requestBody.system = systemMessages;
      }
      
      console.log(`Invoking model: ${this.modelId}`);
      
      const command = new InvokeModelCommand({
        modelId: this.modelId,
        contentType: "application/json",
        accept: "application/json",
        body: JSON.stringify(requestBody)
      });

      const response = await this.client.send(command);
      const responseBody = JSON.parse(
        new TextDecoder().decode(response.body)
      ) as NovaResponse;
      
      return responseBody;
    } catch (error) {
      console.error('Error processing S3 video:', error);
      throw error;
    }
  }

  /**
   * Process multiple videos
   * @param videoContents Array of video content objects
   * @param prompt The prompt to send with the videos
   * @param systemMessages Optional system messages
   * @param inferenceConfig Optional inference configuration
   * @returns The model response
   */
  public async processMultipleVideos(
    videoContents: ContentType[],
    prompt: string,
    systemMessages?: SystemMessage[],
    inferenceConfig?: InferenceConfig
  ): Promise<NovaResponse> {
    try {
      // Prepare content for multiple videos
      const allContent = [...videoContents, { text: prompt }];
      
      // Following JavaScript SDK format
      const requestBody: BedrockRequestBody = {
        messages: [
          {
            role: 'user',
            content: allContent
          }
        ],
        inferenceConfig: {
          maxTokens: inferenceConfig?.maxTokens || 300
        }
      };

      // Add system messages if provided
      if (systemMessages && systemMessages.length > 0) {
        requestBody.system = systemMessages;
      }
      
      console.log(`Invoking model with multiple videos: ${this.modelId}`);
      
      const command = new InvokeModelCommand({
        modelId: this.modelId,
        contentType: "application/json",
        accept: "application/json",
        body: JSON.stringify(requestBody)
      });

      const response = await this.client.send(command);
      const responseBody = JSON.parse(
        new TextDecoder().decode(response.body)
      ) as NovaResponse;
      
      return responseBody;
    } catch (error) {
      console.error('Error processing multiple videos:', error);
      throw error;
    }
  }

  /**
   * Extract the text content from the response
   * @param response The model response
   * @returns The extracted text
   */
  public extractTextFromResponse(response: NovaResponse): string {
    const textContent = response.output.message.content.find(
      (item) => 'text' in item
    ) as { text: string } | undefined;

    return textContent?.text || '';
  }
} 