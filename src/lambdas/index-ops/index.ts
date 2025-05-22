import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  DeleteCommand,
  ScanCommand
} from '@aws-sdk/lib-dynamodb';
import {
  S3Client,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command
} from '@aws-sdk/client-s3';
import { Client } from '@opensearch-project/opensearch';
import { defaultProvider } from '@aws-sdk/credential-provider-node';
import { AwsSigv4Signer } from '@opensearch-project/opensearch/aws';
import { v4 as uuidv4 } from 'uuid';
import { OpenSearchHit } from '../../types/common';

// Initialize clients
const dynamoClient = new DynamoDBClient({endpoint: process.env.INDEXES_TABLE_DYNAMODB_DNS_NAME});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

// Initialize S3 client
const s3Client = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });

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
});

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

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  console.log('Received event for index operations:', JSON.stringify(event, null, 2));

  // Handle OPTIONS request for CORS
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: STATUS_CODES.OK,
      headers: corsHeaders,
      body: ''
    };
  }

  try {
    // Route based on HTTP method
    switch (event.httpMethod) {
      case 'GET':
        return await handleGetIndex(event);
      case 'POST':
        return await handleCreateIndex(event);
      case 'DELETE':
        return await handleDeleteIndex(event);
      default:
        return {
          statusCode: 405,
          headers: corsHeaders,
          body: JSON.stringify({ error: 'Method not allowed' })
        };
    }
  } catch (error) {
    console.error('Error in index operations:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error'
      })
    };
  }
};

/**
 * Handle GET requests to retrieve index information
 * GET /indexes - List all indexes
 * GET /indexes/{indexId} - Get specific index
 */
