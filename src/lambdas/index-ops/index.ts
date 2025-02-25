import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { Client } from '@opensearch-project/opensearch';
import { defaultProvider } from '@aws-sdk/credential-provider-node';
import { AwsSigv4Signer } from '@opensearch-project/opensearch/aws';
import { v4 as uuidv4 } from 'uuid';

// Initialize clients
const dynamoClient = new DynamoDBClient({});
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

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  console.log('Create index event:', JSON.stringify(event, null, 2));

  // Handle OPTIONS request for CORS
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: ''
    };
  }

  try {
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
}; 