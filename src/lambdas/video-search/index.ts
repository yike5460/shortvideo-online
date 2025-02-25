import { APIGatewayProxyEvent } from 'aws-lambda';
import { LambdaContext, LambdaResponse } from '../../types/aws-lambda';
import { VideoResult, VideoSegment, VideoStatus, SearchOptions } from '../../types/common';
import { Client } from '@opensearch-project/opensearch';
import { defaultProvider } from '@aws-sdk/credential-provider-node';
import { RedisClientType, createClient } from 'redis';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { AwsSigv4Signer } from '@opensearch-project/opensearch/aws';

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
let redisClient: RedisClientType | null = null;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
  'Access-Control-Allow-Credentials': 'true'
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
      'video_thumbnail_url',
      'video_s3_path',
      'video_duration',
      'video_original_path',
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
          {
            match_all: {}
          }
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
        minimum_should_match: 0 // Return all documents if no match
      }
    }
  };

  console.log('Generated search body:', JSON.stringify(searchBody, null, 2));
  return searchBody;
};

// Optimize the test query to return less data
const getTestQuery = () => ({
  index: 'videos',
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

// Optimize result transformation to include only essential data
const transformSearchResults = (hits: any[]): VideoResult[] => {
  return hits.map(hit => {
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
    
    return {
      id: hit._id,
      title: hit._source.video_title || '',
      description: hit._source.video_description || '',
      thumbnailUrl: hit._source.video_thumbnail_url || '',
      previewUrl: hit._source.video_s3_path || '',
      duration: hit._source.video_duration || 0,
      source: hit._source.video_original_path?.includes('youtube.com') ? 'youtube' : 'local',
      sourceUrl: hit._source.video_original_path || '',
      uploadDate: hit._source.created_at,
      format: hit._source.video_type || '',
      status: hit._source.video_status,
      size: hit._source.video_size || 0,
      segments: limitedSegments
    };
  });
};

export const handler = async (event: APIGatewayProxyEvent, _context: LambdaContext): Promise<LambdaResponse> => {
  console.log('Received event for video search:', JSON.stringify(event, null, 2));
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

    // Test the OpenSearch connection with minimal data
    const testQuery = getTestQuery();
    console.log('Test query:', JSON.stringify(testQuery, null, 2));
    
    const { body: testResult } = await openSearch.search(testQuery);
    
    // Log only essential test data
    if (testResult.hits?.hits) {
      console.log(`Found ${testResult.hits.total.value} documents`);
      console.log('Sample documents:', testResult.hits.hits.slice(0, 3).map((hit: any) => ({
        id: hit._id,
        title: hit._source.video_title,
        status: hit._source.video_status
      })));
    }

    // Build and execute the search with limited results
    const searchBody = buildSearchQuery(searchQuery);
    const { body } = await openSearch.search({
      index: searchQuery.selectedIndex || 'videos',
      body: searchBody
    });

    // Log only the count and IDs of results to avoid large logs
    console.log(`Search returned ${body.hits.total.value} results`);
    console.log('Result IDs:', body.hits.hits.map((hit: any) => hit._id));

    // Transform results to match VideoResult interface with limited data
    const results: VideoResult[] = transformSearchResults(body.hits.hits);

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