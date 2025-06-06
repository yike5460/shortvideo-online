import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as nodejslambda from 'aws-cdk-lib/aws-lambda-nodejs';
import { Construct } from 'constructs';

export interface StrandsAgentConstructProps {
  vpc: ec2.IVpc;
  openSearchEndpoint: string;
  videoBucket: string;
  indexesTable: dynamodb.ITable;
  api: apigateway.RestApi;
  dynamodbEndpoint: ec2.InterfaceVpcEndpoint;
  deploymentEnvironment: string;
}

export class StrandsAgentConstruct extends Construct {
  public readonly agentCluster: ecs.Cluster;
  public readonly agentService: ecs.FargateService;
  public readonly jobsTable: dynamodb.Table;
  public readonly jobQueue: sqs.Queue;
  public readonly autoCreateLambda: lambda.Function;
  public readonly mcpServerLambda: lambda.Function;

  constructor(scope: Construct, id: string, props: StrandsAgentConstructProps) {
    super(scope, id);

    // Create DynamoDB table for auto-create jobs
    this.jobsTable = new dynamodb.Table(this, 'AutoCreateJobsTable', {
      tableName: 'auto-create-jobs',
      partitionKey: { name: 'jobId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'ttl',
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Add GSI for user queries
    this.jobsTable.addGlobalSecondaryIndex({
      indexName: 'UserIdIndex',
      partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'createdAt', type: dynamodb.AttributeType.STRING },
    });

    // Add GSI for status queries
    this.jobsTable.addGlobalSecondaryIndex({
      indexName: 'StatusIndex',
      partitionKey: { name: 'status', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'createdAt', type: dynamodb.AttributeType.STRING },
    });

    // Create SQS queue for agent jobs
    this.jobQueue = new sqs.Queue(this, 'AgentJobQueue', {
      queueName: 'strands-agent-jobs.fifo',
      fifo: true,
      contentBasedDeduplication: true,
      visibilityTimeout: cdk.Duration.minutes(30),
      retentionPeriod: cdk.Duration.days(14),
    });

    // Create ECS cluster for Strands Agent
    this.agentCluster = new ecs.Cluster(this, 'StrandsAgentCluster', {
      vpc: props.vpc,
      clusterName: 'strands-agent-cluster',
      containerInsights: true,
    });

    // Create CloudWatch log group
    const logGroup = new logs.LogGroup(this, 'StrandsAgentLogGroup', {
      logGroupName: '/ecs/strands-agent',
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Create IAM role for the task
    const taskRole = new iam.Role(this, 'StrandsAgentTaskRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
    });

    // Create execution role for ECS task
    const executionRole = new iam.Role(this, 'StrandsAgentExecutionRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy'),
      ],
    });

    // Create task definition with proper roles
    const taskDefinition = new ecs.FargateTaskDefinition(this, 'StrandsAgentTaskDef', {
      memoryLimitMiB: 4096,
      cpu: 2048,
      taskRole: taskRole,
      executionRole: executionRole,
    });

    // Grant permissions to access required services
    taskRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'bedrock:InvokeModel',
        'bedrock:InvokeModelWithResponseStream',
        'bedrock:ListFoundationModels',
        'bedrock:GetFoundationModel',
      ],
      resources: ['*'],
    }));

    // Grant access to OpenSearch
    taskRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'aoss:APIAccessAll',
      ],
      resources: [`arn:aws:aoss:${cdk.Stack.of(this).region}:${cdk.Stack.of(this).account}:collection/*`],
    }));

    // Grant access to S3 video bucket
    taskRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        's3:GetObject',
        's3:PutObject',
        's3:DeleteObject',
        's3:ListBucket',
      ],
      resources: [
        `arn:aws:s3:::${props.videoBucket}`,
        `arn:aws:s3:::${props.videoBucket}/*`,
      ],
    }));

    // Grant access to DynamoDB tables
    this.jobsTable.grantReadWriteData(taskRole);
    props.indexesTable.grantReadData(taskRole);

    // Grant access to SQS
    this.jobQueue.grantConsumeMessages(taskRole);

    taskDefinition.addToTaskRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'lambda:InvokeFunction',
      ],
      resources: ['*'], // Will be restricted to specific Lambda functions
    }));

    // Add container to task definition - build from local source
    const container = taskDefinition.addContainer('StrandsAgentContainer', {
      image: ecs.ContainerImage.fromAsset('src/containers/strands-agent'),
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'strands-agent',
        logGroup: logGroup,
      }),
      environment: {
        AWS_REGION: cdk.Stack.of(this).region,
        OPENSEARCH_ENDPOINT: props.openSearchEndpoint,
        VIDEO_BUCKET: props.videoBucket,
        JOBS_TABLE: this.jobsTable.tableName,
        INDEXES_TABLE: props.indexesTable.tableName,
        JOB_QUEUE_URL: this.jobQueue.queueUrl,
        BEDROCK_REGION: cdk.Stack.of(this).region,
        // Keep MCP server URL for future reference (currently commented out in code)
        MCP_SERVER_URL: `${props.api.url}mcp`,
        // Add direct API endpoints for custom tools
        VIDEO_SEARCH_API_URL: `${props.api.url}search`,
        VIDEO_MERGE_API_URL: `${props.api.url}videos/merge`,
      },
    });

    // Add port mapping back - container serves FastAPI endpoints for health checks
    container.addPortMappings({
      containerPort: 8080,
      protocol: ecs.Protocol.TCP,
    });

    // Create Fargate service with CloudWatch monitoring
    this.agentService = new ecs.FargateService(this, 'StrandsAgentService', {
      cluster: this.agentCluster,
      taskDefinition: taskDefinition,
      desiredCount: 1,
      assignPublicIp: false,
      serviceName: 'strands-agent-service',
    });

    // Create Auto Scaling based on SQS queue depth and CPU utilization
    const scaling = this.agentService.autoScaleTaskCount({
      minCapacity: 1,
      maxCapacity: 10,
    });

    // Scale based on CPU utilization for processing-intensive video operations
    scaling.scaleOnCpuUtilization('CpuScaling', {
      targetUtilizationPercent: 70,
      scaleInCooldown: cdk.Duration.minutes(5),
      scaleOutCooldown: cdk.Duration.minutes(2),
    });

    // Scale based on SQS queue depth - scale out when messages are waiting
    // COMMENTED OUT: Single task is sufficient for demo purposes to avoid job fluctuation between tasks
    // scaling.scaleOnMetric('SqsQueueDepthScaling', {
    //   metric: this.jobQueue.metricApproximateNumberOfMessagesVisible(),
    //   scalingSteps: [
    //     { upper: 0, change: -1 },    // Scale down when no messages
    //     { lower: 1, change: +1 },    // Scale up when messages are waiting
    //     { lower: 5, change: +2 },    // Scale up faster with more messages
    //   ],
    //   adjustmentType: cdk.aws_applicationautoscaling.AdjustmentType.CHANGE_IN_CAPACITY,
    // });

    // Create Lambda security group
    const lambdaSG = new ec2.SecurityGroup(this, 'AutoCreateLambdaSG', {
      vpc: props.vpc,
      description: 'Security group for Auto Create Lambda',
      allowAllOutbound: true,
    });

    // Allow outbound connections to HTTP and HTTPS
    lambdaSG.addEgressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), 'Allow HTTPS outbound');
    lambdaSG.addEgressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), 'Allow HTTP outbound');

    // Add ingress rules for VPC endpoint access
    lambdaSG.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), 'Allow HTTPS inbound');
    lambdaSG.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), 'Allow HTTP inbound');

    // Extract DynamoDB endpoint DNS
    const dynamoDbEndpointDns = cdk.Fn.select(
      1,
      cdk.Fn.split(
        ':',
        cdk.Fn.select(0, props.dynamodbEndpoint.vpcEndpointDnsEntries)
      )
    );
    const dynamoDbEndpointDnsHttp = `https://${dynamoDbEndpointDns}`;

    // Create Auto Create Lambda function
    this.autoCreateLambda = new nodejslambda.NodejsFunction(this, 'AutoCreateLambda', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: 'src/lambdas/auto-create/index.ts',
      timeout: cdk.Duration.seconds(30),
      vpc: props.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups: [lambdaSG],
      environment: {
        JOBS_TABLE: this.jobsTable.tableName,
        JOB_QUEUE_URL: this.jobQueue.queueUrl,
        INDEXES_TABLE_DYNAMODB_DNS_NAME: dynamoDbEndpointDnsHttp,
        // No AGENT_ENDPOINT needed - AutoCreate Lambda only manages jobs in DynamoDB/SQS
      },
      bundling: {
        minify: true,
        sourceMap: true,
        target: 'node20',
        format: nodejslambda.OutputFormat.CJS,
      }
    });

    // Create MCP Server Lambda function
    this.mcpServerLambda = new nodejslambda.NodejsFunction(this, 'MCPServerLambda', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: 'src/lambdas/mcp-server/index.ts',
      timeout: cdk.Duration.minutes(5),
      vpc: props.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups: [lambdaSG],
      environment: {
        VIDEO_SEARCH_FUNCTION_NAME: 'video-search-lambda',
        VIDEO_MERGE_FUNCTION_NAME: 'video-merge-lambda',
        OPENSEARCH_ENDPOINT: props.openSearchEndpoint,
        VIDEO_BUCKET: props.videoBucket,
        INDEXES_TABLE: props.indexesTable.tableName,
        INDEXES_TABLE_DYNAMODB_DNS_NAME: dynamoDbEndpointDnsHttp,
      },
      bundling: {
        minify: true,
        sourceMap: true,
        target: 'node20',
        format: nodejslambda.OutputFormat.CJS,
      }
    });

    // Grant permissions to Lambda functions
    this.jobsTable.grantReadWriteData(this.autoCreateLambda);
    this.jobQueue.grantSendMessages(this.autoCreateLambda);
    props.indexesTable.grantReadData(this.autoCreateLambda);

    // Grant permissions to MCP Server Lambda
    props.indexesTable.grantReadData(this.mcpServerLambda);
    
    // Grant Lambda invoke permissions to MCP Server
    this.mcpServerLambda.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['lambda:InvokeFunction'],
      resources: ['*'], // Will be restricted to specific functions
    }));

    // Add API Gateway resources to existing API
    this.addApiGatewayResources(props.api);
  }

  private addApiGatewayResources(api: apigateway.RestApi): void {
    // Helper function to add methods with CORS
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
    };

    // Create API resources for auto-create functionality
    const autoCreateResource = api.root.addResource('auto-create');
    
    // POST /auto-create - Create new job
    addMethodWithCors(autoCreateResource, 'POST', this.autoCreateLambda);

    // GET /auto-create/jobs - List jobs
    const jobsResource = autoCreateResource.addResource('jobs');
    addMethodWithCors(jobsResource, 'GET', this.autoCreateLambda);

    // GET /auto-create/jobs/{jobId} - Get job status
    const jobResource = jobsResource.addResource('{jobId}');
    addMethodWithCors(jobResource, 'GET', this.autoCreateLambda);

    // POST /auto-create/jobs/{jobId}/cancel - Cancel job
    const cancelResource = jobResource.addResource('cancel');
    addMethodWithCors(cancelResource, 'POST', this.autoCreateLambda);

    // GET /auto-create/stream/{jobId} - SSE stream
    const streamResource = autoCreateResource.addResource('stream');
    const streamJobResource = streamResource.addResource('{jobId}');
    addMethodWithCors(streamJobResource, 'GET', this.autoCreateLambda);

    // Add MCP server endpoint
    const mcpResource = api.root.addResource('mcp');
    addMethodWithCors(mcpResource, 'POST', this.mcpServerLambda);
  }

  /**
   * Add CDK outputs for debugging
   */
  public addOutputs(): void {

    // Output AWS CLI commands for debugging
    new cdk.CfnOutput(this, 'StrandsAgentDebugCommands', {
      value: [
        `# List running tasks:`,
        // Extrac the latter part, e.g. strands-agent-cluster/8d09967c20f64ee497bf04d9256b4cb2"
        `aws ecs list-tasks --cluster ${this.agentCluster.clusterName} --service-name ${this.agentService.serviceName}`,
        `# Tail the logs:`,
        `aws logs tail "/ecs/strands-agent" --log-stream-names "strands-agent/StrandsAgentContainer/30826052b06c45549a1eb77a6ea767c5" --region ap-northeast-1 --follow`
      ].join('\n'),
      description: 'AWS CLI commands for debugging Strands Agent'
    });

  }
}