async function handleGetIndex(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {

  const indexId = event.pathParameters?.indexId;
  
  // If indexId is provided, return the detailed information of the index, including the vector inside the indexId per videoId
  if (indexId) {
    try {
      // First get all the videoId in the index

      // Get all the videoId from the search result
      // The raw schema like:
      // "took": 42,
      // "timed_out": false,
      // "_shards": {
      //   "total": 0,
      //   "successful": 0,
      //   "skipped": 0,
      //   "failed": 0
      // },
      // "hits": {
      //   "total": {
      //     "value": 2,
      //     "relation": "eq"
      //   },
      //   "max_score": 1,
      //   "hits": [
      //     {
      //       "_index": "test38",
      //       "_id": "1%3A0%3AE5Ddk5UB007fNqCqMIEw",
      //       "_score": 1,
      //       "_source": {
      //         "video_index": "test38",
      //         "video_id": "95af47df-d9a7-4f4b-b389-843777a4fd4b",
      //         "video_segments": [
      //           {
      //             "segment_visual": {
      //               "segment_visual_embedding": [0.1, 0.2, 0.3]
      //             }
      //           }
      //         ]
      //       }
      //     }
      //    ...
      //   ]
      // }

      const { body: searchResult } = await openSearch.search({
        index: indexId,
        body: {
          query: { match_all: {} },
          _source: [
            'video_id',
            'video_index', 
            'video_segments',
            'video_objects.timestamp',
            'video_objects.labels.name',
            'video_objects.labels.confidence',
            'video_objects.labels.categories',
            'video_objects.labels.aliases'
          ]
        }
      });

      // Initialize structures to store embeddings - each videoId will have arrays for both visual and audio embeddings
      const videoIdToSegmentVisualEmbedding: Record<string, number[][]> = {};
      const videoIdToSegmentAudioEmbedding: Record<string, number[][]> = {};

      // Process all videos and their segments
      searchResult.hits.hits.forEach((hit: OpenSearchHit) => {
        const videoId = hit._source.video_id;
        
        // Initialize arrays for this videoId if they don't exist
        if (!videoIdToSegmentVisualEmbedding[videoId]) {
          videoIdToSegmentVisualEmbedding[videoId] = [];
        }
        if (!videoIdToSegmentAudioEmbedding[videoId]) {
          videoIdToSegmentAudioEmbedding[videoId] = [];
        }
        
        // Iterate through video_segments and extract both visual and audio embeddings
        hit._source.video_segments.forEach((segment: any) => {
          // Process visual embeddings
          if (segment.segment_visual?.segment_visual_embedding && 
            segment.segment_visual.segment_visual_embedding.length === 2048) {
            videoIdToSegmentVisualEmbedding[videoId].push(
              segment.segment_visual.segment_visual_embedding
            );
          }
          
          // Process audio embeddings
          if (segment.segment_audio?.segment_audio_embedding && 
            segment.segment_audio.segment_audio_embedding.length === 768) {
            videoIdToSegmentAudioEmbedding[videoId].push(
              segment.segment_audio.segment_audio_embedding
            );
          }
        });
      });

      // Count valid and invalid segments for visual embeddings
      const segmentVisualEmbeddingCount = {
        validEmbedding: 0,
        invalidEmbedding: 0,
        totalSegments: 0
      };

      // Count valid and invalid segments for audio embeddings
      const segmentAudioEmbeddingCount = {
        validEmbedding: 0,
        invalidEmbedding: 0,
        totalSegments: 0
      };

      // Calculate visual embedding statistics
      Object.entries(videoIdToSegmentVisualEmbedding).forEach(([videoId, embeddings]) => {
        segmentVisualEmbeddingCount.totalSegments += embeddings.length;
        
        if (embeddings.length > 0) {
          segmentVisualEmbeddingCount.validEmbedding += embeddings.length;
        } else {
          segmentVisualEmbeddingCount.invalidEmbedding++;
        }
      });
      
      // Calculate audio embedding statistics
      Object.entries(videoIdToSegmentAudioEmbedding).forEach(([videoId, embeddings]) => {
        segmentAudioEmbeddingCount.totalSegments += embeddings.length;
        
        if (embeddings.length > 0) {
          segmentAudioEmbeddingCount.validEmbedding += embeddings.length;
        } else {
          segmentAudioEmbeddingCount.invalidEmbedding++;
        }
      });

      // Summarize the detailed information of the index including both visual and audio embeddings
      const indexSummary = {
        indexId,
        videoCount: searchResult.hits.total.value,
        segmentVisualEmbeddingCount,
        segmentAudioEmbeddingCount,
        videoIdToSegmentVisualEmbedding: {},
        videoIdToSegmentAudioEmbedding: {}
      };

      // Include detailed vectors if requested via query parameter
      const displayDetailedVector = event.queryStringParameters?.displayDetailedVector;
      if (displayDetailedVector === 'true') {
        console.log('Visual embeddings summary:', 
          Object.keys(videoIdToSegmentVisualEmbedding).length, 'videos with visual embeddings');
        console.log('Audio embeddings summary:',
          Object.keys(videoIdToSegmentAudioEmbedding).length, 'videos with audio embeddings');
        
        // Add both embedding types to the response
        indexSummary.videoIdToSegmentVisualEmbedding = videoIdToSegmentVisualEmbedding;
        indexSummary.videoIdToSegmentAudioEmbedding = videoIdToSegmentAudioEmbedding;
      }

      return {
        statusCode: STATUS_CODES.OK,
        headers: corsHeaders,
        body: JSON.stringify(indexSummary)
      };

    } catch (error) {
      console.error('Error getting index:', error);
      return {
        statusCode: 500,
        headers: corsHeaders,
        body: JSON.stringify({ 
          error: 'Failed to get index',
          details: error instanceof Error ? error.message : 'Unknown error'
        })
      };
    }
  } 
  // Otherwise, list all indexes, the same indexId should be considered as a single index
  else {
    try {
      const result = await docClient.send(new ScanCommand({
        TableName: process.env.INDEXES_TABLE
      }));
      
      const indexes = result.Items || [];
      // Only return the unique indexId since we are using indexId as the primary key and videoId as the sort key, so different videoId can have the same indexId
      const uniqueIndexes = indexes.filter((item, idx, self) =>
        self.findIndex((t) => t.indexId === item.indexId) === idx
      );

      // TODO: Remove the video_status in the indexes array for now, since the latest video_status is recorded in the aoss, will decouple the video_status to the DynamoDB table in the future
      const indexesWithoutVideoStatus = uniqueIndexes.map((index) => {
        const { video_status, ...rest } = index;
        return rest;
      });

      // Get video counts for each index (in parallel) with retry logic
      await Promise.all(uniqueIndexes.map(async (index) => {
        let videoCount = 0;
        let retries = 3;
        let success = false;
        
        while (retries > 0 && !success) {
          try {
            // Create the search query, use the same filtering logic as in video-upload/index.ts
            const searchQuery = {
              index: index.indexId,
              body: {
                query: {
                  bool: {
                    must_not: [
                      { term: { video_status: 'deleted' } }
                    ]
                  }
                },
                size: 0, // We only need the count, not the actual documents
              }
            };
            const { body } = await openSearch.search(searchQuery);

            // Extract count from the total hits
            videoCount = body.hits.total.value || 0;
            success = true;
            // add videoCount into the indexesWithoutVideoStatus
            indexesWithoutVideoStatus.forEach((item) => {
              if (item.indexId === index.indexId) {
                item.videoCount = videoCount;
              }
            });
          } catch (countError) {
            console.warn(`Error getting video count for index ${index.indexId} (retry ${4-retries}/3):`, countError);
            retries--;
            
            if (retries > 0) {
              // Exponential backoff: 1s, 2s, 4s
              const delay = Math.pow(2, 3-retries) * 500;
              await new Promise(resolve => setTimeout(resolve, delay));
            }
          }
        }
      }));
      
      return {
        statusCode: STATUS_CODES.OK,
        headers: corsHeaders,
        body: JSON.stringify(indexesWithoutVideoStatus)
      };
    } catch (error) {
      console.error('Error listing indexes:', error);
      return {
        statusCode: 500,
        headers: corsHeaders,
        body: JSON.stringify({ 
          error: 'Failed to list indexes',
          details: error instanceof Error ? error.message : 'Unknown error'
        })
      };
    }
  }
}

/**
 * Handle POST requests to create a new index
 * POST /indexes - Create a new index
 */
async function handleCreateIndex(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  if (!event.body) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Missing request body' })
    };
  }

  const requestBody = JSON.parse(event.body);
  const { name, models } = requestBody;

  if (!name) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Index name is required' })
    };
  }

  // Generate a unique index ID
  const indexId = `idx-${uuidv4()}`;
  // Generate a metadata record ID to satisfy the composite key
  const metadataId = `metadata-${uuidv4()}`;  
  const indexName = name.toLowerCase().replace(/[^a-z0-9]/g, '_');
  
  // Create the index in OpenSearch
  const openSearchIndexName = `${indexName}_${indexId}`;
  
  // Define index mapping based on selected models
  const indexSettings = {
    settings: {
      number_of_shards: 1,
      number_of_replicas: 0,
      "index.knn": true  // Enable k-NN for this index
    },
    mappings: {
      properties: {
        video_index: { type: 'keyword' },
        video_description: { type: 'text' },
        video_duration: { type: 'text' },
        video_id: { type: 'keyword' },
        video_name: { type: 'keyword' },
        video_source: { type: 'keyword' },
        video_s3_path: { type: 'keyword' },
        video_size: { type: 'integer' },
        video_status: { type: 'keyword' },
        video_summary: { type: 'text' },
        video_tags: { type: 'keyword' },
        video_title: { type: 'text' },
        video_thumbnail_s3_path: { type: 'keyword' },
        video_thumbnail_url: { type: 'keyword' },
        video_preview_url: { type: 'keyword' },
        video_type: { type: 'keyword' },

        created_at: { type: 'date' },
        updated_at: { type: 'date' },
        error: { type: 'text' },
        segment_count: { type: 'integer' },
        job_id: { type: 'keyword' },

        video_metadata: { type: 'object' },
        video_segments: { 
          type: 'nested',
          properties: {
            segment_id: { type: 'keyword' },
            start_time: { type: 'float' },
            end_time: { type: 'float' },
            duration: { type: 'float' },
            segment_s3_path: { type: 'keyword' },
            segment_visual: {
              type: 'object',
              properties: {
                segment_visual_description: { type: 'text' },
                segment_visual_embedding: { 
                  type: 'knn_vector',
                  dimension: 2048,
                  method: {
                    name: "hnsw",
                    space_type: "cosinesimil"
                  }
                }
              }
            },
            segment_audio: {
              type: 'object',
              properties: {
                segment_audio_description: { type: 'text' },
                segment_audio_embedding: { 
                  type: 'knn_vector',
                  dimension: 768,
                  method: {
                    name: "hnsw",
                    space_type: "cosinesimil"
                  }
                }
              }
            }
          }
        }
      }
    }
  };

  try {
    // Create the index in OpenSearch
    await openSearch.indices.create({
      index: openSearchIndexName,
      body: indexSettings
    });

    // Store index metadata in DynamoDB with both required keys
    const timestamp = new Date().toISOString();
    await docClient.send(new PutCommand({
      TableName: process.env.INDEXES_TABLE,
      Item: {
        indexId,
        videoId: metadataId,  // Required for the composite key
        name,
        openSearchIndexName,
        status: 'ready', // Initial status
        models: models || [],
        videoCount: 0,
        createdAt: timestamp,
        updatedAt: timestamp,
        recordType: 'metadata'  // Flag to identify this as a metadata record
      }
    }));

    return {
      statusCode: 201,
      headers: corsHeaders,
      body: JSON.stringify({
        indexId,
        name,
        status: 'ready',
        message: 'Index created successfully'
      })
    };
  } catch (error) {
    console.error('Error creating index:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({
        error: 'Failed to create index',
        details: error instanceof Error ? error.message : 'Unknown error'
      })
    };
  }
}

