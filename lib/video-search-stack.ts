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
import * as sns_subs from 'aws-cdk-lib/aws-sns-subscriptions';
import { Construct } from 'constructs';
import * as cr from 'aws-cdk-lib/custom-resources';
import * as nodejslambda from 'aws-cdk-lib/aws-lambda-nodejs';
import { S3EventSource, SnsEventSource, SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';

interface VideoSearchStackProps extends cdk.StackProps {
  maxAzs: number;
  deploymentEnvironment?: string;
  externalVideoEmbeddingEndpoint?: string;
}

export class VideoSearchStack extends cdk.Stack {
  private readonly vpc: ec2.Vpc;
  private readonly videoBucket: s3.Bucket;
  private readonly videoProcessingQueue: sqs.Queue;
  private readonly rekognitionTopic: sns.Topic;
  private readonly rekognitionRole: iam.Role;
  private readonly redisCluster: elasticache.CfnCacheCluster;
  private readonly cluster: ecs.Cluster;
  private readonly openSearchCollection: opensearchserverless.CfnCollection;
  private readonly indexesTable: dynamodb.Table;
  private readonly dynamodbEndpoint: ec2.InterfaceVpcEndpoint;
  private readonly videoEmbeddingService: ecs.FargateService;
  private readonly externalVideoEmbeddingEndpoint: string;
  constructor(scope: Construct, id: string, props: VideoSearchStackProps) {
    super(scope, id, props);

    this.externalVideoEmbeddingEndpoint = props.externalVideoEmbeddingEndpoint || '';
    const deploymentEnv = props.deploymentEnvironment || 'dev';

    // Initialize core infrastructure in correct order
    const { vpc, dynamodbEndpoint } = this.createVpcInfrastructure();
    this.vpc = vpc;
    this.dynamodbEndpoint = dynamodbEndpoint;
    this.videoBucket = this.createStorageInfrastructure(deploymentEnv);
    this.indexesTable = new dynamodb.Table(this, 'IndexesTable', {
      partitionKey: { name: 'indexId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'videoId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    this.videoProcessingQueue = this.createQueueInfrastructure();
    const { topic, rekognitionRole } = this.createRekognitionTopic();
    this.rekognitionTopic = topic;
    this.rekognitionRole = rekognitionRole;
    this.redisCluster = this.createCacheInfrastructure();
    this.cluster = this.createContainerInfrastructure();
    
    // Create OpenSearch collection
    this.openSearchCollection = this.createSearchInfrastructure(deploymentEnv);

    // Create video embedding service
    this.videoEmbeddingService = this.createVideoEmbeddingService();

    // Create Lambda functions after OpenSearch collection
    const lambdaFunctions = {
      videoUploadFunction: this.createVideoUploadFunction(),
      videoSliceFunction: this.createVideoSliceFunction(),
      videoSearchFunction: this.createVideoSearchFunction(),
      indexCrudFunction: this.crudIndexFunction()
    };

    // Add dependencies for the lambda functions on the video embedding service and open search collection
    lambdaFunctions.videoUploadFunction.videoUploadHandler.node.addDependency(this.videoEmbeddingService);
    lambdaFunctions.videoUploadFunction.videoUploadHandler.node.addDependency(this.openSearchCollection);
    lambdaFunctions.videoSliceFunction.node.addDependency(this.videoEmbeddingService);
    lambdaFunctions.videoSliceFunction.node.addDependency(this.openSearchCollection);
    lambdaFunctions.videoSearchFunction.node.addDependency(this.openSearchCollection);
    lambdaFunctions.indexCrudFunction.node.addDependency(this.openSearchCollection);

    // Update OpenSearch access policies with Lambda roles
    this.updateOpenSearchPolicies(deploymentEnv, lambdaFunctions);

    // Initialize API Gateway
    const api = this.createApiGateway(lambdaFunctions);

    // Set up permissions
    this.setupPermissions(lambdaFunctions, this.videoEmbeddingService, this.rekognitionTopic, this.indexesTable);

    // Create stack outputs
    this.createStackOutputs(api);
  }

  private createVpcInfrastructure(): { vpc: ec2.Vpc; dynamodbEndpoint: ec2.InterfaceVpcEndpoint } {
    const vpc = new ec2.Vpc(this, 'VideoSearchVPC', {
      maxAzs: 2,
      natGateways: 1,
      ipAddresses: ec2.IpAddresses.cidr('10.1.0.0/16'),  // Use different CIDR block
      subnetConfiguration: [
        {
          name: 'Public',  // For NAT Gateway
          subnetType: ec2.SubnetType.PUBLIC,
          cidrMask: 24,
        },
        {
          name: 'Private',  // For Lambda functions
          subnetType: ec2.SubnetType.PRIVATE_WITH_NAT,
          cidrMask: 24,
        },
        {
          name: 'Isolated',  // For Redis/ElastiCache
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
          cidrMask: 28,
        }
      ],
    });

    // Add VPC endpoints for AWS services
    vpc.addGatewayEndpoint('S3Endpoint', {
      service: ec2.GatewayVpcEndpointAwsService.S3,
    });

    // Add interface endpoints
    const interfaceEndpoints = [
      { name: 'SQSEndpoint', service: ec2.InterfaceVpcEndpointAwsService.SQS },
      { name: 'ECRDockerEndpoint', service: ec2.InterfaceVpcEndpointAwsService.ECR_DOCKER },
      { name: 'ECREndpoint', service: ec2.InterfaceVpcEndpointAwsService.ECR },
      { name: 'CloudWatchLogsEndpoint', service: ec2.InterfaceVpcEndpointAwsService.CLOUDWATCH_LOGS },
      { name: 'ElastiCacheEndpoint', service: ec2.InterfaceVpcEndpointAwsService.ELASTICACHE },
      { name: 'RekognitionEndpoint', service: ec2.InterfaceVpcEndpointAwsService.REKOGNITION },
    ];

    // Create all interface endpoints with consistent configuration
    interfaceEndpoints.forEach(({ name, service }) => {
      vpc.addInterfaceEndpoint(name, {
        service,
        privateDnsEnabled: true,
      });
    });

    // Add DynamoDB endpoint since Private DNS can't be enabled because the service com.amazonaws.<region>.dynamodb does not provide a privateDNS name
    const dynamodbEndpoint = vpc.addInterfaceEndpoint('DynamoDBEndpoint', {
      service: ec2.InterfaceVpcEndpointAwsService.DYNAMODB,
      privateDnsEnabled: false,
    });

    return { vpc, dynamodbEndpoint };
  }

  // Storage infrastructure can be critical in cost and operational complexity, configure all the parameters explicitly
  private createStorageInfrastructure(stage: string): s3.Bucket {
    return new s3.Bucket(this, 'VideoBucket', {
      bucketName: `video-search-${stage}-${this.region}`,
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

    // Allow HTTPS and HTTP from VPC
    vpcEndpointSG.addIngressRule(
      ec2.Peer.ipv4(this.vpc.vpcCidrBlock),
      ec2.Port.tcp(443),
      'Allow HTTPS from VPC'
    );

    vpcEndpointSG.addIngressRule(
      ec2.Peer.ipv4(this.vpc.vpcCidrBlock),
      ec2.Port.tcp(80),
      'Allow HTTP from VPC'
    );

    // Create VPC endpoint for OpenSearch
    const openSearchVpcEndpoint = new opensearchserverless.CfnVpcEndpoint(this, 'OpenSearchVpcEndpoint', {
      name: `video-search-endpoint-${stage}`,
      subnetIds: this.vpc.selectSubnets({
        subnetType: ec2.SubnetType.PRIVATE_ISOLATED
      }).subnetIds,
      vpcId: this.vpc.vpcId,
      securityGroupIds: [vpcEndpointSG.securityGroupId]
    });

    // Create encryption policy
    const encryptionPolicy = new opensearchserverless.CfnSecurityPolicy(this, 'VideoSearchEncryptionPolicy', {
      name: `video-search-encryption-${stage}`,
      type: 'encryption',
      policy: JSON.stringify({
        Rules: [{
          ResourceType: 'collection',
          Resource: [`collection/video-search-${stage}-knn`]
        }],
        AWSOwnedKey: true
      })
    });

    // Create network policy
    const networkPolicy = new opensearchserverless.CfnSecurityPolicy(this, 'VideoSearchNetworkPolicy', {
      name: `video-search-network-${stage}`,
      type: 'network',
      policy: JSON.stringify([{
        Rules: [{
          ResourceType: 'collection',
          Resource: [`collection/video-search-${stage}-knn`]
        }],
        AllowFromPublic: false,
        SourceVPCEs: [openSearchVpcEndpoint.attrId]
      }])
    });

    // Create collection
    const collection = new opensearchserverless.CfnCollection(this, 'VideoSearchCollection', {
      name: `video-search-${stage}-knn`,
      description: 'Collection for video search and analytics',
      type: 'VECTORSEARCH'
    });

    // Add dependencies
    collection.addDependency(encryptionPolicy);
    collection.addDependency(networkPolicy);
    collection.addDependency(openSearchVpcEndpoint);

    // Create initial data access policy
    const initialAccessPolicy = new opensearchserverless.CfnAccessPolicy(this, 'VideoSearchInitialAccessPolicy', {
      name: `video-search-initial-access-${stage}`,
      type: 'data',
      policy: JSON.stringify([{
        Rules: [{
          ResourceType: 'index',
          Resource: [
            `index/video-search-${stage}-knn/*`
          ],
          Permission: [
            'aoss:ReadDocument',
            'aoss:WriteDocument',
            'aoss:CreateIndex',
            'aoss:DeleteIndex',
            'aoss:UpdateIndex',
            'aoss:DescribeIndex'
          ]
        }],
        Principal: [
          `arn:aws:iam::${this.account}:root`
        ]
      }])
    });

    initialAccessPolicy.addDependency(collection);

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
      cacheSubnetGroupName: redisSubnetGroup.ref
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
      queueName: 'video-processing-dlq.fifo',
      retentionPeriod: cdk.Duration.days(14),
      fifo: true,
      contentBasedDeduplication: true
    });

    return new sqs.Queue(this, 'VideoProcessingQueue', {
      queueName: 'video-processing-queue.fifo',
      visibilityTimeout: cdk.Duration.minutes(15),
      retentionPeriod: cdk.Duration.days(14),
      fifo: true,
      contentBasedDeduplication: true,
      deadLetterQueue: {
        queue: dlq,
        maxReceiveCount: 3,
      },
    });
  }

  // Create FFmpeg layer for video slicing and video upload
  private ffmpegLayer = new lambda.LayerVersion(this, 'FFmpegLayer', {
    code: lambda.Code.fromAsset('src/layers/ffmpeg'),
    description: 'FFmpeg binaries for video processing',
    compatibleRuntimes: [lambda.Runtime.NODEJS_20_X],
    compatibleArchitectures: [lambda.Architecture.X86_64],
  });

  private createVideoUploadFunction(): { videoUploadHandler: lambda.Function; youtubeUploadHandler: lambda.Function } {
    // Create the Lambda security group with proper egress and ingress rules
    const lambdaSG = new ec2.SecurityGroup(this, 'LambdaSecurityGroupVideoUpload', {
      vpc: this.vpc,
      description: 'Security group for Lambdas accessing OpenSearch via VPC endpoint',
      allowAllOutbound: true,
    });

    // Allow outbound connections to HTTP and HTTPS (already needed)
    lambdaSG.addEgressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), 'Allow HTTPS outbound');
    lambdaSG.addEgressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), 'Allow HTTP outbound');

    // Now add ingress rules to allow incoming traffic on HTTP and HTTPS (needed for VPC endpoint access)
    lambdaSG.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), 'Allow HTTPS inbound');
    lambdaSG.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), 'Allow HTTP inbound');

    // Extract just the DNS name part by splitting at ':' and selecting the second part, to remove DNS zone ID prefix 
    const dynamoDbEndpointDns = cdk.Fn.select(
      1, 
      cdk.Fn.split(
        ':', 
        cdk.Fn.select(0, this.dynamodbEndpoint.vpcEndpointDnsEntries)
      )
    );

    // Assemble to valid endpoint URL
    const dynamoDbEndpointDnsHttp = `https://${dynamoDbEndpointDns}`;

    const commonLambdaProps = {
      runtime: lambda.Runtime.NODEJS_20_X,
      vpc: this.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups: [lambdaSG],
      timeout: cdk.Duration.minutes(15),
      environment: {
        VIDEO_BUCKET: this.videoBucket.bucketName,
        // QUEUE_URL: this.videoProcessingQueue.queueUrl,
        OPENSEARCH_ENDPOINT: `https://${this.openSearchCollection.attrId}.${this.region}.aoss.amazonaws.com`,
        REDIS_ENDPOINT: this.redisCluster.attrRedisEndpointAddress,
        INDEXES_TABLE: this.indexesTable.tableName,
        // Explicitly specify the DynamoDB endpoint since Private DNS can't be enabled because the service com.amazonaws.<region>.dynamodb does not provide a privateDNS name. Use Fn.select to properly extract the first DNS entry from the list
        INDEXES_TABLE_DYNAMODB_DNS_NAME: dynamoDbEndpointDnsHttp,
        EXTERNAL_EMBEDDING_ENDPOINT: this.externalVideoEmbeddingEndpoint || '',
      },
      bundling: {
        minify: true,
        sourceMap: true,
        target: 'node20',
        format: nodejslambda.OutputFormat.CJS,
        esbuild: {
          bundle: true,
          platform: 'node'
        }
      }
    };

    // Create yt-dlp layer
    const ytDlpLayer = new lambda.LayerVersion(this, 'YtDlpLayer', {
      code: lambda.Code.fromAsset('src/layers/yt-dlp'),
      description: 'yt-dlp binary for downloading YouTube videos',
      compatibleRuntimes: [lambda.Runtime.NODEJS_20_X],
      compatibleArchitectures: [lambda.Architecture.X86_64],
    });

    const videoUploadHandler = new nodejslambda.NodejsFunction(this, 'VideoUploadHandler', {
      ...commonLambdaProps,
      entry: 'src/lambdas/video-upload/index.ts',
      handler: 'handler',
      memorySize: 4096,
      // Add the FFmpeg layer
      layers: [this.ffmpegLayer],
      depsLockFilePath: 'src/lambdas/video-upload/package-lock.json'
    });

    const youtubeUploadHandler = new nodejslambda.NodejsFunction(this, 'YouTubeUploadHandler', {
      ...commonLambdaProps,
      entry: 'src/lambdas/video-upload/youtube.ts',
      handler: 'handler',
      memorySize: 4096,
      timeout: cdk.Duration.minutes(15), // Longer timeout for YouTube downloads
      environment: {
        ...commonLambdaProps.environment,
        TEMP_PATH: '/tmp' // Temp directory for YouTube downloads
      },
      layers: [ytDlpLayer], // Add the yt-dlp layer
      depsLockFilePath: 'src/lambdas/video-upload/package-lock.json'
    });

    return { videoUploadHandler, youtubeUploadHandler };
  }

  private createVideoSliceFunction(): lambda.Function {
    // Create the Lambda security group with proper egress and ingress rules
    const lambdaSG = new ec2.SecurityGroup(this, 'LambdaSecurityGroupVideoSlice', {
      vpc: this.vpc,
      description: 'Security group for Lambdas accessing OpenSearch via VPC endpoint',
      allowAllOutbound: true,
    });

    // Allow outbound connections to HTTP and HTTPS (already needed)
    lambdaSG.addEgressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), 'Allow HTTPS outbound');
    lambdaSG.addEgressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), 'Allow HTTP outbound');

    // Now add ingress rules to allow incoming traffic on HTTP and HTTPS (needed for VPC endpoint access)
    lambdaSG.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), 'Allow HTTPS inbound');
    lambdaSG.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), 'Allow HTTP inbound');

    // Extract just the DNS name part by splitting at ':' and selecting the second part, to remove DNS zone ID prefix 
    const dynamoDbEndpointDns = cdk.Fn.select(
      1, 
      cdk.Fn.split(
        ':', 
        cdk.Fn.select(0, this.dynamodbEndpoint.vpcEndpointDnsEntries)
      )
    );

    // Assemble to valid endpoint URL
    const dynamoDbEndpointDnsHttp = `https://${dynamoDbEndpointDns}`;

    const commonLambdaProps = {
      runtime: lambda.Runtime.NODEJS_20_X,
      vpc: this.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups: [lambdaSG],
      timeout: cdk.Duration.minutes(15),
      environment: {
        VIDEO_BUCKET: this.videoBucket.bucketName,
        VIDEO_SLICING_QUEUE_URL: this.videoProcessingQueue.queueUrl,
        SNS_TOPIC_ARN: this.rekognitionTopic.topicArn,
        REKOGNITION_ROLE_ARN: this.rekognitionRole.roleArn,
        OPENSEARCH_ENDPOINT: `https://${this.openSearchCollection.attrId}.${this.region}.aoss.amazonaws.com`,
        REDIS_ENDPOINT: this.redisCluster.attrRedisEndpointAddress,
        INDEXES_TABLE: this.indexesTable.tableName,
        INDEXES_TABLE_DYNAMODB_DNS_NAME: dynamoDbEndpointDnsHttp,
        EMBEDDING_SERVICE_URL: this.videoEmbeddingService.serviceName,
        EXTERNAL_EMBEDDING_ENDPOINT: this.externalVideoEmbeddingEndpoint || '',
      },
      bundling: {
        minify: true,
        sourceMap: true,
        target: 'node20',
        format: nodejslambda.OutputFormat.CJS,
        esbuild: {
          bundle: true,
          platform: 'node'
        }
      }
    };

    const videoSliceFunctionHandler = new nodejslambda.NodejsFunction(this, 'VideoSliceFunction', {
      ...commonLambdaProps,
      entry: 'src/lambdas/video-slice/index.ts',
      handler: 'handler',
      memorySize: 4096,
      // Add the FFmpeg layer
      layers: [this.ffmpegLayer],
      depsLockFilePath: 'src/lambdas/video-slice/package-lock.json'
    });

    // Add event source from the video processing queue, set the batch size to 1, MaximumBatchingWindowInSeconds to 10 seconds
    videoSliceFunctionHandler.addEventSource(new SqsEventSource(this.videoProcessingQueue, {
      batchSize: 1,
      // Don't wait to accumulate messages
      // maxBatchingWindow: cdk.Duration.seconds(0),
      // Report batch item failures, refer to https://docs.aws.amazon.com/lambda/latest/dg/services-sqs-errorhandling.html#services-sqs-batchfailurereporting
      reportBatchItemFailures: true
    }));

    // Add event source from sns topic
    videoSliceFunctionHandler.addEventSource(new SnsEventSource(this.rekognitionTopic));

    // Add event source from s3 bucket
    videoSliceFunctionHandler.addEventSource(new S3EventSource(this.videoBucket, {
      events: [s3.EventType.OBJECT_CREATED],
      // Align with backend video-upload lambda
      filters: [
        { prefix: 'RawVideos/' }
      ]
    }));

    return videoSliceFunctionHandler;
  }

  private createVideoSearchFunction(): lambda.Function {
    // Create the Lambda security group with proper egress and ingress rules
    const lambdaSG = new ec2.SecurityGroup(this, 'LambdaSecurityGroupVideoSearch', {
      vpc: this.vpc,
      description: 'Security group for Lambdas accessing OpenSearch via VPC endpoint',
      allowAllOutbound: true,
    });

    // Allow outbound connections to HTTP and HTTPS (already needed)
    lambdaSG.addEgressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), 'Allow HTTPS outbound');
    lambdaSG.addEgressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), 'Allow HTTP outbound');

    // Now add ingress rules to allow incoming traffic on HTTP and HTTPS (needed for VPC endpoint access)
    lambdaSG.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), 'Allow HTTPS inbound');
    lambdaSG.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), 'Allow HTTP inbound');

    // Extract just the DNS name part by splitting at ':' and selecting the second part, to remove DNS zone ID prefix 
    const dynamoDbEndpointDns = cdk.Fn.select(
      1, 
      cdk.Fn.split(
        ':', 
        cdk.Fn.select(0, this.dynamodbEndpoint.vpcEndpointDnsEntries)
      )
    );

    // Assemble to valid endpoint URL
    const dynamoDbEndpointDnsHttp = `https://${dynamoDbEndpointDns}`;

    const commonLambdaProps = {
      runtime: lambda.Runtime.NODEJS_20_X,
      vpc: this.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups: [lambdaSG],
      timeout: cdk.Duration.minutes(15),
      environment: {
        VIDEO_BUCKET: this.videoBucket.bucketName,
        // QUEUE_URL: this.videoProcessingQueue.queueUrl,
        OPENSEARCH_ENDPOINT: `https://${this.openSearchCollection.attrId}.${this.region}.aoss.amazonaws.com`,
        REDIS_ENDPOINT: this.redisCluster.attrRedisEndpointAddress,
        INDEXES_TABLE: this.indexesTable.tableName,
        // Explicitly specify the DynamoDB endpoint since Private DNS can't be enabled because the service com.amazonaws.<region>.dynamodb does not provide a privateDNS name. Use Fn.select to properly extract the first DNS entry from the list
        INDEXES_TABLE_DYNAMODB_DNS_NAME: dynamoDbEndpointDnsHttp,
        EXTERNAL_EMBEDDING_ENDPOINT: this.externalVideoEmbeddingEndpoint || '',
      },
      bundling: {
        // Minify the code to reduce bundle size
        minify: true,
        // Generate source maps for better debugging
        sourceMap: true,
        // Target Node.js 20.x runtime
        target: 'node20',
        // Use CommonJS module format for Node.js compatibility
        format: nodejslambda.OutputFormat.CJS,
        esbuild: {
          // Bundle all dependencies into a single file
          bundle: true,
          // Specify Node.js as the platform
          platform: 'node'
        }
      }
    };

    const videoSearchHandler = new nodejslambda.NodejsFunction(this, 'VideoSearchHandler', {
      ...commonLambdaProps,
      entry: 'src/lambdas/video-search/index.ts',
      handler: 'index.handler',
      memorySize: 2048,
      depsLockFilePath: 'src/lambdas/video-search/package-lock.json'
    });

    return videoSearchHandler;
  }

  private crudIndexFunction() {
    // Create the Lambda security group with proper egress and ingress rules
    const lambdaSG = new ec2.SecurityGroup(this, 'LambdaSecurityGroupCreateIndex', {
      vpc: this.vpc,
      description: 'Security group for Lambdas accessing OpenSearch via VPC endpoint',
      allowAllOutbound: true,
    });

    // Allow outbound connections to HTTP and HTTPS (already needed)
    lambdaSG.addEgressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), 'Allow HTTPS outbound');
    lambdaSG.addEgressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), 'Allow HTTP outbound');

    // Now add ingress rules to allow incoming traffic on HTTP and HTTPS (needed for VPC endpoint access)
    lambdaSG.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), 'Allow HTTPS inbound');
    lambdaSG.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), 'Allow HTTP inbound');

    // Extract just the DNS name part by splitting at ':' and selecting the second part, to remove DNS zone ID prefix 
    const dynamoDbEndpointDns = cdk.Fn.select(
      1, 
      cdk.Fn.split(
        ':', 
        cdk.Fn.select(0, this.dynamodbEndpoint.vpcEndpointDnsEntries)
      )
    );

    // Assemble to valid endpoint URL
    const dynamoDbEndpointDnsHttp = `https://${dynamoDbEndpointDns}`;

    const commonLambdaProps = {
      runtime: lambda.Runtime.NODEJS_20_X,
      vpc: this.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups: [lambdaSG],
      timeout: cdk.Duration.minutes(15),
      environment: {
        VIDEO_BUCKET: this.videoBucket.bucketName,
        // QUEUE_URL: this.videoProcessingQueue.queueUrl,
        OPENSEARCH_ENDPOINT: `https://${this.openSearchCollection.attrId}.${this.region}.aoss.amazonaws.com`,
        INDEXES_TABLE: this.indexesTable.tableName,
        // Explicitly specify the DynamoDB endpoint since Private DNS can't be enabled because the service com.amazonaws.<region>.dynamodb does not provide a privateDNS name. Use Fn.select to properly extract the first DNS entry from the list
        INDEXES_TABLE_DYNAMODB_DNS_NAME: dynamoDbEndpointDnsHttp,
      },
      bundling: {
        minify: true,
        sourceMap: true,
        target: 'node20',
        format: nodejslambda.OutputFormat.CJS,
        esbuild: {
          bundle: true,
          platform: 'node'
        }
      }
    };

    const crudIndexHandler = new nodejslambda.NodejsFunction(this, 'crudIndexHandler', {
      ...commonLambdaProps,
      entry: 'src/lambdas/index-ops/index.ts',
      handler: 'index.handler',
      memorySize: 2048,
      depsLockFilePath: 'src/lambdas/index-ops/package-lock.json'
    });

    return crudIndexHandler;
  }

  private createTextEmbeddingService(): ecs.FargateService {
    // Create task definition with increased resources for ML workload
    const taskDefinition = new ecs.FargateTaskDefinition(this, 'EmbeddingTaskDef', {
      memoryLimitMiB: 8192, // 8GB memory for ML model
      cpu: 4096, // 4 vCPU
    });

    // Add execution role permissions for ECR and CloudWatch Logs
    taskDefinition.addToExecutionRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'ecr:GetAuthorizationToken',
          'ecr:BatchCheckLayerAvailability',
          'ecr:GetDownloadUrlForLayer',
          'ecr:BatchGetImage',
          'ecr:*',
          'logs:CreateLogStream',
          'logs:PutLogEvents'
        ],
        resources: ['*']
      })
    );

    // Create security group for the service
    const embeddingServiceSG = new ec2.SecurityGroup(this, 'EmbeddingServiceSG', {
      vpc: this.vpc,
      description: 'Security group for embedding service',
      allowAllOutbound: true,
    });

    // Allow inbound traffic on service port
    embeddingServiceSG.addIngressRule(
      ec2.Peer.ipv4(this.vpc.vpcCidrBlock),
      ec2.Port.tcp(8000),
      'Allow inbound from VPC'
    );

    // Add container to task definition
    const container = taskDefinition.addContainer('EmbeddingContainer', {
      image: ecs.ContainerImage.fromAsset('src/containers/bge-embedding'),
      logging: new ecs.AwsLogDriver({
        streamPrefix: 'embedding-service',
        logRetention: logs.RetentionDays.ONE_WEEK,
        mode: ecs.AwsLogDriverMode.NON_BLOCKING
      }),
      environment: {
        VIDEO_BUCKET: this.videoBucket.bucketName,
        OPENSEARCH_ENDPOINT: `https://${this.openSearchCollection.attrId}.${this.region}.aoss.amazonaws.com`,
        AWS_REGION: this.region,
        PORT: '8000',
        HOST: '0.0.0.0',
        WORKERS: '1',
        MODEL_PATH: '/app/models/bce-embedding-base_v1'
      },
      healthCheck: {
        command: [
          'CMD-SHELL',
          'curl -f http://localhost:8000/health || exit 1'
        ],
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(10),
        retries: 3,
        startPeriod: cdk.Duration.seconds(120)  // Give more time for model loading
      },
      linuxParameters: new ecs.LinuxParameters(this, 'LinuxParams', {
        initProcessEnabled: true,
      })
    });

    // Add port mappings
    container.addPortMappings({
      containerPort: 8000,
      protocol: ecs.Protocol.TCP,
      hostPort: 8000
    });

    // Create service
    const service = new ecs.FargateService(this, 'EmbeddingService', {
      cluster: this.cluster,
      taskDefinition,
      desiredCount: 1, // Start with 1 task for initial deployment
      minHealthyPercent: 100,
      maxHealthyPercent: 200,
      assignPublicIp: false,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      securityGroups: [embeddingServiceSG],
      capacityProviderStrategies: [
        {
          capacityProvider: 'FARGATE',  // Use regular FARGATE for stability
          weight: 1
        }
      ],
      circuitBreaker: { rollback: true },
      enableExecuteCommand: true, // Enable ECS Exec for debugging
      healthCheckGracePeriod: cdk.Duration.seconds(120) // Give more time for health checks
    });

    return service;
  }

  private createVideoEmbeddingService(): ecs.FargateService {
    // Create task definition with increased resources for ML workload
    const taskDefinition = new ecs.FargateTaskDefinition(this, 'VideoEmbeddingTaskDef', {
      memoryLimitMiB: 16384, // 16GB memory for video model
      cpu: 4096, // 4 vCPU
      ephemeralStorageGiB: 50 // Add 50GB ephemeral storage
    });

    // Add execution role permissions for ECR and CloudWatch Logs
    taskDefinition.addToExecutionRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'ecr:GetAuthorizationToken',
          'ecr:BatchCheckLayerAvailability',
          'ecr:GetDownloadUrlForLayer',
          'ecr:BatchGetImage',
          'ecr:*',
          'logs:CreateLogStream',
          'logs:PutLogEvents'
        ],
        resources: ['*']
      })
    );

    // Create security group for the service
    const videoEmbeddingServiceSG = new ec2.SecurityGroup(this, 'VideoEmbeddingServiceSG', {
      vpc: this.vpc,
      description: 'Security group for video embedding service',
      allowAllOutbound: true,
    });

    // Allow inbound traffic on service port
    videoEmbeddingServiceSG.addIngressRule(ec2.Peer.ipv4(this.vpc.vpcCidrBlock), ec2.Port.tcp(8001), 'Allow inbound from VPC');
    
    // Now add ingress rules to allow incoming traffic on HTTP and HTTPS (needed for VPC endpoint access)
    videoEmbeddingServiceSG.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), 'Allow HTTPS inbound');
    videoEmbeddingServiceSG.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), 'Allow HTTP inbound');
    
    // Allow outbound connections to HTTP and HTTPS (already needed)
    videoEmbeddingServiceSG.addEgressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), 'Allow HTTPS outbound');
    videoEmbeddingServiceSG.addEgressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), 'Allow HTTP outbound');

    // Add container to task definition
    const container = taskDefinition.addContainer('VideoEmbeddingContainer', {
      image: ecs.ContainerImage.fromAsset('src/containers/qwen-embedding'),
      logging: new ecs.AwsLogDriver({
        streamPrefix: 'video-embedding-service',
        logRetention: logs.RetentionDays.ONE_WEEK,
        mode: ecs.AwsLogDriverMode.NON_BLOCKING
      }),
      environment: {
        VIDEO_BUCKET: this.videoBucket.bucketName,
        OPENSEARCH_ENDPOINT: `https://${this.openSearchCollection.attrId}.${this.region}.aoss.amazonaws.com`,
        AWS_REGION: this.region,
        PORT: '8001',
        HOST: '0.0.0.0',
        WORKERS: '1',
        MODEL_PATH: '/app/models/videoclip'
      },
      // healthCheck: {
      //   command: [
      //     'CMD-SHELL',
      //     'curl -f http://localhost:8001/health || exit 1'
      //   ],
      //   interval: cdk.Duration.seconds(30),
      //   timeout: cdk.Duration.seconds(10),
      //   retries: 3,
      //   startPeriod: cdk.Duration.seconds(180)  // Give more time for video model loading
      // },
      linuxParameters: new ecs.LinuxParameters(this, 'VideoLinuxParams', {
        initProcessEnabled: true,
      })
    });

    // Add port mappings
    container.addPortMappings({
      containerPort: 8001,
      protocol: ecs.Protocol.TCP,
      hostPort: 8001
    });

    // Create service
    const service = new ecs.FargateService(this, 'VideoEmbeddingService', {
      cluster: this.cluster,
      taskDefinition,
      desiredCount: 1, // Start with 1 task for initial deployment
      minHealthyPercent: 100,
      maxHealthyPercent: 200,
      assignPublicIp: false,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      securityGroups: [videoEmbeddingServiceSG],
      capacityProviderStrategies: [
        {
          capacityProvider: 'FARGATE',  // Use regular FARGATE for stability
          weight: 1
        }
      ],
      circuitBreaker: { rollback: true },
      enableExecuteCommand: true, // Enable ECS Exec for debugging
      healthCheckGracePeriod: cdk.Duration.seconds(180) // Give more time for health checks
    });

    return service;
  }

  private createApiGateway(lambdaFunctions: {
    videoUploadFunction: { videoUploadHandler: lambda.Function; youtubeUploadHandler: lambda.Function };
    videoSliceFunction: lambda.Function;
    videoSearchFunction: lambda.Function;
    indexCrudFunction: lambda.Function;
  }): apigateway.RestApi {
    // Create API Gateway
    const api = new apigateway.RestApi(this, 'VideoSearchApi', {
      restApiName: 'Video Search Service',
      description: 'Video Search API for uploading, slicing, and searching videos',
      deploy: true,
      deployOptions: {
        stageName: 'prod',
        tracingEnabled: true,
      },
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: [
          'Content-Type',
          'X-Amz-Date',
          'Authorization',
          'X-Api-Key',
          'X-Amz-Security-Token',
        ],
        maxAge: cdk.Duration.seconds(600)
      },
    });

    // API Gateway Path:
    // Fixed index "videos"
    // /videos/upload                         POST - Start upload
    // /videos/upload/{videoId}/complete      POST - Complete upload
    // /videos/youtube                        POST - YouTube upload
    // /videos/?index={indexId} or /videos/   GET  - Get specific video details or all videos
    // /videos/?index={indexId}?videoId={videoId} or /videos/?index={indexId}   DELETE - Delete specific video or all videos under index
    
    // /videos/status/?index={indexId}        GET  - Check status, uploading, slicing, indexing, completed, failed
    // /videos/search                         POST - Search videos

    // Dynamic index management

    // /indexes/{indexId}                     GET - Get index details or delete index, including query status, search options, upload status
    // /indexes/{indexId}                     POST - Create index and upload videos to specific index
    // /indexes/{indexId}                     DELETE - Delete index

    const videos = api.root.addResource('videos');
    
    const upload = videos.addResource('upload');
    const uploadComplete = upload.addResource('{uploadId}').addResource('complete');
    const youtube = videos.addResource('youtube');

    const search = api.root.addResource('search');
    const status = videos.addResource('status');
    const videoStatus = status.addResource('{videoId}');

    const indexes = api.root.addResource('indexes');
    const index = indexes.addResource('{indexId}');

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

    // Add endpoints
    addMethodWithCors(videos, 'GET', lambdaFunctions.videoUploadFunction.videoUploadHandler);
    addMethodWithCors(videos, 'DELETE', lambdaFunctions.videoUploadFunction.videoUploadHandler);
    addMethodWithCors(upload, 'POST', lambdaFunctions.videoUploadFunction.videoUploadHandler);
    addMethodWithCors(uploadComplete, 'POST', lambdaFunctions.videoUploadFunction.videoUploadHandler);
    addMethodWithCors(youtube, 'POST', lambdaFunctions.videoUploadFunction.youtubeUploadHandler);

    addMethodWithCors(status, 'GET', lambdaFunctions.videoUploadFunction.videoUploadHandler);
    addMethodWithCors(videoStatus, 'GET', lambdaFunctions.videoSliceFunction);

    addMethodWithCors(search, 'POST', lambdaFunctions.videoSearchFunction);

    addMethodWithCors(indexes, 'GET', lambdaFunctions.indexCrudFunction);
    addMethodWithCors(index, 'GET', lambdaFunctions.indexCrudFunction);
    addMethodWithCors(index, 'DELETE', lambdaFunctions.indexCrudFunction);
    addMethodWithCors(index, 'POST', lambdaFunctions.indexCrudFunction);

    return api;
  }

  private setupPermissions(
    lambdaFunctions: {
      videoUploadFunction: { videoUploadHandler: lambda.Function; youtubeUploadHandler: lambda.Function };
      videoSliceFunction: lambda.Function;
      videoSearchFunction: lambda.Function;
      indexCrudFunction: lambda.Function;
    },
    // textEmbeddingService: ecs.FargateService,
    videoEmbeddingService: ecs.FargateService,
    // queue: sqs.Queue
    snsTopic: sns.Topic,
    indexesTable: dynamodb.Table
  ) {
    // S3 permissions
    this.videoBucket.grantReadWrite(lambdaFunctions.videoUploadFunction.videoUploadHandler);
    this.videoBucket.grantRead(lambdaFunctions.videoSearchFunction);
    this.videoBucket.grantReadWrite(lambdaFunctions.videoSliceFunction);
    this.videoBucket.grantReadWrite(lambdaFunctions.indexCrudFunction);
    // Grant permissions to embedding services to access S3
    this.videoBucket.grantRead(videoEmbeddingService.taskDefinition.taskRole);
 
    // SQS permissions
    // queue.grantSendMessages(lambdaFunctions.videoUploadFunction.videoUploadHandler);
    // queue.grantConsumeMessages(lambdaFunctions.videoSliceFunction);
    
    // Grant SQS send message permissions to videoSliceFunction
    this.videoProcessingQueue.grantSendMessages(lambdaFunctions.videoSliceFunction);

    // SNS permissions for Rekognition notifications subscription
    snsTopic.grantSubscribe(lambdaFunctions.videoSliceFunction);

    // OpenSearch Serverless permissions
    const openSearchPolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'aoss:APIAccessAll',
        'aoss:CreateCollection',
        'aoss:ListCollections',
        'aoss:GetCollection',
        'aoss:BatchGetCollection',
        'aoss:UpdateCollection',
        'aoss:DeleteCollection',
        'aoss:CreateAccessPolicy',
        'aoss:CreateSecurityPolicy',
        'aoss:UpdateSecurityPolicy',
        'aoss:GetSecurityPolicy',
        'aoss:CreateAccessPolicy',
        'aoss:GetAccessPolicy',
        'aoss:UpdateAccessPolicy',
        'es:ESHttp*'  // Add full HTTP access
      ],
      resources: [
        `arn:aws:aoss:${this.region}:${this.account}:collection/*`,
        `arn:aws:aoss:${this.region}:${this.account}:security-policy/*`,
        `arn:aws:aoss:${this.region}:${this.account}:access-policy/*`
      ]
    });

    const openSearchReadOnlyPolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        // All readonly actions
        'aoss:APIAccessAll',
        'aoss:DescribeCollection',
        'aoss:ListCollections',
        'aoss:GetCollection',
        'aoss:BatchGetCollection',
        'aoss:GetSecurityPolicy',
        'aoss:GetAccessPolicy',
        'es:ESHttp*'
      ],
      resources: [
        `arn:aws:aoss:${this.region}:${this.account}:collection/${this.openSearchCollection.attrId}`
      ]
    });

    // Add policies to Lambda roles
    lambdaFunctions.videoUploadFunction.videoUploadHandler.addToRolePolicy(openSearchPolicy);
    lambdaFunctions.videoSliceFunction.addToRolePolicy(openSearchPolicy);
    lambdaFunctions.videoSearchFunction.addToRolePolicy(openSearchPolicy);
    lambdaFunctions.indexCrudFunction.addToRolePolicy(openSearchPolicy);

    // Grant permissions to embedding services to access OpenSearch
    // textEmbeddingService.taskDefinition.addToTaskRolePolicy(openSearchPolicy);
    videoEmbeddingService.taskDefinition.addToTaskRolePolicy(openSearchPolicy);

    // Grant Rekognition permissions to video slice function
    const rekognitionPolicy = new iam.PolicyStatement({
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

    // Add PassRole permission for Rekognition
    const passRolePolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['iam:PassRole'],
      resources: [this.rekognitionRole.roleArn],
      conditions: {
        StringLike: {
          'iam:PassedToService': 'rekognition.amazonaws.com'
        }
      }
    });

    lambdaFunctions.videoSliceFunction.addToRolePolicy(rekognitionPolicy);
    lambdaFunctions.videoSliceFunction.addToRolePolicy(passRolePolicy);

    // Grant DynamoDB permissions
    indexesTable.grantReadWriteData(lambdaFunctions.videoUploadFunction.videoUploadHandler);
    indexesTable.grantReadWriteData(lambdaFunctions.videoUploadFunction.youtubeUploadHandler);
    indexesTable.grantReadWriteData(lambdaFunctions.videoSliceFunction);
    indexesTable.grantReadWriteData(lambdaFunctions.indexCrudFunction);
    indexesTable.grantReadData(lambdaFunctions.videoSearchFunction);
  }

  private createMonitoringInfrastructure(
    lambdaFunctions: {
      videoUploadFunction: { videoUploadHandler: lambda.Function; youtubeUploadHandler: lambda.Function };
      videoSliceFunction: lambda.Function;
      videoSearchFunction: lambda.Function;
    },
    textEmbeddingService: ecs.FargateService,
    videoEmbeddingService: ecs.FargateService
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

  private updateOpenSearchPolicies(stage: string, lambdaFunctions: {
    videoUploadFunction: { videoUploadHandler: lambda.Function; youtubeUploadHandler: lambda.Function };
    videoSliceFunction: lambda.Function;
    videoSearchFunction: lambda.Function;
  }) {
    // Update data access policy to include Lambda roles
    const lambdaAccessPolicy = new opensearchserverless.CfnAccessPolicy(this, 'VideoSearchLambdaAccessPolicy', {
      name: `video-search-lambda-access-${stage}`,
      type: 'data',
      policy: JSON.stringify([{
        Rules: [{
          ResourceType: 'index',
          Resource: [
            `index/video-search-${stage}-knn/*`
          ],
          Permission: [
            'aoss:ReadDocument',
            'aoss:WriteDocument',
            'aoss:CreateIndex',
            'aoss:DeleteIndex',
            'aoss:UpdateIndex',
            'aoss:DescribeIndex'
          ]
        }],
        Principal: [
          lambdaFunctions.videoUploadFunction.videoUploadHandler.role?.roleArn || '',
          lambdaFunctions.videoSliceFunction.role?.roleArn || '',
          lambdaFunctions.videoSearchFunction.role?.roleArn || ''
        ].filter(Boolean)
      }])
    });

    lambdaAccessPolicy.addDependency(this.openSearchCollection);
  }

  private createRekognitionTopic(): { topic: sns.Topic; rekognitionRole: iam.Role } {
    // Create SNS topic for Rekognition notifications
    const topic = new sns.Topic(this, 'RekognitionTopic', {
      displayName: 'Video Processing Notifications',
    });

    // Create SQS queue for processing Rekognition notifications
    const dlq = new sqs.Queue(this, 'RekognitionDLQ', {
      queueName: `${this.stackName}-rekognition-dlq`,
    });

    const queue = new sqs.Queue(this, 'RekognitionQueue', {
      queueName: `${this.stackName}-rekognition-notifications`,
      deadLetterQueue: {
        queue: dlq,
        maxReceiveCount: 3,
      },
    });

    // IAM role that gives Amazon Rekognition publishing permissions to the Amazon SNS topic
    const rekognitionRole = new iam.Role(this, 'RekognitionRole', {
      assumedBy: new iam.ServicePrincipal('rekognition.amazonaws.com'),
    });

    // Subscribe the queue to the SNS topic
    topic.addSubscription(new sns_subs.SqsSubscription(queue));

    // Grant Rekognition permission to publish to the topic
    topic.grantPublish(rekognitionRole);

    return { topic, rekognitionRole };
  }
}
