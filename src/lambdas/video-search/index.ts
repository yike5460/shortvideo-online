import { APIGatewayProxyEvent } from 'aws-lambda';
import { LambdaContext, LambdaResponse } from '../../types/aws-lambda';
import { VideoResult, VideoSegment, VideoStatus, SearchOptions } from '../../types/common';
import { Client } from '@opensearch-project/opensearch';
import { defaultProvider } from '@aws-sdk/credential-provider-node';
import { RedisClientType, createClient } from 'redis';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
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

// Add constants for the external embedding endpoint and SiliconFlow API
const EXTERNAL_EMBEDDING_ENDPOINT = process.env.EXTERNAL_EMBEDDING_ENDPOINT || '';
const SILICONFLOW_API_KEY = process.env.SILICONFLOW_API_KEY || '';
const SILICONFLOW_API_URL = 'https://api.siliconflow.cn/v1/chat/completions';
const MAX_FRAMES = 5; // Maximum number of frames to extract from video

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

// Add a function to generate embeddings using the external endpoint
async function generateEmbedding(text: string): Promise<number[] | undefined> {
  if (!EXTERNAL_EMBEDDING_ENDPOINT) {
    console.warn('External embedding endpoint not configured');
    return undefined;
  }

  try {
    console.log(`Calling external embedding service at ${EXTERNAL_EMBEDDING_ENDPOINT}/embed-text, with query: ${text}`);
    // **Request Body**
    // ```json
    // {
    //     "texts": "single text string"
    // }
    // ```
    // or
    // ```json
    // {
    //     "texts": ["text1", "text2", "text3"]
    // }
    // ```

    // **Response**
    // ```json
    // {
    //     "embedding": [...]  // For single text input
    // }
    // ```
    // or
    // ```json
    // {
    //     "embedding": [[...], [...], [...]]  // For multiple text inputs
    // }
    // ```
    const response = await fetch(`${EXTERNAL_EMBEDDING_ENDPOINT}/embed-text`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ texts: text }),
    });

    if (!response.ok) {
      throw new Error(`Error from embedding service: ${response.statusText}`);
    }
    
    const data = await response.json() as { embedding: number[] };
    return data.embedding;
  } catch (error) {
    console.error('Error calling external embedding service:', error);
    return undefined;
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
  
  // Create a temporary file
  const tempDir = os.tmpdir();
  const tempPath = path.join(tempDir, `temp_${Date.now()}.mp4`);
  const fileStream = fs.createWriteStream(tempPath);
  
  try {
    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: key
    });
    
    const response = await s3.send(command);
    if (!response.Body) {
      throw new Error('Empty response body');
    }
    
    // Convert readable stream to Node.js stream
    const responseBodyStream = response.Body as any;
    
    // Create a promise to track when the piping is complete
    const finished = promisify(stream.finished);
    
    // Pipe the response to the file
    responseBodyStream.pipe(fileStream);
    
    // Wait for the piping to complete
    await finished(fileStream);
    
    return tempPath;
  } catch (error) {
    console.error(`Error downloading video from S3: ${error}`);
    fs.unlinkSync(tempPath);
    throw error;
  }
}

