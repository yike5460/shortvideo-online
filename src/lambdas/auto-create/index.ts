import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, GetCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { v4 as uuidv4 } from 'uuid';

// Initialize AWS clients
const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const sqsClient = new SQSClient({});

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
  'Access-Control-Allow-Credentials': 'true'
};

interface CreateJobRequest {
  request: string;
  userId: string;
  options?: {
    maxDuration?: number;
    preferredIndexes?: string[];
    outputFormat?: string;
  };
}

interface AutoCreateJob {
  jobId: string;
  userId: string;
  request: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  progress: number;
  createdAt: string;
  completedAt?: string;
  logs: string[];
  result?: {
    videoUrl: string;
    thumbnailUrl: string;
    description: string;
    duration: number;
    s3Path: string;
  };
  error?: string;
  estimatedDuration?: number;
  ttl: number;
}

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  console.log('Event:', JSON.stringify(event, null, 2));

  try {
    const path = event.path;
    const method = event.httpMethod;

    // Handle CORS preflight
    if (method === 'OPTIONS') {
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: '',
      };
    }

    // Route requests
    if (method === 'POST' && path === '/auto-create') {
      return await handleCreateJob(event);
    } else if (method === 'GET' && path === '/auto-create/jobs') {
      return await handleListJobs(event);
    } else if (method === 'GET' && path.startsWith('/auto-create/jobs/') && !path.includes('/stream/')) {
      const jobId = path.split('/').pop();
      return await handleGetJobStatus(event, jobId!);
    } else if (method === 'GET' && path.includes('/auto-create/stream/')) {
      const jobId = path.split('/').pop();
      return await handleStreamJobUpdates(event, jobId!);
    }

    return {
      statusCode: 404,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Not found' }),
    };
  } catch (error) {
    console.error('Error:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error'
      }),
    };
  }
};

async function handleCreateJob(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  if (!event.body) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Missing request body' }),
    };
  }

  const request: CreateJobRequest = JSON.parse(event.body);
  
  // Validate request
  if (!request.request || !request.userId) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Missing required fields: request, userId' }),
    };
  }

  const jobId = uuidv4();
  const now = new Date().toISOString();
  const ttl = Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60); // 30 days

  const job: AutoCreateJob = {
    jobId,
    userId: request.userId,
    request: request.request,
    status: 'queued',
    progress: 0,
    createdAt: now,
    logs: [`Job created at ${now}`],
    estimatedDuration: 300, // 5 minutes default estimate
    ttl,
  };

  try {
    // Save job to DynamoDB
    await docClient.send(new PutCommand({
      TableName: process.env.JOBS_TABLE!,
      Item: job,
    }));

    // Send message to SQS queue for processing
    const sqsMessage = {
      jobId,
      request: request.request,
      userId: request.userId,
      options: request.options || {},
    };

    await sqsClient.send(new SendMessageCommand({
      QueueUrl: process.env.JOB_QUEUE_URL!,
      MessageBody: JSON.stringify(sqsMessage),
      MessageGroupId: jobId,
      MessageDeduplicationId: jobId,
    }));

    console.log(`Created job ${jobId} for user ${request.userId}`);

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        jobId,
        status: 'queued',
        estimatedDuration: job.estimatedDuration,
      }),
    };
  } catch (error) {
    console.error('Error creating job:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Failed to create job' }),
    };
  }
}

async function handleGetJobStatus(event: APIGatewayProxyEvent, jobId: string): Promise<APIGatewayProxyResult> {
  const userId = event.queryStringParameters?.userId || event.requestContext.identity?.cognitoIdentityId || 'anonymous';

  try {
    const result = await docClient.send(new GetCommand({
      TableName: process.env.JOBS_TABLE!,
      Key: { jobId, userId },
    }));

    if (!result.Item) {
      return {
        statusCode: 404,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Job not found' }),
      };
    }

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify(result.Item),
    };
  } catch (error) {
    console.error('Error getting job status:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Failed to get job status' }),
    };
  }
}

async function handleListJobs(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const userId = event.queryStringParameters?.userId || event.requestContext.identity?.cognitoIdentityId || 'anonymous';

  try {
    const result = await docClient.send(new QueryCommand({
      TableName: process.env.JOBS_TABLE!,
      IndexName: 'UserIdIndex',
      KeyConditionExpression: 'userId = :userId',
      ExpressionAttributeValues: {
        ':userId': userId,
      },
      ScanIndexForward: false, // Sort by createdAt descending
      Limit: 50, // Limit to recent jobs
    }));

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        jobs: result.Items || [],
      }),
    };
  } catch (error) {
    console.error('Error listing jobs:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Failed to list jobs' }),
    };
  }
}

async function handleStreamJobUpdates(event: APIGatewayProxyEvent, jobId: string): Promise<APIGatewayProxyResult> {
  const userId = event.queryStringParameters?.userId || event.requestContext.identity?.cognitoIdentityId || 'anonymous';

  try {
    // Get current job status
    const result = await docClient.send(new GetCommand({
      TableName: process.env.JOBS_TABLE!,
      Key: { jobId, userId },
    }));

    if (!result.Item) {
      return {
        statusCode: 404,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Job not found' }),
      };
    }

    // For now, return the current status
    // In a full implementation, this would establish an SSE connection
    return {
      statusCode: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
      body: `data: ${JSON.stringify(result.Item)}\n\n`,
    };
  } catch (error) {
    console.error('Error streaming job updates:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Failed to stream job updates' }),
    };
  }
}

// Helper function to update job status (used by Strands Agent)
export async function updateJobStatus(
  jobId: string,
  userId: string,
  updates: Partial<AutoCreateJob>
): Promise<void> {
  const updateExpression: string[] = [];
  const expressionAttributeNames: Record<string, string> = {};
  const expressionAttributeValues: Record<string, any> = {};

  Object.entries(updates).forEach(([key, value]) => {
    if (value !== undefined) {
      updateExpression.push(`#${key} = :${key}`);
      expressionAttributeNames[`#${key}`] = key;
      expressionAttributeValues[`:${key}`] = value;
    }
  });

  if (updateExpression.length === 0) return;

  await docClient.send(new UpdateCommand({
    TableName: process.env.JOBS_TABLE!,
    Key: { jobId, userId },
    UpdateExpression: `SET ${updateExpression.join(', ')}`,
    ExpressionAttributeNames: expressionAttributeNames,
    ExpressionAttributeValues: expressionAttributeValues,
  }));
}