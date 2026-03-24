import { APIGatewayProxyEvent } from 'aws-lambda';
import { LambdaContext, LambdaResponse } from '../../types/aws-lambda';
import { VideoResult, VideoSegment, VideoStatus, SearchOptions, TimestampedLabel } from '../../types/common';
import { Client } from '@opensearch-project/opensearch';
import { defaultProvider } from '@aws-sdk/credential-provider-node';
import { RedisClientType, createClient } from 'redis';
import { BedrockRuntimeClient, ConverseCommand, ConversationRole, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { AwsSigv4Signer } from '@opensearch-project/opensearch/aws';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import * as os from 'os';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as stream from 'stream';
import { promisify } from 'util';
import axios from 'axios';
import { execSync } from 'child_process';
import { spawn } from 'child_process';
import { GoogleGenAI } from '@google/genai';

// Update search query interface to match frontend
interface SearchQuery {
  searchType: 'text' | 'image' | 'video' | 'audio';
  searchQuery: string;
  exactMatch: boolean;
  topK: number;
  weights: {
    text: number;
    image: number;
    video: number;
    audio: number;
  };
  minConfidence: number;
  selectedIndex?: string;
  advancedSearch?: boolean; // Add the advanced search option
  skipValidation?: boolean; // Flag to skip validation step (false by default, validation is performed)
  visualSearch?: boolean;   // Flag for visual search toggle
  audioSearch?: boolean;    // Flag for audio search toggle
}

interface ValidationResult {
  videoPath: string;
  originalScore: number;
  framesAnalyzed: number;
  matchesDescription: boolean;
  matchScore: number;
  matchConfidence: number;
  explanation: string;
  error?: string;
}

// Extend the VideoResult interface to include validation fields
interface EnhancedVideoResult extends VideoResult {
  validationScore?: number;
  validationConfidence?: number;
  validationExplanation?: string;
  validationStatus?: string;
}

// Add an interface for enhanced segments with validation fields
interface EnhancedVideoSegment extends VideoSegment {
  validationScore?: number;
  validationConfidence?: number;
  validationExplanation?: string;
  validationStatus?: string;
}

// OpenSearch query types
interface OpenSearchQuery {
  size: number;
  query: {
    bool: {
      must?: any[];
      must_not?: any[];
      should: any[];
      minimum_should_match?: number;
    };
  };
  _source?: string[];
}

const openSearch = new Client({
  ...AwsSigv4Signer({
    region: process.env.AWS_REGION || 'us-east-1',
    service: 'aoss',
    getCredentials: () => {
      const credentialsProvider = defaultProvider();
      return credentialsProvider();
    },
  }),
  node: process.env.OPENSEARCH_ENDPOINT,
  requestTimeout: 30000, // 30 seconds
  maxRetries: 3,
});

const bedrock = new BedrockRuntimeClient({});
const s3 = new S3Client({});
let redisClient: RedisClientType | null = null;
const dynamoClient = new DynamoDBClient({endpoint: process.env.INDEXES_TABLE_DYNAMODB_DNS_NAME});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY || '';
const VALIDATION_MODEL = process.env.VALIDATION_MODEL || 'gemini'; // 'gemini' or 'nova'
const BEDROCK_MULTIMODAL_MODEL_ID = process.env.BEDROCK_EMBEDDING_MODEL_ID || 'amazon.titan-embed-image-v1';
const BEDROCK_TEXT_MODEL_ID = process.env.BEDROCK_TEXT_EMBEDDING_MODEL_ID || 'amazon.titan-embed-text-v2:0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
  'Access-Control-Allow-Credentials': 'true'
};

const STATUS_CODES = {
  OK: 200,
  CREATED: 201,
  BAD_REQUEST: 400,
  NOT_FOUND: 404,
  INTERNAL_SERVER_ERROR: 500
};

/**
 * Generate embeddings for a search query using Amazon Bedrock Titan.
 * For text search queries, we generate both:
 * - A multimodal embedding (via Titan Multimodal) for visual similarity search
 * - A text embedding (via Titan Text) for audio/transcript similarity search
 * Both use the same text input, producing 1024-dimensional vectors.
 */
