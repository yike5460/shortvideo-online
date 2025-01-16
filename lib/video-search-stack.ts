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
    this.redisCluster = this.createCacheInfrastructure();
    this.cluster = this.createContainerInfrastructure();
    this.videoProcessingQueue = this.createQueueInfrastructure();
    
    const lambdaFunctions = {
      videoUploadFunction: this.createVideoUploadFunction(),
      videoSliceFunction: this.createVideoSliceFunction(),
      videoSearchFunction: this.createVideoSearchFunction()
    };

    // Create text and video embedding services, skip the BGE-embedding service for now
    // const textEmbeddingService = this.createTextEmbeddingService();
    const videoEmbeddingService = this.createVideoEmbeddingService();

    // Initialize API Gateway
    const api = this.createApiGateway(lambdaFunctions);

    // Set up permissions
    // this.setupPermissions(lambdaFunctions, textEmbeddingService, videoEmbeddingService, this.videoProcessingQueue);
    this.setupPermissions(lambdaFunctions, videoEmbeddingService, this.videoProcessingQueue);
    // Create CloudWatch Event Rules for monitoring
    // this.createMonitoringInfrastructure(lambdaFunctions, textEmbeddingService, videoEmbeddingService);

    // Create stack outputs
    this.createStackOutputs(api);
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

    // Add ECR endpoints
    vpc.addInterfaceEndpoint('ECRDockerEndpoint', {
      service: ec2.InterfaceVpcEndpointAwsService.ECR_DOCKER,
    });

    vpc.addInterfaceEndpoint('ECREndpoint', {
      service: ec2.InterfaceVpcEndpointAwsService.ECR,
    });

    // Add CloudWatch Logs endpoint for container logging
    vpc.addInterfaceEndpoint('CloudWatchLogsEndpoint', {
      service: ec2.InterfaceVpcEndpointAwsService.CLOUDWATCH_LOGS,
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

    // Create encryption policy first
    const encryptionPolicy = new opensearchserverless.CfnSecurityPolicy(this, 'VideoSearchEncryptionPolicy', {
      name: `video-search-encryption-${stage}`,
      type: 'encryption',
      policy: JSON.stringify({
        Rules: [{
          ResourceType: 'collection',
          Resource: [`collection/video-search-${stage}`] // Exact match for the collection name
        }],
        AWSOwnedKey: true
      })
    });

    // Create OpenSearch Serverless Collection
    const collection = new opensearchserverless.CfnCollection(this, 'VideoSearchCollection', {
      name: `video-search-${stage}`,
      description: 'Collection for video search and analytics',
      type: 'SEARCH'
    });

    // Add explicit dependency
    collection.addDependency(encryptionPolicy);

    // Create the OpenSearch VPC endpoint using AwsCustomResource, obsoleted
    // const openSearchVPCEndpointCustomResource = new cr.AwsCustomResource(this, 'OpenSearchVpcEndpointCustomResource', {
    //   onCreate: {
    //     service: 'opensearchserverless',
    //     action: 'createVpcEndpoint',
    //     parameters: {
    //       name: `video-search-endpoint-${stage}`,
    //       vpcId: this.vpc.vpcId,
    //       subnetIds: this.vpc.selectSubnets({
    //         subnetType: ec2.SubnetType.PRIVATE_ISOLATED
    //       }).subnetIds,
    //       securityGroupIds: [vpcEndpointSG.securityGroupId],
    //       clientToken: `create-endpoint-${stage}-${Date.now()}`
    //     },
    //     // Refer to the response {
    //     //   "createVpcEndpointDetail": { 
    //     //       "id": "string",
    //     //       "name": "string",
    //     //       "status": "string"
    //     //   }
    //     // }
    //     physicalResourceId: cr.PhysicalResourceId.fromResponse('createVpcEndpointDetail.id'),
    //     outputPaths: ['*']  // Get all paths
    //   },
    //   onDelete: {
    //     service: 'opensearchserverless',
    //     action: 'deleteVpcEndpoint',
    //     parameters: {
    //       id: cr.PhysicalResourceId.of('${PhysicalResourceId}')
    //     }
    //   },
    //   policy: cr.AwsCustomResourcePolicy.fromStatements([
    //     new iam.PolicyStatement({
    //       effect: iam.Effect.ALLOW,
    //       actions: [
    //         'aoss:CreateVpcEndpoint',
    //         'aoss:DeleteVpcEndpoint',
    //         'aoss:ListVpcEndpoints',
    //         'aoss:GetVpcEndpoint',
    //         'ec2:CreateVpcEndpoint',
    //         'ec2:DeleteVpcEndpoints',
    //         'ec2:DescribeVpcEndpoints',
    //         'ec2:ModifyVpcEndpoint',
    //         'ec2:DescribeSecurityGroups',
    //         'ec2:DescribeSubnets',
    //         'ec2:DescribeVpcs',
    //         'ec2:CreateTags',
    //         'ec2:DeleteTags',
    //         'iam:CreateServiceLinkedRole'
    //       ],
    //       resources: ['*']
    //     }),
    //     new iam.PolicyStatement({
    //       effect: iam.Effect.ALLOW,
    //       actions: [
    //         'iam:CreateServiceLinkedRole'
    //       ],
    //       resources: [`arn:aws:iam::${this.account}:role/aws-service-role/aoss.amazonaws.com/AWSServiceRoleForAmazonOpenSearchServerless`],
    //       conditions: {
    //         StringLike: {
    //           'iam:AWSServiceName': 'aoss.amazonaws.com'
    //         }
    //       }
    //     })
    //   ])
    // });

    // Custom Resource Responding Format:
    //   {
    //     "Status": "SUCCESS",
    //     "Reason": "OK",
    //     "PhysicalResourceId": "vpce-015883d051b260af7",
    //     "StackId": "arn:aws:cloudformation:us-east-1:705247044519:stack/VideoSearchStack/e7afe090-bc30-11ef-914f-0e36817187a3",
    //     "RequestId": "9e6df8f2-1c31-4a0f-8688-11f3fc789038",
    //     "LogicalResourceId": "OpenSearchVpcEndpoint2B9DFE5C",
    //     "NoEcho": false,
    //     "Data": {}
    //    }

    // Create the OpenSearch VPC endpoint using CloudFormation: https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_opensearchserverless.CfnVpcEndpoint.html
    const openSearchVpcEndpointCloudFormation = new opensearchserverless.CfnVpcEndpoint(this, 'OpenSearchVpcEndpointCloudFormation', {
      name: `video-search-endpoint-${stage}`,
      subnetIds: this.vpc.selectSubnets({
        subnetType: ec2.SubnetType.PRIVATE_ISOLATED
      }).subnetIds,
      vpcId: this.vpc.vpcId,
      securityGroupIds: [vpcEndpointSG.securityGroupId],  
    });

    // Create network policy for VPC access after endpoint is created, allow Lambda to access the endpoint, refer to https://docs.aws.amazon.com/opensearch-service/latest/developerguide/serverless-security.html for more details
    const networkPolicy = new opensearchserverless.CfnSecurityPolicy(this, 'VideoSearchNetworkPolicy', {
      name: `video-search-network-${stage}`,
      type: 'network',
      description: 'Only VPC endpoint access to the collection, No public access and No dashboards access',
      policy: JSON.stringify([{
        Rules: [{
          Resource: [`collection/${collection.name}`],
          ResourceType: 'collection'
        }],
        // Using CloudFormation VPC endpoint ID
        SourceVPCEs: [openSearchVpcEndpointCloudFormation.attrId],
        // Using Custom Resource VPC endpoint ID
        // SourceVPCEs: [openSearchVPCEndpointCustomResource.getResponseField('PhysicalResourceId')],
        // Not used, since ONLY Bedrock supported in SourceServices, refer to: https://docs.aws.amazon.com/opensearch-service/latest/developerguide/serverless-network.html
        // SourceServices: ["lambda.amazonaws.com"]
      }])
    });

    // Create data access policy
    const dataAccessPolicy = new opensearchserverless.CfnAccessPolicy(this, 'VideoSearchDataAccessPolicy', {
      name: `video-search-access-${stage}`,
      type: 'data',
      policy: JSON.stringify([{
        Rules: [{
          Resource: [`collection/${collection.name}`],
          Permission: [
            'aoss:CreateCollectionItems',
            'aoss:DeleteCollectionItems',
            'aoss:UpdateCollectionItems',
            'aoss:DescribeCollectionItems',
            'aoss:*'
          ],
          ResourceType: 'collection'
        }],
        Principal: [
          `arn:aws:iam::${this.account}:root` // Grant access to the AWS account root
        ]
      }])
    });

    // Add dependencies
    // networkPolicy.node.addDependency(openSearchVPCEndpointCustomResource);
    networkPolicy.node.addDependency(openSearchVpcEndpointCloudFormation);
    networkPolicy.node.addDependency(collection);
    dataAccessPolicy.node.addDependency(collection);

    // // Get the collection endpoint
    // const collectionEndpoint = `https://${collection.attrId}.${this.region}.aoss.amazonaws.com`;

    // // Update stack outputs
    // new cdk.CfnOutput(this, 'OpenSearchEndpoint', {
    //   value: collectionEndpoint,
    //   description: 'OpenSearch Serverless collection endpoint'
    // });

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
      runtime: lambda.Runtime.NODEJS_20_X,
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

    // Create yt-dlp layer
    const ytDlpLayer = new lambda.LayerVersion(this, 'YtDlpLayer', {
      code: lambda.Code.fromAsset('src/layers/yt-dlp'),
      description: 'yt-dlp binary for downloading YouTube videos',
      compatibleRuntimes: [lambda.Runtime.NODEJS_20_X],
      compatibleArchitectures: [lambda.Architecture.X86_64],
    });

    const videoUploadHandler = new lambda.Function(this, 'VideoUploadHandler', {
      ...commonLambdaProps,
      code: lambda.Code.fromAsset('src/lambdas/video-upload'),
      handler: 'index.handler',
      memorySize: 2048,
    });

    const youtubeUploadHandler = new lambda.Function(this, 'YouTubeUploadHandler', {
      ...commonLambdaProps,
      code: lambda.Code.fromAsset('src/lambdas/video-upload'),
      handler: 'youtube.handler',
      memorySize: 4096,
      timeout: cdk.Duration.minutes(15), // Longer timeout for YouTube downloads
      environment: {
        ...commonLambdaProps.environment,
        TEMP_PATH: '/tmp' // Temp directory for YouTube downloads
      },
      layers: [ytDlpLayer], // Add the yt-dlp layer
    });

    return { videoUploadHandler, youtubeUploadHandler };
  }

  private createVideoSliceFunction() {
    const commonLambdaProps = {
      runtime: lambda.Runtime.NODEJS_20_X,
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
      memorySize: 4096,
    });

    return videoSliceHandler;
  }

  private createVideoSearchFunction() {
    const commonLambdaProps = {
      runtime: lambda.Runtime.NODEJS_20_X,
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
    videoEmbeddingServiceSG.addIngressRule(
      ec2.Peer.ipv4(this.vpc.vpcCidrBlock),
      ec2.Port.tcp(8001),
      'Allow inbound from VPC'
    );

    // Add container to task definition
    const container = taskDefinition.addContainer('VideoEmbeddingContainer', {
      image: ecs.ContainerImage.fromAsset('src/containers/videoclip-embedding'),
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
  }): apigateway.RestApi {
    // Create the API
    const api = new apigateway.RestApi(this, 'VideoSearchApi', {
      restApiName: 'Video Search Service',
      description: 'API for video search and processing',
      deploy: true,
      deployOptions: {
        stageName: 'prod',
        tracingEnabled: true,
      }
    });

    // Add Gateway Responses for CORS
    new apigateway.GatewayResponse(this, 'Gateway4XXResponse', {
      restApi: api,
      type: apigateway.ResponseType.DEFAULT_4XX,
      responseHeaders: {
        'Access-Control-Allow-Origin': "'*'",
        'Access-Control-Allow-Headers': "'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token'",
        'Access-Control-Allow-Methods': "'GET,POST,PUT,DELETE,OPTIONS'"
      }
    });

    new apigateway.GatewayResponse(this, 'Gateway5XXResponse', {
      restApi: api,
      type: apigateway.ResponseType.DEFAULT_5XX,
      responseHeaders: {
        'Access-Control-Allow-Origin': "'*'",
        'Access-Control-Allow-Headers': "'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token'",
        'Access-Control-Allow-Methods': "'GET,POST,PUT,DELETE,OPTIONS'"
      }
    });

    // Main resources
    const videos = api.root.addResource('videos');
    const search = api.root.addResource('search');
    const upload = videos.addResource('upload');
    const youtube = videos.addResource('youtube');

    // Helper function to add method with CORS
    const addMethodWithCors = (resource: apigateway.Resource, httpMethod: string, lambdaFn: lambda.Function) => {
      // Add the actual method
      const methodResponse: apigateway.MethodResponse = {
        statusCode: '200',
        responseParameters: {
          'method.response.header.Access-Control-Allow-Origin': true,
          'method.response.header.Access-Control-Allow-Headers': true,
          'method.response.header.Access-Control-Allow-Methods': true
        }
      };

      const integrationResponse: apigateway.IntegrationResponse = {
        statusCode: '200',
        responseParameters: {
          'method.response.header.Access-Control-Allow-Origin': "'*'",
          'method.response.header.Access-Control-Allow-Headers': "'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token'",
          'method.response.header.Access-Control-Allow-Methods': "'GET,POST,PUT,DELETE,OPTIONS'"
        }
      };

      // Add the main method
      resource.addMethod(httpMethod, new apigateway.LambdaIntegration(lambdaFn, {
        proxy: true,
        integrationResponses: [integrationResponse]
      }), {
        methodResponses: [methodResponse]
      });

      // Add OPTIONS method
      const optionsResponse: apigateway.MethodResponse = {
        statusCode: '200',
        responseParameters: {
          'method.response.header.Access-Control-Allow-Origin': true,
          'method.response.header.Access-Control-Allow-Headers': true,
          'method.response.header.Access-Control-Allow-Methods': true
        }
      };

      const optionsIntegration = new apigateway.MockIntegration({
        integrationResponses: [{
          statusCode: '200',
          responseParameters: {
            'method.response.header.Access-Control-Allow-Origin': "'*'",
            'method.response.header.Access-Control-Allow-Headers': "'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token'",
            'method.response.header.Access-Control-Allow-Methods': "'GET,POST,PUT,DELETE,OPTIONS'"
          }
        }],
        passthroughBehavior: apigateway.PassthroughBehavior.NEVER,
        requestTemplates: {
          'application/json': '{"statusCode": 200}'
        }
      });

      resource.addMethod('OPTIONS', optionsIntegration, {
        methodResponses: [optionsResponse]
      });
    };

    // Add endpoints with CORS
    addMethodWithCors(upload, 'POST', lambdaFunctions.videoUploadFunction.videoUploadHandler);
    addMethodWithCors(youtube, 'POST', lambdaFunctions.videoUploadFunction.youtubeUploadHandler);

    const uploadComplete = upload.addResource('{uploadId}').addResource('complete');
    addMethodWithCors(uploadComplete, 'POST', lambdaFunctions.videoUploadFunction.videoUploadHandler);

    addMethodWithCors(search, 'POST', lambdaFunctions.videoSearchFunction);

    const status = videos.addResource('status');
    const videoStatus = status.addResource('{videoId}');
    addMethodWithCors(videoStatus, 'GET', lambdaFunctions.videoSliceFunction);

    return api;
  }

  private setupPermissions(
    lambdaFunctions: {
      videoUploadFunction: { videoUploadHandler: lambda.Function; youtubeUploadHandler: lambda.Function };
      videoSliceFunction: lambda.Function;
      videoSearchFunction: lambda.Function;
    },
    // textEmbeddingService: ecs.FargateService,
    videoEmbeddingService: ecs.FargateService,
    queue: sqs.Queue
  ) {
    // S3 permissions
    this.videoBucket.grantReadWrite(lambdaFunctions.videoUploadFunction.videoUploadHandler);
    this.videoBucket.grantRead(lambdaFunctions.videoSearchFunction);
    this.videoBucket.grantReadWrite(lambdaFunctions.videoSliceFunction);

    // SQS permissions
    queue.grantSendMessages(lambdaFunctions.videoUploadFunction.videoUploadHandler);
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

    lambdaFunctions.videoUploadFunction.videoUploadHandler.addToRolePolicy(openSearchPolicy);
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

    // Grant permissions to embedding services to access OpenSearch
    // textEmbeddingService.taskDefinition.addToTaskRolePolicy(openSearchReadOnlyPolicy);
    videoEmbeddingService.taskDefinition.addToTaskRolePolicy(openSearchReadOnlyPolicy);

    // Grant permissions to embedding services to access S3
    // this.videoBucket.grantRead(textEmbeddingService.taskDefinition.taskRole);
    this.videoBucket.grantRead(videoEmbeddingService.taskDefinition.taskRole);
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
}