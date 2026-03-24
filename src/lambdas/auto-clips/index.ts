import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { Client } from '@opensearch-project/opensearch';
import { defaultProvider } from '@aws-sdk/credential-provider-node';
import { AwsSigv4Signer } from '@opensearch-project/opensearch/aws';

// Initialize AWS clients
const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const s3 = new S3Client({});
const bedrock = new BedrockRuntimeClient({
  region: process.env.AWS_REGION || 'ap-northeast-1',
});
const openSearch = new Client({
  ...AwsSigv4Signer({
    region: process.env.AWS_REGION || 'ap-northeast-1',
    service: 'aoss',
    getCredentials: () => {
      const credentialsProvider = defaultProvider();
      return credentialsProvider();
    },
  }),
  node: process.env.OPENSEARCH_ENDPOINT
});

// Constants
const VIDEO_BUCKET = process.env.VIDEO_BUCKET || '';
const NOVA_MODEL_ID = process.env.NOVA_MODEL_ID || 'apac.amazon.nova-pro-v1:0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
  'Access-Control-Allow-Credentials': 'true'
};

interface ClipSuggestion {
  clipId: string;
  title: string;
  description: string;
  startTime: number;
  endTime: number;
  duration: number;
  qualityScore: number;
  engagementScore: number;
  segments: string[]; // segment IDs that compose this clip
  thumbnailUrl?: string;
  previewUrl?: string;
  tags: string[];
  style: string;
  aspectRatios: {
    landscape: { width: number; height: number }; // 16:9
    portrait: { width: number; height: number };   // 9:16
    square: { width: number; height: number };      // 1:1
  };
}

interface AutoClipsRequest {
  indexId: string;
  targetDuration?: number; // seconds: 15, 30, 60
  count?: number;          // number of clips to generate
  style?: 'highlights' | 'tutorial' | 'montage' | 'storytelling';
}

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  console.log('Auto-clips Lambda invoked:', JSON.stringify(event, null, 2));

  try {
    const method = event.httpMethod;

    if (method === 'OPTIONS') {
      return respond(200, '');
    }

    // POST /videos/auto-clips/{videoId}
    if (method === 'POST') {
      const videoId = event.pathParameters?.videoId;
      if (!videoId) {
        return respond(400, { error: 'videoId is required' });
      }
      return handleAutoClips(event, videoId);
    }

    return respond(400, { error: 'Unsupported method' });
  } catch (error) {
    console.error('Error in auto-clips handler:', error);
    return respond(500, { error: 'Internal server error' });
  }
};

async function handleAutoClips(event: APIGatewayProxyEvent, videoId: string): Promise<APIGatewayProxyResult> {
  const body: AutoClipsRequest = event.body ? JSON.parse(event.body) : {};
  const indexId = body.indexId;
  const targetDuration = body.targetDuration || 30;
  const count = Math.min(body.count || 5, 20); // cap at 20
  const style = body.style || 'highlights';

  if (!indexId) {
    return respond(400, { error: 'indexId is required in request body' });
  }

  // Fetch video data from OpenSearch
  const videoData = await getVideoFromOpenSearch(indexId, videoId);
  if (!videoData) {
    return respond(404, { error: 'Video not found' });
  }

  const segments = videoData.video_segments || [];
  if (segments.length === 0) {
    return respond(400, { error: 'Video has no segments. Please wait for video processing to complete.' });
  }

  // Get the raw video S3 path for Nova analysis
  const rawVideoS3Path = videoData.video_s3_path;
  if (!rawVideoS3Path) {
    return respond(400, { error: 'Video S3 path not found' });
  }

  // Use Nova to analyze the full video and suggest clips
  const clipSuggestions = await generateClipSuggestions(
    rawVideoS3Path,
    segments,
    videoData,
    targetDuration,
    count,
    style
  );

  // Enrich suggestions with signed URLs from existing segments
  const enrichedClips = await enrichClipsWithUrls(clipSuggestions, segments);

  return respond(200, {
    videoId,
    indexId,
    targetDuration,
    style,
    count: enrichedClips.length,
    clips: enrichedClips,
  });
}