async function generateEmbedding(text: string): Promise<{
  vision_embedding: number[] | undefined;
  audio_embedding: number[] | undefined;
}> {
  const defaultResponse = { vision_embedding: undefined, audio_embedding: undefined };

  if (!text || text.trim().length === 0) {
    console.warn('Empty text provided for embedding generation');
    return defaultResponse;
  }

  try {
    console.log(`Generating embeddings via Bedrock Titan for query: ${text}`);

    // Generate both embeddings in parallel
    const [multimodalResult, textResult] = await Promise.all([
      // Titan Multimodal Embeddings - text input for cross-modal visual search
      bedrock.send(new InvokeModelCommand({
        modelId: BEDROCK_MULTIMODAL_MODEL_ID,
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify({
          inputText: text,
          embeddingConfig: { outputEmbeddingLength: 1024 }
        })
      })),
      // Titan Text Embeddings - for audio/transcript search
      bedrock.send(new InvokeModelCommand({
        modelId: BEDROCK_TEXT_MODEL_ID,
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify({
          inputText: text,
          dimensions: 1024,
          normalize: true
        })
      }))
    ]);

    const multimodalParsed = JSON.parse(new TextDecoder().decode(multimodalResult.body));
    const textParsed = JSON.parse(new TextDecoder().decode(textResult.body));

    const visionEmbedding = multimodalParsed.embedding && Array.isArray(multimodalParsed.embedding)
      ? multimodalParsed.embedding as number[] : undefined;
    const audioEmbedding = textParsed.embedding && Array.isArray(textParsed.embedding)
      ? textParsed.embedding as number[] : undefined;

    console.log(`Successfully generated embeddings: Vision embedding length: ${visionEmbedding?.length || 0}, Audio embedding length: ${audioEmbedding?.length || 0}`);

    return { vision_embedding: visionEmbedding, audio_embedding: audioEmbedding };
  } catch (error) {
    console.error('Error generating embeddings via Bedrock Titan:', error);
    return defaultResponse;
  }
}

// New function to download video from S3
async function downloadVideoFromS3(s3Path: string): Promise<string> {
  
  // Parse S3 path
  let bucket = process.env.VIDEO_BUCKET;
  let key = s3Path;
  
  // If s3Path is a full s3:// URL, parse it
  if (s3Path.startsWith('s3://')) {
    s3Path = s3Path.replace('s3://', '');
    const parts = s3Path.split('/', 2);
    bucket = parts[0];
    key = parts.length > 1 ? parts.slice(1).join('/') : '';
  }
  
  if (!bucket) {
    throw new Error('No S3 bucket specified. Set VIDEO_BUCKET environment variable or use full s3:// path');
  }
  
  // Create a temporary file with a more unique name using timestamp and random string
  const tempDir = os.tmpdir();
  const randomString = Math.random().toString(36).substring(2, 8);
  const tempPath = path.join(tempDir, `temp_${Date.now()}_${randomString}.mp4`);
  
  try {
    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: key
    });
    
    const response = await s3.send(command);
    if (!response.Body) {
      throw new Error('Empty response body');
    }
    
    // Download the entire file as a buffer first (more reliable than streaming)
    const buf = Buffer.from(await response.Body.transformToByteArray());
    
    // Write the complete buffer to file
    fs.writeFileSync(tempPath, buf);
    console.log(`Downloaded video from S3, size: ${buf.length} bytes, path: ${tempPath}`);
    
    // Validate the file contains a moov atom
    await validateMP4Structure(tempPath);
    
    return tempPath;
  } catch (error) {
    // Clean up the temporary file if it exists
    if (fs.existsSync(tempPath)) {
      try {
        fs.unlinkSync(tempPath);
      } catch (unlinkError) {
        console.warn(`Failed to clean up temporary file ${tempPath}:`, unlinkError);
      }
    }
    console.error(`Error downloading video from S3: ${error}`);
    throw error;
  }
}

// Add a function to validate MP4 structure
async function validateMP4Structure(filePath: string): Promise<void> {
  // Define ffprobe path - it's included in the FFmpeg Lambda layer
  const ffprobePath = process.env.LAMBDA_TASK_ROOT ? '/opt/bin/ffprobe' : 'ffprobe';
  
  return new Promise((resolve, reject) => {
    const ffprobeProcess = spawn(ffprobePath, [
      '-v', 'error',
      '-show_entries', 'format=format_name',
      '-of', 'json',
      filePath
    ]);
    
    let ffprobeOutput = '';
    let ffprobeError = '';
    
    ffprobeProcess.stdout.on('data', (data) => {
      ffprobeOutput += data.toString();
    });
    
    ffprobeProcess.stderr.on('data', (data) => {
      ffprobeError += data.toString();
      console.error(`ffprobe validation stderr: ${data}`);
    });
    
    ffprobeProcess.on('close', (code) => {
      if (code === 0) {
        try {
          const result = JSON.parse(ffprobeOutput);
          if (result.format && result.format.format_name) {
            console.log(`Valid video format detected: ${result.format.format_name}, file: ${filePath}`);
            resolve();
          } else {
            reject(new Error('Invalid video format structure'));
          }
        } catch (e) {
          reject(new Error(`Failed to parse ffprobe output: ${e}`));
        }
      } else {
        reject(new Error(`MP4 validation failed: ${ffprobeError || 'Unknown error'} (exit code ${code})`));
      }
    });
    
    ffprobeProcess.on('error', (err) => {
      reject(new Error(`Failed to start ffprobe process: ${err}`));
    });
  });
}

