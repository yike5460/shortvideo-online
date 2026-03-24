import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { Client } from '@opensearch-project/opensearch';
import { defaultProvider } from '@aws-sdk/credential-provider-node';
import { AwsSigv4Signer } from '@opensearch-project/opensearch/aws';
import { v4 as uuidv4 } from 'uuid';

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
const ADS_TAGS_TABLE = process.env.ADS_TAGS_TABLE || '';
const NOVA_MODEL_ID = process.env.NOVA_MODEL_ID || 'apac.amazon.nova-pro-v1:0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
  'Access-Control-Allow-Credentials': 'true'
};

// Tag schema matching the requirements document
interface SegmentTag {
  tagId: string;
  videoId: string;
  indexId: string;
  segmentId: string;
  startTime: number;
  endTime: number;
  duration: number;
  // FR2: Visual Content Analysis
  scene: {
    environment: 'indoor' | 'outdoor' | 'mixed';
    location: string;
    lighting: string;
    colorGrading: string;
  };
  subjects: Array<{
    type: string;
    description: string;
    action: string;
  }>;
  camera: {
    shotType: string;
    movement: string;
    composition: string;
  };
  // FR3: Human Behavior Analysis
  emotion: {
    facialExpressions: Array<{
      type: string;
      intensity: 'low' | 'medium' | 'high';
    }>;
    overallMood: string;
    engagementLevel: string;
  };
  // FR4: Audio Content Analysis
  audio: {
    type: string;
    description: string;
  };
  // FR5: Metadata Generation
  summary: string;
  keywords: string[];
  emotionKeywords: string[];
  visualStyleKeywords: string[];
  // FR5.2: Categorization
  category: string;
  emotionalIntensity: 'low' | 'medium' | 'high';
  utilityTags: string[];
  technicalTags: string[];
  // Metadata
  tag: string; // primary tag for GSI
  confidence: number;
  createdAt: string;
}

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  console.log('Ads-tagging Lambda invoked:', JSON.stringify(event, null, 2));

  try {
    const method = event.httpMethod;
    const path = event.path;

    if (method === 'OPTIONS') {
      return { statusCode: 200, headers: corsHeaders, body: '' };
    }

    // POST /videos/analyze/{videoId} - Start analysis
    if (method === 'POST' && path.includes('/analyze/')) {
      const videoId = event.pathParameters?.videoId;
      if (!videoId) {
        return respond(400, { error: 'videoId is required' });
      }
      return handleStartAnalysis(event, videoId);
    }

    // GET /videos/analyze/{videoId}/tags - Get analysis results
    if (method === 'GET' && path.includes('/analyze/') && path.includes('/tags')) {
      const videoId = event.pathParameters?.videoId;
      if (!videoId) {
        return respond(400, { error: 'videoId is required' });
      }
      return handleGetTags(videoId, event.queryStringParameters);
    }

    return respond(400, { error: 'Unsupported route' });
  } catch (error) {
    console.error('Error in ads-tagging handler:', error);
    return respond(500, { error: 'Internal server error' });
  }
};