async function generateClipSuggestions(
  rawVideoS3Path: string,
  segments: any[],
  videoData: any,
  targetDuration: number,
  count: number,
  style: string
): Promise<ClipSuggestion[]> {
  const s3Uri = `s3://${VIDEO_BUCKET}/${rawVideoS3Path}`;
  const format = rawVideoS3Path.split('.').pop()?.toLowerCase() || 'mp4';

  // Build segment info for context
  const segmentInfo = segments.map((s: any, i: number) => ({
    index: i,
    segmentId: s.segment_id,
    startTime: s.start_time,
    endTime: s.end_time,
    duration: s.duration,
    description: s.segment_visual?.segment_visual_description || '',
  }));

  const prompt = `You are an expert short-form video editor. Analyze this video and suggest ${count} engaging clips for ${getPlatformFromDuration(targetDuration)}.

Target clip duration: ~${targetDuration} seconds
Style: ${style}
${style === 'highlights' ? 'Focus on the most visually engaging, emotionally impactful, or action-packed moments.' : ''}
${style === 'tutorial' ? 'Focus on key instructional moments, demonstrations, and clear explanations.' : ''}
${style === 'montage' ? 'Select visually diverse moments that create an engaging montage when combined.' : ''}
${style === 'storytelling' ? 'Select moments that tell a compelling mini-story with beginning, middle, and end.' : ''}

Available segments:
${JSON.stringify(segmentInfo, null, 2)}

For each suggested clip, group consecutive or related segments that together form a coherent clip of approximately ${targetDuration} seconds. Rate each clip on quality (visual appeal, production value) and engagement (hook potential, emotional impact, shareability) on a scale of 0-100.

Return ONLY a valid JSON array:
[
  {
    "title": "short engaging title",
    "description": "1-sentence description of what makes this clip compelling",
    "segmentIndexes": [0, 1, 2],
    "qualityScore": 85,
    "engagementScore": 90,
    "tags": ["action", "highlight", "exciting"],
    "hookDescription": "why this works as a short-form clip"
  }
]

Return ONLY valid JSON. No markdown, no explanation. Suggest the ${count} best clips sorted by engagement score descending.`;

  const requestBody = {
    messages: [
      {
        role: 'user',
        content: [
          {
            video: {
              format,
              source: {
                s3Location: { uri: s3Uri }
              }
            }
          },
          { text: prompt }
        ]
      }
    ],
    system: [
      {
        text: 'You are an expert short-form video editor who creates viral TikTok, Reels, and YouTube Shorts content. You have an eye for engaging moments and know what makes clips shareable. Always respond with valid JSON only.'
      }
    ],
    inferenceConfig: {
      maxTokens: 2000,
      temperature: 0.3
    }
  };

  const command = new InvokeModelCommand({
    modelId: NOVA_MODEL_ID,
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify(requestBody)
  });

  const response = await bedrock.send(command);
  const responseBody = JSON.parse(new TextDecoder().decode(response.body));

  const textContent = responseBody.output?.message?.content?.find(
    (item: any) => 'text' in item
  );

  if (!textContent?.text) {
    throw new Error('No text content in Nova response');
  }

  let jsonStr = textContent.text.trim();
  if (jsonStr.startsWith('```')) {
    jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  }

  let suggestions: any[];
  try {
    suggestions = JSON.parse(jsonStr);
  } catch (parseError) {
    console.error('Failed to parse Nova response:', jsonStr);
    // Fallback: create simple clips from segments
    return createFallbackClips(segments, targetDuration, count, style);
  }

  // Convert Nova suggestions to ClipSuggestion format
  return suggestions.slice(0, count).map((suggestion: any, index: number) => {
    const segmentIndexes: number[] = suggestion.segmentIndexes || [];
    const clipSegments = segmentIndexes
      .filter((i: number) => i >= 0 && i < segments.length)
      .map((i: number) => segments[i]);

    if (clipSegments.length === 0) {
      return null;
    }

    const startTime = Math.min(...clipSegments.map((s: any) => s.start_time));
    const endTime = Math.max(...clipSegments.map((s: any) => s.end_time));

    return {
      clipId: `clip_${index + 1}`,
      title: suggestion.title || `Clip ${index + 1}`,
      description: suggestion.description || '',
      startTime,
      endTime,
      duration: endTime - startTime,
      qualityScore: Math.min(100, Math.max(0, suggestion.qualityScore || 70)),
      engagementScore: Math.min(100, Math.max(0, suggestion.engagementScore || 70)),
      segments: clipSegments.map((s: any) => s.segment_id),
      tags: suggestion.tags || [],
      style,
      aspectRatios: {
        landscape: { width: 1920, height: 1080 },
        portrait: { width: 1080, height: 1920 },
        square: { width: 1080, height: 1080 },
      },
    } as ClipSuggestion;
  }).filter(Boolean) as ClipSuggestion[];
}

