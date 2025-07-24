import { APIGatewayProxyEvent, SQSEvent } from 'aws-lambda';
import { LambdaContext, LambdaResponse } from '../../types/aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { Client } from '@opensearch-project/opensearch';
import { defaultProvider } from '@aws-sdk/credential-provider-node';
import { AwsSigv4Signer } from '@opensearch-project/opensearch/aws';
import { v4 as uuidv4 } from 'uuid';
import * as crypto from 'crypto';

// Initialize AWS clients
const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const s3 = new S3Client({});
const sqs = new SQSClient({});
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
// SQS queue for async processing
const PROCESSING_QUEUE_URL = process.env.PROCESSING_QUEUE_URL || '';

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
      return `Please identify key moments or highlights in this video with precise timestamps.
Video duration: ${formatTime(duration)}
FPS: ${optimalFps}
Video start time: ${startTime}

For each highlight:
1. Provide a concise, descriptive title
2. Include start and end timestamps in [MM:SS] format
3. Keep the description to a single concise sentence

Format your response EXACTLY as follows:

## Highlight 1: [Title]
[00:00 - MM:SS]
Brief single-sentence description of this highlight.

## Highlight 2: [Title]
[MM:SS - MM:SS]
Brief single-sentence description of this highlight.

Note that highlights may be non-consecutive moments in the video.

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
      return `Please classify this video based on YouTube categories and output the result in a simple JSON format.
Analyze the video content carefully and determine the most appropriate YouTube category.

Your response should be ONLY a valid JSON object with a single "category" key-value pair like this:
{
  "category": "Art & Craft"
}

Do not include any explanations, markdown formatting, or additional text before or after the JSON.
The output should be a valid JSON that can be directly parsed.

Original question: ${question}`;
    
    case QuestionType.HASHTAGS:
      return `Please generate relevant hashtags and topics for this video.
      Watch the video carefully and identify:
      1. The main subject matter
      2. Key themes and concepts
      3. Notable objects, people, or activities
      4. Style, mood, or aesthetic elements
      5. Trending or evergreen topics related to the content
      
      Format your response EXACTLY as follows:
      
      ## Hashtags
      #hashtag1 #hashtag2 #hashtag3 #hashtag4 #hashtag5 #hashtag6 #hashtag7 #hashtag8 #hashtag9 #hashtag10
      
      ## Topics
      A single concise sentence that captures the main topic of the video
      
      Original question: ${question}`;
    
    case QuestionType.AUDIENCE:
      return `Please analyze this video and determine what audience it is most suitable for.
Consider the following factors:
1. Age appropriateness
2. Content complexity
3. Subject matter interest
4. Educational value
5. Entertainment value
6. Cultural context
7. Prerequisites (knowledge or experience needed)

Format your response in an extremely concise, to-the-point manner without any markdown symbols or formatting. Structure your response EXACTLY as follows with each section on its own line:

Primary Audience: [Describe the main audience this video is best suited for in 1 sentence]

Secondary Audiences: [List any other audiences that might find value in this content in 1 sentence]

Content Advisories: [Note any content that might be inappropriate for certain viewers, if applicable, or "None" if there are no advisories]

For example:
Primary Audience: Young children and nature enthusiasts\n

Secondary Audiences: Educators, parents, and anyone interested in wildlife observation\n

Content Advisories: None

Keep your response clear, direct, and brief. Do not include any reasoning or explanations about why the video is suitable for these audiences. Do not use any special formatting or symbols.

Original question: ${question}`;
    
    case QuestionType.TIMELINE:
      return `Please break down this video by main events and timestamps.
Video duration: ${formatTime(duration)}

Create a detailed timeline of the video, identifying:
1. All major events, scenes, or segments
2. Precise start and end timestamps for each event in [MM:SS] format
3. Brief descriptions of what happens in each segment

Format your response as a bullet list with timestamps and descriptions. Do not include any markdown formatting symbols like "##" or section headers.

The output should look like this:

The video can be broken down into main events and timestamps as follows:

• [00:00 - 00:05] Description of first event
• [00:05 - 00:10] Description of second event
• [00:10 - 00:15] Description of third event
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

Format your response as a concise, well-structured summary without any markdown symbols. Use clear paragraphs with:
- A brief introduction
- Main content organized by key points
- A short conclusion

Keep the summary to the point and focused on the most important aspects of the video.

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
  bypassPromptEnhancement?: boolean;  // Flag to bypass prompt enhancement for raw analysis
  status: 'pending' | 'processing' | 'completed' | 'error';
  createdAt: number;
  ttl: number;
  error?: string;
  result?: string;  // Store the final result
  partialResult?: string;  // Store partial results for streaming
}

