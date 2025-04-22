import { APIGatewayProxyEvent } from 'aws-lambda';
import { LambdaContext, LambdaResponse } from '../../types/aws-lambda';
import {
  S3Client,
  ListBucketsCommand,
  ListObjectsV2Command,
  GetObjectCommand,
  CopyObjectCommand,
  PutObjectCommand,
  GetBucketLocationCommand
} from '@aws-sdk/client-s3';
import { 
  STSClient, 
  AssumeRoleCommand, 
  AssumeRoleCommandInput 
} from '@aws-sdk/client-sts';
import { 
  DynamoDBClient 
} from '@aws-sdk/client-dynamodb';
import { 
  DynamoDBDocumentClient, 
  PutCommand, 
  GetCommand, 
  QueryCommand, 
  DeleteCommand, 
  ScanCommand 
} from '@aws-sdk/lib-dynamodb';
import { v4 as uuidv4 } from 'uuid';
import { Readable } from 'stream';

// Initialize clients
const s3 = new S3Client({});
const sts = new STSClient({});
const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

// Constants
const CONNECTORS_TABLE = process.env.CONNECTORS_TABLE || 'S3Connectors';
const VIDEO_BUCKET = process.env.VIDEO_BUCKET || '';
const EXTERNAL_ID_PREFIX = 'video-search-';
const SESSION_DURATION = 3600; // 1 hour in seconds
const SERVICE_ROLE_ARN = process.env.SERVICE_ROLE_ARN || '';

// CORS headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
  'Access-Control-Allow-Credentials': 'true'
};

// Status codes
const STATUS_CODES = {
  OK: 200,
  CREATED: 201,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  INTERNAL_SERVER_ERROR: 500
};

// Interfaces
interface S3Connector {
  id: string;
  userId: string;
  name: string;
  roleArn: string;
  externalId: string;
  createdAt: string;
  updatedAt: string;
}

interface S3Object {
  key: string;
  name: string;
  size: number;
  lastModified: string;
  type: string;
}

interface S3ListResponse {
  files: S3Object[];
  nextContinuationToken?: string;
}

interface S3ImportRequest {
  connectorId: string;
  files: Array<{
    bucket: string;
    key: string;
  }>;
  indexId: string;
}

// Helper function to validate IAM role ARN
const validateRoleArn = (roleArn: string): boolean => {
  const arnRegex = /^arn:aws:iam::\d{12}:role\/[\w+=,.@-]+$/;
  return arnRegex.test(roleArn);
};

// Helper function to assume role and get temporary credentials
const assumeRole = async (roleArn: string, externalId: string): Promise<any> => {
  const params: AssumeRoleCommandInput = {
    RoleArn: roleArn,
    RoleSessionName: `video-search-s3-connector-${Date.now()}`,
    ExternalId: externalId,
    DurationSeconds: SESSION_DURATION
  };

  try {
    const command = new AssumeRoleCommand(params);
    const response = await sts.send(command);
    
    if (!response.Credentials) {
      throw new Error('Failed to get credentials from assumed role');
    }
    
    return {
      accessKeyId: response.Credentials.AccessKeyId,
      secretAccessKey: response.Credentials.SecretAccessKey,
      sessionToken: response.Credentials.SessionToken
    };
  } catch (error) {
    console.error('Error assuming role:', error);
    throw error;
  }
};

// Helper function to get user ID from event
const getUserId = (event: APIGatewayProxyEvent): string => {
  // In a real implementation, this would extract the user ID from the JWT token
  // For now, we'll use a placeholder or extract from request context
  const requestContext = event.requestContext;
  
  // Check if authorizer is present and has claims
  if (requestContext.authorizer && requestContext.authorizer.claims && requestContext.authorizer.claims.sub) {
    return requestContext.authorizer.claims.sub;
  }
  
  // Fallback to a test user ID
  return 'test-user-id';
};

