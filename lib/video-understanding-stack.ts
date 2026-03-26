// lib/video-understanding-stack.ts

import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as lambdaEventSources from 'aws-cdk-lib/aws-lambda-event-sources';
import * as nodejslambda from 'aws-cdk-lib/aws-lambda-nodejs';
import { Construct } from 'constructs';

export interface VideoUnderstandingProps {
  vpc: ec2.Vpc;
  api: apigateway.RestApi;
  videoBucket: string;
  dynamodbEndpoint: ec2.InterfaceVpcEndpoint;
  openSearchEndpoint: string;
  indexesTable: dynamodb.Table;
  deploymentEnvironment: string;
  googleApiKey?: string;
}

export class VideoUnderstandingStack extends Construct {
  public readonly videoUnderstandingFunction: lambda.Function;
  
  constructor(scope: Construct, id: string, props: VideoUnderstandingProps) {
    super(scope, id);

    // Create DynamoDB table for video understanding sessions
    const sessionsTable = new dynamodb.Table(this, 'VideoUnderstandingSessions', {
      partitionKey: { name: 'sessionId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      timeToLiveAttribute: 'ttl',
    });

    // Create SQS queue for async video processing
    const processingQueue = new sqs.Queue(this, 'VideoProcessingQueue', {
      queueName: `video-processing-${props.deploymentEnvironment}`,
      visibilityTimeout: cdk.Duration.minutes(15), // Match Lambda timeout
      retentionPeriod: cdk.Duration.days(14),
      deadLetterQueue: {
        queue: new sqs.Queue(this, 'VideoProcessingDLQ', {
          queueName: `video-processing-dlq-${props.deploymentEnvironment}`,
          retentionPeriod: cdk.Duration.days(14)
        }),
        maxReceiveCount: 3
      }
    });

    // Create the Lambda security group
    const lambdaSG = new ec2.SecurityGroup(this, 'LambdaSecurityGroupVideoUnderstanding', {
      vpc: props.vpc,
      description: 'Security group for Video Understanding Lambda',
      allowAllOutbound: true,
    });

    // Allow outbound connections to HTTP and HTTPS
    lambdaSG.addEgressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), 'Allow HTTPS outbound');
    lambdaSG.addEgressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), 'Allow HTTP outbound');

    // Add ingress rules to allow incoming traffic on HTTP and HTTPS
    lambdaSG.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), 'Allow HTTPS inbound');
    lambdaSG.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), 'Allow HTTP inbound');

    // Extract just the DNS name part by splitting at ':' and selecting the second part
    const dynamoDbEndpointDns = cdk.Fn.select(
      1, 
      cdk.Fn.split(
        ':', 
        cdk.Fn.select(0, props.dynamodbEndpoint.vpcEndpointDnsEntries)
      )
    );

    // Assemble to valid endpoint URL
    const dynamoDbEndpointDnsHttp = `https://${dynamoDbEndpointDns}`;

    // Create the Lambda function
    this.videoUnderstandingFunction = new nodejslambda.NodejsFunction(this, 'VideoUnderstandingHandler', {
      runtime: lambda.Runtime.NODEJS_20_X,
      vpc: props.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups: [lambdaSG],
      timeout: cdk.Duration.minutes(15),
      memorySize: 2048,
      entry: 'src/lambdas/video-understanding/index.ts',
      handler: 'handler',
      environment: {
        VIDEO_BUCKET: props.videoBucket,
        OPENSEARCH_ENDPOINT: props.openSearchEndpoint,
        INDEXES_TABLE: props.indexesTable.tableName,
        INDEXES_TABLE_DYNAMODB_DNS_NAME: dynamoDbEndpointDnsHttp,
        SESSIONS_TABLE: sessionsTable.tableName,
        NOVA_MODEL_ID: 'apac.amazon.nova-pro-v1:0',
        CLAUDE_MODEL_ID: 'anthropic.claude-sonnet-4-6',
        PEGASUS_MODEL_ID: 'global.twelvelabs.pegasus-1-2-v1:0',
        AWS_ACCOUNT_ID: '705247044519',
        // SQS queue URL for async processing
        PROCESSING_QUEUE_URL: processingQueue.queueUrl,
      },
      bundling: {
        minify: true,
        sourceMap: true,
        target: 'node20',
        format: nodejslambda.OutputFormat.CJS
      },
      depsLockFilePath: 'src/lambdas/video-understanding/package.json'
    });

    // Add SQS event source to the Lambda function
    this.videoUnderstandingFunction.addEventSource(
      new lambdaEventSources.SqsEventSource(processingQueue, {
        batchSize: 1, // Process one message at a time
        maxBatchingWindow: cdk.Duration.seconds(0), // No batching window
        enabled: true,
      })
    );

    // Grant permissions to the Lambda function
    sessionsTable.grantReadWriteData(this.videoUnderstandingFunction);
    
    // Grant read access to the indexes table with explicit permissions
    props.indexesTable.grantReadData(this.videoUnderstandingFunction);
    
    // Add explicit permissions for DynamoDB operations on the indexes table
    const indexesTablePolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'dynamodb:GetItem',
        'dynamodb:Query',
        'dynamodb:Scan'
      ],
      resources: [props.indexesTable.tableArn]
    });
    this.videoUnderstandingFunction.addToRolePolicy(indexesTablePolicy);

    // Grant S3 permissions
    const s3Policy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        's3:GetObject',
        's3:ListBucket',
      ],
      resources: [
        `arn:aws:s3:::${props.videoBucket}`,
        `arn:aws:s3:::${props.videoBucket}/*`,
      ],
    });
    this.videoUnderstandingFunction.addToRolePolicy(s3Policy);

    // Grant Bedrock permissions
    const bedrockPolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'bedrock:InvokeModel',
      ],
      resources: ['*'],
    });
    this.videoUnderstandingFunction.addToRolePolicy(bedrockPolicy);

    // Grant SQS permissions
    const sqsPolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'sqs:SendMessage',
        'sqs:ReceiveMessage',
        'sqs:DeleteMessage',
        'sqs:GetQueueAttributes',
      ],
      resources: [
        processingQueue.queueArn,
        processingQueue.deadLetterQueue?.queue.queueArn || '',
      ].filter(Boolean),
    });
    this.videoUnderstandingFunction.addToRolePolicy(sqsPolicy);

    // Add API Gateway endpoints
    // POST /video/ask/init
    // GET /video/ask/status/{sessionId}
    // GET /video/ask/stream/{sessionId}
    // GET /videos/segmentation/{videoId}/{indexId}
    const videos = props.api.root.getResource('videos') || props.api.root.addResource('videos');
    const ask = videos.addResource('ask');
    const init = ask.addResource('init');
    const status = ask.addResource('status');
    const statusSession = status.addResource('{sessionId}');
    const stream = ask.addResource('stream');
    const streamSession = stream.addResource('{sessionId}');
    
    // Add segmentation endpoint
    const segmentation = videos.addResource('segmentation');
    const segmentationVideo = segmentation.addResource('{videoId}');
    const segmentationIndex = segmentationVideo.addResource('{indexId}');

    // Add Lambda integrations with CORS
    const addMethodWithCors = (resource: apigateway.Resource, httpMethod: string, lambdaFn: lambda.Function) => {
      const integration = new apigateway.LambdaIntegration(lambdaFn, {
        proxy: true,
        integrationResponses: [
          {
            statusCode: '200',
            responseParameters: {
              'method.response.header.Access-Control-Allow-Origin': "'*'",
              'method.response.header.Access-Control-Allow-Headers': "'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token'",
              'method.response.header.Access-Control-Allow-Methods': "'OPTIONS,GET,PUT,POST,DELETE'",
            },
          },
          {
            selectionPattern: '.*',
            statusCode: '500',
            responseParameters: {
              'method.response.header.Access-Control-Allow-Origin': "'*'",
            },
          }
        ],
      });

      // Add the main method
      resource.addMethod(httpMethod, integration, {
        methodResponses: [
          {
            statusCode: '200',
            responseParameters: {
              'method.response.header.Access-Control-Allow-Origin': true,
              'method.response.header.Access-Control-Allow-Headers': true,
              'method.response.header.Access-Control-Allow-Methods': true,
            },
          },
          {
            statusCode: '500',
            responseParameters: {
              'method.response.header.Access-Control-Allow-Origin': true,
            },
          }
        ],
      });

      // Add OPTIONS method if it doesn't exist
      try {
        resource.addMethod('OPTIONS', new apigateway.MockIntegration({
          integrationResponses: [
            {
              statusCode: '200',
              responseParameters: {
                'method.response.header.Access-Control-Allow-Headers': "'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token'",
                'method.response.header.Access-Control-Allow-Origin': "'*'",
                'method.response.header.Access-Control-Allow-Methods': "'OPTIONS,GET,PUT,POST,DELETE'",
                'method.response.header.Access-Control-Allow-Credentials': "'true'"
              },
            },
          ],
          passthroughBehavior: apigateway.PassthroughBehavior.NEVER,
          requestTemplates: {
            'application/json': '{"statusCode": 200}',
          },
        }), {
          methodResponses: [
            {
              statusCode: '200',
              responseParameters: {
                'method.response.header.Access-Control-Allow-Headers': true,
                'method.response.header.Access-Control-Allow-Methods': true,
                'method.response.header.Access-Control-Allow-Origin': true,
                'method.response.header.Access-Control-Allow-Credentials': true,
              },
            },
          ],
        });
      } catch (error) {
        // OPTIONS method already exists, skip adding it
        console.log(`OPTIONS method already exists for resource ${resource.path}`);
      }
    };

    // Add endpoints
    addMethodWithCors(init, 'POST', this.videoUnderstandingFunction);
    addMethodWithCors(statusSession, 'GET', this.videoUnderstandingFunction);
    addMethodWithCors(streamSession, 'GET', this.videoUnderstandingFunction);
    addMethodWithCors(segmentationIndex, 'GET', this.videoUnderstandingFunction);
  }
}