// lib/s3-connector-stack.ts

import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as nodejslambda from 'aws-cdk-lib/aws-lambda-nodejs';
import { Construct } from 'constructs';

export interface S3ConnectorStackProps {
  vpc: ec2.Vpc;
  api: apigateway.RestApi;
  videoBucket: string;
  dynamodbEndpoint: ec2.InterfaceVpcEndpoint;
  deploymentEnvironment: string;
}
/**
 * S3 Connector Stack
 * 
 * This stack creates a DynamoDB table for S3 connectors and a Lambda function for S3 connector operations, it provides:
 * - DynamoDB table for storing S3 connector configurations
 * - Lambda function for S3 connector operations
 * - API Gateway endpoints for the S3 connector API
 * - IAM permissions for assuming roles and accessing S3
 * 
 */
export class S3ConnectorStack extends Construct {
  public readonly s3ConnectorFunction: lambda.Function;
  public readonly s3ConnectorsTable: dynamodb.Table;
  public readonly s3ConnectorRole: iam.Role;

  constructor(scope: Construct, id: string, props: S3ConnectorStackProps) {
    super(scope, id);

    // Create DynamoDB table for S3 connectors
    this.s3ConnectorsTable = new dynamodb.Table(this, 'S3ConnectorsTable', {
      partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Add GSI for userId
    this.s3ConnectorsTable.addGlobalSecondaryIndex({
      indexName: 'UserIdIndex',
      partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL
    });

    // Create Lambda security group
    const lambdaSG = new ec2.SecurityGroup(this, 'S3ConnectorLambdaSG', {
      vpc: props.vpc,
      description: 'Security group for S3 connector Lambda',
      allowAllOutbound: true,
    });

    // Allow outbound connections to HTTP and HTTPS
    lambdaSG.addEgressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), 'Allow HTTPS outbound');
    lambdaSG.addEgressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), 'Allow HTTP outbound');

    // Extract just the DNS name part by splitting at ':' and selecting the second part, to remove DNS zone ID prefix 
    const dynamoDbEndpointDns = cdk.Fn.select(
      1, 
      cdk.Fn.split(
        ':', 
        cdk.Fn.select(0, props.dynamodbEndpoint.vpcEndpointDnsEntries)
      )
    );

    // Assemble to valid endpoint URL
    const dynamoDbEndpointDnsHttp = `https://${dynamoDbEndpointDns}`;

    // Create S3 connector role that can be assumed by external accounts
    this.s3ConnectorRole = new iam.Role(this, 'S3ConnectorRole', {
      roleName: 'S3ConnectorRole', 
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'), // Initially assumed by Lambda
      description: 'Role for S3 Connector to access external S3 buckets',
    });

    // Allow S3ConnectorRole to access S3
    this.s3ConnectorRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          's3:ListBucket',
          's3:GetObject',
          's3:GetObjectVersion',
          's3:ListAllMyBuckets',
          's3:GetBucketLocation',  // For cross-region bucket detection
          's3:CopyObject',         // Add for copying objects between buckets
          's3:PutObject'           // Add for uploading objects to destination bucket
        ],
        resources: ['*'] // In production, this should be restricted to specific buckets
      })
    );

    // Create S3 connector Lambda function
    this.s3ConnectorFunction = new nodejslambda.NodejsFunction(this, 'S3ConnectorFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: 'src/lambdas/s3-connector/index.ts',
      handler: 'handler',
      vpc: props.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups: [lambdaSG],
      timeout: cdk.Duration.minutes(5),
      memorySize: 1024,
      environment: {
        VIDEO_BUCKET: props.videoBucket,
        CONNECTORS_TABLE: this.s3ConnectorsTable.tableName,
        CONNECTORS_TABLE_DYNAMODB_DNS_NAME: dynamoDbEndpointDnsHttp,
        SERVICE_ROLE_ARN: this.s3ConnectorRole.roleArn,
      },
      bundling: {
        minify: true,
        sourceMap: true,
        target: 'node20',
        format: nodejslambda.OutputFormat.CJS
      }
    });

    // Grant permissions to the Lambda function
    this.s3ConnectorsTable.grantReadWriteData(this.s3ConnectorFunction);

    // Update the trust policy of the S3ConnectorRole to allow it to be assumed by the Lambda function
    this.s3ConnectorRole.assumeRolePolicy?.addStatements(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        principals: [
          new iam.ArnPrincipal(this.s3ConnectorFunction.role!.roleArn)
        ],
        actions: ['sts:AssumeRole']
      })
    );

    // Create IAM policy for assuming roles
    const assumeRolePolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['sts:AssumeRole'],
      resources: ['*'] // Allow assuming any role, including user-provided roles
    });

    // Add the policy to the Lambda function
    this.s3ConnectorFunction.addToRolePolicy(assumeRolePolicy);

    // Add API Gateway endpoints
    this.addApiEndpoints(props.api);
  }

  /**
   * API Gateway endpoints for S3 connector operations:
   * - GET /connectors/s3 - List user's S3 connectors
   * - POST /connectors/s3 - Create a new S3 connector
   * - GET /connectors/s3/{connectorId} - Get a specific connector
   * - PUT /connectors/s3/{connectorId} - Update a connector
   * - DELETE /connectors/s3/{connectorId} - Delete a connector
   * - GET /connectors/s3/{connectorId}/buckets - List buckets for a connector
   * - GET /connectors/s3/{connectorId}/buckets/{bucket} - List files in a bucket
   * - GET /connectors/s3/{connectorId}/search - Search for files in a bucket
   * - POST /videos/import/s3 - Import videos from S3
   */
  private addApiEndpoints(api: apigateway.RestApi): void {
    // Create /connectors resource
    const connectorsResource = api.root.addResource('connectors');
    
    // Create /connectors/s3 resource
    const s3Resource = connectorsResource.addResource('s3');
    
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

      // Add OPTIONS method if it doesn't exist and hasn't been added by defaultCorsPreflightOptions
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
    
    // Add methods to resources using the helper function
    addMethodWithCors(s3Resource, 'GET', this.s3ConnectorFunction);
    addMethodWithCors(s3Resource, 'POST', this.s3ConnectorFunction);
    
    // Create /connectors/s3/{connectorId} resource
    const connectorResource = s3Resource.addResource('{connectorId}');
    
    // Add methods to /connectors/s3/{connectorId}
    addMethodWithCors(connectorResource, 'GET', this.s3ConnectorFunction);
    addMethodWithCors(connectorResource, 'PUT', this.s3ConnectorFunction);
    addMethodWithCors(connectorResource, 'DELETE', this.s3ConnectorFunction);
    
    // Create /connectors/s3/{connectorId}/buckets resource
    const bucketsResource = connectorResource.addResource('buckets');
    
    // Add methods to /connectors/s3/{connectorId}/buckets
    addMethodWithCors(bucketsResource, 'GET', this.s3ConnectorFunction);
    
    // Create /connectors/s3/{connectorId}/buckets/{bucket} resource
    const bucketResource = bucketsResource.addResource('{bucket}');
    
    // Add methods to /connectors/s3/{connectorId}/buckets/{bucket}
    addMethodWithCors(bucketResource, 'GET', this.s3ConnectorFunction);
    
    // Create /connectors/s3/{connectorId}/search resource
    const searchResource = connectorResource.addResource('search');
    
    // Add methods to /connectors/s3/{connectorId}/search
    addMethodWithCors(searchResource, 'GET', this.s3ConnectorFunction);
    
    // Create /videos/import/s3 resource
    const videosResource = api.root.getResource('videos') || api.root.addResource('videos');
    const importResource = videosResource.addResource('import');
    const importS3Resource = importResource.addResource('s3');
    
    // Add methods to /videos/import/s3
    addMethodWithCors(importS3Resource, 'POST', this.s3ConnectorFunction);
  }
}