// Helper function to import a file from S3
async function importS3File(
  s3Client: S3Client, 
  sourceBucket: string, 
  sourceKey: string, 
  videoId: string, 
  indexId: string
): Promise<void> {
  // Get the file name from the key
  const fileName = sourceKey.split('/').pop() || sourceKey;
  
  // Create the destination key
  const timestamp = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  const destinationKey = `RawVideos/${timestamp}/${indexId}/${videoId}/${fileName}`;
  
  try {
    // Try to use CopyObject directly
    await s3.send(new CopyObjectCommand({
      Bucket: VIDEO_BUCKET,
      Key: destinationKey,
      CopySource: `${sourceBucket}/${encodeURIComponent(sourceKey)}`
    }));
  } catch (error: any) {
    // If we get a region error, try to get bucket location and create a region-specific client
    if (error.name === 'PermanentRedirect' || (error.message && error.message.includes('endpoint'))) {
      console.error('Region error when copying S3 object:', error);
      
      // Try to determine the bucket region
      try {
        const getBucketLocationCommand = new GetBucketLocationCommand({ Bucket: sourceBucket });
        const locationResponse = await s3Client.send(getBucketLocationCommand);
        const bucketRegion = locationResponse.LocationConstraint || 'us-east-1';
        
        console.log(`Source bucket ${sourceBucket} is in region ${bucketRegion}`);
        
        // Create a region-specific client
        const regionS3Client = new S3Client({
          credentials: (s3Client as any).config.credentials,
          region: bucketRegion
        });
        
        // First get the object using the region-specific client
        const getObjectCommand = new GetObjectCommand({
          Bucket: sourceBucket,
          Key: sourceKey
        });
        
        const getObjectResponse = await regionS3Client.send(getObjectCommand);
        
        if (!getObjectResponse.Body) {
          throw new Error('Failed to get object from source bucket');
        }
        
        // Then upload it to the destination bucket
        await s3.send(new PutObjectCommand({
          Bucket: VIDEO_BUCKET,
          Key: destinationKey,
          Body: getObjectResponse.Body
        }));
      } catch (regionError) {
        console.error('Error handling cross-region copy:', regionError);
        throw regionError;
      }
    } else {
      throw error;
    }
  }
}

// Main handler
export const handler = async (event: APIGatewayProxyEvent): Promise<LambdaResponse> => {
  try {
    // Handle OPTIONS requests for CORS
    if (event.httpMethod === 'OPTIONS') {
      return {
        statusCode: STATUS_CODES.OK,
        headers: corsHeaders,
        body: ''
      };
    }

    // Extract path and method
    const path = event.path.toLowerCase();
    const method = event.httpMethod;
    const userId = getUserId(event);

    // Route the request based on path and method
    if (path.endsWith('/connectors/s3') || path.endsWith('/connectors/s3/')) {
      if (method === 'GET') {
        return await listConnectors(userId);
      } else if (method === 'POST') {
        return await createConnector(event, userId);
      }
    } else if (path.match(/\/connectors\/s3\/[^\/]+$/)) {
      const connectorId = path.split('/').pop() || '';
      
      if (method === 'GET') {
        return await getConnector(connectorId, userId);
      } else if (method === 'PUT') {
        return await updateConnector(event, connectorId, userId);
      } else if (method === 'DELETE') {
        return await deleteConnector(connectorId, userId);
      }
    } else if (path.match(/\/connectors\/s3\/[^\/]+\/buckets$/)) {
      const connectorId = path.split('/').slice(-2)[0];
      
      if (method === 'GET') {
        return await listBuckets(connectorId, userId);
      }
    } else if (path.match(/\/connectors\/s3\/[^\/]+\/buckets\/[^\/]+$/)) {
      const pathParts = path.split('/');
      const connectorId = pathParts.slice(-3)[0];
      const bucket = pathParts.slice(-1)[0];
      
      if (method === 'GET') {
        return await listObjects(event, connectorId, bucket, userId);
      }
    } else if (path.match(/\/connectors\/s3\/[^\/]+\/search$/)) {
      const connectorId = path.split('/').slice(-2)[0];
      
      if (method === 'GET') {
        return await searchObjects(event, connectorId, userId);
      }
    } else if (path.endsWith('/videos/import/s3') || path.endsWith('/videos/import/s3/')) {
      if (method === 'POST') {
        return await importFromS3(event, userId);
      }
    }

    // If no route matched
    return {
      statusCode: STATUS_CODES.NOT_FOUND,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Endpoint not found' })
    };
  } catch (error) {
    console.error('Error handling request:', error);
    return {
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      headers: corsHeaders,
      body: JSON.stringify({
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error'
      })
    };
  }
};

// Handler functions for different endpoints

