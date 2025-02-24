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

  const searchBody: OpenSearchQuery = {
    size: searchQuery.topK || 20,
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
      'video_segments'
    ],
    query: {
      bool: {
        must: [
          { term: { video_status: 'ready' as VideoStatus } }
        ],
        must_not: [
          { term: { video_status: 'deleted' as VideoStatus } }
        ],
        should: [],
        minimum_should_match: 1
      }
    }
  };

  // Only add search conditions if we have a query
  if (searchQuery.searchQuery && searchQuery.searchQuery.trim()) {
    if (searchQuery.exactMatch) {
      // Exact match query
      searchBody.query.bool.should.push({
        multi_match: {
          query: searchQuery.searchQuery,
          fields: [
            'video_title^3',
            'video_description^2',
            'video_metadata.exact_match_keywords.visual^2',
            'video_metadata.exact_match_keywords.audio^2',
            'video_metadata.exact_match_keywords.text^1',
            'video_segments.segment_audio.segment_audio_transcript^1',
            'video_segments.segment_visual.segment_visual_description^1'
          ],
          type: 'phrase',
          tie_breaker: 0.3
        }
      });
    } else {
      // Semantic search with weights
      const fields = [];
      if (searchQuery.weights.text > 0) {
        fields.push(
          `video_title^${3 * searchQuery.weights.text}`,
          `video_description^${2 * searchQuery.weights.text}`,
          `video_metadata.exact_match_keywords.text^${searchQuery.weights.text}`
        );
      }
      if (searchQuery.weights.audio > 0) {
        fields.push(
          `video_metadata.exact_match_keywords.audio^${2 * searchQuery.weights.audio}`,
          `video_segments.segment_audio.segment_audio_transcript^${searchQuery.weights.audio}`
        );
      }
      if (searchQuery.weights.image > 0) {
        fields.push(
          `video_metadata.exact_match_keywords.visual^${2 * searchQuery.weights.image}`,
          `video_segments.segment_visual.segment_visual_description^${searchQuery.weights.image}`,
          `video_segments.segment_visual.segment_visual_ocr_text^${searchQuery.weights.image}`
        );
      }

      if (fields.length > 0) {
        searchBody.query.bool.should.push({
          multi_match: {
            query: searchQuery.searchQuery,
            fields,
            type: 'best_fields',
            tie_breaker: 0.3,
            fuzziness: 'AUTO'
          }
        });
      }
    }
  }

  console.log('Generated search body:', JSON.stringify(searchBody, null, 2));
  return searchBody;
};

// Update result transformation
const transformSearchResults = (hits: any[]): VideoResult[] => {
  return hits.map(hit => ({
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
    segments: hit._source.video_segments?.map((segment: any): VideoSegment => ({
      segment_id: segment.segment_id,
      video_id: hit._id,
      start_time: segment.start_time,
      end_time: segment.end_time,
      duration: segment.duration,
      // segment_visual: segment.segment_visual,
      // segment_audio: segment.segment_audio
    })) || []
  }));
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

    // Test the OpenSearch connection
    const { body: testResult } = await openSearch.search({
      index: 'videos',
      body: {
        query: { match_all: {} }
      }
    });

    console.log('OpenSearch test result:', testResult);

    // Build and execute the search
    const searchBody = buildSearchQuery(searchQuery);
    const { body } = await openSearch.search({
      index: searchQuery.selectedIndex || 'videos',
      body: searchBody
    });

    console.log('Search results:', JSON.stringify(body, null, 2));

    // Transform results to match VideoResult interface
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