// New function to analyze video with Amazon Nova model
async function analyzeVideoWithNova(s3VideoPath: string, textDescription: string): Promise<any> {
  
  try {
    const modelId = 'us.amazon.nova-lite-v1:0'; // Using Nova Lite for cost-effectiveness and speed
    
    // Parse S3 path to get bucket and key
    let s3Uri = s3VideoPath;
    if (!s3VideoPath.startsWith('s3://')) {
      // If it's just a key, construct the full S3 URI
      s3Uri = `s3://${process.env.VIDEO_BUCKET}/${s3VideoPath}`;
    }

    // Prepare the message following AWS best practices with S3 source
    const message = {
      role: ConversationRole.USER,
      content: [
        {
          video: {
            format: "mp4",
            source: {
              s3Location: {
                uri: s3Uri
              }
            }
          }
        },
        {
          text: `Your task is to determine if this video matches a given text description.

The description is:
\`\`\`
${textDescription}
\`\`\`

Please evaluate how well this video matches the description and give a score from 0-5, where:
0: Completely does not match the description
1: Barely matches the description
2: Slightly matches the description
3: Partially matches the description
4: Mostly matches the description
5: Perfectly matches the description

Please output in the following format:
<o>
Score (integer from 0-5)
</o>
<reason>
Reasoning for the score
</reason>

Example output:
<o>
4
</o>
<reason>
The video shows a person running on a beach, which closely matches the description of "a person jogging by the sea". You can clearly see waves and sand, as well as the person's running motion. The only aspect that doesn't completely match is that the video doesn't show the "sunset" scene mentioned in the description, so I give it 4 points instead of 5.
</reason>`
        }
      ]
    };
    
    // Prepare the request following AWS best practices
    const request = {
      modelId,
      messages: [message],
      system: [
        {
          text: "You are an expert media analyst"
        }
      ],
      inferenceConfig: {
        maxTokens: 4096,
        temperature: 0.7,
        topP: 0.9
      }
    };

    // Fix: The ConverseCommand expects the messages to be an array of Message objects,
    // and each Message's content should be an array of ContentBlock objects.
    // Ensure the request is properly typed and constructed.

    // Type assertion to satisfy the ConverseCommandInput type
    const response = await bedrock.send(
      new ConverseCommand(request as any)
    );

    // Parse the response from ConverseCommand
    const analysisText =
      response.output?.message?.content?.find(
        (block: any) => typeof block.text === "string"
      )?.text || "";
    // Extract score from the response using regex patterns
    const outputMatch = analysisText.match(/<o>[\s\S]*?([0-5])[\s\S]*?<\/o>/);
    let score = 0;
    let matches = false;
    
    if (outputMatch) {
      score = parseInt(outputMatch[1].trim());
      matches = (score >= 1);
    } else {
      // Fallback pattern: look for any 0-5 digits in <o> tags
      const fallbackMatch = analysisText.match(/<o>.*?([0-5])[\s\.].*?<\/o>/s);
      if (fallbackMatch) {
        score = parseInt(fallbackMatch[1].trim());
        matches = (score >= 1);
      } else {
        // Last attempt: search for score-related patterns in the entire response
        const numberMatch = analysisText.match(/score.*?([0-5])[\s\.]/i);
        if (numberMatch) {
          score = parseInt(numberMatch[1].trim());
          matches = (score >= 1);
        }
      }
    }
    
    // Extract reasoning with improved robustness
    const reasonMatch = analysisText.match(/<reason>([\s\S]*?)<\/reason>/);
    let explanation = '';
    if (reasonMatch) {
      explanation = reasonMatch[1].trim();
    } else {
      explanation = analysisText.replace(/<o>[\s\S]*?<\/o>/g, '').trim();
    }

    return {
      matches,
      score,
      confidence: score / 5.0,
      explanation,
      fullResponse: analysisText
    };
  } catch (error) {
    console.error(`Error analyzing video with Nova: ${error}`);
    return {
      matches: false,
      score: 0,
      confidence: 0,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

// New function to analyze video with Google Gemini 2.5 Flash model
async function analyzeVideoWithGemini(videoPath: string, textDescription: string): Promise<any> {
  
  if (!GOOGLE_API_KEY) {
    throw new Error('Google API key not configured');
  }
  
  try {
    const ai = new GoogleGenAI({
      apiKey: GOOGLE_API_KEY
    });
    
    // Read video file as base64
    const base64VideoFile = fs.readFileSync(videoPath, {
      encoding: 'base64'
    });
    
    // Prepare the content for Google GenAI API
    const contents = [
      {
        inlineData: {
          mimeType: 'video/mp4',
          data: base64VideoFile
        }
      },
      {
        text: `Your task is to determine if this video matches a given text description.

The description is:
\`\`\`
${textDescription}
\`\`\`

Please evaluate how well this video matches the description and give a score from 0-5, where:
0: Completely does not match the description
1: Barely matches the description
2: Slightly matches the description
3: Partially matches the description
4: Mostly matches the description
5: Perfectly matches the description

Please output in the following format:
<o>
Score (integer from 0-5)
</o>
<reason>
Reasoning for the score
</reason>

Example output:
<o>
4
</o>
<reason>
The video shows a person running on a beach, which closely matches the description of "a person jogging by the sea". You can clearly see waves and sand, as well as the person's running motion. The only aspect that doesn't completely match is that the video doesn't show the "sunset" scene mentioned in the description, so I give it 4 points instead of 5.
</reason>`
      }
    ];
    
    // Call the Google GenAI API
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: contents,
      config: {
        thinkingConfig: {
          thinkingBudget: 128
        },
      },
    });
    
    // Parse the response
    const analysisText = response.text || '';
    
    // Extract score from the response using regex patterns
    const outputMatch = analysisText.match(/<o>[\s\S]*?([0-5])[\s\S]*?<\/o>/);
    let score = 0;
    let matches = false;
    
    if (outputMatch) {
      score = parseInt(outputMatch[1].trim());
      matches = (score >= 1);
    } else {
      // Fallback pattern: look for any 0-5 digits in <o> tags
      const fallbackMatch = analysisText.match(/<o>.*?([0-5])[\s\.].*?<\/o>/s);
      if (fallbackMatch) {
        score = parseInt(fallbackMatch[1].trim());
        matches = (score >= 1);
      } else {
        // Last attempt: search for score-related patterns in the entire response
        const numberMatch = analysisText.match(/score.*?([0-5])[\s\.]/i);
        if (numberMatch) {
          score = parseInt(numberMatch[1].trim());
          matches = (score >= 1);
        }
      }
    }
    
    // Extract reasoning with improved robustness
    const reasonMatch = analysisText.match(/<reason>([\s\S]*?)<\/reason>/);
    let explanation = '';
    if (reasonMatch) {
      explanation = reasonMatch[1].trim();
    } else {
      explanation = analysisText.replace(/<o>[\s\S]*?<\/o>/g, '').trim();
    }

    return {
      matches,
      score,
      confidence: score / 5.0,
      explanation,
      fullResponse: analysisText
    };
  } catch (error) {
    console.error(`Error analyzing video with Gemini: ${error}`);
    return {
      matches: false,
      score: 0,
      confidence: 0,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

// New function to validate videos against text description with configurable model
async function validateVideos(videosWithScores: [string, number][], textDescription: string, useNova = false): Promise<ValidationResult[]> {
  
  // 并行处理所有视频片段
  const resultsPromises = videosWithScores.map(async ([s3Path, score]) => {
    try {
      let analysisResult;
      
      if (useNova) {
        // Use Nova with direct S3 access (no download needed)
        analysisResult = await analyzeVideoWithNova(s3Path, textDescription);
      } else {
        // Use Gemini (still needs to download video file)
        const tempVideoPath = await downloadVideoFromS3(s3Path);
        
        try {
          analysisResult = await analyzeVideoWithGemini(tempVideoPath, textDescription);
        } finally {
          // Clean up temporary file
          try {
            fs.unlinkSync(tempVideoPath);
            console.log(`Cleaned up temporary file: ${tempVideoPath}`);
          } catch (cleanupError) {
            console.warn(`Failed to clean up temporary file ${tempVideoPath}:`, cleanupError);
          }
        }
      }
      
      return {
        videoPath: s3Path,
        originalScore: score,
        framesAnalyzed: 0, // No longer extracting frames for Nova
        matchesDescription: analysisResult.matches || false,
        matchScore: analysisResult.score || 0,
        matchConfidence: analysisResult.confidence || 0,
        explanation: analysisResult.explanation || ''
      };
    } catch (error) {
      console.error(`Error processing video segment ${s3Path}: ${error}`);
      return {
        videoPath: s3Path,
        originalScore: score,
        framesAnalyzed: 0,
        matchesDescription: false,
        matchScore: 0,
        matchConfidence: 0,
        explanation: '',
        error: error instanceof Error ? error.message : String(error)
      };
    }
  });

  // 等待所有处理完成并返回结果
  return await Promise.all(resultsPromises);
}

// Update the transform function to normalize OpenSearch confidence scores, such score is relative and per index and per query, calculated using TF-IDF by default
const transformSearchResults = async (hits: any[], selectedIndex?: string): Promise<VideoResult[]> => {

  // Find the max video score for normalization across all videos
  const maxVideoScore = Math.max(...hits.map(hit => hit._score || 0));
  
  // Process all results in parallel
  return await Promise.all(hits.map(async hit => {
    // Get the video's score and normalize it
    const videoScore = hit._score || 0;
    const normalizedVideoScore = maxVideoScore > 0 ? videoScore / maxVideoScore : 0;
    
    // Extract segment scores from inner_hits if available
    const segmentScores = new Map<string, number>();
    const segmentOffsetMap = new Map<number, any>();
    const matchedSegments: any[] = [];
    const processedSegmentIds = new Set<string>(); // Track processed segment IDs to avoid duplicates
    
    // First, create a mapping between offsets and segment objects
    if (hit._source.video_segments) {
      hit._source.video_segments.forEach((segment: any, index: number) => {
        segmentOffsetMap.set(index, segment);
      });
    }
    
    // Process inner_hits if available to extract segment confidence scores and matched segments
    if (hit.inner_hits?.matched_segments?.hits?.hits) {
      const innerHits = hit.inner_hits.matched_segments.hits.hits;
      // Find max score for normalization
      const maxInnerScore = Math.max(...innerHits.map((segHit: any) => segHit._score || 0));
      
      console.log(`Max inner score: ${maxInnerScore}`);
      
      // Map scores to segments using the offset and collect matched segments
      innerHits.forEach((segHit: any) => {
        const offset = segHit._nested?.offset;
        // Scale score to 0-1 range (typically OpenSearch scores are between 0-2)
        const score = (segHit._score || 0) / 2;
        
        if (offset !== undefined) {
          const segment = segmentOffsetMap.get(offset);
          // Skip segments we've already processed
          if (segment && !processedSegmentIds.has(segment.segment_id)) {
            // Add to processed set to avoid duplicates 
            processedSegmentIds.add(segment.segment_id);
            
            // Deduplicate segments by segment_id due to the nature of the OpenSearch k-NN search:
            // 1. Each function evaluates segments independently:
            //    - Vision embedding function evaluates all segments
            //    - Audio embedding function evaluates all segments again
            // 2. Segments that score highly in both functions can appear multiple times
            //    when OpenSearch ranks segments and returns top N inner hits
            
            // Normalize the score relative to the highest score within this video, not used for now
            const normalizedScore = maxInnerScore > 0 ? score / maxInnerScore : 0;
            // segmentScores.set(segment.segment_id, normalizedScore);
            segmentScores.set(segment.segment_id, score);
            
            // Add to matched segments with score
            matchedSegments.push({
              ...segment,
              // confidence: normalizedScore,
              confidence: score,
              _offset: offset,
              _raw_score: score
            });
            
            console.log(`Mapped offset ${offset} to segment ${segment.segment_id} with score ${score} -> normalized ${normalizedScore}`);
          }
        }
      });
    }
    
    // Helper function to generate signed URLs
    const generateSignedUrl = async (s3Path: string): Promise<string> => {
      if (!s3Path) return '';
      
      try {
        const getCommand = new GetObjectCommand({
          Bucket: process.env.VIDEO_BUCKET,
          Key: s3Path,
        });
        return await getSignedUrl(s3 as any, getCommand as any, { expiresIn: 3600 });
      } catch (error) {
        console.warn(`Failed to generate signed URL for ${s3Path}:`, error);
        return '';
      }
    };

    // Generate signed URLs only for matched segments (from inner_hits)
    const segmentsWithSignedUrls = await Promise.all(matchedSegments.map(async (segment: any) => {
      const segmentVideoPreviewUrl = await generateSignedUrl(segment.segment_video_s3_path || '');
      const segmentVideoThumbnailUrl = await generateSignedUrl(segment.segment_video_thumbnail_s3_path || '');
      
      return {
        segment_id: segment.segment_id,
        video_id: hit._source.video_id,
        start_time: segment.start_time,
        end_time: segment.end_time,
        duration: segment.duration,
        segment_video_s3_path: segment.segment_video_s3_path,
        segment_video_preview_url: segmentVideoPreviewUrl,
        segment_video_thumbnail_s3_path: segment.segment_video_thumbnail_s3_path,
        segment_video_thumbnail_url: segmentVideoThumbnailUrl,
        confidence: segment.confidence || 0 // Use the normalized confidence score we already calculated
      };
    })) || [];

    // Sort segments by confidence
    const sortedSegments = segmentsWithSignedUrls.sort((a: VideoSegment, b: VideoSegment) => 
      (b.confidence || 0) - (a.confidence || 0)
    );

    // Generate fresh signed URLs for video preview and thumbnail
    const videoPreviewUrl = await generateSignedUrl(hit._source.video_s3_path);
    const thumbnailUrl = await generateSignedUrl(hit._source.video_thumbnail_s3_path);

    // Removed video_objects processing - not needed in search results page

    return {
      id: hit._id,
      title: hit._source.video_title || '',
      description: hit._source.video_description || '',
      videoPreviewUrl: videoPreviewUrl,
      videoS3Path: hit._source.video_s3_path || '',
      videoDuration: hit._source.video_duration || "00:00:00",
      videoThumbnailS3Path: hit._source.video_thumbnail_s3_path || '',
      videoThumbnailUrl: thumbnailUrl,
      source: hit._source.video_source?.includes('youtube.com') ? 'youtube' : 'local',
      uploadDate: hit._source.created_at,
      format: hit._source.video_type || '',
      status: hit._source.video_status,
      size: hit._source.video_size || 0,
      segments: sortedSegments,
      searchConfidence: normalizedVideoScore,
      indexId: selectedIndex || hit._source.video_index || 'videos'  // Use selectedIndex from request first
      // Removed video_objects field - not needed in search results
    };
  }));
};

// Update the handler to use the dynamic index and include video validation
export const handler = async (event: APIGatewayProxyEvent, _context: LambdaContext): Promise<LambdaResponse> => {
  try {
    // Regular search request
    if (!event.body) {
      return {
        statusCode: STATUS_CODES.BAD_REQUEST,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Missing request body' })
      };
    }

    const searchQuery: SearchQuery = JSON.parse(event.body);
    console.log('Parsed search query:', JSON.stringify(searchQuery, null, 2));

    // Redis caching for search results
    const cacheKey = `search:${JSON.stringify({
      query: searchQuery.searchQuery,
      index: searchQuery.selectedIndex,
      topK: searchQuery.topK,
      advancedSearch: searchQuery.advancedSearch,
      visualSearch: searchQuery.visualSearch,
      audioSearch: searchQuery.audioSearch,
      minConfidence: searchQuery.minConfidence
    })}`;

    try {
      if (!redisClient && process.env.REDIS_ENDPOINT) {
        redisClient = createClient({
          url: `redis://${process.env.REDIS_ENDPOINT}:6379`
        });
        await redisClient.connect();
      }

      if (redisClient) {
        const cachedResults = await redisClient.get(cacheKey);
        if (cachedResults) {
          console.log('Returning cached search results');
          return {
            statusCode: STATUS_CODES.OK,
            headers: corsHeaders,
            body: cachedResults
          };
        }
      }
    } catch (cacheError) {
      console.warn('Redis cache read error, proceeding without cache:', cacheError);
    }

    // Check if we should use advanced search with embeddings (always available via Bedrock Titan)
    if (searchQuery.advancedSearch) {
      console.log('Using advanced search with Bedrock Titan embeddings');

      // Generate embeddings for the search query
      const embeddings = await generateEmbedding(searchQuery.searchQuery);
      
      // Check if we have at least one valid embedding type
      if (embeddings.vision_embedding || embeddings.audio_embedding) {
        // Determine weights based on visualSearch and audioSearch flags
        let videoWeight = 0.5;
        let audioWeight = 0.5;

        // If visualSearch and audioSearch flags are provided, use them to set weights
        if (searchQuery.visualSearch !== undefined && searchQuery.audioSearch !== undefined) {
          if (searchQuery.visualSearch && searchQuery.audioSearch) {
            // Both enabled: equal weights
            videoWeight = 0.5;
            audioWeight = 0.5;
          } else if (searchQuery.visualSearch) {
            // Only visual search enabled
            videoWeight = 1.0;
            audioWeight = 0.0;
          } else if (searchQuery.audioSearch) {
            // Only audio search enabled
            videoWeight = 0.0;
            audioWeight = 1.0;
          } else {
            // Neither enabled: use default weights
            videoWeight = 0.5;
            audioWeight = 0.5;
          }
        } else {
          // Fallback to weights from the request if available
          const weights = searchQuery.weights || { video: 0.5, audio: 0.5, text: 0, image: 0 };
          videoWeight = weights.video || 0.5;
          audioWeight = weights.audio || 0.5;
        }

        // Calculate normalized weights
        const totalWeight = videoWeight + audioWeight;
        const normalizedVideoWeight = totalWeight > 0 ? videoWeight / totalWeight : 0.5;
        const normalizedAudioWeight = totalWeight > 0 ? audioWeight / totalWeight : 0.5;
        
        console.log(`Search weights - Video: ${normalizedVideoWeight}, Audio: ${normalizedAudioWeight}`);

        // Build a weighted search query for OpenSearch that combines visual and audio embeddings
        const searchBody: any = {
          size: searchQuery.topK || 3,
          _source: [
            'video_id',
            'video_title',
            'video_description',
            'video_preview_url',
            'video_s3_path',
            'video_duration',
            'video_source',
            'video_thumbnail_s3_path',
            'video_thumbnail_url',
            'created_at',
            'video_type',
            'video_status',
            'video_size',
            'video_segments.segment_id',
            'video_segments.start_time',
            'video_segments.end_time',
            'video_segments.duration',
            'video_segments.segment_video_s3_path',
            'video_segments.segment_video_preview_url',
            'video_segments.segment_video_thumbnail_s3_path',
            'video_segments.segment_video_thumbnail_url',
            'video_segments.segment_visual',
            'video_segments.segment_audio'
          ],
          query: {
            nested: {
              path: "video_segments",
              score_mode: "max", // The presence of at least one highly relevant segment makes the entire video highly relevant, regardless of other, less relevant segments it might also contain.
              query: {
                function_score: {
                  query: {
                    match_all: {} // Match all documents initially
                  },
                  functions: [
                    // Add visual embedding function if available with appropriate weight
                    ...(embeddings.vision_embedding ? [{
                      script_score: {
                        script: {
                          source: "knn_score",
                          lang: "knn",
                          params: {
                            field: "video_segments.segment_visual.segment_visual_embedding",
                            query_value: embeddings.vision_embedding,
                            space_type: "cosinesimil"
                          }
                        }
                      },
                      weight: normalizedVideoWeight
                    }] : []),
                    // Add audio embedding function if available with appropriate weight
                    ...(embeddings.audio_embedding ? [{
                      script_score: {
                        script: {
                          source: "knn_score",
                          lang: "knn",
                          params: {
                            field: "video_segments.segment_audio.segment_audio_embedding",
                            query_value: embeddings.audio_embedding,
                            space_type: "cosinesimil"
                          }
                        }
                      },
                      weight: normalizedAudioWeight
                    }] : [])
                  ],
                  score_mode: "sum", // Sum the scores from different embedding searches
                  boost_mode: "replace" // Replace the original score with our weighted score
                }
              },
              inner_hits: {
                _source: [
                  "segment_id", 
                  "start_time", 
                  "end_time", 
                  "duration",
                  "segment_video_s3_path",
                  "segment_video_preview_url",
                  "segment_video_thumbnail_s3_path",
                  "segment_video_thumbnail_url"
                ],
                size: 5,
                name: "matched_segments"
              }
            }
          },
          // Apply post-filter to exclude deleted videos
          post_filter: {
            bool: {
              should: [
                { term: { "video_status": "ready" } },
                { term: { "video_status": "ready_for_face" } },
                { term: { "video_status": "ready_for_object" } },
                { term: { "video_status": "ready_for_shots" } },
                { term: { "video_status": "ready_for_video_embed" } },
                { term: { "video_status": "ready_for_audio_embed" } }
              ],
              must_not: [
                { term: { "video_status": "deleted" } }
              ],
              minimum_should_match: 1
            }
          },
          // min_score: searchQuery.minConfidence || 0
        };

        try {
          const { body } = await openSearch.search({
            index: searchQuery.selectedIndex,
            body: searchBody
          });

          // Process results
          console.log(`k-NN search returned ${body.hits.total?.value || 0} results`);
          
          // Transform results to match VideoResult interface
          const results: VideoResult[] = await transformSearchResults(body.hits.hits, searchQuery.selectedIndex);
          
          // Apply minConfidence filtering in post-processing
          let filteredResults = results;
          
          if (searchQuery.minConfidence > 0) {
            // Filter segments based on confidence score
            filteredResults = results.map(result => ({
              ...result,
              segments: result.segments.filter(segment => (segment.confidence || 0) >= searchQuery.minConfidence)
            }));
            
            // Only keep videos that still have at least one segment after filtering
            filteredResults = filteredResults.filter(result => result.segments.length > 0);
          }
          
          // Always perform validation as a secondary check unless explicitly skipped
          if (!searchQuery.skipValidation && filteredResults.length > 0) {
            console.log('Performing secondary validation of search results against query text');
            
            // Extract top segments with their scores for validation
            const segmentsWithScores: [string, number][] = [];
            
            // Collect segments from all videos
            filteredResults.forEach(video => {
              // Only use segments with confidence scores
              video.segments.forEach(segment => {
                if (segment.segment_video_s3_path && typeof segment.confidence === 'number') {
                  segmentsWithScores.push([segment.segment_video_s3_path, segment.confidence]);
                }
              });
            });
            
            console.log(`Collected ${segmentsWithScores.length} segments for validation`);
            
            if (segmentsWithScores.length > 0) {
              // Limit the number of segments to validate to avoid excessive processing
              const maxSegmentsToValidate = 20;
              const segmentsToValidate = segmentsWithScores
                .sort((a, b) => b[1] - a[1]) // Sort by confidence, highest first
                .slice(0, maxSegmentsToValidate);
              // print segmentsToValidate
              console.log('Segments to validate:', segmentsToValidate);
              // Validate against the search query text using configured model
              const useNova = VALIDATION_MODEL === 'nova';
              console.log(`Using ${useNova ? 'Nova' : 'Gemini'} for video validation (VALIDATION_MODEL=${VALIDATION_MODEL})`);
              
              const validationResults = await validateVideos(
                segmentsToValidate,
                searchQuery.searchQuery,
                useNova
              );
              // print validationResults
              console.log('Validation results:', validationResults);
              // Create a map of segment paths to validation results for easier lookup
              const validationMap = new Map<string, ValidationResult>();
              validationResults.forEach(result => {
                validationMap.set(result.videoPath, result);
              });
              
              // Enhance results with validation data at the segment level
              const enhancedResults: EnhancedVideoResult[] = filteredResults.map(video => {
                // Enhance segments with validation data
                const enhancedSegments: EnhancedVideoSegment[] = video.segments.map(segment => {
                  const validation = validationMap.get(segment.segment_video_s3_path || '');
                  
                  if (validation) {
                    return {
                      ...segment,
                      
                      confidence: ((segment.confidence || 0) + validation.matchConfidence) / 2, // Average of original confidence and validation confidence
                      validationScore: validation.matchScore,
                      validationConfidence: validation.matchConfidence,
                      validationExplanation: validation.explanation,
                      validationStatus: validation.matchesDescription ? 'matches' : 'does_not_match'
                    };
                  }
                  return segment;
                });
                
                // Return the video with enhanced segments
                return {
                  ...video,
                  segments: enhancedSegments
                };
              });
              
              // Filter by validation if needed
              let finalResults = enhancedResults;
              if (searchQuery.minConfidence > 0) {
                console.log(`Applying minConfidence filter: ${searchQuery.minConfidence}`);
                
                // First, log segments with their confidence scores before filtering
                enhancedResults.forEach(video => {
                  console.log(`Video ${video.id} has ${video.segments.length} segments before filtering`);
                  video.segments.forEach(segment => {
                    console.log(`Segment ${segment.segment_id}: confidence=${segment.confidence}, validationConfidence=${(segment as EnhancedVideoSegment).validationConfidence}`);
                  });
                });
                
                // Filter at both segment and video levels:
                // 1. For each video, keep only segments with validationConfidence >= minConfidence
                // 2. Then keep only videos that still have at least one segment after filtering
                finalResults = enhancedResults
                  .map(video => ({
                    ...video,
                    segments: video.segments.filter(segment =>
                      ((segment as EnhancedVideoSegment).validationConfidence || 0) >= searchQuery.minConfidence
                    )
                  }))
                  .filter(video => video.segments.length > 0);
                
                // Log the results after filtering
                console.log(`After filtering: ${finalResults.length} videos remain`);
                finalResults.forEach(video => {
                  console.log(`Video ${video.id} has ${video.segments.length} segments after filtering`);
                });
              }
              
              const resultBody = JSON.stringify(finalResults);
              // Cache results with 5 minute TTL
              try {
                if (redisClient) {
                  await redisClient.setEx(cacheKey, 300, resultBody);
                  console.log('Cached search results');
                }
              } catch (cacheWriteError) {
                console.warn('Redis cache write error:', cacheWriteError);
              }
              return {
                statusCode: STATUS_CODES.OK,
                headers: corsHeaders,
                body: resultBody
              };
            }
          }

          // Return unvalidated results if validation was skipped or no videos to validate
          const unvalidatedBody = JSON.stringify(filteredResults);
          try {
            if (redisClient) {
              await redisClient.setEx(cacheKey, 300, unvalidatedBody);
              console.log('Cached unvalidated search results');
            }
          } catch (cacheWriteError) {
            console.warn('Redis cache write error:', cacheWriteError);
          }
          return {
            statusCode: STATUS_CODES.OK,
            headers: corsHeaders,
            body: unvalidatedBody
          };
        } catch (searchError) {
          console.error("k-NN search error:", searchError);
          return {
            statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
            headers: corsHeaders,
            body: JSON.stringify({ 
              error: 'OpenSearch query error',
              details: searchError instanceof Error ? searchError.message : 'Unknown error'
            })
          };
        }
      } else {
        console.error('Failed to generate embedding for advanced search, falling back to basic search');
        return {
          statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
          headers: corsHeaders,
          body: JSON.stringify({ error: 'Failed to generate embedding for advanced search, consider to fallback to basic search' })
        };
      }
    }
    
    // If we reach here, advanced search is not enabled or embedding generation failed
    return {
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Failed to generate embedding for advanced search, consider to fallback to basic search' })
    };

  } catch (error) {
    console.error('Search error:', error);
    return {
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      headers: corsHeaders,
      body: JSON.stringify({ 
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error'
      })
    };
  } finally {
    // Don't disconnect Redis client - keep it alive for connection reuse across Lambda invocations
  }
};