// List all connectors for a user
async function listConnectors(userId: string): Promise<LambdaResponse> {
  try {
    const params = {
      TableName: CONNECTORS_TABLE,
      IndexName: 'UserIdIndex',
      KeyConditionExpression: 'userId = :userId',
      ExpressionAttributeValues: {
        ':userId': userId
      }
    };

    const result = await docClient.send(new QueryCommand(params));
    
    // Map the results to a simpler format
    const connectors = (result.Items || []).map((item: any) => ({
      id: item.id,
      name: item.name,
      roleArn: item.roleArn,
      createdAt: item.createdAt
    }));

    return {
      statusCode: STATUS_CODES.OK,
      headers: corsHeaders,
      body: JSON.stringify(connectors)
    };
  } catch (error) {
    console.error('Error listing connectors:', error);
    return {
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      headers: corsHeaders,
      body: JSON.stringify({
        error: 'Failed to list connectors',
        details: error instanceof Error ? error.message : 'Unknown error'
      })
    };
  }
}

// Create a new connector
async function createConnector(event: APIGatewayProxyEvent, userId: string): Promise<LambdaResponse> {
  try {
    if (!event.body) {
      return {
        statusCode: STATUS_CODES.BAD_REQUEST,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Missing request body' })
      };
    }

    const body = JSON.parse(event.body);
    
    // Validate required fields
    if (!body.name || !body.roleArn) {
      return {
        statusCode: STATUS_CODES.BAD_REQUEST,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Name and roleArn are required' })
      };
    }

    // Validate role ARN format
    if (!validateRoleArn(body.roleArn)) {
      return {
        statusCode: STATUS_CODES.BAD_REQUEST,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Invalid IAM role ARN format' })
      };
    }

    // Generate a unique ID and external ID
    const id = uuidv4();
    const externalId = `${EXTERNAL_ID_PREFIX}${uuidv4()}`;
    const timestamp = new Date().toISOString();

    // Create the connector record
    const connector: S3Connector = {
      id,
      userId,
      name: body.name,
      roleArn: body.roleArn,
      externalId,
      createdAt: timestamp,
      updatedAt: timestamp
    };

    // Save to DynamoDB
    await docClient.send(new PutCommand({
      TableName: CONNECTORS_TABLE,
      Item: connector
    }));

    return {
      statusCode: STATUS_CODES.CREATED,
      headers: corsHeaders,
      body: JSON.stringify({
        id,
        name: body.name,
        externalId
      })
    };
  } catch (error) {
    console.error('Error creating connector:', error);
    return {
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      headers: corsHeaders,
      body: JSON.stringify({
        error: 'Failed to create connector',
        details: error instanceof Error ? error.message : 'Unknown error'
      })
    };
  }
}

// Get a specific connector
async function getConnector(connectorId: string, userId: string): Promise<LambdaResponse> {
  try {
    const result = await docClient.send(new GetCommand({
      TableName: CONNECTORS_TABLE,
      Key: { id: connectorId }
    }));

    if (!result.Item) {
      return {
        statusCode: STATUS_CODES.NOT_FOUND,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Connector not found' })
      };
    }

    // Check if the connector belongs to the user
    if (result.Item.userId !== userId) {
      return {
        statusCode: STATUS_CODES.FORBIDDEN,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Access denied' })
      };
    }

    // Return the connector details (excluding sensitive information)
    const connector = {
      id: result.Item.id,
      name: result.Item.name,
      roleArn: result.Item.roleArn,
      externalId: result.Item.externalId,
      createdAt: result.Item.createdAt,
      updatedAt: result.Item.updatedAt
    };

    return {
      statusCode: STATUS_CODES.OK,
      headers: corsHeaders,
      body: JSON.stringify(connector)
    };
  } catch (error) {
    console.error('Error getting connector:', error);
    return {
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      headers: corsHeaders,
      body: JSON.stringify({
        error: 'Failed to get connector',
        details: error instanceof Error ? error.message : 'Unknown error'
      })
    };
  }
}

