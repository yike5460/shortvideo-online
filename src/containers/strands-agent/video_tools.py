from strands import tool
from mcp_client import HTTPMCPClient
import os
import logging
from typing import List, Dict, Any, Optional

logger = logging.getLogger(__name__)

# Initialize MCP client
mcp_client = HTTPMCPClient()

@tool
async def video_search(
    query: str, 
    indexes: Optional[List[str]] = None, 
    top_k: int = 5,
    min_confidence: float = 0.3
) -> List[Dict[str, Any]]:
    """Search for relevant video content using natural language
    
    Args:
        query: Natural language search query describing the video content needed
        indexes: Optional list of video indexes to search (e.g., ['education', 'tutorials'])
        top_k: Maximum number of results to return (default: 5)
        min_confidence: Minimum confidence score for results (default: 0.3)
    
    Returns:
        List of video segments with metadata including:
        - videoId: Unique identifier for the video
        - segmentId: Unique identifier for the segment
        - indexId: Index where the video is stored
        - title: Title or description of the video segment
        - confidence: Relevance confidence score (0.0 to 1.0)
        - duration: Duration of the segment in milliseconds
        - s3Path: S3 path to the video file
        - startTime: Start time of the segment (if applicable)
        - endTime: End time of the segment (if applicable)
    """
    try:
        logger.info(f"Searching videos with query: '{query}' in indexes: {indexes}")
        
        # Prepare search parameters
        search_params = {
            'query': query,
            'topK': top_k,
            'minConfidence': min_confidence,
            'weights': {
                'text': 0.4,
                'image': 0.3,
                'video': 0.2,
                'audio': 0.1
            }
        }
        
        # Add indexes if specified
        if indexes:
            search_params['indexes'] = indexes
        
        # Call MCP server
        result = await mcp_client.call_tool('video_search', search_params)
        
        # Extract segments from result
        segments = result.get('segments', [])
        logger.info(f"Found {len(segments)} video segments matching query")
        
        # Log segment details for debugging
        for i, segment in enumerate(segments[:3]):  # Log first 3 segments
            logger.debug(f"Segment {i+1}: {segment.get('title', 'No title')} "
                        f"(confidence: {segment.get('confidence', 0):.2f})")
        
        return segments
        
    except Exception as e:
        logger.error(f"Video search failed for query '{query}': {str(e)}")
        raise Exception(f"Failed to search videos: {str(e)}")

@tool
async def video_merge(
    segments: List[Dict[str, Any]], 
    output_name: str,
    resolution: str = "720p",
    transition_type: str = "fade",
    transition_duration: int = 500
) -> Dict[str, Any]:
    """Merge multiple video segments into a single video
    
    Args:
        segments: List of video segments to merge. Each segment should contain:
                 - indexId: Index identifier
                 - videoId: Video identifier  
                 - segmentId: Segment identifier
        output_name: Name for the output video (without extension)
        resolution: Output video resolution (default: "720p", options: "480p", "720p", "1080p")
        transition_type: Type of transition between segments (default: "fade", options: "fade", "cut", "dissolve")
        transition_duration: Duration of transitions in milliseconds (default: 500)
    
    Returns:
        Dictionary containing information about the merged video:
        - success: Boolean indicating if merge was successful
        - message: Status message
        - videoUrl: URL to access the merged video
        - thumbnailUrl: URL to the video thumbnail
        - s3Path: S3 path where the merged video is stored
        - duration: Total duration of the merged video in milliseconds
        - segmentCount: Number of segments merged
        - resolution: Output resolution used
    """
    try:
        logger.info(f"Merging {len(segments)} video segments into '{output_name}'")
        
        if not segments:
            raise ValueError("No segments provided for merging")
        
        # Validate segments have required fields
        required_fields = ['indexId', 'videoId', 'segmentId']
        for i, segment in enumerate(segments):
            missing_fields = [field for field in required_fields if field not in segment]
            if missing_fields:
                raise ValueError(f"Segment {i+1} missing required fields: {missing_fields}")
        
        # Format segments for MCP server
        formatted_segments = []
        total_estimated_duration = 0
        
        for i, segment in enumerate(segments):
            formatted_segment = {
                'indexId': segment['indexId'],
                'videoId': segment['videoId'],
                'segmentId': segment['segmentId'],
                'transitionType': transition_type,
                'transitionDuration': transition_duration
            }
            
            # Add optional fields if present
            if 'startTime' in segment:
                formatted_segment['startTime'] = segment['startTime']
            if 'endTime' in segment:
                formatted_segment['endTime'] = segment['endTime']
            
            formatted_segments.append(formatted_segment)
            
            # Estimate duration for logging
            segment_duration = segment.get('duration', 30000)  # Default 30 seconds
            total_estimated_duration += segment_duration
            
            logger.debug(f"Segment {i+1}: {segment.get('title', 'Unknown')} "
                        f"({segment_duration/1000:.1f}s)")
        
        logger.info(f"Estimated total duration: {total_estimated_duration/1000:.1f} seconds")
        
        # Prepare merge parameters
        merge_params = {
            'segments': formatted_segments,
            'mergedName': output_name,
            'options': {
                'resolution': resolution,
                'defaultTransition': transition_type,
                'transitionDuration': transition_duration
            }
        }
        
        # Call MCP server
        result = await mcp_client.call_tool('video_merge', merge_params)
        
        # Enhance result with additional metadata
        enhanced_result = {
            'success': result.get('success', True),
            'message': result.get('message', 'Video merged successfully'),
            'videoUrl': result.get('videoUrl', ''),
            'thumbnailUrl': result.get('thumbnailUrl', ''),
            's3Path': result.get('s3Path', ''),
            'duration': result.get('duration', total_estimated_duration),
            'segmentCount': len(segments),
            'resolution': resolution,
            'transitionType': transition_type,
            'outputName': output_name
        }
        
        logger.info(f"Video merge completed successfully: {enhanced_result['message']}")
        logger.info(f"Output video: {enhanced_result.get('s3Path', 'Unknown path')}")
        
        return enhanced_result
        
    except ValueError as e:
        logger.error(f"Video merge validation error: {str(e)}")
        raise Exception(f"Invalid merge parameters: {str(e)}")
    except Exception as e:
        logger.error(f"Video merge failed for '{output_name}': {str(e)}")
        raise Exception(f"Failed to merge videos: {str(e)}")

# Additional utility function for tool validation
async def validate_mcp_connection() -> bool:
    """Validate that MCP client can connect to the server"""
    try:
        await mcp_client.health_check()
        logger.info("MCP connection validated successfully")
        return True
    except Exception as e:
        logger.error(f"MCP connection validation failed: {str(e)}")
        return False

async def get_available_tools() -> List[str]:
    """Get list of available tools from MCP server"""
    try:
        tools_info = await mcp_client.list_tools()
        tools = tools_info.get('tools', [])
        tool_names = [tool.get('name', 'unknown') for tool in tools]
        logger.info(f"Available MCP tools: {tool_names}")
        return tool_names
    except Exception as e:
        logger.error(f"Failed to get available tools: {str(e)}")
        return []