// Interface for the initialization request
interface InitRequest {
  videoId: string;
  indexId: string;
  question: string;
  model?: string;  // Add model field
  bypassPromptEnhancement?: boolean;  // Flag to bypass prompt enhancement for raw analysis
}

// Interface for model processors
interface ModelProcessor {
  processVideo(s3Path: string, question: string, videoMetadata?: any, bypassPromptEnhancement?: boolean): Promise<string>;
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
        processVideo: async (s3Path: string, question: string, videoMetadata?: any, bypassPromptEnhancement?: boolean) => {
          if (EXTERNAL_VIDEO_UNDERSTANDING_ENDPOINT) {
            return processVideoWithQwenVL(s3Path, question, videoMetadata, bypassPromptEnhancement);
          } else {
            return processVideoWithNova(s3Path, question, videoMetadata, bypassPromptEnhancement);
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
async function processVideoWithNova(s3Path: string, question: string, videoMetadata?: any, bypassPromptEnhancement?: boolean): Promise<string> {
  // Get video metadata if not provided
  videoMetadata = videoMetadata || {
    duration: 0,
    fps: 1,
    startTime: '00:00:00'
  };
  
  // Enhance the prompt based on question type, unless bypassing enhancement
  const shouldBypass = bypassPromptEnhancement === true;
  const enhancedPrompt = shouldBypass ? question : enhancePrompt(question, videoMetadata);
  
  // Log the bypass status for debugging
  console.log(`Nova processing - bypassPromptEnhancement: ${bypassPromptEnhancement} (${typeof bypassPromptEnhancement})`);
  console.log(`shouldBypass: ${shouldBypass}`);
  console.log(`Original question: ${question}`);
  console.log(`Enhanced prompt: ${enhancedPrompt.substring(0, 200)}...`);
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
async function processVideoWithQwenVL(s3Path: string, question: string, videoMetadata?: any, bypassPromptEnhancement?: boolean): Promise<string> {
  // Get video metadata if not provided
  videoMetadata = videoMetadata || {
    duration: 0,
    fps: 1,
    startTime: '00:00:00'
  };
  
  // Enhance the prompt based on question type, unless bypassing enhancement
  const shouldBypass = bypassPromptEnhancement === true;
  const enhancedPrompt = shouldBypass ? question : enhancePrompt(question, videoMetadata);
  
  // Log the bypass status for debugging
  console.log(`QwenVL processing - bypassPromptEnhancement: ${bypassPromptEnhancement} (${typeof bypassPromptEnhancement})`);
  console.log(`shouldBypass: ${shouldBypass}`);
  console.log(`Original question: ${question}`);
  console.log(`Enhanced prompt: ${enhancedPrompt.substring(0, 200)}...`);
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
    
    const responseData = await response.json() as any;
    
    // Extract the response text
    return responseData.response || '';
  } catch (error) {
    console.error('Error processing video with Qwen-VL:', error);
    throw error;
  }
}

// Handler for initializing an async processing session
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
    const { videoId, indexId, question, model, bypassPromptEnhancement = false } = request;
    
    // Debug log to see what's being received
    console.log('Request body:', JSON.stringify(request, null, 2));
    console.log('bypassPromptEnhancement value:', bypassPromptEnhancement, 'type:', typeof bypassPromptEnhancement);
    console.log('All request properties:', Object.keys(request));
    console.log('Raw event body:', event.body);

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
      bypassPromptEnhancement,
      status: 'pending',
      createdAt: now,
      ttl: now + SESSION_TTL
    };
    
    // Debug log session data
    console.log('Creating session with data:', JSON.stringify(sessionData, null, 2));

    await createSession(sessionData);

    // Queue the processing job
    if (PROCESSING_QUEUE_URL) {
      try {
        const sqsMessage = {
          QueueUrl: PROCESSING_QUEUE_URL,
          MessageBody: JSON.stringify({
            sessionId,
            videoId,
            indexId,
            question,
            model,
            bypassPromptEnhancement
          })
        };
        
        await sqs.send(new SendMessageCommand(sqsMessage));
        console.log(`Processing job queued for session ${sessionId}`);
      } catch (sqsError) {
        console.error('Error queuing processing job:', sqsError);
        // Update session status to error
        await updateSession(sessionId, { 
          status: 'error',
          error: 'Failed to queue processing job'
        });
        
        return {
          statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
          headers: corsHeaders,
          body: JSON.stringify({ error: 'Failed to queue processing job' })
        };
      }
    }

    return {
      statusCode: STATUS_CODES.CREATED,
      headers: corsHeaders,
      body: JSON.stringify({ sessionId })
    };
  } catch (error) {
    console.error('Error initializing async processing session:', error);
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

// Handler for checking processing status
export async function statusHandler(event: APIGatewayProxyEvent): Promise<LambdaResponse> {
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

    // Return the session status
    return {
      statusCode: STATUS_CODES.OK,
      headers: corsHeaders,
      body: JSON.stringify({
        sessionId,
        status: session.status,
        result: session.result,
        partialResult: session.partialResult,
        error: session.error
      })
    };
  } catch (error) {
    console.error('Error checking status:', error);
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

// Handler for video segmentation preview
export async function segmentationPreviewHandler(event: APIGatewayProxyEvent): Promise<LambdaResponse> {
  try {
    const { videoId, indexId } = event.pathParameters || {};
    
    if (!videoId || !indexId) {
      return {
        statusCode: STATUS_CODES.BAD_REQUEST,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Missing required parameters: videoId and indexId' })
      };
    }

    // Get video details from DynamoDB
    const videoDetails = await getVideoDetails(videoId, indexId);
    if (!videoDetails) {
      return {
        statusCode: STATUS_CODES.NOT_FOUND,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Video not found' })
      };
    }

    // Extract video segments from DynamoDB first (this contains the raw segment detection results)
    let segments = videoDetails.video_segments || [];
    
    // If no segments in DynamoDB, this might be an older video - segments are stored only in OpenSearch
    if (segments.length === 0) {
      console.log(`No segments found in DynamoDB for video ${videoId}, checking OpenSearch...`);
    }
    
    // Format segments for preview with thumbnail URLs
    const segmentPreviews = await Promise.all(
      segments.map(async (segment: any, index: number) => {
        let thumbnailUrl = segment.segment_video_thumbnail_url;
        
        // If no pre-signed URL exists, generate one from S3 path
        if (!thumbnailUrl && segment.segment_video_thumbnail_s3_path) {
          try {
            const bucket = VIDEO_BUCKET;
            // Handle both s3:// prefixed paths and direct S3 keys
            let key = segment.segment_video_thumbnail_s3_path;
            if (key.startsWith(`s3://${bucket}/`)) {
              key = key.replace(`s3://${bucket}/`, '');
            } else if (key.startsWith('s3://')) {
              // Handle s3://other-bucket/key format
              const s3Parts = key.replace('s3://', '').split('/', 1);
              if (s3Parts.length > 1) {
                key = key.replace(`s3://${s3Parts[0]}/`, '');
              }
            }
            // If key doesn't have s3:// prefix, use it directly
            
            const getObjectCommand = new GetObjectCommand({
              Bucket: bucket,
              Key: key
            });
            
            thumbnailUrl = await getSignedUrl(s3 as any, getObjectCommand as any, { expiresIn: 3600 });
          } catch (error) {
            console.error(`Error generating thumbnail URL for segment ${index}:`, error);
            thumbnailUrl = null;
          }
        }

        return {
          segment_id: segment.segment_id || `${videoId}_segment_${index}`,
          start_time: segment.start_time,
          end_time: segment.end_time,
          duration: segment.duration,
          confidence: segment.confidence,
          thumbnailUrl,
          segment_name: segment.segment_name || `Segment ${index + 1}`,
          segment_visual_description: segment.segment_visual?.segment_visual_description,
          segment_audio_description: segment.segment_audio?.segment_audio_description
        };
      })
    );

    // Return segmentation preview data
    return {
      statusCode: STATUS_CODES.OK,
      headers: corsHeaders,
      body: JSON.stringify({
        videoId,
        indexId,
        totalSegments: segments.length,
        videoDuration: videoDetails.video_duration,
        segments: segmentPreviews
      })
    };

  } catch (error) {
    console.error('Error in segmentation preview handler:', error);
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

// Handler for processing SQS messages
export async function sqsHandler(event: SQSEvent): Promise<void> {
  console.log('Processing SQS messages:', JSON.stringify(event, null, 2));
  
  for (const record of event.Records) {
    try {
      const message = JSON.parse(record.body);
      const { sessionId, videoId, indexId, question, model, bypassPromptEnhancement } = message;
      
      console.log(`Processing session ${sessionId}`);
      
      // Update session status to processing
      await updateSession(sessionId, { status: 'processing' });
      
      // Get video details
      const videoDetails = await getVideoDetails(videoId, indexId);
      if (!videoDetails) {
        console.error(`Video details not found for ${videoId}/${indexId}`);
        await updateSession(sessionId, { 
          status: 'error',
          error: 'Video details not found'
        });
        continue;
      }
      
      // Get the S3 path from the video details
      const videoS3Path = videoDetails.video_s3_path || '';
      
      if (!videoS3Path) {
        console.error('No video_s3_path found in video details');
        await updateSession(sessionId, { 
          status: 'error',
          error: 'Video S3 path not found in metadata'
        });
        continue;
      }
      
      // Extract video metadata
      const videoMetadata = {
        duration: videoDetails.video_duration || '00:00:00',
        fps: videoDetails.video_fps || 1,
        startTime: '00:00:00'
      };
      
      console.log('Video metadata:', JSON.stringify(videoMetadata, null, 2));
      
      // Get the appropriate model processor based on the selected model
      const modelProcessor = getModelProcessor(model);
      console.log(`Using model: ${model || 'default'}`);
      console.log(`Session bypassPromptEnhancement:`, bypassPromptEnhancement, 'type:', typeof bypassPromptEnhancement);
      
      // Process the video with the selected model
      const response = await modelProcessor.processVideo(videoS3Path, question, videoMetadata, bypassPromptEnhancement || false);
      
      // Update session with the result
      await updateSession(sessionId, { 
        status: 'completed',
        result: response
      });
      
      console.log(`Session ${sessionId} completed successfully`);
      
    } catch (error) {
      console.error('Error processing SQS message:', error);
      
      try {
        // Try to parse sessionId from the message to update status
        const message = JSON.parse(record.body);
        const { sessionId } = message;
        
        if (sessionId) {
          await updateSession(sessionId, { 
            status: 'error',
            error: error instanceof Error ? error.message : 'Unknown error'
          });
        }
      } catch (parseError) {
        console.error('Error parsing message for error handling:', parseError);
      }
    }
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
    
    // Debug log retrieved session
    console.log('Retrieved session data:', JSON.stringify(session, null, 2));

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
      console.log(`Session bypassPromptEnhancement:`, session.bypassPromptEnhancement, 'type:', typeof session.bypassPromptEnhancement);
      
      // Process the video with the selected model and enhanced prompt
      const response = await modelProcessor.processVideo(videoS3Path, session.question, videoMetadata, session.bypassPromptEnhancement || false);
      
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
  
  console.log('Original response before normalization:', fullResponse);
  
  // Normalize the text to ensure consistent spacing
  const normalizedText = fullResponse.replace(/\s+/g, ' ').trim();
  
  console.log('Normalized response:', normalizedText);
  
  // Create chunks by character count while preserving complete words and ensuring proper spacing
  const chunks = [];
  let startIndex = 0;
  const avgChunkSize = 30; // Average characters per chunk
  
  while (startIndex < normalizedText.length) {
    // Determine a random chunk size (characters)
    const chunkSize = avgChunkSize + Math.floor(Math.random() * 20);
    
    // Find the end of the current chunk, ensuring we don't cut words in half
    let endIndex = Math.min(startIndex + chunkSize, normalizedText.length);
    
    // If we're not at the end of the text, find a good breaking point (space)
    if (endIndex < normalizedText.length) {
      // Look for the last space within our chunk size
      const lastSpaceIndex = normalizedText.lastIndexOf(' ', endIndex);
      if (lastSpaceIndex > startIndex) {
        endIndex = lastSpaceIndex + 1; // Include the space
      }
    }
    
    // Extract the chunk and add it to our chunks array
    const chunk = normalizedText.substring(startIndex, endIndex);
    chunks.push(chunk);
    
    // Move to the next chunk's starting position
    startIndex = endIndex;
  }
  
  return chunks;
}

// Main handler function
export const handler = async (event: APIGatewayProxyEvent | SQSEvent, _context: LambdaContext): Promise<LambdaResponse | void> => {
  // Check if this is an SQS event
  if ('Records' in event) {
    return await sqsHandler(event as SQSEvent);
  }
  
  // Handle API Gateway events
  const apiEvent = event as APIGatewayProxyEvent;
  
  // Handle OPTIONS requests for CORS
  if (apiEvent.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: ''
    };
  }

  // Route the request based on the path
  const path = apiEvent.path;
  
  if (path.endsWith('/videos/ask/init') && apiEvent.httpMethod === 'POST') {
    return await initHandler(apiEvent);
  } else if (path.match(/\/videos\/ask\/status\/[^\/]+$/) && apiEvent.httpMethod === 'GET') {
    return await statusHandler(apiEvent);
  } else if (path.match(/\/videos\/ask\/stream\/[^\/]+$/) && apiEvent.httpMethod === 'GET') {
    return await streamHandler(apiEvent);
  } else if (path.match(/\/videos\/segmentation\/[^\/]+\/[^\/]+$/) && apiEvent.httpMethod === 'GET') {
    return await segmentationPreviewHandler(apiEvent);
  } else {
    return {
      statusCode: STATUS_CODES.NOT_FOUND,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Not found' })
    };
  }
};
