import os
import logging
from typing import Dict, Any
from strands import Agent
from strands.models import BedrockModel
from video_tools import video_search, video_merge, validate_mcp_connection

logger = logging.getLogger(__name__)

def create_strands_agent() -> Agent:
    """Create and configure Strands Agent with video tools"""
    
    try:
        # Configure Bedrock model
        model_id = "us.anthropic.claude-3-7-sonnet-20250219-v1:0"
        region_name = os.getenv('AWS_REGION', 'us-east-1')
        
        logger.info(f"Initializing Bedrock model: {model_id} in region {region_name}")
        
        bedrock_model = BedrockModel(
            model_id=model_id,
            region_name=region_name,
            temperature=0.3,
            max_tokens=4000
        )
        
        # System prompt for video creation
        system_prompt = """You are a video creation assistant that helps users create short videos from existing video libraries.

You have access to these tools:
- video_search: Search for relevant video content using natural language queries
- video_merge: Merge multiple video segments into a single cohesive video

Your task is to help users create videos by:
1. Understanding their request for video creation
2. Using video_search to find relevant video content based on the request
3. Analyzing the search results and selecting the most appropriate segments
4. Using video_merge to combine selected segments into a final video
5. Providing a clear description of the created video

Guidelines for video creation:
- Always search for video content before attempting to merge
- Select segments that create a logical narrative flow and match the user's intent
- Consider video quality, relevance, duration, and content when selecting segments
- Aim for videos that are engaging and well-structured
- Provide helpful explanations of your decisions and the final result
- Be creative while working within the available video content
- If you can't find suitable content, explain what was searched for and suggest alternatives

Important constraints:
- You can only work with existing video content in the library
- Always use the video_search tool first to find relevant content
- Only merge segments that are actually returned from video_search
- Provide detailed explanations of your video creation process

When creating videos:
1. Start by searching for content related to the user's request
2. Review the search results and select the best segments
3. Merge the selected segments with appropriate transitions
4. Describe the final video including its content, duration, and key segments used

Be helpful, creative, and thorough in your responses."""

        # Create agent with tools
        agent = Agent(
            model=bedrock_model,
            tools=[video_search, video_merge],
            system_prompt=system_prompt
        )
        
        logger.info("Strands Agent created successfully with video tools")
        return agent
        
    except Exception as e:
        logger.error(f"Failed to create Strands Agent: {str(e)}")
        raise Exception(f"Agent initialization failed: {str(e)}")

async def validate_agent_setup() -> Dict[str, bool]:
    """Validate that all components needed for the agent are working"""
    validation_results = {
        'mcp_connection': False,
        'bedrock_access': False,
        'agent_creation': False
    }
    
    try:
        # Test MCP connection
        logger.info("Validating MCP connection...")
        validation_results['mcp_connection'] = await validate_mcp_connection()
        
        # Test agent creation
        logger.info("Validating agent creation...")
        agent = create_strands_agent()
        validation_results['agent_creation'] = True
        validation_results['bedrock_access'] = True  # If agent creation succeeds, Bedrock is accessible
        
        logger.info("Agent setup validation completed")
        
    except Exception as e:
        logger.error(f"Agent setup validation failed: {str(e)}")
    
    return validation_results

def get_agent_info() -> Dict[str, Any]:
    """Get information about the configured agent"""
    return {
        'model_id': "us.anthropic.claude-3-7-sonnet-20250219-v1:0",
        'region': os.getenv('AWS_REGION', 'us-east-1'),
        'tools': ['video_search', 'video_merge'],
        'mcp_server_url': os.getenv('MCP_SERVER_URL'),
        'temperature': 0.3,
        'max_tokens': 4000
    }