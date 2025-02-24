import { APIGatewayProxyEvent } from 'aws-lambda';
import { LambdaContext, LambdaResponse } from '../../types/aws-lambda';
import { VideoResult, VideoSegment, VideoStatus, SearchOptions } from '../../types/common';
import { Client } from '@opensearch-project/opensearch';
import { defaultProvider } from '@aws-sdk/credential-provider-node';
import { RedisClientType, createClient } from 'redis';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { AwsSigv4Signer } from '@opensearch-project/opensearch/aws';

// Add search query interface to match frontend in page.tsx
interface SearchQuery {
  text: string;
  exact_match: boolean;
  top_k: number;
  weights: {
    visual: number;
    audio: number;
    text: number;
  };
  min_confidence: number;
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

// Simplify and optimize the search query
const buildSearchQuery = (searchQuery: SearchQuery): OpenSearchQuery => {
  const searchBody: OpenSearchQuery = {
    size: searchQuery.top_k || 20,
    query: {
      bool: {
        must: [
          { term: { video_status: 'ready' as VideoStatus} }
        ],
        must_not: [
          { term: { video_status: 'deleted' as VideoStatus} }
        ],
        should: [],
        minimum_should_match: 1
      }
    }
  };

  if (searchQuery.text) {
    if (searchQuery.exact_match) {
      // Simplified exact match query
      searchBody.query.bool.should.push({
        multi_match: {
          query: searchQuery.text,
          fields: [
            'video_title^3',
            'video_description^2',
            'video_metadata.exact_match_keywords.*',
            'video_segments.segment_audio.segment_audio_transcript',
            'video_segments.segment_visual.segment_visual_description'
          ],
          type: 'phrase',
          tie_breaker: 0.3
        }
      });
    } else {
      // Simplified semantic search
      searchBody.query.bool.should.push({
        multi_match: {
          query: searchQuery.text,
          fields: [
            'video_title^3',
            'video_description^2',
            'video_metadata.exact_match_keywords.*',
            'video_segments.segment_audio.segment_audio_transcript',
            'video_segments.segment_visual.segment_visual_description'
          ],
          type: 'best_fields',
          tie_breaker: 0.3,
          fuzziness: 'AUTO'
        }
      });
    }
  }

  return searchBody;
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

    // Build and execute the actual search
    const searchBody = buildSearchQuery(searchQuery);
    console.log('Search query:', JSON.stringify(searchBody, null, 2));

    const { body } = await openSearch.search({
      index: 'videos',
      body: searchBody
    });

    // Transform results to match VideoResult interface
    const results: VideoResult[] = body.hits.hits.map((hit: any) => ({
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
        segment_visual: segment.segment_visual,
        segment_audio: segment.segment_audio
      })) || []
    }));

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