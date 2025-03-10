import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { 
  DynamoDBDocumentClient, 
  PutCommand, 
  GetCommand, 
  DeleteCommand, 
  ScanCommand 
} from '@aws-sdk/lib-dynamodb';
import { Client } from '@opensearch-project/opensearch';
import { defaultProvider } from '@aws-sdk/credential-provider-node';
import { AwsSigv4Signer } from '@opensearch-project/opensearch/aws';
import { v4 as uuidv4 } from 'uuid';

// Initialize clients
const dynamoClient = new DynamoDBClient({endpoint: process.env.INDEXES_TABLE_DYNAMODB_DNS_NAME});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

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
  console.log('Getting index with event: ', event);
  const indexId = event.pathParameters?.indexId;
  
  // If indexId is provided, get specific index
  if (indexId) {
    try {
      // First let's get a dummy videoId entry to get the index information
      // In a production environment, you'd want to use a Query with a condition on just the partition key
      const result = await docClient.send(new ScanCommand({
        TableName: process.env.INDEXES_TABLE,
        FilterExpression: 'indexId = :indexId',
        ExpressionAttributeValues: {
          ':indexId': indexId
        },
        Limit: 1
      }));
      
      if (!result.Items || result.Items.length === 0) {
        return {
          statusCode: STATUS_CODES.NOT_FOUND,
          headers: corsHeaders,
          body: JSON.stringify({ error: 'Index not found' })
        };
      }
      console.log('Index found:', result.Items[0]);

      return {
        statusCode: STATUS_CODES.OK,
        headers: corsHeaders,
        body: JSON.stringify(result.Items[0])
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

      // Get video counts for each index (in parallel) with retry logic
      await Promise.all(uniqueIndexes.map(async (index) => {
        let videoCount = 0;
        let retries = 3;
        let success = false;
        
        while (retries > 0 && !success) {
          try {
            // Use the same filtering logic as in video-upload/index.ts
            // to exclude deleted videos and get an accurate count
            const { body } = await openSearch.search({
              // Use the indexId directly as the index name, which is what
              // video-upload/index.ts does when querying videos
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
            });
            
            // Extract count from the total hits
            videoCount = body.hits.total.value || 0;
            success = true;
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
        
        index.videoCount = videoCount;
      }));
      
      return {
        statusCode: STATUS_CODES.OK,
        headers: corsHeaders,
        body: JSON.stringify(indexes)
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
                  dimension: 2048,
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
    const openSearchIndexName = firstItem.indexId || indexId;
    
    // Delete the index from OpenSearch
    try {
      await openSearch.indices.delete({
        index: openSearchIndexName
      });
      console.log(`Deleted OpenSearch index: ${openSearchIndexName}`);
    } catch (deleteError) {
      console.warn(`Error deleting OpenSearch index ${openSearchIndexName}:`, deleteError);
      // Continue even if OpenSearch delete fails
    }
    
    // Delete all entries for this indexId from DynamoDB
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
    
    return {
      statusCode: STATUS_CODES.OK,
      headers: corsHeaders,
      body: JSON.stringify({
        message: `Index deleted successfully. Removed ${successful} of ${scanResult.Items.length} items.`,
        indexId
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