// Update a connector
async function updateConnector(event: APIGatewayProxyEvent, connectorId: string, userId: string): Promise<LambdaResponse> {
  try {
    if (!event.body) {
      return {
        statusCode: STATUS_CODES.BAD_REQUEST,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Missing request body' })
      };
    }

    // Get the existing connector
    const getResult = await docClient.send(new GetCommand({
      TableName: CONNECTORS_TABLE,
      Key: { id: connectorId }
    }));

    if (!getResult.Item) {
      return {
        statusCode: STATUS_CODES.NOT_FOUND,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Connector not found' })
      };
    }

    // Check if the connector belongs to the user
    if (getResult.Item.userId !== userId) {
      return {
        statusCode: STATUS_CODES.FORBIDDEN,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Access denied' })
      };
    }

    const body = JSON.parse(event.body);
    
    // Validate fields if provided
    if (body.roleArn && !validateRoleArn(body.roleArn)) {
      return {
        statusCode: STATUS_CODES.BAD_REQUEST,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Invalid IAM role ARN format' })
      };
    }

    // Update the connector
    await docClient.send(new PutCommand({
      TableName: CONNECTORS_TABLE,
      Item: {
        ...getResult.Item,
        ...(body.name && { name: body.name }),
        ...(body.roleArn && { roleArn: body.roleArn }),
        updatedAt: new Date().toISOString()
      }
    }));

    return {
      statusCode: STATUS_CODES.OK,
      headers: corsHeaders,
      body: JSON.stringify({
        id: connectorId,
        updated: true
      })
    };
  } catch (error) {
    console.error('Error updating connector:', error);
    return {
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      headers: corsHeaders,
      body: JSON.stringify({
        error: 'Failed to update connector',
        details: error instanceof Error ? error.message : 'Unknown error'
      })
    };
  }
}

// Delete a connector
async function deleteConnector(connectorId: string, userId: string): Promise<LambdaResponse> {
  try {
    // Get the existing connector
    const getResult = await docClient.send(new GetCommand({
      TableName: CONNECTORS_TABLE,
      Key: { id: connectorId }
    }));

    if (!getResult.Item) {
      return {
        statusCode: STATUS_CODES.NOT_FOUND,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Connector not found' })
      };
    }

    // Check if the connector belongs to the user
    if (getResult.Item.userId !== userId) {
      return {
        statusCode: STATUS_CODES.FORBIDDEN,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Access denied' })
      };
    }

    // Delete the connector
    await docClient.send(new DeleteCommand({
      TableName: CONNECTORS_TABLE,
      Key: { id: connectorId }
    }));

    return {
      statusCode: STATUS_CODES.OK,
      headers: corsHeaders,
      body: JSON.stringify({
        id: connectorId,
        deleted: true
      })
    };
  } catch (error) {
    console.error('Error deleting connector:', error);
    return {
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      headers: corsHeaders,
      body: JSON.stringify({
        error: 'Failed to delete connector',
        details: error instanceof Error ? error.message : 'Unknown error'
      })
    };
  }
}

