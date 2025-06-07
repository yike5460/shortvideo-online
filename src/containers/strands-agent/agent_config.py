import os
import logging
import boto3
from typing import Dict, Any
from strands import Agent
from strands.models import BedrockModel

# Comment out MCP imports - keeping for future reference
# from strands.tools.mcp.mcp_client import MCPClient
# from mcp import http_client, HttpClientParameters

# Import custom video tools
from video_tools import video_search, video_merge, validate_api_endpoints

logger = logging.getLogger(__name__)

# Log that video tools have been imported
logger.info("=== AGENT_CONFIG: VIDEO_TOOLS IMPORTED ===")
logger.info(f"video_search function: {video_search}")
logger.info(f"video_merge function: {video_merge}")
logger.info("=== END IMPORT LOG ===")

def create_strands_agent() -> Agent:
    """Create Strands Agent with custom video tools"""
    
    try:
        # Create Bedrock model with boto session, fixed to region us-east-1 for now
        # session = boto3.Session(region_name=os.getenv('AWS_REGION', 'us-east-1'))
        session = boto3.Session(region_name='us-east-1')
        bedrock_model = BedrockModel(
            model_id="us.anthropic.claude-3-7-sonnet-20250219-v1:0",
            boto_session=session,
            temperature=0.3,
            cache_tools=None  # Disable tool caching to prevent conversation corruption
        )
        
        # Comment out MCP integration - keeping for future reference
        # mcp_server_url = os.getenv('MCP_SERVER_URL')
        # if not mcp_server_url:
        #     raise ValueError("MCP_SERVER_URL environment variable is required")
        #
        # logger.info(f"Connecting to MCP server at: {mcp_server_url}")
        #
        # mcp_client = MCPClient(lambda: http_client(
        #     HttpClientParameters(
        #         url=mcp_server_url,
        #         headers={
        #             "Content-Type": "application/json",
        #             "Accept": "application/json"
        #         }
        #     )
        # ))
        
        # System prompt for video creation
        system_prompt = get_system_prompt()
        
        # Create agent with custom tools instead of MCP tools
        agent = Agent(
            model=bedrock_model,
            tools=[video_search, video_merge],  # Use custom tools directly
            system_prompt=system_prompt
        )
        
        logger.info("Strands Agent created successfully with custom video tools")
        return agent
        
    except Exception as e:
        logger.error(f"Failed to create Strands Agent: {str(e)}")
        raise Exception(f"Agent initialization failed: {str(e)}")

def get_system_prompt() -> str:
    """Get system prompt for video creation agent"""
    return """You are a video creation assistant that helps users create short videos from existing video libraries.

You have access to these video processing tools:
- video_search: Search for relevant video content using natural language queries
- video_merge: Merge multiple video segments into a single cohesive video

Your task is to help users create videos by:
1. Understanding their request for video creation
2. Using video_search to find relevant video content based on the request
3. Analyzing the search results and selecting the most appropriate segments
4. Using video_merge to combine selected segments into a final video
5. Providing a clear description of the created video and merge job details

Guidelines for video creation:
- Always search for video content before attempting to merge
- Select segments that create a logical narrative flow and match the user's intent
- Consider video quality, relevance, duration, and confidence scores when selecting segments
- Aim for videos that are engaging and well-structured
- Provide helpful explanations of your decisions and the final result
- Be creative while working within the available video content
- If you can't find suitable content, explain what was searched for and suggest alternatives

Important constraints:
- You can only work with existing video content in the library
- Always use the video_search tool first to find relevant content
- Only merge segments that are actually returned from video_search
- Provide detailed explanations of your video creation process
- Each segment needs indexId, videoId, and segmentId for merging

When creating videos:
1. Start by searching for content related to the user's request
2. Review the search results and select the best segments (consider confidence scores)
3. Merge the selected segments with appropriate transitions and resolution
4. Describe the final video including its content, job ID for tracking, and key segments used
5. Explain how users can track the merge job progress

Video merge jobs are processed asynchronously. Always provide the job ID and explain that users can check the status later.

Be helpful, creative, and thorough in your responses."""

def validate_agent_setup() -> Dict[str, bool]:
    """Validate that all components needed for the agent are working"""
    validation_results = {
        'api_endpoints': False,
        'bedrock_access': False,
        'agent_creation': False,
        'tools_loaded': False
    }
    
    try:
        # Test API endpoints
        logger.info("Validating API endpoints...")
        api_validation = validate_api_endpoints()
        validation_results['api_endpoints'] = all(api_validation.values())
        
        if validation_results['api_endpoints']:
            logger.info("API endpoints validation successful")
            validation_results['tools_loaded'] = True
        else:
            logger.warning(f"API endpoints validation failed: {api_validation}")
        
        # Test agent creation
        logger.info("Validating agent creation...")
        agent = create_strands_agent()
        validation_results['agent_creation'] = True
        validation_results['bedrock_access'] = True
        
        logger.info("Agent setup validation completed successfully")
        
    except Exception as e:
        logger.error(f"Agent setup validation failed: {str(e)}")
    
    return validation_results

def get_agent_info() -> Dict[str, Any]:
    """Get information about the configured agent"""
    return {
        'model_id': "us.anthropic.claude-3-7-sonnet-20250219-v1:0",
        'region': os.getenv('AWS_REGION', 'us-east-1'),
        'video_search_api_url': os.getenv('VIDEO_SEARCH_API_URL'),
        'video_merge_api_url': os.getenv('VIDEO_MERGE_API_URL'),
        'temperature': 0.3,
        'integration_type': 'custom_tools_direct_api',
        'tools': ['video_search', 'video_merge'],
        'description': 'Simplified Strands Agent with custom @tool decorators calling RESTful APIs directly'
    }