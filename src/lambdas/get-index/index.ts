import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { Client } from '@opensearch-project/opensearch';
import { defaultProvider } from '@aws-sdk/credential-provider-node';
import { AwsSigv4Signer } from '@opensearch-project/opensearch/aws';

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
  console.log('Get index event:', JSON.stringify(event, null, 2));

  // Handle OPTIONS request for CORS
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: ''
    };
  }

  try {
    // Check if this is a status request
    const isStatusRequest = event.path.endsWith('/status');
    
    // If no indexId is provided, list all indexes
    if (!event.pathParameters?.indexId) {
      const result = await docClient.send(new ScanCommand({
        TableName: process.env.INDEXES_TABLE
      }));

      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify(result.Items || [])
      };
    }

    const indexId = event.pathParameters.indexId;
    
    // Get index details from DynamoDB
    const result = await docClient.send(new GetCommand({
      TableName: process.env.INDEXES_TABLE,
      Key: { indexId }
    }));

    if (!result.Item) {
      return {
        statusCode: 404,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Index not found' })
      };
    }

    // If this is a status request, return only the status information
    if (isStatusRequest) {
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          indexId: result.Item.indexId,
          status: result.Item.status,
          videoCount: result.Item.videoCount
        })
      };
    }

    // Get additional stats from OpenSearch
    try {
      const openSearchIndexName = result.Item.openSearchIndexName;
      const { body: indexStats } = await openSearch.indices.stats({
        index: openSearchIndexName
      });

      // Enhance the response with OpenSearch stats
      result.Item.stats = {
        documentCount: indexStats._all.primaries.docs.count,
        sizeInBytes: indexStats._all.primaries.store.size_in_bytes
      };
    } catch (osError) {
      console.warn('Error getting OpenSearch stats:', osError);
      // Continue without OpenSearch stats
    }

    return {
      statusCode: 200,
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
}; 