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
import * as cognito from 'aws-cdk-lib/aws-cognito';
import { Construct } from 'constructs';
import * as cr from 'aws-cdk-lib/custom-resources';
import * as nodejslambda from 'aws-cdk-lib/aws-lambda-nodejs';
import { S3EventSource, SnsEventSource, SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { S3ConnectorStack } from './s3-connector-stack';
import { VideoUnderstandingStack } from './video-understanding-stack';
import { StrandsAgentConstruct } from './strands-agent-stack';
import { AdsAssetTagsTable } from './ads-asset-tags-table';

interface VideoSearchStackProps extends cdk.StackProps {
  maxAzs: number;
  deploymentEnvironment?: string;
  siliconflowApiKey?: string;
  appDomain?: string;
  googleApiKey?: string;
  validationModel?: string;
}

export class VideoSearchStack extends cdk.Stack {
  private readonly vpc: ec2.Vpc;
  private readonly videoBucket: s3.Bucket;
  private readonly videoProcessingQueue: sqs.Queue;
  private readonly videoMergeQueue: sqs.Queue;
  private readonly mergeJobsTable: dynamodb.Table;
  private readonly rekognitionTopic: sns.Topic;
  private readonly rekognitionRole: iam.Role;
  private readonly redisCluster: elasticache.CfnCacheCluster;
  private readonly cluster: ecs.Cluster;
  private readonly openSearchCollection: opensearchserverless.CfnCollection;
  private readonly indexesTable: dynamodb.Table;
  private readonly dynamodbEndpoint: ec2.InterfaceVpcEndpoint;
  private readonly siliconflowApiKey?: string;
  private readonly googleApiKey?: string;
  private readonly validationModel?: string;
  private readonly appDomain?: string;
  private readonly userPool: cognito.UserPool;
  private readonly userPoolClient: cognito.UserPoolClient;
  private readonly identityPool: cognito.CfnIdentityPool;
  private readonly s3ConnectorStack?: S3ConnectorStack;
  private readonly videoUnderstandingStack?: VideoUnderstandingStack;
  private readonly strandsAgentConstruct?: StrandsAgentConstruct;
  private readonly adsAssetTagsTable: AdsAssetTagsTable;
  constructor(scope: Construct, id: string, props: VideoSearchStackProps) {
    super(scope, id, props);

    this.siliconflowApiKey = props.siliconflowApiKey || '';
    this.googleApiKey = props.googleApiKey || '';
    this.validationModel = props.validationModel || '';
    this.appDomain = props.appDomain;
    const deploymentEnv = props.deploymentEnvironment || 'dev';

    // Initialize core infrastructure in correct order
    const { vpc, dynamodbEndpoint } = this.createVpcInfrastructure();
    this.vpc = vpc;
    this.dynamodbEndpoint = dynamodbEndpoint;
    this.videoBucket = this.createStorageInfrastructure(deploymentEnv);
    
    // Create Cognito resources for authentication
    const { userPool, userPoolClient, identityPool } = this.createCognitoResources(deploymentEnv);
    this.userPool = userPool;
    this.userPoolClient = userPoolClient;
    this.identityPool = identityPool;
    this.indexesTable = new dynamodb.Table(this, 'IndexesTable', {
      partitionKey: { name: 'indexId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'videoId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    this.videoProcessingQueue = this.createQueueInfrastructure();
    this.videoMergeQueue = this.createVideoMergeQueue();
    this.mergeJobsTable = this.createMergeJobsTable();
    
    const { topic, rekognitionRole } = this.createRekognitionTopic();
    this.rekognitionTopic = topic;
    this.rekognitionRole = rekognitionRole;
    this.redisCluster = this.createCacheInfrastructure();
    this.cluster = this.createContainerInfrastructure();
    
    // Create OpenSearch collection
    this.openSearchCollection = this.createSearchInfrastructure(deploymentEnv);

    // Create Ads Asset Tags table
    this.adsAssetTagsTable = new AdsAssetTagsTable(this, 'AdsAssetTags');

    // Create Lambda functions after OpenSearch collection
    const lambdaFunctions = {
      videoUploadFunction: this.createVideoUploadFunction(),
      videoSliceFunction: this.createVideoSliceFunction(),
      videoSearchFunction: this.createVideoSearchFunction(),
      indexCrudFunction: this.crudIndexFunction(),
      videoMergeFunction: this.createVideoMergeFunction(),
      adsTaggingFunction: this.createAdsTaggingFunction(),
      autoClipsFunction: this.createAutoClipsFunction(),
    };

    // Add dependencies for the lambda functions on the OpenSearch collection
    lambdaFunctions.videoUploadFunction.videoUploadHandler.node.addDependency(this.openSearchCollection);
    lambdaFunctions.videoSliceFunction.node.addDependency(this.openSearchCollection);
    lambdaFunctions.videoSearchFunction.node.addDependency(this.openSearchCollection);
    lambdaFunctions.indexCrudFunction.node.addDependency(this.openSearchCollection);
    lambdaFunctions.videoMergeFunction.node.addDependency(this.openSearchCollection);
    lambdaFunctions.adsTaggingFunction.node.addDependency(this.openSearchCollection);
    lambdaFunctions.autoClipsFunction.node.addDependency(this.openSearchCollection);

    // Update OpenSearch access policies with Lambda roles
    this.updateOpenSearchPolicies(deploymentEnv, lambdaFunctions);
    
    // Initialize API Gateway
    const api = this.createApiGateway(lambdaFunctions);

    // Create S3 connector stack
    this.s3ConnectorStack = this.createS3ConnectorStack(api, deploymentEnv);
   
    // Create Video Understanding stack
    this.videoUnderstandingStack = this.createVideoUnderstandingStack(api, deploymentEnv);

    // Create Strands Agent construct
    this.strandsAgentConstruct = this.createStrandsAgentConstruct(api, deploymentEnv);

    // Add Strands Agent debugging outputs
    if (this.strandsAgentConstruct) {
      this.strandsAgentConstruct.addOutputs();
    }

    // Set up permissions
    this.setupPermissions(lambdaFunctions, this.rekognitionTopic, this.indexesTable);
    
    // Set up permissions for Strands Agent
    if (this.strandsAgentConstruct) {
      this.setupStrandsAgentPermissions(deploymentEnv);
    }

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
      type: 'VECTORSEARCH',
      // The Maximum indexing/searching capacity is not supported in official documentation, refer to the similiar thread in community forum: https://repost.aws/questions/QUT51J80bvR5Gj5dk_0Ah0Gg/setting-opensearch-serverless-ocu-capacity-via-cloudformation
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
  
  /**
   * Create SQS queue for video merge operations
   */
  private createVideoMergeQueue(): sqs.Queue {
    const dlq = new sqs.Queue(this, 'VideoMergeDLQ', {
      queueName: 'video-merge-dlq.fifo',
      retentionPeriod: cdk.Duration.days(14),
      fifo: true,
      contentBasedDeduplication: true
    });

    return new sqs.Queue(this, 'VideoMergeQueue', {
      queueName: 'video-merge-queue.fifo',
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
  
  /**
   * Create DynamoDB table for merge jobs
   */
  private createMergeJobsTable(): dynamodb.Table {
    const table = new dynamodb.Table(this, 'MergeJobsTable', {
      partitionKey: { name: 'jobId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      timeToLiveAttribute: 'ttl',
    });
    
    // Add GSI for querying by userId
    table.addGlobalSecondaryIndex({
      indexName: 'UserIdIndex',
      partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'createdAt', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL
    });
    
    // Add GSI for querying by status
    table.addGlobalSecondaryIndex({
      indexName: 'StatusIndex',
      partitionKey: { name: 'status', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'createdAt', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL
    });
    
    return table;
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
        GOOGLE_API_KEY: this.googleApiKey || '',
        VALIDATION_MODEL: this.validationModel || ''
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
        TEMP_PATH: '/tmp',
        // Add environment variable to tell Puppeteer where to find Chrome
        CHROME_PATH: '/opt/chromium/chrome',
        // Make sure Chrome can find the required shared libraries
        LD_LIBRARY_PATH: '/opt/lib:/opt/lib64:/var/task/lib:/var/task/lib64:/var/runtime/lib:/var/runtime/lib64'
      },
      // Add a layer with the required shared libraries
      layers: [
        ytDlpLayer,
        // Use public ARN for chrome-aws-lambda layer (make sure to use the correct region and version)
        lambda.LayerVersion.fromLayerVersionArn(this, 'ChromeAwsLambdaLayer', 
          `arn:aws:lambda:${this.region}:764866452798:layer:chrome-aws-lambda:50`) // Check for latest version
      ],
      depsLockFilePath: 'src/lambdas/video-upload/package-lock.json',
      bundling: {
        ...commonLambdaProps.bundling,
        externalModules: [
          // External modules to exclude from bundling
          // '@aws-sdk/*', // Default AWS SDK modules 
          // 'chrome-aws-lambda',
          // 'puppeteer-core',
          '@sparticuz/chromium',
          'puppeteer-core'
        ]
      }
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
        BEDROCK_EMBEDDING_MODEL_ID: 'amazon.titan-embed-image-v1',
        BEDROCK_TEXT_EMBEDDING_MODEL_ID: 'amazon.titan-embed-text-v2:0',
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
      // CPU intensive due to FFmpeg processing
      memorySize: 1024*10,
      ephemeralStorageSize: cdk.Size.gibibytes(10), // Increase ephemeral storage to 10GB
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

  /**
   * Create the video merge Lambda function
   */
  private createVideoMergeFunction(): lambda.Function {
    // Create the Lambda security group with proper egress and ingress rules
    const lambdaSG = new ec2.SecurityGroup(this, 'LambdaSecurityGroupVideoMerge', {
      vpc: this.vpc,
      description: 'Security group for Lambdas accessing OpenSearch via VPC endpoint',
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
        OPENSEARCH_ENDPOINT: `https://${this.openSearchCollection.attrId}.${this.region}.aoss.amazonaws.com`,
        REDIS_ENDPOINT: this.redisCluster.attrRedisEndpointAddress,
        INDEXES_TABLE: this.indexesTable.tableName,
        INDEXES_TABLE_DYNAMODB_DNS_NAME: dynamoDbEndpointDnsHttp,
        VIDEO_MERGE_QUEUE_URL: this.videoMergeQueue.queueUrl,
        MERGE_JOBS_TABLE: this.mergeJobsTable.tableName
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

    const videoMergeHandler = new nodejslambda.NodejsFunction(this, 'VideoMergeHandler', {
      ...commonLambdaProps,
      entry: 'src/lambdas/video-merge/index.ts',
      handler: 'handler',
      memorySize: 4096,
      // Add the FFmpeg layer
      layers: [this.ffmpegLayer],
      depsLockFilePath: 'src/lambdas/video-merge/package.json'
    });

    // Add event source from the video merge queue
    videoMergeHandler.addEventSource(new SqsEventSource(this.videoMergeQueue, {
      batchSize: 1,
      reportBatchItemFailures: true
    }));

    return videoMergeHandler;
  }

  private createAdsTaggingFunction(): lambda.Function {
    const lambdaSG = new ec2.SecurityGroup(this, 'LambdaSecurityGroupAdsTagging', {
      vpc: this.vpc,
      description: 'Security group for Ads Tagging Lambda accessing OpenSearch',
      allowAllOutbound: true,
    });
    lambdaSG.addEgressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), 'Allow HTTPS outbound');
    lambdaSG.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), 'Allow HTTPS inbound');

    return new nodejslambda.NodejsFunction(this, 'AdsTaggingFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      vpc: this.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups: [lambdaSG],
      entry: 'src/lambdas/ads-tagging/index.ts',
      handler: 'handler',
      memorySize: 1024,
      timeout: cdk.Duration.minutes(15),
      environment: {
        VIDEO_BUCKET: this.videoBucket.bucketName,
        OPENSEARCH_ENDPOINT: `https://${this.openSearchCollection.attrId}.${this.region}.aoss.amazonaws.com`,
        ADS_TAGS_TABLE: this.adsAssetTagsTable.table.tableName,
        NOVA_MODEL_ID: 'apac.amazon.nova-pro-v1:0',
      },
      bundling: {
        minify: true,
        sourceMap: true,
        target: 'node20',
        format: nodejslambda.OutputFormat.CJS,
      },
      depsLockFilePath: 'src/lambdas/ads-tagging/package.json'
    });
  }

  private createAutoClipsFunction(): lambda.Function {
    const lambdaSG = new ec2.SecurityGroup(this, 'LambdaSecurityGroupAutoClips', {
      vpc: this.vpc,
      description: 'Security group for Auto Clips Lambda accessing OpenSearch',
      allowAllOutbound: true,
    });
    lambdaSG.addEgressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), 'Allow HTTPS outbound');
    lambdaSG.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), 'Allow HTTPS inbound');

    return new nodejslambda.NodejsFunction(this, 'AutoClipsFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      vpc: this.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups: [lambdaSG],
      entry: 'src/lambdas/auto-clips/index.ts',
      handler: 'handler',
      memorySize: 1024,
      timeout: cdk.Duration.minutes(5),
      environment: {
        VIDEO_BUCKET: this.videoBucket.bucketName,
        OPENSEARCH_ENDPOINT: `https://${this.openSearchCollection.attrId}.${this.region}.aoss.amazonaws.com`,
        NOVA_MODEL_ID: 'apac.amazon.nova-pro-v1:0',
      },
      bundling: {
        minify: true,
        sourceMap: true,
        target: 'node20',
        format: nodejslambda.OutputFormat.CJS,
      },
      depsLockFilePath: 'src/lambdas/auto-clips/package.json'
    });
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
        BEDROCK_EMBEDDING_MODEL_ID: 'amazon.titan-embed-image-v1',
        BEDROCK_TEXT_EMBEDDING_MODEL_ID: 'amazon.titan-embed-text-v2:0',
        SILICONFLOW_API_KEY: this.siliconflowApiKey || '',
        GOOGLE_API_KEY: this.googleApiKey || '',
        VALIDATION_MODEL: this.validationModel || ''
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
      // Add the FFmpeg layer
      layers: [this.ffmpegLayer],
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
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_NAT },
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
      // Use simple sample container image to placehold the ECS service creation process
      // image: ecs.ContainerImage.fromRegistry('public.ecr.aws/amazonlinux/amazonlinux:latest'),
      image: ecs.ContainerImage.fromAsset('src/containers/video-embedding'),
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
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_NAT },
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
    videoMergeFunction: lambda.Function;
    adsTaggingFunction: lambda.Function;
    autoClipsFunction: lambda.Function;
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
    // /videos/merge                          POST - Merge videos
    // /videos/merge/{jobId}                  GET - Get merge job status
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
    const merge = videos.addResource('merge');
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
    // Use the dedicated videoMergeFunction for merge operations
    addMethodWithCors(merge, 'POST', lambdaFunctions.videoMergeFunction);
    
    // Add endpoints for merge job status and listing
    const mergeJob = merge.addResource('{jobId}');
    addMethodWithCors(mergeJob, 'GET', lambdaFunctions.videoMergeFunction);
    
    addMethodWithCors(uploadComplete, 'POST', lambdaFunctions.videoUploadFunction.videoUploadHandler);
    addMethodWithCors(youtube, 'POST', lambdaFunctions.videoUploadFunction.youtubeUploadHandler);

    addMethodWithCors(status, 'GET', lambdaFunctions.videoUploadFunction.videoUploadHandler);
    addMethodWithCors(videoStatus, 'GET', lambdaFunctions.videoSliceFunction);

    addMethodWithCors(search, 'POST', lambdaFunctions.videoSearchFunction);

    addMethodWithCors(indexes, 'GET', lambdaFunctions.indexCrudFunction);
    addMethodWithCors(index, 'GET', lambdaFunctions.indexCrudFunction);
    addMethodWithCors(index, 'DELETE', lambdaFunctions.indexCrudFunction);
    addMethodWithCors(index, 'POST', lambdaFunctions.indexCrudFunction);


    // Ads-tagging endpoints: POST /videos/analyze/{videoId}, GET /videos/analyze/{videoId}/tags
    const analyze = videos.addResource('analyze');
    const analyzeVideo = analyze.addResource('{videoId}');
    addMethodWithCors(analyzeVideo, 'POST', lambdaFunctions.adsTaggingFunction);
    const analyzeTags = analyzeVideo.addResource('tags');
    addMethodWithCors(analyzeTags, 'GET', lambdaFunctions.adsTaggingFunction);

    // Auto-clips endpoint: POST /videos/auto-clips/{videoId}
    const autoClips = videos.addResource('auto-clips');
    const autoClipsVideo = autoClips.addResource('{videoId}');
    addMethodWithCors(autoClipsVideo, 'POST', lambdaFunctions.autoClipsFunction);

    // API rate limiting with usage plans
    const freeApiKey = api.addApiKey('FreeApiKey', {
      apiKeyName: 'free-tier-key',
      description: 'API key for free tier usage',
    });

    const proApiKey = api.addApiKey('ProApiKey', {
      apiKeyName: 'pro-tier-key',
      description: 'API key for pro tier usage',
    });

    const freePlan = api.addUsagePlan('FreePlan', {
      name: 'Free',
      description: 'Free tier: 100 requests/day, 10 req/s burst',
      throttle: {
        rateLimit: 10,
        burstLimit: 10,
      },
      quota: {
        limit: 100,
        period: apigateway.Period.DAY,
      },
    });

    const proPlan = api.addUsagePlan('ProPlan', {
      name: 'Pro',
      description: 'Pro tier: 10000 requests/day, 50 req/s burst',
      throttle: {
        rateLimit: 50,
        burstLimit: 50,
      },
      quota: {
        limit: 10000,
        period: apigateway.Period.DAY,
      },
    });

    freePlan.addApiKey(freeApiKey);
    proPlan.addApiKey(proApiKey);

    // Associate usage plans with the prod stage
    freePlan.addApiStage({ stage: api.deploymentStage });
    proPlan.addApiStage({ stage: api.deploymentStage });

    // Output API keys
    new cdk.CfnOutput(this, 'FreeApiKeyId', {
      value: freeApiKey.keyId,
      description: 'Free tier API key ID',
    });

    new cdk.CfnOutput(this, 'ProApiKeyId', {
      value: proApiKey.keyId,
      description: 'Pro tier API key ID',
    });

    return api;
  }

  private setupPermissions(
    lambdaFunctions: {
      videoUploadFunction: { videoUploadHandler: lambda.Function; youtubeUploadHandler: lambda.Function };
      videoSliceFunction: lambda.Function;
      videoSearchFunction: lambda.Function;
      indexCrudFunction: lambda.Function;
      videoMergeFunction: lambda.Function;
      adsTaggingFunction: lambda.Function;
      autoClipsFunction: lambda.Function;
    },
    snsTopic: sns.Topic,
    indexesTable: dynamodb.Table
  ) {
    // S3 permissions
    this.videoBucket.grantReadWrite(lambdaFunctions.videoUploadFunction.videoUploadHandler);
    this.videoBucket.grantReadWrite(lambdaFunctions.videoUploadFunction.youtubeUploadHandler);
    this.videoBucket.grantRead(lambdaFunctions.videoSearchFunction);
    this.videoBucket.grantReadWrite(lambdaFunctions.videoSliceFunction);
    this.videoBucket.grantReadWrite(lambdaFunctions.indexCrudFunction);
    this.videoBucket.grantReadWrite(lambdaFunctions.videoMergeFunction);
    this.videoBucket.grantRead(lambdaFunctions.adsTaggingFunction);
    this.videoBucket.grantRead(lambdaFunctions.autoClipsFunction);

    // SQS permissions - grant send message permissions to videoSliceFunction
    this.videoProcessingQueue.grantSendMessages(lambdaFunctions.videoSliceFunction);
    
    // Grant SQS permissions for videoMergeQueue
    this.videoMergeQueue.grantSendMessages(lambdaFunctions.videoMergeFunction);
    this.videoMergeQueue.grantConsumeMessages(lambdaFunctions.videoMergeFunction);
    
    // Grant DynamoDB permissions for mergeJobsTable
    this.mergeJobsTable.grantReadWriteData(lambdaFunctions.videoMergeFunction);

    // Grant DynamoDB permissions for ads-tagging table
    this.adsAssetTagsTable.table.grantReadWriteData(lambdaFunctions.adsTaggingFunction);

    // Grant Bedrock permissions for ads-tagging and auto-clips
    const adsBedrockPolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['bedrock:InvokeModel'],
      resources: ['*'],
    });
    lambdaFunctions.adsTaggingFunction.addToRolePolicy(adsBedrockPolicy);
    lambdaFunctions.autoClipsFunction.addToRolePolicy(adsBedrockPolicy);

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
    lambdaFunctions.videoUploadFunction.youtubeUploadHandler.addToRolePolicy(openSearchPolicy);
    lambdaFunctions.videoSliceFunction.addToRolePolicy(openSearchPolicy);
    lambdaFunctions.videoSearchFunction.addToRolePolicy(openSearchPolicy);
    lambdaFunctions.indexCrudFunction.addToRolePolicy(openSearchPolicy);
    lambdaFunctions.videoMergeFunction.addToRolePolicy(openSearchPolicy);
    lambdaFunctions.adsTaggingFunction.addToRolePolicy(openSearchReadOnlyPolicy);
    lambdaFunctions.autoClipsFunction.addToRolePolicy(openSearchReadOnlyPolicy);

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
    indexesTable.grantReadWriteData(lambdaFunctions.videoMergeFunction);

    // Grant Bedrock permissions for video search function
    const bedrockPolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'bedrock:InvokeModel',
        'bedrock:InvokeModelWithResponseStream'
      ],
      resources: [
        'arn:aws:bedrock:*:*:foundation-model/*',
        'arn:aws:bedrock:*:*:inference-profile/*'
      ]
    });

    lambdaFunctions.videoSearchFunction.addToRolePolicy(bedrockPolicy);
    lambdaFunctions.videoSliceFunction.addToRolePolicy(bedrockPolicy);
  }

  private createMonitoringInfrastructure(
    lambdaFunctions: {
      videoUploadFunction: { videoUploadHandler: lambda.Function; youtubeUploadHandler: lambda.Function };
      videoSliceFunction: lambda.Function;
      videoSearchFunction: lambda.Function;
      videoMergeFunction: lambda.Function;
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

    new cdk.CfnOutput(this, 'UserPoolId', {
      value: this.userPool.userPoolId,
      description: 'Cognito User Pool ID',
    });
    
    new cdk.CfnOutput(this, 'UserPoolClientId', {
      value: this.userPoolClient.userPoolClientId,
      description: 'Cognito User Pool Client ID',
    });
    
    new cdk.CfnOutput(this, 'IdentityPoolId', {
      value: this.identityPool.ref,
      description: 'Cognito Identity Pool ID',
    });

    // Add Strands Agent outputs if available
    if (this.strandsAgentConstruct) {
      new cdk.CfnOutput(this, 'StrandsAgentClusterName', {
        value: this.strandsAgentConstruct.agentCluster.clusterName,
        description: 'ECS Cluster name for Strands Agent',
      });

      new cdk.CfnOutput(this, 'AutoCreateJobsTableName', {
        value: this.strandsAgentConstruct.jobsTable.tableName,
        description: 'DynamoDB table for auto-create jobs',
      });

      new cdk.CfnOutput(this, 'AgentJobQueueUrl', {
        value: this.strandsAgentConstruct.jobQueue.queueUrl,
        description: 'SQS queue URL for agent jobs',
      });
    }
  }

  private createCognitoResources(stage: string): { 
    userPool: cognito.UserPool; 
    userPoolClient: cognito.UserPoolClient; 
    identityPool: cognito.CfnIdentityPool;
  } {
    // Create the pre-signup Lambda function to validate email domains
    const preSignUpFunction = new nodejslambda.NodejsFunction(this, 'PreSignUpTrigger', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: 'src/lambdas/auth/pre-signup.ts', 
      environment: {
        ALLOWED_DOMAIN: 'amazon.com',
      },
    });

    // Create user pool with email verification and domain restriction
    const userPool = new cognito.UserPool(this, 'VideoSearchUserPool', {
      userPoolName: `video-search-user-pool-${stage}`,
      selfSignUpEnabled: true,
      autoVerify: { email: true },
      standardAttributes: {
        email: {
          required: true,
          mutable: true,
        },
      },
      passwordPolicy: {
        minLength: 8,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: true,
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      removalPolicy: cdk.RemovalPolicy.DESTROY, // For development
      lambdaTriggers: {
        preSignUp: preSignUpFunction,
      },
    });
    
    // Determine the appropriate callback and logout URLs based on the deployment stage
    const isDev = stage === 'dev';
    
    // Default development URLs
    let callbackUrls = ['http://localhost:3000/auth/callback'];
    let logoutUrls = ['http://localhost:3000/'];
    
    // For production or staging, add appropriate domain URLs
    if (!isDev && this.appDomain) {
      callbackUrls = [
        ...callbackUrls,
        `https://${this.appDomain}/auth/callback`
      ];
      logoutUrls = [
        ...logoutUrls,
        `https://${this.appDomain}/`
      ];
    }
    
    // Add app client
    const userPoolClient = userPool.addClient('app-client', {
      authFlows: {
        userPassword: true,
        userSrp: true,
      },
      oAuth: {
        flows: {
          implicitCodeGrant: true,
        },
        callbackUrls: callbackUrls,
        logoutUrls: logoutUrls,
      },
    });

    // Create identity pool for AWS credentials
    const identityPool = new cognito.CfnIdentityPool(this, 'VideoSearchIdentityPool', {
      identityPoolName: `video_search_identity_pool_${stage}`,
      allowUnauthenticatedIdentities: false,
      cognitoIdentityProviders: [
        {
          clientId: userPoolClient.userPoolClientId,
          providerName: userPool.userPoolProviderName,
        },
      ],
    });
    
    // Set up roles for authenticated users
    const authenticatedRole = new iam.Role(this, 'CognitoAuthenticatedRole', {
      assumedBy: new iam.FederatedPrincipal(
        'cognito-identity.amazonaws.com',
        {
          StringEquals: {
            'cognito-identity.amazonaws.com:aud': identityPool.ref,
          },
          'ForAnyValue:StringLike': {
            'cognito-identity.amazonaws.com:amr': 'authenticated',
          },
        },
        'sts:AssumeRoleWithWebIdentity'
      ),
    });
    
    // Add permissions for authenticated users (S3, API calls, etc.)
    authenticatedRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['s3:GetObject', 's3:PutObject'],
        resources: [
          `${this.videoBucket.bucketArn}/RawVideos/*`,
          `${this.videoBucket.bucketArn}/ProcessedVideos/*`,
        ],
      })
    );
    
    // Attach roles to identity pool
    new cognito.CfnIdentityPoolRoleAttachment(this, 'IdentityPoolRoleAttachment', {
      identityPoolId: identityPool.ref,
      roles: {
        authenticated: authenticatedRole.roleArn,
      },
    });
    
    return { userPool, userPoolClient, identityPool };
  }

  private updateOpenSearchPolicies(stage: string, lambdaFunctions: {
    videoUploadFunction: { videoUploadHandler: lambda.Function; youtubeUploadHandler: lambda.Function };
    videoSliceFunction: lambda.Function;
    videoSearchFunction: lambda.Function;
    videoMergeFunction: lambda.Function;
    adsTaggingFunction: lambda.Function;
    autoClipsFunction: lambda.Function;
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
          lambdaFunctions.videoSearchFunction.role?.roleArn || '',
          lambdaFunctions.videoMergeFunction.role?.roleArn || '',
          lambdaFunctions.adsTaggingFunction.role?.roleArn || '',
          lambdaFunctions.autoClipsFunction.role?.roleArn || ''
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

  private createS3ConnectorStack(api: apigateway.RestApi, deploymentEnv: string): S3ConnectorStack {
    return new S3ConnectorStack(this, 'S3ConnectorStack', {
      vpc: this.vpc,
      api: api,
      videoBucket: this.videoBucket.bucketName,
      dynamodbEndpoint: this.dynamodbEndpoint,
      deploymentEnvironment: deploymentEnv
    });
  }
  
  private createVideoUnderstandingStack(api: apigateway.RestApi, deploymentEnv: string): VideoUnderstandingStack {
    return new VideoUnderstandingStack(this, 'VideoUnderstandingStack', {
      vpc: this.vpc,
      api: api,
      videoBucket: this.videoBucket.bucketName,
      dynamodbEndpoint: this.dynamodbEndpoint,
      openSearchEndpoint: `https://${this.openSearchCollection.attrId}.${this.region}.aoss.amazonaws.com`,
      indexesTable: this.indexesTable,
      deploymentEnvironment: deploymentEnv,
      googleApiKey: this.googleApiKey || ''
    });
  }
  
  private createStrandsAgentConstruct(api: apigateway.RestApi, deploymentEnv: string): StrandsAgentConstruct {
    return new StrandsAgentConstruct(this, 'StrandsAgentConstruct', {
      vpc: this.vpc,
      openSearchEndpoint: `https://${this.openSearchCollection.attrId}.${this.region}.aoss.amazonaws.com`,
      videoBucket: this.videoBucket.bucketName,
      indexesTable: this.indexesTable,
      api: api,
      dynamodbEndpoint: this.dynamodbEndpoint,
      deploymentEnvironment: deploymentEnv
    });
  }

  private setupStrandsAgentPermissions(stage: string): void {
    if (!this.strandsAgentConstruct) return;

    // Grant S3 permissions to Strands Agent Lambda functions
    this.videoBucket.grantReadWrite(this.strandsAgentConstruct.autoCreateLambda);
    this.videoBucket.grantRead(this.strandsAgentConstruct.mcpServerLambda);

    // Grant DynamoDB permissions
    this.indexesTable.grantReadData(this.strandsAgentConstruct.autoCreateLambda);
    this.indexesTable.grantReadData(this.strandsAgentConstruct.mcpServerLambda);

    // Grant OpenSearch permissions
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
        'es:ESHttp*'
      ],
      resources: [
        `arn:aws:aoss:${this.region}:${this.account}:collection/*`,
        `arn:aws:aoss:${this.region}:${this.account}:security-policy/*`,
        `arn:aws:aoss:${this.region}:${this.account}:access-policy/*`
      ]
    });

    this.strandsAgentConstruct.autoCreateLambda.addToRolePolicy(openSearchPolicy);
    this.strandsAgentConstruct.mcpServerLambda.addToRolePolicy(openSearchPolicy);

    // Update OpenSearch access policies to include Strands Agent Lambda roles
    const strandsAgentAccessPolicy = new opensearchserverless.CfnAccessPolicy(this, 'StrandsAgentAccessPolicy', {
      name: `strands-agent-access-${stage}`,
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
          this.strandsAgentConstruct.autoCreateLambda.role?.roleArn || '',
          this.strandsAgentConstruct.mcpServerLambda.role?.roleArn || ''
        ].filter(Boolean)
      }])
    });

    strandsAgentAccessPolicy.addDependency(this.openSearchCollection);
  }
}