// List buckets for a connector
async function listBuckets(connectorId: string, userId: string): Promise<LambdaResponse> {
  try {
    // Get the connector
    const getResult = await docClient.send(new GetCommand({
      TableName: CONNECTORS_TABLE,
      Key: { id: connectorId }
    }));

    if (!getResult.Item) {
      return {
        statusCode: STATUS_CODES.NOT_FOUND,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Connector not found' })
      };
    }

    // Check if the connector belongs to the user
    if (getResult.Item.userId !== userId) {
      return {
        statusCode: STATUS_CODES.FORBIDDEN,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Access denied' })
      };
    }

    // Use the service role ARN from environment variables instead of connector's roleArn
    const roleArn = SERVICE_ROLE_ARN;
    
    // Log the role being used
    console.log(`Assuming role: ${roleArn}`);
    
    // Assume the role to get temporary credentials
    const credentials = await assumeRole(roleArn, getResult.Item.externalId);

    // Create an S3 client with the temporary credentials
    const s3Client = new S3Client({
      credentials: {
        accessKeyId: credentials.accessKeyId,
        secretAccessKey: credentials.secretAccessKey,
        sessionToken: credentials.sessionToken
      }
      // Note: For listing buckets, we don't need to specify a region
      // The ListBuckets operation is global and works from any region
    });

    try {
      // List buckets
      const listBucketsCommand = new ListBucketsCommand({});
      const listBucketsResponse = await s3Client.send(listBucketsCommand);

      // Extract bucket names
      const buckets = (listBucketsResponse.Buckets || []).map(bucket => bucket.Name);

      return {
        statusCode: STATUS_CODES.OK,
        headers: corsHeaders,
        body: JSON.stringify(buckets)
      };
    } catch (error: any) {
      // If we get a cross-region error (unlikely for ListBuckets, but just in case)
      if (error.name === 'PermanentRedirect' || (error.message && error.message.includes('endpoint'))) {
        console.error('Region error when listing buckets:', error);
        
        // Try to extract region from error message
        const regionMatch = error.message && error.message.match(/endpoint: "(.+?)\.amazonaws\.com/);
        let extractedRegion = '';
        
        if (regionMatch && regionMatch[1]) {
          extractedRegion = regionMatch[1].replace('s3.', '').replace('s3-', '');
          console.log(`Using explicit region for bucket listing: ${extractedRegion}`);
          
          // Create a new S3 client with the extracted region
          const regionS3Client = new S3Client({
            credentials: {
              accessKeyId: credentials.accessKeyId,
              secretAccessKey: credentials.secretAccessKey,
              sessionToken: credentials.sessionToken
            },
            region: extractedRegion
          });
          
          // Retry with the region-specific client
          const listBucketsCommand = new ListBucketsCommand({});
          const listBucketsResponse = await regionS3Client.send(listBucketsCommand);
          
          // Extract bucket names
          const buckets = (listBucketsResponse.Buckets || []).map(bucket => bucket.Name);
          
          return {
            statusCode: STATUS_CODES.OK,
            headers: corsHeaders,
            body: JSON.stringify(buckets)
          };
        } else {
          throw error; // Re-throw if we can't extract region
        }
      } else {
        throw error; // Re-throw other errors
      }
    }
  } catch (error) {
    console.error('Error listing buckets:', error);
    return {
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      headers: corsHeaders,
      body: JSON.stringify({
        error: 'Failed to list buckets',
        details: error instanceof Error ? error.message : 'Unknown error'
      })
    };
  }
}

// List objects in a bucket
async function listObjects(event: APIGatewayProxyEvent, connectorId: string, bucket: string, userId: string): Promise<LambdaResponse> {
  try {
    // Get the connector
    const getResult = await docClient.send(new GetCommand({
      TableName: CONNECTORS_TABLE,
      Key: { id: connectorId }
    }));

    if (!getResult.Item) {
      return {
        statusCode: STATUS_CODES.NOT_FOUND,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Connector not found' })
      };
    }

    // Check if the connector belongs to the user
    if (getResult.Item.userId !== userId) {
      return {
        statusCode: STATUS_CODES.FORBIDDEN,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Access denied' })
      };
    }

    // Get query parameters
    const queryParams = event.queryStringParameters || {};
    const prefix = queryParams.prefix || '';
    const continuationToken = queryParams.continuationToken;
    const maxKeys = parseInt(queryParams.maxKeys || '100', 10);

    // Use the service role ARN from environment variables
    const roleArn = SERVICE_ROLE_ARN;
    
    // Log the role being used
    console.log(`Assuming role: ${roleArn}`);

    // Assume the role to get temporary credentials
    const credentials = await assumeRole(roleArn, getResult.Item.externalId);

    // Create an S3 client with the temporary credentials
    const s3Client = new S3Client({
      credentials: {
        accessKeyId: credentials.accessKeyId,
        secretAccessKey: credentials.secretAccessKey,
        sessionToken: credentials.sessionToken
      }
    });

    // First try to get the bucket location to determine its region
    let bucketRegion = 'us-east-1'; // Default to US East 1
    try {
      const getBucketLocationCommand = new GetBucketLocationCommand({ Bucket: bucket });
      const locationResponse = await s3Client.send(getBucketLocationCommand);
      // S3 returns null or empty string for us-east-1
      bucketRegion = locationResponse.LocationConstraint || 'us-east-1';
      console.log(`Bucket ${bucket} is in region ${bucketRegion}`);
    } catch (error) {
      console.error('Error getting bucket location:', error);
      // If we can't determine the region, we'll try with the default client
      // and handle any redirect errors below
    }

    // Create a region-specific client if we determined the region
    const regionS3Client = new S3Client({
      credentials: {
        accessKeyId: credentials.accessKeyId,
        secretAccessKey: credentials.secretAccessKey,
        sessionToken: credentials.sessionToken
      },
      region: bucketRegion
    });

    try {
      // List objects with the region-specific client
      const listObjectsCommand = new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
        MaxKeys: maxKeys
      });

      const listObjectsResponse = await regionS3Client.send(listObjectsCommand);

      // Format the response
      const response: S3ListResponse = {
        files: (listObjectsResponse.Contents || []).map(item => ({
          key: item.Key || '',
          name: item.Key?.split('/').pop() || '',
          size: item.Size || 0,
          lastModified: item.LastModified?.toISOString() || '',
          type: item.Key?.split('.').pop() || ''
        })),
        nextContinuationToken: listObjectsResponse.NextContinuationToken
      };

      return {
        statusCode: STATUS_CODES.OK,
        headers: corsHeaders,
        body: JSON.stringify(response)
      };
    } catch (error: any) {
      // Handle PermanentRedirect error - this occurs when the bucket is in a different region
      if (error.name === 'PermanentRedirect' || (error.message && error.message.includes('endpoint'))) {
        // Try to extract region from error message
        const regionMatch = error.message && error.message.match(/endpoint: "(.+?)\.amazonaws\.com/);
        let extractedRegion = '';
        
        if (regionMatch && regionMatch[1]) {
          extractedRegion = regionMatch[1].replace('s3.', '').replace('s3-', '');
          console.log(`Extracted region from error: ${extractedRegion}`);
        } else {
          console.error('Could not extract region from error:', error);
          throw error; // Re-throw if we can't extract region
        }
        
        // Create a new S3 client with the extracted region
        const redirectS3Client = new S3Client({
          credentials: {
            accessKeyId: credentials.accessKeyId,
            secretAccessKey: credentials.secretAccessKey,
            sessionToken: credentials.sessionToken
          },
          region: extractedRegion
        });
        
        // Retry with the new region-specific client
        const listObjectsCommand = new ListObjectsV2Command({
          Bucket: bucket,
          Prefix: prefix,
          ContinuationToken: continuationToken,
          MaxKeys: maxKeys
        });
        
        const listObjectsResponse = await redirectS3Client.send(listObjectsCommand);
        
        // Format the response
        const response: S3ListResponse = {
          files: (listObjectsResponse.Contents || []).map(item => ({
            key: item.Key || '',
            name: item.Key?.split('/').pop() || '',
            size: item.Size || 0,
            lastModified: item.LastModified?.toISOString() || '',
            type: item.Key?.split('.').pop() || ''
          })),
          nextContinuationToken: listObjectsResponse.NextContinuationToken
        };
        
        return {
          statusCode: STATUS_CODES.OK,
          headers: corsHeaders,
          body: JSON.stringify(response)
        };
      } else {
        // Re-throw other errors
        throw error;
      }
    }
  } catch (error) {
    console.error('Error listing objects:', error);
    return {
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      headers: corsHeaders,
      body: JSON.stringify({
        error: 'Failed to list objects',
        details: error instanceof Error ? error.message : 'Unknown error'
      })
    };
  }
}

