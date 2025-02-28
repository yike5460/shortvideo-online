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
      const result = await docClient.send(new GetCommand({
        TableName: process.env.INDEXES_TABLE,
        Key: { indexId }
      }));
      
      if (!result.Item) {
        return {
          statusCode: STATUS_CODES.NOT_FOUND,
          headers: corsHeaders,
          body: JSON.stringify({ error: 'Index not found' })
        };
      }
      console.log('Index found:', result.Item);

      return {
        statusCode: STATUS_CODES.OK,
        headers: corsHeaders,
        body: JSON.stringify(result.Item)
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
  // Otherwise, list all indexes
  else {
    try {
      const result = await docClient.send(new ScanCommand({
        TableName: process.env.INDEXES_TABLE
      }));
      
      const indexes = result.Items || [];
      
      // Get video counts for each index (in parallel) with retry logic
      await Promise.all(indexes.map(async (index) => {
        let videoCount = 0;
        let retries = 3;
        let success = false;
        
        while (retries > 0 && !success) {
          try {
            const { body } = await openSearch.count({
              index: index.openSearchIndexName
            });
            
            videoCount = body.count || 0;
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
  const indexName = name.toLowerCase().replace(/[^a-z0-9]/g, '_');
  
  // Create the index in OpenSearch
  const openSearchIndexName = `${indexName}_${indexId}`;
  
  // Define index mapping based on selected models
  const mapping = {
    mappings: {
      properties: {
        video_id: { type: 'keyword' },
        video_index: { type: 'keyword' },
        video_title: { 
          type: 'text',
          fields: {
            keyword: { type: 'keyword', ignore_above: 256 }
          }
        },
        video_description: { type: 'text' },
        video_thumbnail_url: { type: 'keyword' },
        video_s3_path: { type: 'keyword' },
        video_duration: { type: 'long' },
        video_original_path: { type: 'keyword' },
        created_at: { type: 'date' },
        video_type: { type: 'keyword' },
        video_status: { type: 'keyword' },
        video_size: { type: 'long' },
        video_segments: {
          type: 'nested',
          properties: {
            segment_id: { type: 'keyword' },
            start_time: { type: 'long' },
            end_time: { type: 'long' },
            duration: { type: 'long' },
            segment_visual: {
              type: 'object',
              properties: {
                segment_visual_description: { type: 'text' },
                segment_visual_objects: {
                  type: 'nested',
                  properties: {
                    label: { type: 'keyword' },
                    confidence: { type: 'float' },
                    bounding_box: {
                      type: 'object',
                      properties: {
                        left: { type: 'float' },
                        top: { type: 'float' },
                        width: { type: 'float' },
                        height: { type: 'float' }
                      }
                    }
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
      body: mapping
    });

    // Store index metadata in DynamoDB
    const timestamp = new Date().toISOString();
    await docClient.send(new PutCommand({
      TableName: process.env.INDEXES_TABLE,
      Item: {
        indexId,
        name,
        openSearchIndexName,
        status: 'ready', // Initial status
        models: models || [],
        videoCount: 0,
        createdAt: timestamp,
        updatedAt: timestamp
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
    // First, get the index to retrieve the OpenSearch index name
    const getResult = await docClient.send(new GetCommand({
      TableName: process.env.INDEXES_TABLE,
      Key: { indexId }
    }));

    if (!getResult.Item) {
      return {
        statusCode: STATUS_CODES.NOT_FOUND,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Index not found' })
      };
    }

    const openSearchIndexName = getResult.Item.indexId;
    
    // Delete the index from OpenSearch
    try {
      await openSearch.indices.delete({
        index: indexId
      });
    } catch (deleteError) {
      console.warn(`Error deleting OpenSearch index ${indexId}:`, deleteError);
      // Continue even if OpenSearch delete fails
    }
    
    // Delete the index from DynamoDB
    await docClient.send(new DeleteCommand({
      TableName: process.env.INDEXES_TABLE,
      Key: { indexId }
    }));
    
    return {
      statusCode: STATUS_CODES.OK ,
      headers: corsHeaders,
      body: JSON.stringify({
        message: 'Index deleted successfully',
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