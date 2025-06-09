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
            
            # Create a fresh agent instance for each job to prevent conversation history accumulation
            logger.info("Creating fresh agent instance to prevent conversation history issues")
            fresh_agent = create_strands_agent()
            
            # Update job status to processing
            await self.update_job_status(job_message.jobId, job_message.userId, {
                'status': 'processing',
                'progress': 10,
                'logs': [f"Started processing at {datetime.now().isoformat()}"]
            })

            # Extract index from options or use default
            selected_index = job_message.options.get('selectedIndex', 'videos') if job_message.options else 'videos'
            
            # Check for fast mode to determine prompt style
            use_fast_mode = job_message.options.get('fastMode', True) if job_message.options else True
            
            if use_fast_mode:
                # Fast mode: Direct, action-oriented prompt
                prompt = f"""EXECUTE IMMEDIATELY: Create video for "{job_message.request}"

ACTIONS:
1. video_search(query="{job_message.request}", indexes=["{selected_index}"], top_k=5, fast_mode=True)
2. Select top 3 segments by confidence
3. video_merge(segments=selected, output_name="auto_{job_message.jobId[:8]}", resolution="720p")

INDEX: {selected_index}
MODE: Direct execution, minimal cycles, fast processing with skipValidation=True"""
            else:
                # Standard mode: Detailed, conversational prompt
                prompt = f"""Create a short video based on this request: "{job_message.request}"

Please search for videos using index '{selected_index}' and follow these steps:
1. Search for relevant video content in the '{selected_index}' index that matches this request
2. Select the best segments that create a coherent narrative
3. Merge them into a cohesive video with appropriate transitions
4. Provide details about the final video including description and key segments used

User options: {json.dumps(job_message.options, indent=2) if job_message.options else 'None specified'}
Selected video index: {selected_index}

Remember to be thorough in your search within the specified index and selective in choosing segments that best match the user's intent."""

            # Process with streaming for progress updates using fresh agent
            result = await self.process_with_streaming(prompt, job_message, fresh_agent)
            
            return result
            
        except Exception as e:
            logger.error(f"Error processing job {job_message.jobId}: {str(e)}")
            await self.update_job_status(job_message.jobId, job_message.userId, {
                'status': 'failed',
                'error': str(e),
                'completedAt': datetime.now().isoformat()
            })
            raise e

    async def process_with_streaming(self, prompt: str, job_message: JobMessage, agent) -> Dict[str, Any]:
        """Process request with streaming using Strands Agent"""
        progress = 30
        video_result = None
        
        try:
            # Determine processing mode from prompt
            is_fast_mode = "EXECUTE IMMEDIATELY" in prompt
            mode_name = "fast mode" if is_fast_mode else "standard mode"
            
            logger.info(f"Starting Strands Agent processing for job {job_message.jobId} using {mode_name}")
            logger.info(f"Initial prompt length: {len(prompt)} characters")
            
            # Log agent state before streaming
            try:
                if hasattr(agent, 'conversation') and agent.conversation:
                    logger.info(f"Agent conversation history before streaming: {len(agent.conversation.messages)} messages")
                    for i, msg in enumerate(agent.conversation.messages):
                        content_preview = str(msg.content)[:100] if msg.content else "EMPTY_CONTENT"
                        logger.info(f"Message {i}: role={msg.role}, content_preview='{content_preview}...'")
                else:
                    logger.info("Agent has no conversation history before streaming")
            except Exception as e:
                logger.warning(f"Could not inspect agent conversation: {e}")
            
            # Use async streaming from Strands Agent
            event_count = 0
            async for event in agent.stream_async(prompt):
                event_count += 1
                logger.debug(f"Streaming event {event_count}: {event}")
                
                if "current_tool_use" in event and event["current_tool_use"]:
                    tool_info = event["current_tool_use"]
                    tool_name = tool_info.get("name")
                    logger.info(f"Tool use detected: {tool_name}")
                    
                    if tool_name == "video_search":
                        progress = 50
                        await self.update_job_status(job_message.jobId, job_message.userId, {
                            'progress': progress,
                            'logs': [f"Searching for video content using {mode_name}..."]
                        })
                        
                    elif tool_name == "video_merge":
                        progress = 80
                        await self.update_job_status(job_message.jobId, job_message.userId, {
                            'progress': progress,
                            'logs': [f"Merging video segments using {mode_name}..."]
                        })
                
                # Capture streaming text output
                if "data" in event:
                    logger.debug(f"Agent output: {event['data']}")
            
            logger.info(f"Streaming completed after {event_count} events")
            
            # Log agent state after streaming but before final call
            try:
                if hasattr(agent, 'conversation') and agent.conversation:
                    logger.info(f"Agent conversation history after streaming: {len(agent.conversation.messages)} messages")
                    for i, msg in enumerate(agent.conversation.messages):
                        content_preview = str(msg.content)[:100] if msg.content else "EMPTY_CONTENT"
                        logger.warning(f"Message {i}: role={msg.role}, content_preview='{content_preview}...'")
                        if not msg.content or (isinstance(msg.content, str) and not msg.content.strip()):
                            logger.error(f"FOUND EMPTY MESSAGE at index {i}: role={msg.role}, content={repr(msg.content)}")
                else:
                    logger.info("Agent has no conversation history after streaming")
            except Exception as e:
                logger.warning(f"Could not inspect agent conversation after streaming: {e}")
            
            # Get final result from agent
            logger.info("Making final agent call...")
            try:
                final_result = agent(prompt)
                logger.info("Final agent call completed successfully")
            except Exception as bedrock_error:
                logger.error(f"Final agent call failed: {str(bedrock_error)}")
                
                # Log detailed error information for ValidationException
                if "ValidationException" in str(bedrock_error):
                    logger.error("BEDROCK VALIDATION EXCEPTION DETAILS:")
                    logger.error(f"Error message: {str(bedrock_error)}")
                    
                    # Try to inspect conversation state when error occurs
                    try:
                        if hasattr(agent, 'conversation') and agent.conversation:
                            logger.error(f"Conversation has {len(agent.conversation.messages)} messages at time of error")
                            # Log messages around the problematic message 38
                            for i in range(max(0, 35), min(len(agent.conversation.messages), 42)):
                                msg = agent.conversation.messages[i]
                                content_info = f"content_type={type(msg.content)}, content_length={len(str(msg.content)) if msg.content else 0}"
                                if not msg.content or (isinstance(msg.content, str) and not msg.content.strip()):
                                    logger.error(f"EMPTY MESSAGE FOUND at index {i}: role={msg.role}, {content_info}, content={repr(msg.content)}")
                                else:
                                    logger.error(f"Message {i}: role={msg.role}, {content_info}")
                    except Exception as inspect_error:
                        logger.error(f"Could not inspect conversation during error: {inspect_error}")
                
                raise bedrock_error
            
            # Extract video information from the agent's response and conversation history
            video_result = self.extract_video_result(final_result, job_message.request, agent)
            video_result['processingMode'] = mode_name
            
            await self.update_job_status(job_message.jobId, job_message.userId, {
                'status': 'completed',
                'progress': 100,
                'result': video_result,
                'completedAt': datetime.now().isoformat(),
                'logs': [f'Video creation completed using {mode_name}']
            })
            
            return video_result
            
        except Exception as e:
            logger.error(f"Streaming process failed for job {job_message.jobId}: {str(e)}")
            # Check if it's a throttling error
            if "ThrottlingException" in str(e) or "Too many tokens" in str(e):
                logger.error("Bedrock throttling detected - try using fast mode")
            elif "ValidationException" in str(e) and "empty" in str(e):
                logger.error("Empty message content detected - this indicates a conversation history issue")
            raise e
    
    def extract_video_result(self, agent_response, original_request: str, agent=None) -> Dict[str, Any]:
        """Extract structured video result from agent response and tool results"""
        logger.info(f"Extracting video result from agent response type: {type(agent_response)}")
        
        # Initialize default values
        duration = 0
        description = original_request
        video_merge_result = None
        video_search_results = []
        
        try:
            # Extract tool results from agent conversation history
            if agent and hasattr(agent, 'conversation') and agent.conversation:
                logger.info(f"Analyzing agent conversation with {len(agent.conversation.messages)} messages")
                
                for i, message in enumerate(agent.conversation.messages):
                    try:
                        # Look for tool results in the conversation
                        if hasattr(message, 'content') and message.content:
                            content_str = str(message.content)
                            
                            # Check for video_merge tool results
                            if 'video_merge' in content_str and 'jobId' in content_str:
                                logger.info(f"Found video_merge result in message {i}")
                                try:
                                    import json
                                    if '{' in content_str and '}' in content_str:
                                        json_start = content_str.find('{')
                                        json_end = content_str.rfind('}') + 1
                                        json_str = content_str[json_start:json_end]
                                        video_merge_result = json.loads(json_str)
                                        logger.info(f"Extracted video_merge result: {video_merge_result}")
                                except Exception as e:
                                    logger.warning(f"Could not parse video_merge JSON: {e}")
                            
                            # Check for video_search tool results
                            if 'video_search' in content_str and ('videoId' in content_str or 'segmentId' in content_str):
                                logger.info(f"Found video_search result in message {i}")
                                try:
                                    import json
                                    if '[' in content_str and ']' in content_str:
                                        json_start = content_str.find('[')
                                        json_end = content_str.rfind(']') + 1
                                        json_str = content_str[json_start:json_end]
                                        search_results = json.loads(json_str)
                                        if isinstance(search_results, list):
                                            video_search_results.extend(search_results)
                                            logger.info(f"Extracted {len(search_results)} video search results")
                                except Exception as e:
                                    logger.warning(f"Could not parse video_search JSON: {e}")
                                    
                    except Exception as e:
                        logger.warning(f"Error processing message {i}: {e}")
            
            # Extract video information from tool results
            if video_merge_result:
                logger.info("Using video_merge result for video information")
                custom_name = video_merge_result.get('customName', 'merged-video')
                
                # Calculate duration from search results if available
                if video_search_results:
                    total_duration = sum(segment.get('duration', 0) for segment in video_search_results)
                    duration = total_duration // 1000 if total_duration > 1000 else total_duration
                    logger.info(f"Calculated duration from segments: {duration} seconds")
                
                # Create meaningful description
                segment_count = video_merge_result.get('segmentCount', len(video_search_results))
                description = f"Successfully created video '{custom_name}' by merging {segment_count} video segments for: {original_request}"
            else:
                # Fallback description if no tool results found
                logger.info("No video_merge result found, using fallback description")
                description = f"Video creation completed for: {original_request}"
                
            # Set default duration if not calculated
            if duration == 0:
                duration = 30  # Default 30 seconds
                
        except Exception as e:
            logger.error(f"Error extracting video result: {str(e)}")
            # Fallback to safe defaults
            duration = 30
            description = f"Video creation completed for: {original_request}"
        
        # Simplified result structure - no longer need video URLs or thumbnails
        result = {
            'description': description,  # Guaranteed to be a string
            'duration': duration,  # Duration in seconds for frontend
            'originalRequest': original_request
        }
        
        logger.info(f"Final extracted result: {result}")
        return result

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
                    logger.info(f"Received job message: {job_message}")
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