// Search objects in a bucket
async function searchObjects(event: APIGatewayProxyEvent, connectorId: string, userId: string): Promise<LambdaResponse> {
  try {
    // Get the connector
    const getResult = await docClient.send(new GetCommand({
      TableName: CONNECTORS_TABLE,
      Key: { id: connectorId }
    }));

    if (!getResult.Item) {
      return {
        statusCode: STATUS_CODES.NOT_FOUND,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Connector not found' })
      };
    }

    // Check if the connector belongs to the user
    if (getResult.Item.userId !== userId) {
      return {
        statusCode: STATUS_CODES.FORBIDDEN,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Access denied' })
      };
    }

    // Get query parameters
    const queryParams = event.queryStringParameters || {};
    const query = queryParams.query || '';
    const bucket = queryParams.bucket;
    const continuationToken = queryParams.continuationToken;
    const maxKeys = parseInt(queryParams.maxKeys || '100', 10);

    if (!bucket) {
      return {
        statusCode: STATUS_CODES.BAD_REQUEST,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Bucket parameter is required' })
      };
    }

    // Use the service role ARN from environment variables
    const roleArn = SERVICE_ROLE_ARN;
    
    // Log the role being used
    console.log(`Assuming role: ${roleArn}`);

    // Assume the role to get temporary credentials
    const credentials = await assumeRole(roleArn, getResult.Item.externalId);

    // Create an S3 client with the temporary credentials
    const s3Client = new S3Client({
      credentials: {
        accessKeyId: credentials.accessKeyId,
        secretAccessKey: credentials.secretAccessKey,
        sessionToken: credentials.sessionToken
      }
    });

    // First try to get the bucket location to determine its region
    let bucketRegion = 'us-east-1'; // Default to US East 1
    try {
      const getBucketLocationCommand = new GetBucketLocationCommand({ Bucket: bucket });
      const locationResponse = await s3Client.send(getBucketLocationCommand);
      // S3 returns null or empty string for us-east-1
      bucketRegion = locationResponse.LocationConstraint || 'us-east-1';
      console.log(`Bucket ${bucket} is in region ${bucketRegion}`);
    } catch (error) {
      console.error('Error getting bucket location:', error);
      // If we can't determine the region, we'll try with the default client
      // and handle any redirect errors below
    }

    // Create a region-specific client if we determined the region
    const regionS3Client = new S3Client({
      credentials: {
        accessKeyId: credentials.accessKeyId,
        secretAccessKey: credentials.secretAccessKey,
        sessionToken: credentials.sessionToken
      },
      region: bucketRegion
    });

    try {
      // List objects with the query as prefix using the region-specific client
      const listObjectsCommand = new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: query,
        ContinuationToken: continuationToken,
        MaxKeys: maxKeys
      });

      const listObjectsResponse = await regionS3Client.send(listObjectsCommand);

      // Format the response
      const response: S3ListResponse = {
        files: (listObjectsResponse.Contents || []).map(item => ({
          key: item.Key || '',
          name: item.Key?.split('/').pop() || '',
          size: item.Size || 0,
          lastModified: item.LastModified?.toISOString() || '',
          type: item.Key?.split('.').pop() || ''
        })),
        nextContinuationToken: listObjectsResponse.NextContinuationToken
      };

      return {
        statusCode: STATUS_CODES.OK,
        headers: corsHeaders,
        body: JSON.stringify(response)
      };
    } catch (error: any) {
      // Handle PermanentRedirect error - this occurs when the bucket is in a different region
      if (error.name === 'PermanentRedirect' || (error.message && error.message.includes('endpoint'))) {
        // Try to extract region from error message
        const regionMatch = error.message && error.message.match(/endpoint: "(.+?)\.amazonaws\.com/);
        let extractedRegion = '';
        
        if (regionMatch && regionMatch[1]) {
          extractedRegion = regionMatch[1].replace('s3.', '').replace('s3-', '');
          console.log(`Extracted region from error: ${extractedRegion}`);
        } else {
          console.error('Could not extract region from error:', error);
          throw error; // Re-throw if we can't extract region
        }
        
        // Create a new S3 client with the extracted region
        const redirectS3Client = new S3Client({
          credentials: {
            accessKeyId: credentials.accessKeyId,
            secretAccessKey: credentials.secretAccessKey,
            sessionToken: credentials.sessionToken
          },
          region: extractedRegion
        });
        
        // Retry with the new region-specific client
        const listObjectsCommand = new ListObjectsV2Command({
          Bucket: bucket,
          Prefix: query,
          ContinuationToken: continuationToken,
          MaxKeys: maxKeys
        });
        
        const listObjectsResponse = await redirectS3Client.send(listObjectsCommand);
        
        // Format the response
        const response: S3ListResponse = {
          files: (listObjectsResponse.Contents || []).map(item => ({
            key: item.Key || '',
            name: item.Key?.split('/').pop() || '',
            size: item.Size || 0,
            lastModified: item.LastModified?.toISOString() || '',
            type: item.Key?.split('.').pop() || ''
          })),
          nextContinuationToken: listObjectsResponse.NextContinuationToken
        };
        
        return {
          statusCode: STATUS_CODES.OK,
          headers: corsHeaders,
          body: JSON.stringify(response)
        };
      } else {
        // Re-throw other errors
        throw error;
      }
    }
  } catch (error) {
    console.error('Error searching objects:', error);
    return {
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      headers: corsHeaders,
      body: JSON.stringify({
        error: 'Failed to search objects',
        details: error instanceof Error ? error.message : 'Unknown error'
      })
    };
  }
}

