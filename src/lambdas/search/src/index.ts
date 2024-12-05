import { Client } from '@opensearch-project/opensearch';
import { createClient } from 'redis';
import { APIGatewayProxyEvent } from 'aws-lambda';
import {
  SearchRequest,
  SearchResponse,
  ErrorResponse,
  LambdaResponse,
  SearchType,
  SearchModality,
  EmbeddingVector
} from './types';

const openSearchClient = new Client({
  node: process.env.OPENSEARCH_DOMAIN,
  ssl: {
    rejectUnauthorized: false
  }
});

const redisClient = createClient({
  url: `redis://${process.env.REDIS_ENDPOINT}:6379`,
  socket: {
    connectTimeout: 5000,
    keepAlive: 5000
  }
});

const createResponse = (statusCode: number, body: SearchResponse | ErrorResponse): LambdaResponse => {
  return Promise.resolve({
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=300' // 5 minutes cache
    },
    body: JSON.stringify(body)
  });
};

const validateRequest = (body: any): body is SearchRequest => {
  return (
    typeof body === 'object' &&
    typeof body.query === 'string' &&
    (!body.type || ['exact', 'semantic'].includes(body.type)) &&
    (!body.modality || ['visual', 'audio', 'text', 'all'].includes(body.modality))
  );
};

const getSearchFields = (modality: SearchModality): string[] => {
  const fields = {
    visual: [
      'segment_visual_objects.label^2',
      'segment_visual_faces.person_name^2',
      'segment_visual.segment_visual_ocr_text'
    ],
    audio: ['segment_audio.segment_audio_transcript'],
    text: ['video_metadata.exact_match_keywords^1.5'],
    all: [] as string[]
  };

  return modality === 'all'
    ? [...fields.visual, ...fields.audio, ...fields.text]
    : fields[modality];
};

// Placeholder for the embedding service integration
const generateQueryVector = async (query: string, modality: SearchModality): Promise<EmbeddingVector> => {
  // TODO: Implement actual embedding generation using a service like AWS Bedrock
  return new Array(384).fill(0); // Placeholder 384-dimensional vector
};

export const handler = async (event: APIGatewayProxyEvent): LambdaResponse => {
  try {
    if (!event.body) {
      return createResponse(400, { error: 'Request body is required' });
    }

    const body = JSON.parse(event.body);
    
    if (!validateRequest(body)) {
      return createResponse(400, { error: 'Invalid request format' });
    }

    const {
      query,
      type = 'semantic',
      modality = 'all',
      limit = 20,
      offset = 0
    } = body;

    await redisClient.connect();

    let searchResponse: SearchResponse;

    if (type === 'exact') {
      // Exact keyword search with field boosting
      searchResponse = await openSearchClient.search({
        index: 'videos',
        body: {
          from: offset,
          size: limit,
          query: {
            multi_match: {
              query,
              fields: getSearchFields(modality),
              type: 'cross_fields',
              operator: 'and',
              tie_breaker: 0.3
            }
          },
          _source: {
            excludes: ['*_embedding'] // Don't return large embedding vectors
          }
        }
      });
    } else {
      // Semantic search with caching
      const cacheKey = `search:${type}:${modality}:${query}:${limit}:${offset}`;
      const cachedResult = await redisClient.get(cacheKey);

      if (cachedResult) {
        await redisClient.quit();
        return createResponse(200, JSON.parse(cachedResult));
      }

      const queryVector = await generateQueryVector(query, modality);

      searchResponse = await openSearchClient.search({
        index: 'videos',
        body: {
          from: offset,
          size: limit,
          query: {
            script_score: {
              query: { match_all: {} },
              script: {
                source: `cosineSimilarity(params.query_vector, 'video_metadata.semantic_vectors.${modality}_embedding') + 1.0`,
                params: { query_vector: queryVector }
              }
            }
          },
          _source: {
            excludes: ['*_embedding']
          }
        }
      });

      // Cache results
      await redisClient.set(cacheKey, JSON.stringify(searchResponse), {
        EX: 3600 // 1 hour cache
      });
    }

    await redisClient.quit();
    return createResponse(200, searchResponse);
  } catch (error) {
    console.error('Error:', error);
    
    if (redisClient.isOpen) {
      await redisClient.quit();
    }

    return createResponse(500, {
      error: 'Internal server error',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}; 