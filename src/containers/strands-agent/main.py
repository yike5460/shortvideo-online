import os
import json
import asyncio
import logging
from typing import Dict, Any, List
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import boto3
import uvicorn
from datetime import datetime

# Strands Agent imports - Fix relative import issue
try:
    # Try relative imports first (for package mode)
    from .agent_config import create_strands_agent, validate_agent_setup, get_agent_info
    print("DEBUG: Successfully imported with relative imports")
except ImportError as e:
    print(f"DEBUG: Relative import failed: {e}")
    # Fallback to absolute imports (for script mode)
    from agent_config import create_strands_agent, validate_agent_setup, get_agent_info
    print("DEBUG: Successfully imported with absolute imports")

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Background task management
background_tasks = set()

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    if JOB_QUEUE_URL:
        task = asyncio.create_task(poll_sqs_queue())
        background_tasks.add(task)
        logger.info("Started SQS polling task")
    yield
    # Shutdown
    for task in background_tasks:
        task.cancel()
    await asyncio.gather(*background_tasks, return_exceptions=True)

app = FastAPI(title="Strands Agent for Video Creation", version="1.0.0", lifespan=lifespan)

# AWS clients
sqs_client = boto3.client('sqs')
dynamodb = boto3.resource('dynamodb')
bedrock_client = boto3.client('bedrock-runtime')

# Environment variables
JOB_QUEUE_URL = os.getenv('JOB_QUEUE_URL')
JOBS_TABLE_NAME = os.getenv('JOBS_TABLE')
MCP_SERVER_URL = os.getenv('MCP_SERVER_URL', 'http://localhost:8001')

class JobMessage(BaseModel):
    jobId: str
    request: str
    userId: str
    options: Dict[str, Any] = {}

class AgentResponse(BaseModel):
    success: bool
    message: str
    data: Dict[str, Any] = {}

