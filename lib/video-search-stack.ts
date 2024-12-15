// lib/video-search-stack.ts

import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as opensearchserverless from 'aws-cdk-lib/aws-opensearchserverless';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as elasticache from 'aws-cdk-lib/aws-elasticache';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as sns from 'aws-cdk-lib/aws-sns';
import { Construct } from 'constructs';
import * as cr from 'aws-cdk-lib/custom-resources';

interface VideoSearchStackProps extends cdk.StackProps {
  maxAzs: number;
  deploymentEnvironment?: string;
}

export class VideoSearchStack extends cdk.Stack {
  private readonly vpc: ec2.Vpc;
  private readonly videoBucket: s3.Bucket;
  private readonly openSearchCollection: opensearchserverless.CfnCollection;
  private readonly redisCluster: elasticache.CfnCacheCluster;
  private readonly cluster: ecs.Cluster;
  private readonly videoProcessingQueue: sqs.Queue;

  constructor(scope: Construct, id: string, props: VideoSearchStackProps) {
    super(scope, id, props);

    const deploymentEnv = props.deploymentEnvironment || 'dev';

    // Initialize core infrastructure
    this.vpc = this.createVpcInfrastructure();
    this.videoBucket = this.createStorageInfrastructure(deploymentEnv);
    this.openSearchCollection = this.createSearchInfrastructure(deploymentEnv);
    // this.redisCluster = this.createCacheInfrastructure();
    // this.cluster = this.createContainerInfrastructure();
    // this.videoProcessingQueue = this.createQueueInfrastructure();
    
    // const lambdaFunctions = {
    //   videoUploadFunction: this.createVideoUploadFunction(),
    //   videoSliceFunction: this.createVideoSliceFunction(),
    //   videoSearchFunction: this.createVideoSearchFunction()
    // };

    // // Create embedding service
    // const embeddingService = this.createEmbeddingService();

    // // Initialize API Gateway
    // const api = this.createApiGateway(lambdaFunctions);

    // // Set up permissions
    // this.setupPermissions(lambdaFunctions, embeddingService, this.videoProcessingQueue);

    // // Create CloudWatch Event Rules for monitoring
    // this.createMonitoringInfrastructure(lambdaFunctions, embeddingService);

    // // Create stack outputs
    // this.createStackOutputs(api);
  }

  private createVpcInfrastructure(): ec2.Vpc {
    const vpc = new ec2.Vpc(this, 'VideoSearchVPC', {
      maxAzs: 2,
      natGateways: 0,
      subnetConfiguration: [
        {
          name: 'Private',
          // No NAT Gateway, no internet access from this subnet in either directions
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
          cidrMask: 24,
        },
      ],
    });

    // Keep only the necessary VPC endpoints
    vpc.addGatewayEndpoint('S3Endpoint', {
      service: ec2.GatewayVpcEndpointAwsService.S3,
    });

    vpc.addInterfaceEndpoint('SQSEndpoint', {
      service: ec2.InterfaceVpcEndpointAwsService.SQS,
    });

    return vpc;
  }

  // Storage infrastructure can be critical in cost and operational complexity, configure all the parameters explicitly
  private createStorageInfrastructure(stage: string): s3.Bucket {
    return new s3.Bucket(this, 'VideoBucket', {
      bucketName: `video-search-${stage}-${this.account}`,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      lifecycleRules: [
        {
          // Rule for raw videos
          prefix: 'RawVideos/',
          transitions: [
            {
              storageClass: s3.StorageClass.INTELLIGENT_TIERING,
              transitionAfter: cdk.Duration.days(30),
            },
          ],
          noncurrentVersionExpiration: cdk.Duration.days(7),
        },
        {
          // Rule for processed shots
          prefix: 'RawVideos/*/*/ShotsVideos/',
          transitions: [
            {
              storageClass: s3.StorageClass.INTELLIGENT_TIERING,
              transitionAfter: cdk.Duration.days(30),
            },
          ],
          noncurrentVersionExpiration: cdk.Duration.days(7),
        },
        {
          // Rule for metadata and embeddings
          prefix: 'RawVideos/*/*/ShotsVideos/*/shot_',
          transitions: [
            {
              storageClass: s3.StorageClass.INTELLIGENT_TIERING,
              transitionAfter: cdk.Duration.days(30),
            },
          ],
          noncurrentVersionExpiration: cdk.Duration.days(7),
        }
      ],
      cors: [
        {
          allowedMethods: [s3.HttpMethods.GET, s3.HttpMethods.PUT, s3.HttpMethods.POST],
          allowedOrigins: ['*'],
          allowedHeaders: ['*'],
          maxAge: 3000,
        },
      ],
      versioned: false, // Disable versioning for now
      encryption: s3.BucketEncryption.S3_MANAGED, // Enable encryption
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL, // Block public access
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED, // Simplify ownership
      intelligentTieringConfigurations: [
        {
          name: 'video-search-tiering',
          prefix: 'RawVideos/',
          archiveAccessTierTime: cdk.Duration.days(90),
          deepArchiveAccessTierTime: cdk.Duration.days(180),
        },
      ],
      metrics: [
        {
          id: 'EntireBucket',
        },
        {
          id: 'RawVideos',
          prefix: 'RawVideos/',
        },
        {
          id: 'ShotsVideos',
          prefix: 'RawVideos/*/*/ShotsVideos/',
        },
      ],
    });
  }

