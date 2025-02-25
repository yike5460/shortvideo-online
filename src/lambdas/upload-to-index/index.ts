import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { v4 as uuidv4 } from 'uuid';

// Initialize clients
const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const s3Client = new S3Client({});

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
  'Access-Control-Allow-Credentials': 'true'
};

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  console.log('Upload to index event:', JSON.stringify(event, null, 2));

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

    if (!event.body) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Request body is required' })
      };
    }

    const indexId = event.pathParameters.indexId;
    const requestBody = JSON.parse(event.body);
    
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

    // Update index status to processing
    await docClient.send(new UpdateCommand({
      TableName: process.env.INDEXES_TABLE,
      Key: { indexId },
      UpdateExpression: 'SET #status = :status, updatedAt = :updatedAt',
      ExpressionAttributeNames: {
        '#status': 'status'
      },
      ExpressionAttributeValues: {
        ':status': 'processing',
        ':updatedAt': new Date().toISOString()
      }
    }));

    // Generate pre-signed URLs for video uploads
    const uploadUrls = [];
    const fileMetadata = requestBody.files || [];
    
    for (const file of fileMetadata) {
      const videoId = uuidv4();
      const key = `${indexId}/${videoId}/${file.name}`;
      
      const command = new PutObjectCommand({
        Bucket: process.env.VIDEOS_BUCKET,
        Key: key,
        ContentType: file.type
      });
      
      const signedUrl = await getSignedUrl(s3Client, command, { expiresIn: 3600 });
      
      uploadUrls.push({
        videoId,
        fileName: file.name,
        fileType: file.type,
        fileSize: file.size,
        uploadUrl: signedUrl,
        key
      });
    }

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        message: 'Upload URLs generated successfully',
        indexId,
        uploads: uploadUrls
      })
    };
  } catch (error) {
    console.error('Error generating upload URLs:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({
        error: 'Failed to generate upload URLs',
        details: error instanceof Error ? error.message : 'Unknown error'
      })
    };
  }
}; 