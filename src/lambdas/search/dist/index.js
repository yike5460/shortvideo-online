"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handler = void 0;
const opensearch_1 = require("@opensearch-project/opensearch");
const redis_1 = require("redis");
const openSearchClient = new opensearch_1.Client({
    node: process.env.OPENSEARCH_DOMAIN,
    ssl: {
        rejectUnauthorized: false
    }
});
const redisClient = (0, redis_1.createClient)({
    url: `redis://${process.env.REDIS_ENDPOINT}:6379`,
    socket: {
        connectTimeout: 5000,
        keepAlive: 5000
    }
});
const createResponse = (statusCode, body) => {
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
const validateRequest = (body) => {
    return (typeof body === 'object' &&
        typeof body.query === 'string' &&
        (!body.type || ['exact', 'semantic'].includes(body.type)) &&
        (!body.modality || ['visual', 'audio', 'text', 'all'].includes(body.modality)));
};
const getSearchFields = (modality) => {
    const fields = {
        visual: [
            'segment_visual_objects.label^2',
            'segment_visual_faces.person_name^2',
            'segment_visual.segment_visual_ocr_text'
        ],
        audio: ['segment_audio.segment_audio_transcript'],
        text: ['video_metadata.exact_match_keywords^1.5'],
        all: []
    };
    return modality === 'all'
        ? [...fields.visual, ...fields.audio, ...fields.text]
        : fields[modality];
};
// Placeholder for the embedding service integration
const generateQueryVector = async (query, modality) => {
    // TODO: Implement actual embedding generation using a service like AWS Bedrock
    return new Array(384).fill(0); // Placeholder 384-dimensional vector
};
const handler = async (event) => {
    try {
        if (!event.body) {
            return createResponse(400, { error: 'Request body is required' });
        }
        const body = JSON.parse(event.body);
        if (!validateRequest(body)) {
            return createResponse(400, { error: 'Invalid request format' });
        }
        const { query, type = 'semantic', modality = 'all', limit = 20, offset = 0 } = body;
        await redisClient.connect();
        let searchResponse;
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
        }
        else {
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
    }
    catch (error) {
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
exports.handler = handler;
//# sourceMappingURL=index.js.map