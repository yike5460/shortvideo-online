import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
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
  console.log('Delete index event:', JSON.stringify(event, null, 2));

  // Handle OPTIONS request for CORS
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: ''
    };
  }

  try {
    if (!event.pathParameters?.indexId) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Index ID is required' })
      };
    }

    const indexId = event.pathParameters.indexId;
    
    // Get index details from DynamoDB
    const getResult = await docClient.send(new GetCommand({
      TableName: process.env.INDEXES_TABLE,
      Key: { indexId }
    }));

    if (!getResult.Item) {
      return {
        statusCode: 404,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Index not found' })
      };
    }

    const openSearchIndexName = getResult.Item.openSearchIndexName;

    // Delete the index from OpenSearch
    try {
      await openSearch.indices.delete({
        index: openSearchIndexName
      });
    } catch (osError) {
      console.warn('Error deleting OpenSearch index:', osError);
      // Continue with DynamoDB deletion even if OpenSearch deletion fails
    }

    // Delete the index from DynamoDB
    await docClient.send(new DeleteCommand({
      TableName: process.env.INDEXES_TABLE,
      Key: { indexId }
    }));

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        message: 'Index deleted successfully',
        indexId
      })
    };
  } catch (error) {
    console.error('Error deleting index:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({
        error: 'Failed to delete index',
        details: error instanceof Error ? error.message : 'Unknown error'
      })
    };
  }
}; 