import { APIGatewayProxyEvent } from 'aws-lambda';
import { LambdaContext, LambdaResponse } from '../../types/aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { v4 as uuidv4 } from 'uuid';
import * as crypto from 'crypto';

// Initialize AWS clients
const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const s3 = new S3Client({});
const bedrock = new BedrockRuntimeClient({});

// Constants
const VIDEO_BUCKET = process.env.VIDEO_BUCKET || '';
const SESSIONS_TABLE = process.env.SESSIONS_TABLE || 'VideoUnderstandingSessions';
const SESSION_TTL = 60 * 60; // 1 hour in seconds
const NOVA_MODEL_ID = process.env.NOVA_MODEL_ID || 'amazon.nova-pro-v1:0';

// CORS headers
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

// Interface for session data
interface SessionData {
  sessionId: string;
  videoId: string;
  indexId: string;
  question: string;
  status: 'pending' | 'processing' | 'completed' | 'error';
  createdAt: number;
  ttl: number;
  error?: string;
}

// Interface for the initialization request
interface InitRequest {
  videoId: string;
  indexId: string;
  question: string;
}

// Helper function to get video details from DynamoDB
async function getVideoDetails(videoId: string, indexId: string) {
  try {
    const params = {
      TableName: process.env.VIDEOS_TABLE || 'Videos',
      Key: {
        id: videoId,
        indexId: indexId
      }
    };

    const { Item } = await docClient.send(new GetCommand(params));
    return Item;
  } catch (error) {
    console.error('Error getting video details:', error);
    throw error;
  }
}

// Helper function to create a session
async function createSession(sessionData: SessionData): Promise<string> {
  try {
    const params = {
      TableName: SESSIONS_TABLE,
      Item: sessionData
    };

    await docClient.send(new PutCommand(params));
    return sessionData.sessionId;
  } catch (error) {
    console.error('Error creating session:', error);
    throw error;
  }
}

// Helper function to get a session
async function getSession(sessionId: string): Promise<SessionData | null> {
  try {
    const params = {
      TableName: SESSIONS_TABLE,
      Key: {
        sessionId
      }
    };

    const { Item } = await docClient.send(new GetCommand(params));
    return Item as SessionData || null;
  } catch (error) {
    console.error('Error getting session:', error);
    throw error;
  }
}