class StrandsVideoAgent:
    def __init__(self):
        """Initialize Strands Video Agent with official SDK"""
        try:
            self.agent = create_strands_agent()
            logger.info("StrandsVideoAgent initialized with official Strands SDK")
        except Exception as e:
            logger.error(f"Failed to initialize StrandsVideoAgent: {str(e)}")
            raise e

    async def process_request(self, job_message: JobMessage) -> Dict[str, Any]:
        """Process video creation request using Strands Agent"""
        try:
            logger.info(f"Processing job {job_message.jobId}: {job_message.request}")
            
            # Update job status to processing
            await self.update_job_status(job_message.jobId, job_message.userId, {
                'status': 'processing',
                'progress': 10,
                'logs': [f"Started processing at {datetime.now().isoformat()}"]
            })

            # Extract index from options or use default
            selected_index = job_message.options.get('selectedIndex', 'videos') if job_message.options else 'videos'
            
            # Create prompt for Strands Agent with index specification
            prompt = f"""Create a short video based on this request: "{job_message.request}"

Please search for videos using index '{selected_index}' and follow these steps:
1. Search for relevant video content in the '{selected_index}' index that matches this request
2. Select the best segments that create a coherent narrative
3. Merge them into a cohesive video with appropriate transitions
4. Provide details about the final video including description and key segments used

User options: {json.dumps(job_message.options, indent=2) if job_message.options else 'None specified'}
Selected video index: {selected_index}

Remember to be thorough in your search within the specified index and selective in choosing segments that best match the user's intent."""

            # Process with streaming for progress updates
            result = await self.process_with_streaming(prompt, job_message)
            
            return result
            
        except Exception as e:
            logger.error(f"Error processing job {job_message.jobId}: {str(e)}")
            await self.update_job_status(job_message.jobId, job_message.userId, {
                'status': 'failed',
                'error': str(e),
                'completedAt': datetime.now().isoformat()
            })
            raise e

    async def process_with_streaming(self, prompt: str, job_message: JobMessage) -> Dict[str, Any]:
        """Process request with progress streaming using Strands Agent"""
        progress = 30
        video_result = None
        
        try:
            logger.info(f"Starting Strands Agent processing for job {job_message.jobId}")
            
            # Use async streaming from Strands Agent
            async for event in self.agent.stream_async(prompt):
                if "current_tool_use" in event and event["current_tool_use"]:
                    tool_info = event["current_tool_use"]
                    tool_name = tool_info.get("name")
                    
                    if tool_name == "video_search":
                        progress = 50
                        await self.update_job_status(job_message.jobId, job_message.userId, {
                            'progress': progress,
                            'logs': [f"Searching for video content..."]
                        })
                        
                    elif tool_name == "video_merge":
                        progress = 80
                        await self.update_job_status(job_message.jobId, job_message.userId, {
                            'progress': progress,
                            'logs': [f"Merging video segments..."]
                        })
                
                # Capture streaming text output
                if "data" in event:
                    # This is streaming text output from the agent
                    logger.debug(f"Agent output: {event['data']}")
            
            # Get final result from agent
            final_result = self.agent(prompt)
            
            # Extract video information from the agent's response
            video_result = self.extract_video_result(final_result.message, job_message.request)
            
            await self.update_job_status(job_message.jobId, job_message.userId, {
                'status': 'completed',
                'progress': 100,
                'result': video_result,
                'completedAt': datetime.now().isoformat(),
                'logs': ['Video creation completed successfully']
            })
            
            return video_result
            
        except Exception as e:
            logger.error(f"Streaming process failed for job {job_message.jobId}: {str(e)}")
            raise e
    
    def extract_video_result(self, agent_response: str, original_request: str) -> Dict[str, Any]:
        """Extract structured video result from agent response"""
        # This is a simplified extraction - the agent should provide structured information
        # about the video creation process including the final video details
        
        # For now, return a basic structure that will be enhanced by the actual tool results
        return {
            'videoUrl': 'https://example.com/created-video.mp4',  # Will be populated by video_merge tool
            'thumbnailUrl': 'https://example.com/thumbnail.jpg',
            'description': agent_response,
            'duration': 60000,  # Will be calculated from segments
            's3Path': 'path/to/merged-video.mp4',
            'originalRequest': original_request,
            'agentResponse': agent_response
        }

    async def update_job_status(self, job_id: str, user_id: str, updates: Dict[str, Any]):
        """Update job status in DynamoDB"""
        try:
            table = dynamodb.Table(JOBS_TABLE_NAME)
            
            # Build update expression
            update_expression = "SET "
            expression_values = {}
            
            for key, value in updates.items():
                update_expression += f"#{key} = :{key}, "
                expression_values[f":{key}"] = value
            
            update_expression = update_expression.rstrip(", ")
            expression_names = {f"#{key}": key for key in updates.keys()}
            
            table.update_item(
                Key={'jobId': job_id, 'userId': user_id},
                UpdateExpression=update_expression,
                ExpressionAttributeNames=expression_names,
                ExpressionAttributeValues=expression_values
            )
            
        except Exception as e:
            logger.error(f"Error updating job status: {str(e)}")

# Initialize the agent
agent = StrandsVideoAgent()