  private createSearchInfrastructure(stage: string): opensearchserverless.CfnCollection {
    // Create security group for the VPC endpoint
    const vpcEndpointSG = new ec2.SecurityGroup(this, 'OpenSearchVPCEndpointSG', {
      vpc: this.vpc,
      description: 'Security group for OpenSearch VPC endpoint',
      allowAllOutbound: true,
    });

    vpcEndpointSG.addIngressRule(
      ec2.Peer.ipv4(this.vpc.vpcCidrBlock),
      ec2.Port.tcp(443),
      'Allow HTTPS from VPC'
    );

    // Create OpenSearch Serverless Collection
    const collection = new opensearchserverless.CfnCollection(this, 'VideoSearchCollection', {
      name: `video-search-${stage}`,
      description: 'Collection for video search and analytics',
      type: 'SEARCH'
    });

    // Create network policy for VPC access
    const networkPolicy = new opensearchserverless.CfnSecurityPolicy(this, 'VideoSearchNetworkPolicy', {
      name: `video-search-network-${stage}`,
      type: 'network',
      policy: JSON.stringify([{
        Rules: [{
          Resource: [`collection/${collection.attrId}`],
          ResourceType: 'collection',
          AllowFromPublic: false
        }],
        AllowFromPublic: false,
        SourceVPCEndpoint: this.vpc.vpcId
      }])
    });

    // Create encryption policy
    const encryptionPolicy = new opensearchserverless.CfnSecurityPolicy(this, 'VideoSearchEncryptionPolicy', {
      name: `video-search-encryption-${stage}`,
      type: 'encryption',
      policy: JSON.stringify([{
        Rules: [{
          Resource: [`collection/${collection.attrId}`],
          ResourceType: 'collection'
        }],
        AWSOwnedKey: true
      }])
    });

    // Create data access policy
    const dataAccessPolicy = new opensearchserverless.CfnAccessPolicy(this, 'VideoSearchDataAccessPolicy', {
      name: `video-search-access-${stage}`,
      type: 'data',
      policy: JSON.stringify([{
        Rules: [{
          Resource: [`collection/${collection.attrId}`],
          Permission: [
            'aoss:CreateCollectionItems',
            'aoss:DeleteCollectionItems',
            'aoss:UpdateCollectionItems',
            'aoss:DescribeCollectionItems'
          ],
          ResourceType: 'collection'
        }],
        Principal: [
          this.account // Grant access to current AWS account
        ]
      }])
    });

    // Create the OpenSearch VPC endpoint using AwsCustomResource
    const openSearchEndpoint = new cr.AwsCustomResource(this, 'OpenSearchVpcEndpoint', {
      onCreate: {
        service: 'opensearchserverless',
        action: 'createVpcEndpoint',
        parameters: {
          name: `video-search-endpoint-${stage}`,
          vpcId: this.vpc.vpcId,
          subnetIds: this.vpc.selectSubnets({
            subnetType: ec2.SubnetType.PRIVATE_ISOLATED
          }).subnetIds,
          securityGroupIds: [vpcEndpointSG.securityGroupId],
          clientToken: `create-endpoint-${stage}-${Date.now()}`
        },
        physicalResourceId: cr.PhysicalResourceId.fromResponse('vpcEndpoint.id')
      },
      onDelete: {
        service: 'opensearchserverless',
        action: 'deleteVpcEndpoint',
        parameters: {
          id: cr.PhysicalResourceId.fromResponse('vpcEndpoint.id')
        }
      },
      policy: cr.AwsCustomResourcePolicy.fromStatements([
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            'aoss:CreateVpcEndpoint',
            'aoss:DeleteVpcEndpoint',
            'aoss:ListVpcEndpoints',
            'aoss:GetVpcEndpoint',
            'ec2:CreateVpcEndpoint',
            'ec2:DeleteVpcEndpoints',
            'ec2:DescribeVpcEndpoints',
            'ec2:ModifyVpcEndpoint',
            'ec2:DescribeSecurityGroups',
            'ec2:DescribeSubnets',
            'ec2:DescribeVpcs',
            'iam:CreateServiceLinkedRole'
          ],
          resources: ['*']
        }),
        // Add policy for service-linked role
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            'iam:CreateServiceLinkedRole'
          ],
          resources: [`arn:aws:iam::${this.account}:role/aws-service-role/aoss.amazonaws.com/AWSServiceRoleForAmazonOpenSearchServerless`],
          conditions: {
            StringLike: {
              'iam:AWSServiceName': 'aoss.amazonaws.com'
            }
          }
        })
      ])
    });

    // Add dependencies
    networkPolicy.node.addDependency(collection);
    encryptionPolicy.node.addDependency(collection);
    dataAccessPolicy.node.addDependency(collection);
    openSearchEndpoint.node.addDependency(collection);

    // Get the collection endpoint
    const collectionEndpoint = `https://${collection.attrId}.${this.region}.aoss.amazonaws.com`;

    // Update environment variables in Lambda functions
    const commonLambdaProps = {
      environment: {
        OPENSEARCH_ENDPOINT: collectionEndpoint
      }
    };

    // Update stack outputs
    new cdk.CfnOutput(this, 'OpenSearchEndpoint', {
      value: collectionEndpoint,
      description: 'OpenSearch Serverless collection endpoint'
    });

    return collection;
  }

  private createCacheInfrastructure(): elasticache.CfnCacheCluster {
    const redisSubnetGroup = new elasticache.CfnSubnetGroup(this, 'RedisSubnetGroup', {
      description: 'Subnet group for Redis cluster',
      subnetIds: this.vpc.selectSubnets({ subnetType: ec2.SubnetType.PRIVATE_ISOLATED }).subnetIds,
    });

    const redisSecurityGroup = new ec2.SecurityGroup(this, 'RedisSecurityGroup', {
      vpc: this.vpc,
      description: 'Security group for Redis cluster',
      allowAllOutbound: true,
    });

    redisSecurityGroup.addIngressRule(
      ec2.Peer.ipv4(this.vpc.vpcCidrBlock),
      ec2.Port.tcp(6379),
      'Allow Redis access from VPC'
    );

    return new elasticache.CfnCacheCluster(this, 'RedisCluster', {
      engine: 'redis',
      cacheNodeType: 'cache.t4g.medium',
      numCacheNodes: 1,
      vpcSecurityGroupIds: [redisSecurityGroup.securityGroupId],
      cacheSubnetGroupName: redisSubnetGroup.ref,
    });
  }

  private createContainerInfrastructure(): ecs.Cluster {
    return new ecs.Cluster(this, 'VideoProcessingCluster', {
      vpc: this.vpc,
      containerInsights: true,
    });
  }

  private createQueueInfrastructure(): sqs.Queue {
    const dlq = new sqs.Queue(this, 'VideoProcessingDLQ', {
      queueName: 'video-processing-dlq',
      retentionPeriod: cdk.Duration.days(14),
    });

    return new sqs.Queue(this, 'VideoProcessingQueue', {
      queueName: 'video-processing-queue',
      visibilityTimeout: cdk.Duration.minutes(15),
      retentionPeriod: cdk.Duration.days(14),
      deadLetterQueue: {
        queue: dlq,
        maxReceiveCount: 3,
      },
    });
  }

  private createVideoUploadFunction() {
    const commonLambdaProps = {
      runtime: lambda.Runtime.NODEJS_18_X,
      vpc: this.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      timeout: cdk.Duration.minutes(15),
      environment: {
        VIDEO_BUCKET: this.videoBucket.bucketName,
        QUEUE_URL: this.videoProcessingQueue.queueUrl,
        OPENSEARCH_ENDPOINT: `https://${this.openSearchCollection.attrId}.${this.region}.aoss.amazonaws.com`,
        REDIS_ENDPOINT: this.redisCluster.attrRedisEndpointAddress,
      },
    };

    const videoUploadHandler = new lambda.Function(this, 'VideoUploadHandler', {
      ...commonLambdaProps,
      code: lambda.Code.fromAsset('src/lambdas/video-upload'),
      handler: 'index.handler',
      memorySize: 1024,
    });

    return videoUploadHandler;
  }

  private createVideoSliceFunction() {
    const commonLambdaProps = {
      runtime: lambda.Runtime.NODEJS_18_X,
      vpc: this.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      timeout: cdk.Duration.minutes(15),
      environment: {
        VIDEO_BUCKET: this.videoBucket.bucketName,
        QUEUE_URL: this.videoProcessingQueue.queueUrl,
        OPENSEARCH_ENDPOINT: `https://${this.openSearchCollection.attrId}.${this.region}.aoss.amazonaws.com`,
        REDIS_ENDPOINT: this.redisCluster.attrRedisEndpointAddress,
      },
    };

    const videoSliceHandler = new lambda.Function(this, 'VideoSliceHandler', {
      ...commonLambdaProps,
      code: lambda.Code.fromAsset('src/lambdas/video-slice'),
      handler: 'index.handler',
      memorySize: 2048,
    });

    return videoSliceHandler;
  }

  private createVideoSearchFunction() {
    const commonLambdaProps = {
      runtime: lambda.Runtime.NODEJS_18_X,
      vpc: this.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      timeout: cdk.Duration.minutes(15),
      environment: {
        VIDEO_BUCKET: this.videoBucket.bucketName,
        QUEUE_URL: this.videoProcessingQueue.queueUrl,
        OPENSEARCH_ENDPOINT: `https://${this.openSearchCollection.attrId}.${this.region}.aoss.amazonaws.com`,
        REDIS_ENDPOINT: this.redisCluster.attrRedisEndpointAddress,
      },
    };

    const videoSearchHandler = new lambda.Function(this, 'VideoSearchHandler', {
      ...commonLambdaProps,
      code: lambda.Code.fromAsset('src/lambdas/video-search'),
      handler: 'index.handler',
      memorySize: 2048,
    });

    return videoSearchHandler;
  }

  private createEmbeddingService(): ecs.FargateService {
    const taskDefinition = new ecs.FargateTaskDefinition(this, 'EmbeddingTaskDef', {
      memoryLimitMiB: 4096,
      cpu: 2048,
    });

    const container = taskDefinition.addContainer('EmbeddingContainer', {
      image: ecs.ContainerImage.fromAsset('src/containers/bge-embedding'),
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'embedding-service',
        logRetention: logs.RetentionDays.ONE_WEEK,
      }),
      environment: {
        VIDEO_BUCKET: this.videoBucket.bucketName,
        OPENSEARCH_ENDPOINT: `https://${this.openSearchCollection.attrId}.${this.region}.aoss.amazonaws.com`,
      },
    });

    container.addPortMappings({
      containerPort: 8000,
    });

    return new ecs.FargateService(this, 'EmbeddingService', {
      cluster: this.cluster,
      taskDefinition,
      desiredCount: 2,
      minHealthyPercent: 50,
      maxHealthyPercent: 200,
      assignPublicIp: false,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
    });
  }

  private createApiGateway(lambdaFunctions: {
    videoUploadFunction: lambda.Function;
    videoSliceFunction: lambda.Function;
    videoSearchFunction: lambda.Function;
  }): apigateway.RestApi {
    const api = new apigateway.RestApi(this, 'VideoSearchApi', {
      restApiName: 'Video Search Service',
      description: 'API for video search and processing',
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
      },
    });

    const videos = api.root.addResource('videos');
    const search = api.root.addResource('search');
    const status = videos.addResource('{videoId}').addResource('status');

    videos.addMethod('POST', new apigateway.LambdaIntegration(lambdaFunctions.videoUploadFunction));
    search.addMethod('POST', new apigateway.LambdaIntegration(lambdaFunctions.videoSearchFunction));
    status.addMethod('GET', new apigateway.LambdaIntegration(lambdaFunctions.videoSliceFunction));

    return api;
  }

  private setupPermissions(
    lambdaFunctions: {
      videoUploadFunction: lambda.Function;
      videoSliceFunction: lambda.Function;
      videoSearchFunction: lambda.Function;
    },
    _embeddingService: ecs.FargateService,
    queue: sqs.Queue
  ) {
    // S3 permissions
    this.videoBucket.grantReadWrite(lambdaFunctions.videoUploadFunction);
    this.videoBucket.grantRead(lambdaFunctions.videoSearchFunction);
    this.videoBucket.grantReadWrite(lambdaFunctions.videoSliceFunction);

    // SQS permissions
    queue.grantSendMessages(lambdaFunctions.videoUploadFunction);
    queue.grantConsumeMessages(lambdaFunctions.videoSliceFunction);

    // OpenSearch Serverless permissions
    const openSearchPolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'aoss:APIAccessAll',
        'aoss:DescribeCollection',
        'aoss:CreateCollection',
        'aoss:UpdateCollection',
        'aoss:DeleteCollection'
      ],
      resources: [
        `arn:aws:aoss:${this.region}:${this.account}:collection/${this.openSearchCollection.attrId}`
      ]
    });

    const openSearchReadOnlyPolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'aoss:APIAccessAll',
        'aoss:DescribeCollection'
      ],
      resources: [
        `arn:aws:aoss:${this.region}:${this.account}:collection/${this.openSearchCollection.attrId}`
      ]
    });

    lambdaFunctions.videoUploadFunction.addToRolePolicy(openSearchPolicy);
    lambdaFunctions.videoSliceFunction.addToRolePolicy(openSearchPolicy);
    lambdaFunctions.videoSearchFunction.addToRolePolicy(openSearchReadOnlyPolicy);

    // AI service permissions
    const aiServicePolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'rekognition:StartSegmentDetection',
        'rekognition:GetSegmentDetection',
        'rekognition:StartLabelDetection',
        'rekognition:GetLabelDetection',
        'rekognition:StartFaceDetection',
        'rekognition:GetFaceDetection'
      ],
      resources: ['*']
    });

    lambdaFunctions.videoSliceFunction.addToRolePolicy(aiServicePolicy);
  }

  private createMonitoringInfrastructure(
    lambdaFunctions: {
      videoUploadFunction: lambda.Function;
      videoSliceFunction: lambda.Function;
      videoSearchFunction: lambda.Function;
    },
    embeddingService: ecs.FargateService
  ) {
    // Create CloudWatch Event Rule for Lambda errors
    const lambdaErrorRule = new events.Rule(this, 'LambdaErrorRule', {
      eventPattern: {
        source: ['aws.lambda'],
        detailType: ['AWS API Call via CloudTrail'],
        detail: {
          eventSource: ['lambda.amazonaws.com'],
          eventName: ['Invoke'],
          errorCode: [{ exists: true }],
        },
      },
    });

    // Create SNS Topic for alerts
    const alertTopic = new sns.Topic(this, 'AlertTopic', {
      displayName: 'Video Processing Alerts',
    });

    lambdaErrorRule.addTarget(new targets.SnsTopic(alertTopic));
  }

  private createStackOutputs(api: apigateway.RestApi) {
    new cdk.CfnOutput(this, 'ApiEndpoint', {
      value: api.url,
      description: 'API Gateway endpoint URL',
    });

    new cdk.CfnOutput(this, 'VideoBucketName', {
      value: this.videoBucket.bucketName,
      description: 'Name of the S3 bucket for video storage',
    });

    new cdk.CfnOutput(this, 'OpenSearchEndpoint', {
      value: `https://${this.openSearchCollection.attrId}.${this.region}.aoss.amazonaws.com`,
      description: 'OpenSearch Serverless collection endpoint',
    });
  }
}