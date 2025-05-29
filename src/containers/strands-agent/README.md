# Strands Agent for Video Creation

This container implements an autonomous video creation agent using the official Strands Agent SDK. The agent can process natural language requests to create videos by searching existing video libraries and merging relevant segments.

## Architecture

The implementation uses a hybrid approach that combines:
- **Official Strands Agent SDK** for AI orchestration and tool management
- **FastAPI** for HTTP endpoints and health checks
- **MCP (Model Context Protocol)** for video processing tools
- **AWS Integration** for SQS job processing and DynamoDB status updates

## Key Components

### 1. Strands Agent Integration (`agent_config.py`)
- Configures Strands Agent with BedrockModel (Claude 3.7 Sonnet)
- Registers video tools (`video_search`, `video_merge`)
- Provides comprehensive system prompt for video creation

### 2. MCP Client (`mcp_client.py`)
- HTTP client for communicating with Lambda MCP server
- Implements retry logic and error handling
- Supports tool execution and server health checks

### 3. Video Tools (`video_tools.py`)
- `@tool` decorated functions for Strands Agent
- `video_search`: Search video library using natural language
- `video_merge`: Merge video segments with transitions
- Real MCP server integration (no mock data)

### 4. Main Application (`main.py`)
- FastAPI server with health checks and monitoring
- SQS job processing with background polling
- Strands Agent streaming with progress updates
- DynamoDB status tracking

## Environment Variables

### Required
```bash
AWS_REGION=us-east-1
MCP_SERVER_URL=https://your-api-gateway-url/prod/mcp
OPENSEARCH_ENDPOINT=https://your-opensearch-collection.us-east-1.aoss.amazonaws.com
VIDEO_BUCKET=your-video-bucket-name
JOBS_TABLE=auto-create-jobs
INDEXES_TABLE=your-indexes-table-name
```

### Optional
```bash
JOB_QUEUE_URL=https://sqs.us-east-1.amazonaws.com/account/strands-agent-jobs.fifo
```

## API Endpoints

### Health & Status
- `GET /health` - Comprehensive health check with dependency validation
- `GET /` - Basic service information
- `GET /agent/info` - Strands Agent configuration details
- `GET /agent/validate` - Validate agent setup and dependencies

### Job Processing
- `POST /process-job` - Process video creation job directly
- Background SQS polling for automatic job processing

## Usage

### Direct API Call
```bash
curl -X POST http://localhost:8080/process-job \
  -H "Content-Type: application/json" \
  -d '{
    "jobId": "test-job-123",
    "request": "Create a video about English education for K12 students",
    "userId": "user-123",
    "options": {"maxDuration": 120}
  }'
```

### Health Check
```bash
curl http://localhost:8080/health
```

### Agent Information
```bash
curl http://localhost:8080/agent/info
```

## Development

### Dependencies
The implementation requires:
- `strands-agents>=0.1.0` - Official Strands Agent SDK
- `mcp>=1.0.0` - Model Context Protocol support
- `fastapi`, `uvicorn` - Web framework
- `boto3` - AWS SDK
- `aiohttp` - HTTP client for MCP communication

### Testing
Run integration tests:
```bash
python test_integration.py
```

This will test:
- MCP server connection
- Video tools functionality
- Strands Agent creation
- Overall system validation

### Local Development
1. Set environment variables
2. Ensure MCP server is accessible
3. Run the application:
```bash
python main.py
```

## Video Creation Workflow

1. **Job Received**: Via SQS or direct API call
2. **Agent Processing**: Strands Agent analyzes the request
3. **Video Search**: Uses `video_search` tool to find relevant content
4. **Segment Selection**: Agent selects best segments for coherent narrative
5. **Video Merging**: Uses `video_merge` tool to combine segments
6. **Status Updates**: Real-time progress updates via DynamoDB
7. **Completion**: Final video URLs and metadata returned

## Error Handling

- **MCP Server Failures**: Retry logic with exponential backoff
- **Tool Execution Errors**: Graceful degradation with detailed logging
- **Agent Failures**: Comprehensive error capture and status updates
- **Network Issues**: Timeout handling and connection validation

## Monitoring

### Health Checks
The `/health` endpoint validates:
- Environment variable configuration
- MCP server connectivity
- Strands Agent initialization
- SQS queue configuration

### Logging
Structured logging with:
- Job processing progress
- Tool execution details
- Error conditions and recovery
- Performance metrics

## Deployment

### Docker Build
```bash
docker build -t strands-agent .
```

### ECS Deployment
The container is designed for AWS ECS Fargate deployment with:
- Auto-scaling based on CPU utilization
- Health check integration
- VPC networking for secure communication
- IAM roles for AWS service access

## Troubleshooting

### Common Issues

1. **MCP Connection Failed**
   - Check `MCP_SERVER_URL` environment variable
   - Verify Lambda MCP server is deployed and accessible
   - Check VPC networking and security groups

2. **Bedrock Access Denied**
   - Verify IAM permissions for Bedrock access
   - Check model access is enabled in Bedrock console
   - Confirm correct AWS region configuration

3. **Video Tools Not Working**
   - Test MCP server directly: `curl -X POST $MCP_SERVER_URL`
   - Check Lambda function logs for video processing errors
   - Verify video indexes exist and are accessible

4. **SQS Processing Issues**
   - Check `JOB_QUEUE_URL` configuration
   - Verify SQS permissions and queue exists
   - Monitor DynamoDB for job status updates

### Debug Mode
Enable debug logging:
```python
logging.getLogger("strands").setLevel(logging.DEBUG)
```

## Performance Considerations

- **Concurrent Processing**: Single job processing per container instance
- **Memory Usage**: ~4GB recommended for Strands Agent and video processing
- **Network**: Optimized for VPC deployment with endpoint access
- **Scaling**: Horizontal scaling via ECS service auto-scaling

## Security

- **IAM Roles**: Least-privilege access to AWS services
- **VPC Isolation**: Private subnet deployment
- **API Security**: Input validation and error sanitization
- **Secrets Management**: Environment variables for sensitive configuration