// Helper function to update a session
async function updateSession(sessionId: string, updates: Partial<SessionData>): Promise<void> {
  try {
    // First get the current session
    const session = await getSession(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    // Merge the updates with the current session
    const updatedSession = {
      ...session,
      ...updates
    };

    const params = {
      TableName: SESSIONS_TABLE,
      Item: updatedSession
    };

    await docClient.send(new PutCommand(params));
  } catch (error) {
    console.error('Error updating session:', error);
    throw error;
  }
}

// Helper function to process video with Nova
async function processVideoWithNova(s3Path: string, question: string): Promise<string> {
  try {
    // Parse S3 path
    let bucket = VIDEO_BUCKET;
    let key = s3Path;
    
    // If s3Path is a full s3:// URL, parse it
    if (s3Path.startsWith('s3://')) {
      s3Path = s3Path.replace('s3://', '');
      const parts = s3Path.split('/', 2);
      bucket = parts[0];
      key = parts.length > 1 ? parts.slice(1).join('/') : '';
    }
    
    if (!bucket) {
      throw new Error('No S3 bucket specified');
    }

    // Determine video format from file extension
    const format = key.split('.').pop()?.toLowerCase() || 'mp4';
    
    // Create the S3 URI
    const s3Uri = `s3://${bucket}/${key}`;
    
    // Define system messages for Nova
    const systemMessages = [
      {
        text: 'You are an expert video analyst. When given a video, provide detailed and accurate information about the content based on the user\'s question.',
      },
    ];
    
    // Prepare the request body for Nova
    const requestBody = {
      messages: [
        {
          role: 'user',
          content: [
            {
              video: {
                format: format,
                source: {
                  s3Location: {
                    uri: s3Uri
                  }
                }
              }
            },
            {
              text: question
            }
          ]
        }
      ],
      system: systemMessages,
      inferenceConfig: {
        maxTokens: 500,
        temperature: 0.2
      }
    };
    
    // Invoke the Nova model
    const command = new InvokeModelCommand({
      modelId: NOVA_MODEL_ID,
      contentType: "application/json",
      accept: "application/json",
      body: JSON.stringify(requestBody)
    });
    
    const response = await bedrock.send(command);
    const responseBody = JSON.parse(
      new TextDecoder().decode(response.body)
    );
    
    // Extract the text content from the response
    const textContent = responseBody.output.message.content.find(
      (item: any) => 'text' in item
    );
    
    return textContent?.text || '';
  } catch (error) {
    console.error('Error processing video with Nova:', error);
    throw error;
  }
}

// Handler for initializing a streaming session
export async function initHandler(event: APIGatewayProxyEvent): Promise<LambdaResponse> {
  try {
    if (!event.body) {
      return {
        statusCode: STATUS_CODES.BAD_REQUEST,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Missing request body' })
      };
    }

    const request: InitRequest = JSON.parse(event.body);
    const { videoId, indexId, question } = request;

    if (!videoId || !question) {
      return {
        statusCode: STATUS_CODES.BAD_REQUEST,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Missing required fields: videoId and question' })
      };
    }

    // Get video details
    const videoDetails = await getVideoDetails(videoId, indexId);
    if (!videoDetails) {
      return {
        statusCode: STATUS_CODES.NOT_FOUND,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Video not found' })
      };
    }

    // Create a new session
    const sessionId = crypto.createHash('md5').update(`${videoId}-${Date.now()}-${uuidv4()}`).digest('hex');
    const now = Math.floor(Date.now() / 1000);
    
    const sessionData: SessionData = {
      sessionId,
      videoId,
      indexId,
      question,
      status: 'pending',
      createdAt: now,
      ttl: now + SESSION_TTL
    };

    await createSession(sessionData);

    return {
      statusCode: STATUS_CODES.CREATED,
      headers: corsHeaders,
      body: JSON.stringify({ sessionId })
    };
  } catch (error) {
    console.error('Error initializing streaming session:', error);
    return {
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      headers: corsHeaders,
      body: JSON.stringify({ 
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error'
      })
    };
  }
}

// Handler for streaming responses
export async function streamHandler(event: APIGatewayProxyEvent): Promise<LambdaResponse> {
  try {
    const sessionId = event.pathParameters?.sessionId;
    
    if (!sessionId) {
      return {
        statusCode: STATUS_CODES.BAD_REQUEST,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Missing sessionId parameter' })
      };
    }

    // Get the session
    const session = await getSession(sessionId);
    if (!session) {
      return {
        statusCode: STATUS_CODES.NOT_FOUND,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Session not found' })
      };
    }

    // Set up SSE response headers
    const headers = {
      ...corsHeaders,
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    };

    // Update session status to processing
    await updateSession(sessionId, { status: 'processing' });

    try {
      // Get video details
      const videoDetails = await getVideoDetails(session.videoId, session.indexId);
      if (!videoDetails) {
        throw new Error('Video details not found');
      }

      // Process the video with Nova
      const videoS3Path = videoDetails.video_s3_path || '';
      const response = await processVideoWithNova(videoS3Path, session.question);
      
      // In a real implementation, we would stream chunks as they become available
      // For this implementation, we'll simulate streaming with chunks
      const chunks = simulateStreamingChunks(response);
      
      // Build the SSE response
      let sseResponse = '';
      
      // Add message events for each chunk
      for (const chunk of chunks) {
        sseResponse += `event: message\ndata: ${JSON.stringify({ text: chunk })}\n\n`;
      }
      
      // Add completion event
      sseResponse += `event: complete\ndata: {}\n\n`;
      
      // Update session status to completed
      await updateSession(sessionId, { status: 'completed' });
      
      return {
        statusCode: STATUS_CODES.OK,
        headers,
        body: sseResponse
      };
    } catch (error) {
      console.error('Error processing video:', error);
      
      // Update session status to error
      await updateSession(sessionId, { 
        status: 'error',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      
      // Send error event
      const errorEvent = `event: error\ndata: ${JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' })}\n\n`;
      
      return {
        statusCode: STATUS_CODES.OK,
        headers,
        body: errorEvent
      };
    }
  } catch (error) {
    console.error('Error in stream handler:', error);
    return {
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      headers: corsHeaders,
      body: JSON.stringify({ 
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error'
      })
    };
  }
}

// Helper function to simulate streaming chunks
function simulateStreamingChunks(fullResponse: string): string[] {
  // In a real implementation, this would be replaced with actual streaming from Nova
  const words = fullResponse.split(' ');
  const chunks = [];
  let currentChunk = '';
  
  for (const word of words) {
    currentChunk += word + ' ';
    
    // Create chunks of roughly 5-10 words
    if (currentChunk.split(' ').length > 5 + Math.floor(Math.random() * 5)) {
      chunks.push(currentChunk.trim());
      currentChunk = '';
    }
  }
  
  if (currentChunk) {
    chunks.push(currentChunk.trim());
  }
  
  return chunks;
}

// Main handler function
export const handler = async (event: APIGatewayProxyEvent, _context: LambdaContext): Promise<LambdaResponse> => {
  // Handle OPTIONS requests for CORS
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: ''
    };
  }

  // Route the request based on the path
  const path = event.path;
  
  if (path.endsWith('/videos/ask/init') && event.httpMethod === 'POST') {
    return await initHandler(event);
  } else if (path.match(/\/videos\/ask\/stream\/[^\/]+$/) && event.httpMethod === 'GET') {
    return await streamHandler(event);
  } else {
    return {
      statusCode: STATUS_CODES.NOT_FOUND,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Not found' })
    };
  }
};
