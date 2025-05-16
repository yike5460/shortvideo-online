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
const bedrock = new BedrockRuntimeClient({
  // Align with the inference profile region
  region: process.env.AWS_REGION || 'ap-northeast-1',
});

// Constants
const VIDEO_BUCKET = process.env.VIDEO_BUCKET || '';
const SESSIONS_TABLE = process.env.SESSIONS_TABLE || 'VideoUnderstandingSessions';
const SESSION_TTL = 60 * 60; // 1 hour in seconds
// Make sure the region is aligned with the inference profile
const NOVA_MODEL_ID = process.env.NOVA_MODEL_ID || 'apac.amazon.nova-pro-v1:0';
// External video understanding endpoint (Qwen-VL)
const EXTERNAL_VIDEO_UNDERSTANDING_ENDPOINT = process.env.EXTERNAL_VIDEO_UNDERSTANDING_ENDPOINT || '';

// Define question types for specialized prompts
enum QuestionType {
  HASHTAGS = 'hashtags',
  SUMMARY = 'summary',
  HIGHLIGHTS = 'highlights',
  CHAPTERS = 'chapters',
  CLASSIFICATION = 'classification',
  AUDIENCE = 'audience',
  TIMELINE = 'timeline',
  GENERAL = 'general'
}

// Helper function to format time in MM:SS format
function formatTime(seconds: number | string): string {
  if (typeof seconds === 'string') {
    // If it's already a string format, return it
    return seconds;
  }
  
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

// Function to detect question type
function detectQuestionType(question: string): QuestionType {
  const lowerQuestion = question.toLowerCase();
  /*
  Align with the sample questions in the frontend
  const SAMPLE_QUESTIONS = [
    "Generate hashtags and topics",
    "Summarize this video",
    "What are highlighted moments of this video",
    "Chapterize this video",
    "Classify this video based on Youtube categories, Output as JSON format",
    "What audience is the video suitable for, and why",
    "Break down the video by main event and timestamp"
  ];
  */
  
  if (lowerQuestion.includes('hashtag') || lowerQuestion.includes('topic')) {
    return QuestionType.HASHTAGS;
  } else if (lowerQuestion.includes('summarize') || lowerQuestion.includes('summary')) {
    return QuestionType.SUMMARY;
  } else if (lowerQuestion.includes('highlight') || lowerQuestion.includes('key moment')) {
    return QuestionType.HIGHLIGHTS;
  } else if (lowerQuestion.includes('chapter') || lowerQuestion.includes('section')) {
    return QuestionType.CHAPTERS;
  } else if (lowerQuestion.includes('classify') || lowerQuestion.includes('categor') || lowerQuestion.includes('json')) {
    return QuestionType.CLASSIFICATION;
  } else if (lowerQuestion.includes('audience') || lowerQuestion.includes('suitable for')) {
    return QuestionType.AUDIENCE;
  } else if (lowerQuestion.includes('main event') || lowerQuestion.includes('timeline') || lowerQuestion.includes('timestamp')) {
    return QuestionType.TIMELINE;
  } else {
    return QuestionType.GENERAL;
  }
}

// Function to enhance prompt based on question type
function enhancePrompt(question: string, videoMetadata: any): string {
  const questionType = detectQuestionType(question);
  const optimalFps = videoMetadata.fps || 1;
  const startTime = videoMetadata.startTime || '00:00:00';
  const duration = videoMetadata.duration || '';
  
  switch (questionType) {
    case QuestionType.HIGHLIGHTS:
      return `Please describe the video content and identify key events or actions in shots granularity with precise timestamps.
FPS sampling rate: ${optimalFps.toFixed(4)}
Video start time: ${startTime}
Video duration: ${formatTime(duration)}

For each shot, use the format: [MM:SS - MM:SS] Description of the shot.
Ensure each timestamp is accurate to the content being described.
Don't miss any shots and details in the video.

For example:
[00:00:00 - 00:01:00] A person is walking down a street.
[00:01:00 - 00:02:00] A car drives by.
[00:02:00 - 00:03:00] A person is talking on the phone.

Original question: ${question}`;
    
    case QuestionType.CHAPTERS:
      return `Please analyze this video and divide it into logical chapters or sections with timestamps.
Video duration: ${formatTime(duration)}

For each chapter, provide:
1. A clear, descriptive title
2. Start and end timestamps in [MM:SS] format
3. A brief summary of what happens in that chapter

Format your response as:
## Chapter 1: [Title]
[00:00 - MM:SS]
Brief description of this chapter's content.

## Chapter 2: [Title]
[MM:SS - MM:SS]
Brief description of this chapter's content.

Original question: ${question}`;
    
    case QuestionType.CLASSIFICATION:
      return `Please classify this video based on YouTube categories and output the result in JSON format.
Analyze the video content carefully and determine the most appropriate YouTube categories.

Your response should be in valid JSON format like this:
{
  "primaryCategory": "string",
  "secondaryCategories": ["string", "string"],
  "tags": ["string", "string", "string"],
  "contentRating": "string",
  "reasoning": "string"
}

Where:
- primaryCategory: The main YouTube category this video belongs to
- secondaryCategories: Array of other relevant categories
- tags: Array of relevant tags for this video
- contentRating: Age appropriateness (e.g., "General", "Teen", "Mature")
- reasoning: Brief explanation of why these categories were chosen

Original question: ${question}`;
    
    case QuestionType.HASHTAGS:
      return `Please generate relevant hashtags and topics for this video.
Watch the video carefully and identify:
1. The main subject matter
2. Key themes and concepts
3. Notable objects, people, or activities
4. Style, mood, or aesthetic elements
5. Trending or evergreen topics related to the content

Format your response as:

## Hashtags
#hashtag1 #hashtag2 #hashtag3 (provide at least 10 relevant hashtags)

## Topics
- Main topic 1
- Main topic 2
- Main topic 3 (provide 5-7 main topics)

## Keywords
keyword1, keyword2, keyword3 (provide 10-15 keywords)

Original question: ${question}`;
    
    case QuestionType.AUDIENCE:
      return `Please analyze this video and determine what audience it is most suitable for, and explain why.
Consider the following factors:
1. Age appropriateness
2. Content complexity
3. Subject matter interest
4. Educational value
5. Entertainment value
6. Cultural context
7. Prerequisites (knowledge or experience needed)

Format your response as:

## Primary Audience
Describe the main audience this video is best suited for

## Secondary Audiences
List any other audiences that might find value in this content

## Reasoning
Provide a detailed explanation of why this video is suitable for these audiences, citing specific elements from the video

## Content Advisories
Note any content that might be inappropriate or challenging for certain viewers

Original question: ${question}`;
    
    case QuestionType.TIMELINE:
      return `Please break down this video by main events and timestamps.
Video duration: ${formatTime(duration)}

Create a detailed timeline of the video, identifying:
1. All major events, scenes, or segments
2. Precise start and end timestamps for each event
3. Brief descriptions of what happens in each segment

Format your response as:

## Timeline
[00:00 - MM:SS] Description of first event
[MM:SS - MM:SS] Description of second event
[MM:SS - MM:SS] Description of third event
...and so on

Be comprehensive and don't miss any significant moments or transitions in the video.

Original question: ${question}`;
    
    case QuestionType.SUMMARY:
      return `Please provide a comprehensive summary of this video.
Video duration: ${formatTime(duration)}

Your summary should include:
1. The main subject or purpose of the video
2. Key points, arguments, or information presented
3. Important visual elements or demonstrations
4. The overall structure and flow
5. Any conclusions or calls to action

Format your response as a well-structured summary with paragraphs covering different aspects of the content.
Include a brief introduction and conclusion.

Original question: ${question}`;
    
    default:
      return question;
  }
}

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
  model?: string;  // Add model field
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
  model?: string;  // Add model field
}