async function handleStartAnalysis(event: APIGatewayProxyEvent, videoId: string): Promise<APIGatewayProxyResult> {
  const body = event.body ? JSON.parse(event.body) : {};
  const indexId = body.indexId;

  if (!indexId) {
    return respond(400, { error: 'indexId is required in request body' });
  }

  // Fetch video metadata from OpenSearch to get segments and S3 paths
  const videoData = await getVideoFromOpenSearch(indexId, videoId);
  if (!videoData) {
    return respond(404, { error: 'Video not found' });
  }

  const segments = videoData.video_segments || [];
  if (segments.length === 0) {
    return respond(400, { error: 'Video has no segments. Please wait for video processing to complete.' });
  }

  const results: SegmentTag[] = [];
  const startTime = Date.now();

  // Process each segment with Nova
  for (const segment of segments) {
    if (!segment.segment_video_s3_path) {
      console.warn(`Skipping segment ${segment.segment_id} - no S3 path`);
      continue;
    }

    try {
      const analysis = await analyzeSegmentWithNova(
        segment.segment_video_s3_path,
        segment,
        videoData
      );

      const tagId = `tag_${uuidv4().substring(0, 8)}`;
      const segmentTag: SegmentTag = {
        tagId,
        videoId,
        indexId,
        segmentId: segment.segment_id || '',
        startTime: segment.start_time,
        endTime: segment.end_time,
        duration: segment.duration,
        ...analysis,
        tag: analysis.keywords[0] || 'untagged',
        confidence: 85,
        createdAt: new Date().toISOString(),
      };

      // Store in DynamoDB
      await docClient.send(new PutCommand({
        TableName: ADS_TAGS_TABLE,
        Item: segmentTag,
      }));

      results.push(segmentTag);
    } catch (error) {
      console.error(`Error analyzing segment ${segment.segment_id}:`, error);
    }
  }

  const processingTime = Date.now() - startTime;

  return respond(200, {
    videoId,
    indexId,
    totalSegments: segments.length,
    analyzedSegments: results.length,
    processingTimeMs: processingTime,
    tags: results,
  });
}