// New function to extract frames from video using ffmpeg instead of opencv
async function extractFramesFromVideo(videoPath: string, maxFrames: number = MAX_FRAMES): Promise<string[]> {
  
  try {
    // Create a temporary directory for the frames
    const tempDir = path.join(os.tmpdir(), `frames_${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });
    
    // Define ffprobe path - it's included in the FFmpeg Lambda layer
    const ffprobePath = process.env.LAMBDA_TASK_ROOT ? '/opt/bin/ffprobe' : 'ffprobe';
    const ffmpegPath = process.env.LAMBDA_TASK_ROOT ? '/opt/bin/ffmpeg' : 'ffmpeg';
    
    // First, get total frames with ffprobe
    const ffprobeProcess = spawn(ffprobePath, [
      '-loglevel', 'error',  // Only show errors instead of -v error
      '-select_streams', 'v:0',
      '-count_packets',
      '-show_entries', 'stream=nb_read_packets',
      '-of', 'csv=p=0',
      videoPath
    ]);
    
    let ffprobeOutput = '';
    
    ffprobeProcess.stdout.on('data', (data) => {
      ffprobeOutput += data.toString();
    });
    
    // Wait for the ffprobe process to complete
    await new Promise<void>((resolve, reject) => {
      ffprobeProcess.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`ffprobe process exited with code ${code}`));
        }
      });
      
      ffprobeProcess.stderr.on('data', (data) => {
        console.error(`ffprobe stderr: ${data}`);
      });
      
      ffprobeProcess.on('error', (err) => {
        reject(err);
      });
    });
    
    // Calculate step based on total frames
    const totalFrames = parseInt(ffprobeOutput.trim()) || 1;
    const step = Math.max(1, Math.floor(totalFrames / maxFrames));
        
    // Use ffmpeg to extract frames
    const ffmpegProcess = spawn(ffmpegPath, [
      '-loglevel', 'error',  // Only show errors
      '-i', videoPath,
      '-vf', `select='not(mod(n,${step}))'`,
      '-vsync', '0',
      '-frame_pts', 'true',
      '-vframes', maxFrames.toString(),
      '-q:v', '1',
      `${tempDir}/frame_%03d.jpg`
    ]);
    
    // Wait for the ffmpeg process to complete
    await new Promise<void>((resolve, reject) => {
      ffmpegProcess.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`ffmpeg process exited with code ${code}`));
        }
      });
      
      ffmpegProcess.stderr.on('data', (data) => {
        console.log(`ffmpeg stderr: ${data}`);
      });
      
      ffmpegProcess.on('error', (err) => {
        reject(err);
      });
    });
    
    // Read the extracted frames and convert to base64
    const frames: string[] = [];
    const frameFiles = fs.readdirSync(tempDir)
      .filter((file: string) => file.startsWith('frame_') && file.endsWith('.jpg'))
      .sort();
    
    for (const file of frameFiles) {
      const filePath = path.join(tempDir, file);
      const fileData = fs.readFileSync(filePath);
      const base64Image = fileData.toString('base64');
      frames.push(base64Image);
      
      // Clean up the frame file
      fs.unlinkSync(filePath);
    }
    
    // Clean up the temporary directory
    fs.rmdirSync(tempDir);
    
    return frames;
  } catch (error) {
    console.error(`Error extracting frames: ${error}`);
    throw error;
  }
}

// New function to analyze frames with SiliconFlow Qwen model
async function analyzeFramesWithQwen(frames: string[], textDescription: string): Promise<any> {
  
  if (!SILICONFLOW_API_KEY) {
    throw new Error('SiliconFlow API key not configured');
  }
  
  try {
    // Prepare the content for SiliconFlow API
    const content: any[] = [];
    
    // Add each frame to the content
    for (const frame of frames) {
      content.push({
        type: 'image_url',
        image_url: {
          url: `data:image/jpeg;base64,${frame}`
        }
      });
    }
    
    // Add the prompt text
    const promptText = `你的任务是判断一个视频镜头和描述是否相符。

你拿到的描述是：
\`\`\`
${textDescription}
\`\`\`

我会给你展示 ${frames.length} 个视频帧（每秒一帧）。请评估这个视频镜头和描述的匹配程度，并给出0-5分的评分，其中：
0分：完全不符合描述
1分：基本不符合描述
2分：略微符合描述
3分：部分符合描述
4分：大部分符合描述
5分：完全符合描述

你需要按下面的格式输出：
<o>
评分（0-5的整数）
</o>
<reason>
评分理由
</reason>

输出示例：
<o>
4
</o>
<reason>
视频帧展示了一个人在海滩上奔跑的场景，与描述中提到的"一个人在海边跑步"非常吻合。可以清晰看到海浪和沙滩，以及人物跑步的动作。唯一与描述不完全匹配的是视频中没有展示描述中提到的"日落时分"的场景，因此给出4分而非5分。
</reason>`;

    content.push({
      type: 'text',
      text: promptText
    });
    
    // Prepare the request for SiliconFlow API
    const headers = {
      'Authorization': `Bearer ${SILICONFLOW_API_KEY}`,
      'Content-Type': 'application/json'
    };
    
    const payload = {
      model: 'Pro/Qwen/Qwen2.5-VL-7B-Instruct',
      messages: [
        {
          role: 'system',
          content: 'You are an AI assistant that analyzes video frames to determine if they match text descriptions.'
        },
        {
          role: 'user',
          content: content
        }
      ],
      max_tokens: 500
    };
    
    // Call the SiliconFlow API
    const response = await axios.post(SILICONFLOW_API_URL, payload, { headers });
    
    // Parse the response
    const analysisText = response.data.choices[0].message.content;
    
    // 改进分数提取的正则表达式，使其更加健壮
    // 查找<o>标签中的任何0-5的数字，忽略周围可能存在的额外文本
    const outputMatch = analysisText.match(/<o>[\s\S]*?([0-5])[\s\S]*?<\/o>/);
    // print outputMatch
    // 如果第一种匹配方式失败，尝试寻找可能的替代格式
    let score = 0;
    let matches = false;
    
    if (outputMatch) {
      score = parseInt(outputMatch[1].trim());
      matches = (score >= 1); // 3+ is considered a match
    } else {
      // 备用匹配模式：寻找任何包含0-5数字的<o>标签
      const fallbackMatch = analysisText.match(/<o>.*?([0-5])[\s分点].*?<\/o>/s);
      if (fallbackMatch) {
        score = parseInt(fallbackMatch[1].trim());
        matches = (score >= 1);
      } else {
        // 最后的尝试：在整个回答中搜索评分相关的模式
        const numberMatch = analysisText.match(/评分.*?([0-5])[\s分点]/);
        if (numberMatch) {
          score = parseInt(numberMatch[1].trim());
          matches = (score >= 1);
        }
      }
    }
    
    // 提高提取reason的鲁棒性，使用[\s\S]匹配包括换行符在内的所有字符
    const reasonMatch = analysisText.match(/<reason>([\s\S]*?)<\/reason>/);
    
    // 添加多种回退模式，确保即使格式不标准也能尽可能提取到理由
    let explanation = '';
    if (reasonMatch) {
      explanation = reasonMatch[1].trim();
    } else {
      explanation = analysisText.replace(/<o>[\s\S]*?<\/o>/g, '').trim();
    }
    
    
    return {
      matches,
      score,
      confidence: score / 5.0, // Convert score to 0-1 confidence
      explanation,
      fullResponse: analysisText
    };
  } catch (error) {
    console.error(`Error analyzing frames with Qwen: ${error}`);
    return {
      matches: false,
      score: 0,
      confidence: 0,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

// New function to validate videos against text description
async function validateVideos(videosWithScores: [string, number][], textDescription: string): Promise<ValidationResult[]> {
  
  // 并行处理所有视频片段
  const resultsPromises = videosWithScores.map(async ([s3Path, score]) => {
    try {
      // Download the video segment from S3
      const tempVideoPath = await downloadVideoFromS3(s3Path);
      
      // Extract frames from the video segment
      const frames = await extractFramesFromVideo(tempVideoPath);
      
      // Analyze the frames with Qwen
      const analysisResult = await analyzeFramesWithQwen(frames, textDescription);
      
      // Clean up temporary file
      // fs.unlinkSync(tempVideoPath);
      
      return {
        videoPath: s3Path,
        originalScore: score,
        framesAnalyzed: frames.length,
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
const transformSearchResults = async (hits: any[]): Promise<VideoResult[]> => {
  console.log('Transforming search results:', JSON.stringify(hits, null, 2));
  
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
      console.log('Inner hits:', JSON.stringify(innerHits, null, 2));
      
      // Map scores to segments using the offset and collect matched segments
      innerHits.forEach((segHit: any) => {
        const offset = segHit._nested?.offset;
        // 将分数除以2来将范围从0-2转换为0-1
        const score = (segHit._score || 0) / 2;
        
        if (offset !== undefined) {
          const segment = segmentOffsetMap.get(offset);
          if (segment) {
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
        video_id: hit._id,
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
      indexId: hit._source.video_index || 'videos'
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
    // const cacheKey = `search:${JSON.stringify(searchQuery)}`;
    // // Try to get cached results
    // if (!redisClient) {
    //   redisClient = createClient({
    //     url: `redis://${process.env.REDIS_ENDPOINT}:6379`
    //   });
    //   await redisClient.connect();
    // }

    // const cachedResults = await redisClient.get(cacheKey);
    // if (cachedResults) {
    //   return {
    //     statusCode: 200,
    //     headers: corsHeaders,
    //     body: cachedResults
    //   };
    // }

    // Check if we should use advanced search with embeddings
    if (searchQuery.advancedSearch && EXTERNAL_EMBEDDING_ENDPOINT) {
      console.log('Using advanced search with external embedding endpoint:', EXTERNAL_EMBEDDING_ENDPOINT);

      // Generate an embedding for the search query
      const embedding = await generateEmbedding(searchQuery.searchQuery);
      
      if (embedding) {
        // Build a k-NN search query for OpenSearch based on documentation
        const searchBody = {
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
            'video_segments.segment_video_thumbnail_url'
          ],
          query: {
            nested: {
              path: "video_segments",
              query: {
                "script_score": {
                  "query": {
                    "match_all": {}
                  },
                  "script": {
                    "source": "knn_score",
                    "lang": "knn",
                    "params": {
                      "field": "video_segments.segment_visual.segment_visual_embedding",
                      "query_value": embedding,
                      "space_type": "cosinesimil"
                    }
                  }
                }
                // knn: {
                //   "video_segments.segment_visual.segment_visual_embedding": {
                //     vector: embedding,
                //     // Number of nearest neighbors to find
                //     k: 20,
                //     // Filter's Preemptive Effect: acts before the k-NN algorithm even selects the top k neighbors
                //     // filter: {
                //     //   range: {
                //     //     _score: {
                //     //       gte: searchQuery.minConfidence || 0 // Apply minConfidence filter
                //     //     }
                //     //   }
                //     // }
                //   }
                // }
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
                size: 10,
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
          const results: VideoResult[] = await transformSearchResults(body.hits.hits);
          
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
              // Validate against the search query text
              const validationResults = await validateVideos(
                segmentsToValidate,
                searchQuery.searchQuery
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
                // Keep only videos that have at least one segment with good validation confidence
                finalResults = enhancedResults.filter(video => 
                  video.segments.some(segment => 
                    ((segment as EnhancedVideoSegment).validationConfidence || 0) >= searchQuery.minConfidence
                  )
                );
              }
              
              return {
                statusCode: STATUS_CODES.OK,
                headers: corsHeaders,
                body: JSON.stringify(finalResults)
              };
            }
          }
          
          // Return unvalidated results if validation was skipped or no videos to validate
          return {
            statusCode: STATUS_CODES.OK,
            headers: corsHeaders,
            body: JSON.stringify(filteredResults)
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
    // if (redisClient) {
    //   await redisClient.disconnect();
    // }
  }
};