// Interface for model processors
interface ModelProcessor {
  processVideo(s3Path: string, question: string, videoMetadata?: any): Promise<string>;
}

// Factory function to get the appropriate model processor
function getModelProcessor(model?: string): ModelProcessor {
  switch (model) {
    case 'nova':
      return {
        processVideo: processVideoWithNova
      };
    case 'qwen-vl-2.5':
      return {
        processVideo: processVideoWithQwenVL
      };
    default:
      // Default behavior: use Qwen-VL if external endpoint exists, otherwise Nova
      return {
        processVideo: async (s3Path: string, question: string, videoMetadata?: any) => {
          if (EXTERNAL_VIDEO_UNDERSTANDING_ENDPOINT) {
            return processVideoWithQwenVL(s3Path, question, videoMetadata);
          } else {
            return processVideoWithNova(s3Path, question, videoMetadata);
          }
        }
      };
  }
}

// Helper function to get video details from DynamoDB
async function getVideoDetails(videoId: string, indexId: string) {
  try {
    // Use the INDEXES_TABLE instead of VIDEOS_TABLE
    // The primary key is indexId and the sort key is videoId
    const params = {
      TableName: process.env.INDEXES_TABLE,
      Key: {
        indexId: indexId,
        videoId: videoId
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
async function processVideoWithNova(s3Path: string, question: string, videoMetadata?: any): Promise<string> {
  // Get video metadata if not provided
  videoMetadata = videoMetadata || {
    duration: 0,
    fps: 1,
    startTime: '00:00:00'
  };
  
  // Enhance the prompt based on question type
  const enhancedPrompt = enhancePrompt(question, videoMetadata);
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
              text: enhancedPrompt
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

// Helper function to process video with Qwen-VL
async function processVideoWithQwenVL(s3Path: string, question: string, videoMetadata?: any): Promise<string> {
  // Get video metadata if not provided
  videoMetadata = videoMetadata || {
    duration: 0,
    fps: 1,
    startTime: '00:00:00'
  };
  
  // Enhance the prompt based on question type
  const enhancedPrompt = enhancePrompt(question, videoMetadata);
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

    // Create the S3 URI
    const s3Uri = `s3://${bucket}/${key}`;
    
    // Create URL with query parameters
    const url = new URL(`${EXTERNAL_VIDEO_UNDERSTANDING_ENDPOINT}/predict`);
    url.searchParams.append('url', s3Uri);
    url.searchParams.append('prompt', enhancedPrompt);
    url.searchParams.append('input_type', 'video');
    
    console.log(`Making request to Qwen-VL endpoint: ${url.toString()}`);
    
    // Make a request to the Qwen-VL endpoint
    const response = await fetch(url.toString());
    
    if (!response.ok) {
      throw new Error(`Error from Qwen-VL endpoint: ${response.status} ${response.statusText}`);
    }
    
    const responseData = await response.json();
    
    // Extract the response text
    return responseData.response || '';
  } catch (error) {
    console.error('Error processing video with Qwen-VL:', error);
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
    const { videoId, indexId, question, model } = request;

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
      model,
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
      // Log the video details for debugging
      console.log('Video details from DynamoDB:', JSON.stringify(videoDetails, null, 2));
      
      // Get the S3 path from the video details
      const videoS3Path = videoDetails.video_s3_path || '';
      
      if (!videoS3Path) {
        console.error('No video_s3_path found in video details');
        throw new Error('Video S3 path not found in metadata');
      }
      // Extract video metadata
      const videoMetadata = {
        duration: videoDetails.video_duration || '00:00:00',  // Keep as string format since that's what's in DynamoDB
        // TODO: Note we don't have the fps in the metadata, which need to be calculated from the video duration and the number of frames dynamically, we use 1 as default for now
        fps: videoDetails.video_fps || 1,
        startTime: '00:00:00'
      };
      
      console.log('Video metadata:', JSON.stringify(videoMetadata, null, 2));
      
      // Get the appropriate model processor based on the selected model
      const modelProcessor = getModelProcessor(session.model);
      console.log(`Using model: ${session.model || 'default'}`);
      
      // Process the video with the selected model and enhanced prompt
      const response = await modelProcessor.processVideo(videoS3Path, session.question, videoMetadata);
      
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
