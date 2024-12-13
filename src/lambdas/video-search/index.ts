import { APIGatewayProxyEvent } from 'aws-lambda';
import { LambdaContext, LambdaResponse, SearchQuery } from '../../types/aws-lambda';
import { Client } from '@opensearch-project/opensearch';
import { defaultProvider } from '@aws-sdk/credential-provider-node';
import { RedisClientType, createClient } from 'redis';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { AwsSigv4Signer } from '@opensearch-project/opensearch/aws';

// Initialize clients
const openSearch = new Client({
  ...AwsSigv4Signer({
    region: process.env.AWS_REGION || 'us-east-1',
    service: 'es',
    getCredentials: () => {
      const credentialsProvider = defaultProvider();
      return credentialsProvider();
    },
  }),
  node: process.env.OPENSEARCH_DOMAIN
});

const bedrock = new BedrockRuntimeClient({});

let redisClient: RedisClientType | null = null;

export const handler = async (event: APIGatewayProxyEvent, _context: LambdaContext): Promise<LambdaResponse> => {
  try {
    if (!event.body) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Missing request body' })
      };
    }

    const searchQuery: SearchQuery = JSON.parse(event.body);
    const cacheKey = `search:${JSON.stringify(searchQuery)}`;

    // Try to get cached results
    if (!redisClient) {
      redisClient = createClient({
        url: `redis://${process.env.REDIS_ENDPOINT}:6379`
      });
      await redisClient.connect();
    }

    const cachedResults = await redisClient.get(cacheKey);
    if (cachedResults) {
      return {
        statusCode: 200,
        body: cachedResults
      };
    }

    // Prepare search query
    const searchBody: any = {
      size: searchQuery.top_k || 10,
      query: {
        bool: {
          should: []
        }
      }
    };

    // Handle text search
    if (searchQuery.text) {
      if (searchQuery.exact_match) {
        // Exact keyword matching
        searchBody.query.bool.should.push({
          multi_match: {
            query: searchQuery.text,
            fields: [
              'video_metadata.exact_match_keywords.visual^2',
              'video_metadata.exact_match_keywords.audio^2',
              'video_metadata.exact_match_keywords.text^1',
              'video_segments.segment_audio.segment_audio_transcript^1',
              'video_segments.segment_visual.segment_visual_ocr_text^1'
            ],
            type: 'phrase'
          }
        });
      } else {
        // Generate text embedding using Bedrock
        const embeddingResponse = await bedrock.send(new InvokeModelCommand({
          modelId: process.env.BEDROCK_EMBEDDING_MODEL || 'amazon.titan-embed-text-v1',
          body: JSON.stringify({
            inputText: searchQuery.text
          })
        }));

        const textEmbedding = JSON.parse(new TextDecoder().decode(embeddingResponse.body)).embedding;

        // Semantic search using embeddings
        searchBody.query.bool.should.push({
          script_score: {
            query: { match_all: {} },
            script: {
              source: "cosineSimilarity(params.query_vector, 'video_metadata.semantic_vectors.text_embedding') + 1.0",
              params: { query_vector: textEmbedding }
            }
          }
        });
      }
    }

    // Apply weights if provided
    if (searchQuery.weights) {
      searchBody.query.bool.should.forEach((clause: any, index: number) => {
        const modalityType = Object.keys(searchQuery.weights!)[index];
        if (modalityType && searchQuery.weights![modalityType as keyof typeof searchQuery.weights]) {
          clause.boost = searchQuery.weights![modalityType as keyof typeof searchQuery.weights];
        }
      });
    }

    // Execute search
    const searchResponse = await openSearch.search({
      index: 'videos',
      body: searchBody
    });

    // Process results
    const results = searchResponse.body.hits.hits.map((hit: any) => ({
      video_path: hit._source.video_original_path,
      video_clips: hit._source.video_segments
        .filter((segment: any) => segment.segment_confidence > 0.7)
        .map((segment: any) => ({
          start_time: segment.segment_start_time,
          end_time: segment.segment_end_time,
          duration: segment.segment_duration,
          confidence: segment.segment_confidence
        }))
    }));

    // Cache results
    await redisClient.set(cacheKey, JSON.stringify(results), {
      EX: 3600 // Cache for 1 hour
    });

    return {
      statusCode: 200,
      body: JSON.stringify(results)
    };

  } catch (error) {
    console.error('Search error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ 
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error'
      })
    };
  } finally {
    if (redisClient) {
      await redisClient.disconnect();
    }
  }
}; 