// Import videos from S3
async function importFromS3(event: APIGatewayProxyEvent, userId: string): Promise<LambdaResponse> {
  try {
    if (!event.body) {
      return {
        statusCode: STATUS_CODES.BAD_REQUEST,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Missing request body' })
      };
    }

    const body: S3ImportRequest = JSON.parse(event.body);
    
    // Validate required fields
    if (!body.connectorId || !body.files || !Array.isArray(body.files) || body.files.length === 0) {
      return {
        statusCode: STATUS_CODES.BAD_REQUEST,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'connectorId and files are required' })
      };
    }

    // Get the connector
    const getResult = await docClient.send(new GetCommand({
      TableName: CONNECTORS_TABLE,
      Key: { id: body.connectorId }
    }));

    if (!getResult.Item) {
      return {
        statusCode: STATUS_CODES.NOT_FOUND,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Connector not found' })
      };
    }

    // Check if the connector belongs to the user
    if (getResult.Item.userId !== userId) {
      return {
        statusCode: STATUS_CODES.FORBIDDEN,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Access denied' })
      };
    }

    // Use the service role ARN from environment variables
    const roleArn = SERVICE_ROLE_ARN;
    
    // Log the role being used
    console.log(`Assuming role: ${roleArn}`);

    // Assume the role to get temporary credentials
    const credentials = await assumeRole(roleArn, getResult.Item.externalId);

    // Create an S3 client with the temporary credentials
    const s3Client = new S3Client({
      credentials: {
        accessKeyId: credentials.accessKeyId,
        secretAccessKey: credentials.secretAccessKey,
        sessionToken: credentials.sessionToken
      }
      // Note: We'll handle region-specific operations in the importS3File function
    });

    // Process each file
    const results = await Promise.all(body.files.map(async (file) => {
      try {
        const { bucket, key } = file;
        const fileName = key.split('/').pop() || key;
        const videoId = uuidv4();
        
        // Get file size information first
        let fileSize = 0;
        try {
          // Try to get the file size using a HEAD request
          const headObjectCommand = new GetObjectCommand({
            Bucket: bucket,
            Key: key,
            Range: 'bytes=0-0' // Just get the first byte to check if file exists and get metadata
          });
          
          try {
            const headObjectResponse = await s3Client.send(headObjectCommand);
            fileSize = headObjectResponse.ContentLength || 0;
          } catch (error: any) {
            // If we get a region error, try to determine the bucket region
            if (error.name === 'PermanentRedirect' || (error.message && error.message.includes('endpoint'))) {
              // Try to extract region from error message
              const regionMatch = error.message && error.message.match(/endpoint: "(.+?)\.amazonaws\.com/);
              let extractedRegion = '';
              
              if (regionMatch && regionMatch[1]) {
                extractedRegion = regionMatch[1].replace('s3.', '').replace('s3-', '');
                console.log(`Using region ${extractedRegion} for bucket ${bucket}`);
                
                // Create a region-specific client
                const regionS3Client = new S3Client({
                  credentials: {
                    accessKeyId: credentials.accessKeyId,
                    secretAccessKey: credentials.secretAccessKey,
                    sessionToken: credentials.sessionToken
                  },
                  region: extractedRegion
                });
                
                // Retry with the region-specific client
                const retryHeadObjectResponse = await regionS3Client.send(headObjectCommand);
                fileSize = retryHeadObjectResponse.ContentLength || 0;
              } else {
                console.error('Could not extract region from error:', error);
              }
            } else {
              console.error('Error getting file size:', error);
            }
          }
        } catch (sizeError) {
          console.error('Failed to get file size:', sizeError);
          // Continue with import even if we couldn't get the size
        }
        
        // Import the file
        await importS3File(s3Client, bucket, key, videoId, body.indexId);
        
        return {
          videoId,
          fileName,
          size: fileSize,
          status: 'imported'
        };
      } catch (error) {
        console.error('Error importing file:', error);
        return {
          fileName: file.key.split('/').pop() || file.key,
          error: error instanceof Error ? error.message : 'Unknown error',
          status: 'failed'
        };
      }
    }));

    return {
      statusCode: STATUS_CODES.OK,
      headers: corsHeaders,
      body: JSON.stringify({
        results
      })
    };
  } catch (error) {
    console.error('Error importing from S3:', error);
    return {
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      headers: corsHeaders,
      body: JSON.stringify({
        error: 'Failed to import from S3',
        details: error instanceof Error ? error.message : 'Unknown error'
      })
    };
  }
}