async function handleGetTags(
  videoId: string,
  queryParams: Record<string, string> | null
): Promise<APIGatewayProxyResult> {
  const category = queryParams?.category;
  const tag = queryParams?.tag;
  const format = queryParams?.format || 'json';

  let tags: SegmentTag[];

  if (tag) {
    // Query by tag using TagGSI
    const result = await docClient.send(new QueryCommand({
      TableName: ADS_TAGS_TABLE,
      IndexName: 'TagGSI',
      KeyConditionExpression: 'tag = :tag',
      FilterExpression: 'videoId = :videoId',
      ExpressionAttributeValues: {
        ':tag': tag,
        ':videoId': videoId,
      },
    }));
    tags = (result.Items || []) as SegmentTag[];
  } else if (category) {
    // Query by category using CategoryGSI
    const result = await docClient.send(new QueryCommand({
      TableName: ADS_TAGS_TABLE,
      IndexName: 'CategoryGSI',
      KeyConditionExpression: 'category = :category',
      FilterExpression: 'videoId = :videoId',
      ExpressionAttributeValues: {
        ':category': category,
        ':videoId': videoId,
      },
    }));
    tags = (result.Items || []) as SegmentTag[];
  } else {
    // Query all tags for this video
    const result = await docClient.send(new QueryCommand({
      TableName: ADS_TAGS_TABLE,
      KeyConditionExpression: 'videoId = :videoId',
      ExpressionAttributeValues: {
        ':videoId': videoId,
      },
    }));
    tags = (result.Items || []) as SegmentTag[];
  }

  if (format === 'csv') {
    const csv = tagsToCSV(tags);
    return {
      statusCode: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="tags_${videoId}.csv"`,
      },
      body: csv,
    };
  }

  return respond(200, { videoId, count: tags.length, tags });
}

async function analyzeSegmentWithNova(
  s3Path: string,
  segment: any,
  videoData: any
): Promise<Omit<SegmentTag, 'tagId' | 'videoId' | 'indexId' | 'segmentId' | 'startTime' | 'endTime' | 'duration' | 'tag' | 'confidence' | 'createdAt'>> {
  const s3Uri = `s3://${VIDEO_BUCKET}/${s3Path}`;
  const format = s3Path.split('.').pop()?.toLowerCase() || 'mp4';

  const prompt = `Analyze this video segment and provide a structured JSON response with the following fields. Be precise and concise.

{
  "scene": {
    "environment": "indoor|outdoor|mixed",
    "location": "specific location description",
    "lighting": "lighting condition",
    "colorGrading": "color style description"
  },
  "subjects": [
    {
      "type": "person|animal|object|vehicle|logo",
      "description": "brief description",
      "action": "what they are doing"
    }
  ],
  "camera": {
    "shotType": "CU|MS|LS|ELS|OTS|aerial|POV",
    "movement": "static|pan|tilt|dolly|zoom|handheld|tracking",
    "composition": "composition notes"
  },
  "emotion": {
    "facialExpressions": [
      { "type": "smile|neutral|surprise|focus|concern", "intensity": "low|medium|high" }
    ],
    "overallMood": "mood description",
    "engagementLevel": "low|medium|high"
  },
  "audio": {
    "type": "speech|music|ambient|silence|mixed",
    "description": "audio content description"
  },
  "summary": "1-2 sentence content summary",
  "keywords": ["keyword1", "keyword2", "keyword3", "keyword4", "keyword5"],
  "emotionKeywords": ["emotion1", "emotion2"],
  "visualStyleKeywords": ["style1", "style2"],
  "category": "product_demo|interview|landscape|action|tutorial|testimonial|lifestyle|b_roll|transition|opening|closing",
  "emotionalIntensity": "low|medium|high",
  "utilityTags": ["suitable_for_opening", "good_b_roll", "transition_clip", etc.],
  "technicalTags": ["4k", "slow_motion", "timelapse", "handheld", etc.]
}

Return ONLY valid JSON. No markdown, no explanation.`;

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
        text: 'You are an expert video content analyst for advertising asset management. Analyze video segments with precision for scene, subject, camera, emotion, and audio characteristics. Always respond with valid JSON only.'
      }
    ],
    inferenceConfig: {
      maxTokens: 1500,
      temperature: 0.1
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

  // Parse the JSON response, handling potential markdown code blocks
  let jsonStr = textContent.text.trim();
  if (jsonStr.startsWith('```')) {
    jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  }

  try {
    return JSON.parse(jsonStr);
  } catch (parseError) {
    console.error('Failed to parse Nova response as JSON:', jsonStr);
    // Return a minimal valid structure
    return {
      scene: { environment: 'mixed', location: 'unknown', lighting: 'unknown', colorGrading: 'neutral' },
      subjects: [],
      camera: { shotType: 'MS', movement: 'static', composition: 'standard' },
      emotion: { facialExpressions: [], overallMood: 'neutral', engagementLevel: 'medium' },
      audio: { type: 'mixed', description: 'unable to analyze' },
      summary: 'Analysis could not be completed for this segment.',
      keywords: ['video', 'segment'],
      emotionKeywords: ['neutral'],
      visualStyleKeywords: ['standard'],
      category: 'b_roll',
      emotionalIntensity: 'low',
      utilityTags: [],
      technicalTags: [],
    };
  }
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

function tagsToCSV(tags: SegmentTag[]): string {
  if (tags.length === 0) return '';

  const headers = [
    'segmentId', 'startTime', 'endTime', 'duration',
    'environment', 'location', 'lighting', 'colorGrading',
    'shotType', 'cameraMovement',
    'overallMood', 'engagementLevel', 'emotionalIntensity',
    'audioType',
    'category', 'summary',
    'keywords', 'emotionKeywords', 'visualStyleKeywords',
    'utilityTags', 'technicalTags'
  ];

  const rows = tags.map(tag => [
    tag.segmentId,
    tag.startTime,
    tag.endTime,
    tag.duration,
    tag.scene?.environment || '',
    csvEscape(tag.scene?.location || ''),
    csvEscape(tag.scene?.lighting || ''),
    csvEscape(tag.scene?.colorGrading || ''),
    tag.camera?.shotType || '',
    tag.camera?.movement || '',
    csvEscape(tag.emotion?.overallMood || ''),
    tag.emotion?.engagementLevel || '',
    tag.emotionalIntensity || '',
    tag.audio?.type || '',
    tag.category || '',
    csvEscape(tag.summary || ''),
    csvEscape((tag.keywords || []).join('; ')),
    csvEscape((tag.emotionKeywords || []).join('; ')),
    csvEscape((tag.visualStyleKeywords || []).join('; ')),
    csvEscape((tag.utilityTags || []).join('; ')),
    csvEscape((tag.technicalTags || []).join('; ')),
  ].join(','));

  return [headers.join(','), ...rows].join('\n');
}

function csvEscape(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function respond(statusCode: number, body: any): APIGatewayProxyResult {
  return {
    statusCode,
    headers: corsHeaders,
    body: JSON.stringify(body),
  };
}
