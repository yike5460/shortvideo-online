import os
import json
import asyncio
import logging
from typing import Dict, Any, List
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import boto3
import uvicorn
from datetime import datetime

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="Strands Agent for Video Creation", version="1.0.0")

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
        self.system_prompt = """You are a video creation assistant that helps users create short videos from existing video libraries.

You have access to the following tools:
- video_search: Search for relevant video content using natural language
- video_merge: Merge multiple video segments into a single video
- video_slice: Extract specific clips from videos
- video_metadata: Get detailed information about videos
- index_query: Query available video indexes

Your task is to:
1. Understand the user's request for video creation
2. Search for relevant video content in their library
3. Select appropriate video segments
4. Merge them into a cohesive final video
5. Provide a description of the created video

Always be helpful and creative while working within the available video content."""

    async def process_request(self, job_message: JobMessage) -> Dict[str, Any]:
        """Process a video creation request using Claude and MCP tools"""
        try:
            logger.info(f"Processing job {job_message.jobId}: {job_message.request}")
            
            # Update job status to processing
            await self.update_job_status(job_message.jobId, job_message.userId, {
                'status': 'processing',
                'progress': 10,
                'logs': [f"Started processing at {datetime.now().isoformat()}"]
            })

            # Step 1: Analyze the request with Claude
            analysis = await self.analyze_request(job_message.request)
            
            await self.update_job_status(job_message.jobId, job_message.userId, {
                'progress': 30,
                'logs': [f"Request analyzed: {analysis.get('summary', 'Analysis complete')}"]
            })

            # Step 2: Search for relevant videos
            search_results = await self.search_videos(analysis.get('search_queries', [job_message.request]))
            
            await self.update_job_status(job_message.jobId, job_message.userId, {
                'progress': 50,
                'logs': [f"Found {len(search_results)} relevant video segments"]
            })

            # Step 3: Select and merge video segments
            if search_results:
                merge_result = await self.create_video(search_results, job_message.request)
                
                await self.update_job_status(job_message.jobId, job_message.userId, {
                    'progress': 90,
                    'logs': [f"Video creation completed: {merge_result.get('message', 'Success')}"]
                })

                # Step 4: Complete the job
                result = {
                    'videoUrl': merge_result.get('videoUrl', ''),
                    'thumbnailUrl': merge_result.get('thumbnailUrl', ''),
                    'description': merge_result.get('description', job_message.request),
                    'duration': merge_result.get('duration', 0),
                    's3Path': merge_result.get('s3Path', '')
                }

                await self.update_job_status(job_message.jobId, job_message.userId, {
                    'status': 'completed',
                    'progress': 100,
                    'result': result,
                    'completedAt': datetime.now().isoformat(),
                    'logs': ['Video creation completed successfully']
                })

                return result
            else:
                # No suitable videos found
                await self.update_job_status(job_message.jobId, job_message.userId, {
                    'status': 'failed',
                    'error': 'No suitable video content found for the request',
                    'completedAt': datetime.now().isoformat()
                })
                
                raise Exception("No suitable video content found")

        except Exception as e:
            logger.error(f"Error processing job {job_message.jobId}: {str(e)}")
            
            await self.update_job_status(job_message.jobId, job_message.userId, {
                'status': 'failed',
                'error': str(e),
                'completedAt': datetime.now().isoformat()
            })
            
            raise e

    async def analyze_request(self, request: str) -> Dict[str, Any]:
        """Use Claude to analyze the video creation request"""
        try:
            prompt = f"""Analyze this video creation request and provide a structured response:

Request: "{request}"

Please provide:
1. A summary of what the user wants
2. 2-3 search queries to find relevant video content
3. The type of video they want (educational, entertainment, tutorial, etc.)
4. Estimated duration preference
5. Key themes or topics to focus on

Respond in JSON format."""

            response = bedrock_client.invoke_model(
                modelId='anthropic.claude-3-7-sonnet-20250219-v1:0',
                body=json.dumps({
                    'anthropic_version': 'bedrock-2023-05-31',
                    'max_tokens': 1000,
                    'messages': [
                        {
                            'role': 'user',
                            'content': prompt
                        }
                    ]
                })
            )

            result = json.loads(response['body'].read())
            content = result['content'][0]['text']
            
            # Try to parse as JSON, fallback to basic structure
            try:
                return json.loads(content)
            except:
                return {
                    'summary': content,
                    'search_queries': [request],
                    'type': 'general',
                    'duration': 60
                }

        except Exception as e:
            logger.error(f"Error analyzing request: {str(e)}")
            return {
                'summary': request,
                'search_queries': [request],
                'type': 'general',
                'duration': 60
            }

    async def search_videos(self, queries: List[str]) -> List[Dict[str, Any]]:
        """Search for videos using the MCP video_search tool"""
        all_results = []
        
        for query in queries[:3]:  # Limit to 3 queries
            try:
                # This would call the MCP server's video_search tool
                # For now, return mock results
                mock_results = [
                    {
                        'videoId': f'video_{i}',
                        'segmentId': f'segment_{i}',
                        'indexId': 'videos',
                        'title': f'Video {i}',
                        'confidence': 0.8,
                        'duration': 30000,
                        's3Path': f'path/to/video_{i}.mp4'
                    }
                    for i in range(2)  # Mock 2 results per query
                ]
                all_results.extend(mock_results)
                
            except Exception as e:
                logger.error(f"Error searching for query '{query}': {str(e)}")
                continue
        
        return all_results[:5]  # Return top 5 results

    async def create_video(self, segments: List[Dict[str, Any]], original_request: str) -> Dict[str, Any]:
        """Create a video by merging selected segments"""
        try:
            # This would call the MCP server's video_merge tool
            # For now, return mock result
            return {
                'success': True,
                'message': 'Video created successfully',
                'videoUrl': 'https://example.com/created-video.mp4',
                'thumbnailUrl': 'https://example.com/thumbnail.jpg',
                'description': f'Auto-created video based on: {original_request}',
                'duration': sum(s.get('duration', 30000) for s in segments),
                's3Path': 'path/to/merged-video.mp4'
            }
            
        except Exception as e:
            logger.error(f"Error creating video: {str(e)}")
            raise e

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
    """Health check endpoint"""
    return {"status": "healthy", "timestamp": datetime.now().isoformat()}

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

@app.on_event("startup")
async def startup_event():
    """Start background tasks"""
    if JOB_QUEUE_URL:
        asyncio.create_task(poll_sqs_queue())
        logger.info("Started SQS polling task")

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8080)