/**
 * Handle DELETE requests to delete an index
 * DELETE /indexes/{indexId} - Delete a specific index
 */
async function handleDeleteIndex(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const indexId = event.pathParameters?.indexId;
  
  if (!indexId) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Index ID is required' })
    };
  }
  
  try {
    // First, get all items with the indexId to retrieve the OpenSearch index name
    // and to know what items we need to delete
    const scanResult = await docClient.send(new ScanCommand({
      TableName: process.env.INDEXES_TABLE,
      FilterExpression: 'indexId = :indexId',
      ExpressionAttributeValues: {
        ':indexId': indexId
      }
    }));

    if (!scanResult.Items || scanResult.Items.length === 0) {
      return {
        statusCode: STATUS_CODES.NOT_FOUND,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Index not found' })
      };
    }

    // Get the first item to find the OpenSearch index name
    const firstItem = scanResult.Items[0];
    const openSearchIndexName = firstItem.openSearchIndexName || firstItem.indexId || indexId;
    
    // Step 1: Query OpenSearch to get all videos in the index and their S3 paths
    let s3PathsToDelete: string[] = [];
    let videoIds: string[] = [];
    
    try {
      // Get all videos in the index with their S3 paths
      const { body: searchResult } = await openSearch.search({
        index: openSearchIndexName,
        body: {
          query: { match_all: {} },
          _source: [
            'video_id',
            'video_s3_path',
            'video_thumbnail_s3_path',
            'video_segments'
          ],
          size: 1000 // Adjust based on expected number of videos
        }
      });
      
      // Extract S3 paths from search results
      if (searchResult && searchResult.hits && searchResult.hits.hits) {
        console.log(`Found ${searchResult.hits.hits.length} videos in OpenSearch index ${openSearchIndexName}`);
        
        searchResult.hits.hits.forEach((hit: OpenSearchHit) => {
          const source = hit._source;
          videoIds.push(source.video_id);
          
          console.log(`Processing video ${source.video_id} for S3 paths`);
          console.log(`Source fields: ${JSON.stringify(Object.keys(source))}`);
          
          // Add main video S3 path
          if (source.video_s3_path) {
            console.log(`Found video_s3_path: ${source.video_s3_path}`);
            s3PathsToDelete.push(source.video_s3_path);
          }
          
          // Add thumbnail S3 path
          if (source.video_thumbnail_s3_path) {
            console.log(`Found video_thumbnail_s3_path: ${source.video_thumbnail_s3_path}`);
            s3PathsToDelete.push(source.video_thumbnail_s3_path);
          }
          
          // Add segment S3 paths
          if (source.video_segments && Array.isArray(source.video_segments)) {
            console.log(`Found ${source.video_segments.length} segments`);
            
            source.video_segments.forEach((segment: any, idx: number) => {
              console.log(`Segment ${idx} fields: ${JSON.stringify(Object.keys(segment))}`);
              
              // Check for segment_s3_path (original field name)
              if (segment.segment_s3_path) {
                console.log(`Found segment_s3_path: ${segment.segment_s3_path}`);
                s3PathsToDelete.push(segment.segment_s3_path);
              }
              
              // Also check for segment_video_s3_path (likely field name based on user example)
              if (segment.segment_video_s3_path) {
                console.log(`Found segment_video_s3_path: ${segment.segment_video_s3_path}`);
                s3PathsToDelete.push(segment.segment_video_s3_path);
              }
            });
          }
        });
      }
      
      console.log(`Found ${videoIds.length} videos and ${s3PathsToDelete.length} S3 paths to delete`);
    } catch (searchError) {
      console.warn(`Error querying OpenSearch for videos in index ${openSearchIndexName}:`, searchError);
      // Continue even if search fails, we'll delete what we can
    }
    
    // Step 2: Delete the index from OpenSearch
    try {
      await openSearch.indices.delete({
        index: openSearchIndexName
      });
      console.log(`Deleted OpenSearch index: ${openSearchIndexName}`);
    } catch (deleteError) {
      console.warn(`Error deleting OpenSearch index ${openSearchIndexName}:`, deleteError);
      // Continue even if OpenSearch delete fails
    }
    
    // Step 3: Delete S3 files
    const s3DeleteResults = {
      deleted: 0,
      failed: 0,
      skipped: 0
    };
    
    if (s3PathsToDelete.length > 0) {
      try {
        // Group S3 paths by bucket for batch deletion
        const pathsByBucket: Record<string, string[]> = {};
        
        console.log(`Processing ${s3PathsToDelete.length} S3 paths for deletion`);
        
        s3PathsToDelete.forEach(path => {
          // Parse S3 URI (s3://bucket-name/key)
          const match = path.match(/^s3:\/\/([^\/]+)\/(.+)$/);
          if (match) {
            const [, bucket, key] = match;
            if (!pathsByBucket[bucket]) {
              pathsByBucket[bucket] = [];
            }
            pathsByBucket[bucket].push(key);
            console.log(`Added S3 path with s3:// prefix: bucket=${bucket}, key=${key}`);
          } else {
            // For paths without s3:// prefix, use the default bucket
            const defaultBucket = process.env.VIDEO_BUCKET;
            if (defaultBucket) {
              if (!pathsByBucket[defaultBucket]) {
                pathsByBucket[defaultBucket] = [];
              }
              pathsByBucket[defaultBucket].push(path);
              console.log(`Added S3 path without s3:// prefix to default bucket ${defaultBucket}: ${path}`);
            } else {
              console.warn(`Skipping S3 path (no default bucket available): ${path}`);
              s3DeleteResults.skipped++;
            }
          }
        });
        
        console.log(`Grouped S3 paths by bucket: ${JSON.stringify(Object.keys(pathsByBucket).map(bucket => `${bucket}: ${pathsByBucket[bucket].length} paths`))}`);
        
        // Delete objects in batches by bucket
        const s3DeletePromises = Object.entries(pathsByBucket).map(async ([bucket, keys]) => {
          // AWS S3 DeleteObjects can handle up to 1000 keys at once
          const batchSize = 1000;
          
          for (let i = 0; i < keys.length; i += batchSize) {
            const batch = keys.slice(i, i + batchSize);
            
            try {
              const deleteParams = {
                Bucket: bucket,
                Delete: {
                  Objects: batch.map(key => ({ Key: key })),
                  Quiet: false
                }
              };
              
              const deleteResult = await s3Client.send(new DeleteObjectsCommand(deleteParams));
              
              if (deleteResult.Deleted) {
                s3DeleteResults.deleted += deleteResult.Deleted.length;
              }
              
              if (deleteResult.Errors) {
                s3DeleteResults.failed += deleteResult.Errors.length;
                deleteResult.Errors.forEach(error => {
                  console.error(`Failed to delete S3 object: ${error.Key}, Error: ${error.Code} - ${error.Message}`);
                });
              }
            } catch (batchError) {
              console.error(`Error deleting batch of S3 objects from bucket ${bucket}:`, batchError);
              s3DeleteResults.failed += batch.length;
            }
          }
        });
        
        await Promise.all(s3DeletePromises);
        console.log(`S3 deletion results: ${s3DeleteResults.deleted} deleted, ${s3DeleteResults.failed} failed, ${s3DeleteResults.skipped} skipped`);
      } catch (s3Error) {
        console.error('Error during S3 deletion:', s3Error);
        // Continue even if S3 deletion fails
      }
    }
    
    // Step 4: Delete all entries for this indexId from DynamoDB
    console.log(`Deleting ${scanResult.Items.length} items from DynamoDB for indexId ${indexId}`);
    
    const deletePromises = scanResult.Items.map(async (item) => {
      try {
        await docClient.send(new DeleteCommand({
          TableName: process.env.INDEXES_TABLE,
          Key: {
            indexId: indexId,
            videoId: item.videoId
          }
        }));
        return { success: true, videoId: item.videoId };
      } catch (err) {
        console.error(`Failed to delete item with videoId ${item.videoId}:`, err);
        return { success: false, videoId: item.videoId, error: err };
      }
    });
    
    const results = await Promise.all(deletePromises);
    const successful = results.filter(r => r.success).length;
    
    // Step 5: Clean up local storage (this happens on the client side)
    // The frontend will handle clearing any local storage related to this index
    
    return {
      statusCode: STATUS_CODES.OK,
      headers: corsHeaders,
      body: JSON.stringify({
        message: `Index deleted successfully. Removed ${successful} of ${scanResult.Items.length} DynamoDB items and ${s3DeleteResults.deleted} S3 files.`,
        indexId,
        deletionDetails: {
          dynamoDB: {
            deleted: successful,
            failed: scanResult.Items.length - successful
          },
          openSearch: {
            deleted: 1
          },
          s3: s3DeleteResults
        }
      })
    };
  } catch (error) {
    console.error('Error deleting index:', error);
    return {
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      headers: corsHeaders,
      body: JSON.stringify({
        error: 'Failed to delete index',
        details: error instanceof Error ? error.message : 'Unknown error'
      })
    };
  }
}
