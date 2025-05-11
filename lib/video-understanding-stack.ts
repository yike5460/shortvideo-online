// lib/video-understanding-stack.ts

import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
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
        NOVA_MODEL_ID: 'amazon.nova-pro-v1:0',
      },
      bundling: {
        minify: true,
        sourceMap: true,
        target: 'node20',
        format: nodejslambda.OutputFormat.CJS
      },
      depsLockFilePath: 'src/lambdas/video-understanding/package.json'
    });

    // Grant permissions to the Lambda function
    sessionsTable.grantReadWriteData(this.videoUnderstandingFunction);
    props.indexesTable.grantReadData(this.videoUnderstandingFunction);

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

    // Add API Gateway endpoints
    // POST /video/ask/init
    // GET /video/ask/stream/{sessionId}
    const videos = props.api.root.getResource('videos') || props.api.root.addResource('videos');
    const ask = videos.addResource('ask');
    const init = ask.addResource('init');
    const stream = ask.addResource('stream');
    const streamSession = stream.addResource('{sessionId}');

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
    addMethodWithCors(streamSession, 'GET', this.videoUnderstandingFunction);
  }
}