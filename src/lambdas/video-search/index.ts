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

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
  'Access-Control-Allow-Credentials': 'true'
};

// Add this function to get the OpenSearch index name from the index ID
const getOpenSearchIndexName = async (indexId: string): Promise<string> => {
  // If no index ID is provided, use the default 'videos' index
  if (!indexId) {
    return 'videos';
  }
  
  try {
    const result = await docClient.send(new GetCommand({
      TableName: process.env.INDEXES_TABLE,
      Key: { indexId }
    }));
    
    if (!result.Item) {
      console.warn(`Index ${indexId} not found, falling back to default index`);
      return 'videos';
    }
    
    return result.Item.indexId;
  } catch (error) {
    console.error('Error getting index details:', error);
    return 'videos'; // Fallback to default index
  }
};

// Update the search query builder
const buildSearchQuery = (searchQuery: SearchQuery): OpenSearchQuery => {
  console.log('Building search query:', JSON.stringify(searchQuery, null, 2));

  const searchTerm = searchQuery.searchQuery.trim();
  
  // Simple query that should work with most OpenSearch configurations
  const searchBody: OpenSearchQuery = {
    size: searchQuery.topK || 3, // Limit to 3 results by default
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
      // Only include essential segment data
      'video_segments.segment_id',
      'video_segments.start_time',
      'video_segments.end_time',
      'video_segments.duration'
    ],
    query: {
      bool: {
        must: [
          // Filter for valid statuses
          {
            bool: {
              should: [
                { term: { video_status: 'ready' } },
                { term: { video_status: 'ready_for_face' } },
                { term: { video_status: 'ready_for_object' } },
                { term: { video_status: 'ready_for_shots' } },
                { term: { video_status: 'ready_for_video_embed' } },
                { term: { video_status: 'ready_for_audio_embed' } }
              ],
              minimum_should_match: 1
            }
          }
        ],
        must_not: [
          { term: { video_status: 'deleted' } }
        ],
        should: [
          // Simple match on title with high boost
          {
            match: {
              "video_title": {
                query: searchTerm,
                boost: 3.0
              }
            }
          },
          // Match on description with lower boost
          {
            match: {
              "video_description": {
                query: searchTerm,
                boost: 1.0
              }
            }
          },
          // Prefix match for partial matches
          {
            prefix: {
              "video_title": {
                value: searchTerm.toLowerCase(),
                boost: 2.0
              }
            }
          }
        ],
        minimum_should_match: 1 // Require at least one match
      }
    }
  };

  console.log('Generated search body:', JSON.stringify(searchBody, null, 2));
  return searchBody;
};

// Optimize the test query to return less data
const getTestQuery = (indexName: string) => ({
  index: indexName,
  body: {
    size: 3, // Limit to 3 results for testing
    query: { match_all: {} },
    _source: [
      'video_id',
      'video_title',
      'video_status'
    ]
  }
});

// Update the transform function to normalize OpenSearch confidence scores, such score is relative and per index and per query, calculated using TF-IDF by default
const transformSearchResults = async (hits: any[]): Promise<VideoResult[]> => {
  // Find the max score for normalization
  const maxScore = Math.max(...hits.map(hit => hit._score || 0));
  
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
  
  // Process all results in parallel
  return await Promise.all(hits.map(async hit => {
    // Extract only the essential segments data
    const segments = hit._source.video_segments?.map((segment: any): VideoSegment => ({
      segment_id: segment.segment_id,
      video_id: hit._id,
      start_time: segment.start_time,
      end_time: segment.end_time,
      duration: segment.duration
    })) || [];

    // Limit segments to 5 per video to reduce payload size
    const limitedSegments = segments.slice(0, 5);
    
    // Normalize the score to be between 0 and 1
    const normalizedScore = maxScore > 0 ? (hit._score || 0) / maxScore : 0;
    
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
      segments: limitedSegments,
      searchConfidence: normalizedScore, // Use normalized score
      indexId: hit._source.video_index || 'videos'
    };
  }));
};

// Update the handler to use the dynamic index
export const handler = async (event: APIGatewayProxyEvent, _context: LambdaContext): Promise<LambdaResponse> => {
  console.log('Received event for video search:', JSON.stringify(event, null, 2));
  console.log('INDEXES_TABLE_DYNAMODB_DNS_NAME:', process.env.INDEXES_TABLE_DYNAMODB_DNS_NAME);
  try {
    if (!event.body) {
      return {
        statusCode: 400,
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

    const openSearchIndexName = await getOpenSearchIndexName(searchQuery.selectedIndex || '')

    // Build and execute the search with limited results
    const searchBody = buildSearchQuery(searchQuery);

    const { body } = await openSearch.search({
      index: openSearchIndexName,
      body: searchBody
    });

    // Log only the count and IDs of results to avoid large logs
    console.log(`Search returned ${body.hits.total.value} results`);
    console.log('Result IDs:', body.hits.hits.map((hit: any) => hit._id));

    // Transform results to match VideoResult interface with limited data
    const results: VideoResult[] = await transformSearchResults(body.hits.hits);

    // Cache results, skip the redis cache for now
    // await redisClient.set(cacheKey, JSON.stringify(results), {
    //   EX: 3600 // 1 hour
    // });

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify(results)
    };

  } catch (error) {
    console.error('Search error:', error);
    return {
      statusCode: 500,
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