@app.get("/health")
async def health_check():
    """Health check endpoint with dependency verification"""
    try:
        # Basic health status
        health_status = {
            "status": "healthy",
            "timestamp": datetime.now().isoformat(),
            "service": "strands-agent",
            "version": "1.0.0"
        }
        
        # Check if required environment variables are present
        required_env_vars = ['OPENSEARCH_ENDPOINT', 'VIDEO_BUCKET', 'JOBS_TABLE', 'INDEXES_TABLE', 'MCP_SERVER_URL']
        missing_vars = [var for var in required_env_vars if not os.getenv(var)]
        
        if missing_vars:
            # Critical environment variables missing - return 503 Service Unavailable
            health_status["status"] = "unhealthy"
            health_status["error"] = f"Missing critical environment variables: {missing_vars}"
            logger.error(f"Health check failed: Missing env vars: {missing_vars}")
            raise HTTPException(status_code=503, detail=health_status)
        
        # Check if SQS queue URL is configured (optional - just warning)
        if JOB_QUEUE_URL:
            health_status["sqs_queue_configured"] = True
        else:
            health_status["sqs_queue_configured"] = False
            health_status["warnings"] = health_status.get("warnings", []) + ["SQS queue not configured - background processing disabled"]
        
        # Validate MCP connection and agent setup
        try:
            validation_results = await validate_agent_setup()
            health_status["mcp_validation"] = validation_results
            
            if not all(validation_results.values()):
                health_status["warnings"] = health_status.get("warnings", []) + ["Some MCP validation checks failed"]
                
        except Exception as e:
            health_status["mcp_validation"] = {"error": str(e)}
            health_status["warnings"] = health_status.get("warnings", []) + [f"MCP validation failed: {str(e)}"]
        
        # Check Strands Agent configuration
        try:
            agent_info = get_agent_info()
            health_status["strands_agent"] = {
                "status": "configured",
                "model_id": agent_info["model_id"],
                "integration_type": agent_info["integration_type"],
                "mcp_server_url": agent_info["mcp_server_url"]
            }
        except Exception as e:
            health_status["strands_agent"] = {
                "status": "error",
                "error": str(e)
            }
            health_status["warnings"] = health_status.get("warnings", []) + [f"Strands Agent info failed: {str(e)}"]
            
        # All critical checks passed - return 200 OK
        return health_status
        
    except HTTPException:
        # Re-raise HTTP exceptions (like 503 above)
        raise
    except Exception as e:
        # Unexpected error - return 500 Internal Server Error
        logger.error(f"Health check failed with unexpected error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Health check failed: {str(e)}")

# Add a simple root endpoint as well
@app.get("/")
async def root():
    """Root endpoint"""
    return {"message": "Strands Agent API", "status": "running", "version": "1.0.0"}

@app.get("/agent/info")
async def get_agent_info_endpoint():
    """Get information about the Strands Agent configuration"""
    try:
        agent_info = get_agent_info()
        
        # Add MCP validation information
        try:
            validation_results = await validate_agent_setup()
            agent_info["mcp_validation"] = validation_results
        except Exception as e:
            agent_info["mcp_validation_error"] = str(e)
        
        return agent_info
    except Exception as e:
        logger.error(f"Failed to get agent info: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to get agent info: {str(e)}")

@app.get("/agent/validate")
async def validate_agent_endpoint():
    """Validate agent setup and dependencies"""
    try:
        validation_results = await validate_agent_setup()
        
        # Determine overall status
        all_healthy = all(validation_results.values())
        status_code = 200 if all_healthy else 503
        
        return {
            "status": "healthy" if all_healthy else "unhealthy",
            "timestamp": datetime.now().isoformat(),
            "validation_results": validation_results
        }
    except Exception as e:
        logger.error(f"Agent validation failed: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Agent validation failed: {str(e)}")

@app.post("/process-job")
async def process_job(job_message: JobMessage):
    """Process a video creation job"""
    try:
        result = await agent.process_request(job_message)
        return AgentResponse(success=True, message="Job processed successfully", data=result)
    except Exception as e:
        logger.error(f"Error processing job: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

async def poll_sqs_queue():
    """Poll SQS queue for new jobs"""
    while True:
        try:
            if not JOB_QUEUE_URL:
                await asyncio.sleep(10)
                continue
                
            response = sqs_client.receive_message(
                QueueUrl=JOB_QUEUE_URL,
                MaxNumberOfMessages=1,
                WaitTimeSeconds=20
            )
            
            messages = response.get('Messages', [])
            
            for message in messages:
                try:
                    body = json.loads(message['Body'])
                    job_message = JobMessage(**body)
                    logger.info(f"Processing job {job_message.jobId}: {job_message.request}")
                    logger.info(f"Job message: {job_message}")

                    # Process the job
                    await agent.process_request(job_message)
                    
                    # Delete the message from queue
                    sqs_client.delete_message(
                        QueueUrl=JOB_QUEUE_URL,
                        ReceiptHandle=message['ReceiptHandle']
                    )
                    
                except Exception as e:
                    logger.error(f"Error processing SQS message: {str(e)}")
                    
        except Exception as e:
            logger.error(f"Error polling SQS queue: {str(e)}")
            await asyncio.sleep(30)