function createFallbackClips(
  segments: any[],
  targetDuration: number,
  count: number,
  style: string
): ClipSuggestion[] {
  const targetMs = targetDuration * 1000;
  const clips: ClipSuggestion[] = [];

  // Group consecutive segments into clips of approximately targetDuration
  let currentGroup: any[] = [];
  let currentDuration = 0;

  for (const segment of segments) {
    currentGroup.push(segment);
    currentDuration += segment.duration;

    if (currentDuration >= targetMs) {
      const startTime = currentGroup[0].start_time;
      const endTime = currentGroup[currentGroup.length - 1].end_time;

      clips.push({
        clipId: `clip_${clips.length + 1}`,
        title: `Clip ${clips.length + 1}`,
        description: `Auto-generated ${style} clip`,
        startTime,
        endTime,
        duration: endTime - startTime,
        qualityScore: 60,
        engagementScore: 60,
        segments: currentGroup.map((s: any) => s.segment_id),
        tags: [style],
        style,
        aspectRatios: {
          landscape: { width: 1920, height: 1080 },
          portrait: { width: 1080, height: 1920 },
          square: { width: 1080, height: 1080 },
        },
      });

      currentGroup = [];
      currentDuration = 0;

      if (clips.length >= count) break;
    }
  }

  return clips;
}

async function enrichClipsWithUrls(clips: ClipSuggestion[], segments: any[]): Promise<ClipSuggestion[]> {
  const segmentMap = new Map(segments.map((s: any) => [s.segment_id, s]));

  for (const clip of clips) {
    // Use the first segment's thumbnail as the clip thumbnail
    const firstSegmentId = clip.segments[0];
    const firstSegment = segmentMap.get(firstSegmentId);

    if (firstSegment) {
      // Generate signed URLs if S3 paths exist
      if (firstSegment.segment_video_thumbnail_s3_path) {
        try {
          const thumbnailCommand = new GetObjectCommand({
            Bucket: VIDEO_BUCKET,
            Key: firstSegment.segment_video_thumbnail_s3_path,
          });
          clip.thumbnailUrl = await getSignedUrl(s3 as any, thumbnailCommand as any, { expiresIn: 3600 });
        } catch (error) {
          console.warn(`Failed to generate thumbnail URL for clip ${clip.clipId}`);
        }
      }

      if (firstSegment.segment_video_s3_path) {
        try {
          const previewCommand = new GetObjectCommand({
            Bucket: VIDEO_BUCKET,
            Key: firstSegment.segment_video_s3_path,
          });
          clip.previewUrl = await getSignedUrl(s3 as any, previewCommand as any, { expiresIn: 3600 });
        } catch (error) {
          console.warn(`Failed to generate preview URL for clip ${clip.clipId}`);
        }
      }
    }
  }

  return clips;
}

function getPlatformFromDuration(seconds: number): string {
  if (seconds <= 15) return 'TikTok/Instagram Reels (15s)';
  if (seconds <= 30) return 'TikTok/Instagram Reels (30s)';
  if (seconds <= 60) return 'YouTube Shorts/TikTok (60s)';
  return `short-form content (${seconds}s)`;
}

async function getVideoFromOpenSearch(indexId: string, videoId: string): Promise<any | null> {
  try {
    const { body: searchResult } = await openSearch.search({
      index: indexId,
      body: {
        query: { term: { video_id: videoId } }
      }
    });

    if (searchResult.hits?.hits?.length > 0) {
      return searchResult.hits.hits[0]._source;
    }
    return null;
  } catch (error) {
    console.error('Error fetching video from OpenSearch:', error);
    return null;
  }
}

function respond(statusCode: number, body: any): APIGatewayProxyResult {
  return {
    statusCode,
    headers: corsHeaders,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  };
}
