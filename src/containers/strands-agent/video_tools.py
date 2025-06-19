from strands import tool
import requests
import os
import logging
import time
from typing import List, Dict, Any
from functools import wraps

# Import monitoring (try both relative and absolute)
try:
    from .monitoring import monitor
except ImportError:
    from monitoring import monitor

# Configure logger to ensure it inherits from root logger
logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

# Add a handler if none exists to ensure logs go to stdout/CloudWatch
if not logger.handlers:
    handler = logging.StreamHandler()
    handler.setLevel(logging.INFO)
    formatter = logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s')
    handler.setFormatter(formatter)
    logger.addHandler(handler)

# Log module loading to confirm the module is being imported
logger.info("=== VIDEO_TOOLS MODULE LOADED ===")
logger.info(f"Logger name: {logger.name}")
logger.info(f"Logger level: {logger.level}")
logger.info(f"Logger handlers: {logger.handlers}")
logger.info("=== END MODULE LOAD LOG ===")

# Environment variables for API endpoints
VIDEO_SEARCH_API_URL = os.getenv('VIDEO_SEARCH_API_URL')
VIDEO_MERGE_API_URL = os.getenv('VIDEO_MERGE_API_URL')

def retry_on_failure(max_retries=3, delay=1.0):
    """Decorator to retry function calls on failure with exponential backoff"""
    def decorator(func):
        @wraps(func)
        def wrapper(*args, **kwargs):
            last_exception = None
            for attempt in range(max_retries):
                try:
                    return func(*args, **kwargs)
                except Exception as e:
                    last_exception = e
                    if attempt < max_retries - 1:
                        wait_time = delay * (2 ** attempt)  # Exponential backoff
                        logger.warning(f"Attempt {attempt + 1} failed for {func.__name__}: {str(e)}. Retrying in {wait_time}s...")
                        time.sleep(wait_time)
                    else:
                        logger.error(f"All {max_retries} attempts failed for {func.__name__}")
            raise last_exception
        return wrapper
    return decorator

def make_api_request(url: str, data: dict, timeout: int = 30) -> requests.Response:
    """Make HTTP request with enhanced error handling and circuit breaker pattern"""
    try:
        response = requests.post(
            url,
            json=data,
            headers={
                "Content-Type": "application/json",
                "Accept": "application/json"
            },
            timeout=timeout
        )
        
        # Log response for debugging
        logger.info(f"API Response: {response.status_code} from {url}")
        
        if response.status_code == 429:  # Rate limiting
            retry_after = response.headers.get('Retry-After', '5')
            raise Exception(f"Rate limited. Retry after {retry_after} seconds")
        elif response.status_code >= 500:  # Server errors
            raise Exception(f"Server error: {response.status_code} - {response.text}")
        elif response.status_code >= 400:  # Client errors
            raise Exception(f"Client error: {response.status_code} - {response.text}")
            
        return response
        
    except requests.exceptions.Timeout:
        raise Exception(f"Request timeout after {timeout} seconds")
    except requests.exceptions.ConnectionError:
        raise Exception("Connection error - API endpoint unavailable")
    except requests.exceptions.RequestException as e:
        raise Exception(f"Request failed: {str(e)}")

@tool
@retry_on_failure(max_retries=3, delay=1.0)
@monitor.track_api_call('video_search')
def video_search(
    query: str,
    indexes: List[str] = None,
    top_k: int = 5,
    # Align with frontend default min_confidence
    min_confidence: float = 0.5,
    fast_mode: bool = False
) -> List[Dict[str, Any]]:
    """Search for relevant video content using natural language queries
    
    Args:
        query: Natural language search query describing the video content needed
        indexes: List of video indexes to search, passed by the user in the web
        top_k: Maximum number of results to return (default: 5)
        min_confidence: Minimum confidence score for results (default: 0.5)
        fast_mode: Enable fast mode processing - skips validation for faster results (default: False)
    
    Returns:
        List of video segments with metadata including:
        - videoId: Unique identifier for the video
        - segmentId: Unique identifier for the segment
        - indexId: Index where the video is stored
        - title: Title or description of the video segment
        - confidence: Relevance confidence score (0.0 to 1.0)
        - duration: Duration of the segment in milliseconds
        - s3Path: S3 path to the video file
        - videoUrl: Signed URL for video preview
        - thumbnailUrl: Signed URL for thumbnail
    """
        # Add function entry log to confirm function is being called  
    logger.info("=== VIDEO_SEARCH FUNCTION CALLED ===")
    logger.info(f"Query: '{query}', Indexes: {indexes}, Top_k: {top_k}, Min_confidence: {min_confidence}, Fast_mode: {fast_mode}")
    logger.info("=== END FUNCTION ENTRY LOG ===")
    
    try:
        if not VIDEO_SEARCH_API_URL:
            raise ValueError("VIDEO_SEARCH_API_URL environment variable is not set")

        if not indexes:
            raise ValueError("No indexes provided")
        
        # Prepare search request matching the frontend API format (from page.tsx)
        # In fast mode, skip validation to speed up processing
        skip_validation = fast_mode  # Skip validation when fast mode is enabled
        
        search_request = {
            "searchType": "text",
            "searchQuery": query,
            "selectedIndex": indexes[0],
            "advancedSearch": True,  # Enable advanced search as in frontend
            "skipValidation": skip_validation,  # Skip validation in fast mode for faster results
            "exactMatch": False,  # Already obsoleted in frontend
            "topK": top_k,
            "weights": {
                # Align with backend weights implementation in index.ts or video_search Lambda
                "video": 0.5,
                "audio": 0.5,
                "text": 0,
                "image": 0
            },
            "minConfidence": min_confidence,
            "visualSearch": True,
            "audioSearch": True
        }
        
        logger.info(f"Search request skipValidation set to: {skip_validation} (fast_mode: {fast_mode})")
        
        # Make HTTP request to video search API with enhanced error handling
        response = make_api_request(VIDEO_SEARCH_API_URL, search_request, timeout=30)
        
        if response.status_code == 200:

            results = response.json()
            # Log search results count without full structure to avoid cluttering logs
            logger.info(f"Found {len(results)} video results for query: '{query}'")

            # Transform results to a more tool-friendly format
            formatted_results = []
            for video in results:
                # Log video structure
                logger.info(f"Processing video {video.get('id')} with {len(video.get('segments', []))} segments")
                
                # Extract segments from each video
                for segment in video.get('segments', []):
                    # Get URLs but don't log them (they're very long)
                    video_url = segment.get('segment_video_preview_url', '')
                    thumbnail_url = segment.get('segment_video_thumbnail_url', '')
                    s3_path = segment.get('segment_video_s3_path', '')
                    
                    # Log segment data without URLs to avoid cluttering logs
                    logger.info(f"Segment {segment.get('segment_id')}: s3_path={'present' if s3_path else 'missing'}, duration={segment.get('duration')}, start_time={segment.get('start_time')}, end_time={segment.get('end_time')}")
                    
                    formatted_results.append({
                        'videoId': video.get('id'),
                        'segmentId': segment.get('segment_id'),
                        'indexId': video.get('indexId', indexes[0]),  # Use requested index as fallback
                        'title': video.get('title', ''),
                        'description': video.get('description', ''),
                        'confidence': segment.get('confidence', 0),
                        'duration': segment.get('duration', 0),
                        'startTime': segment.get('start_time', 0),
                        'endTime': segment.get('end_time', 0),
                        's3Path': s3_path,
                        'videoUrl': video_url,
                        'thumbnailUrl': thumbnail_url,
                        'videoTitle': video.get('title', ''),
                        'videoDescription': video.get('description', '')
                    })
            
            # Sort by confidence score (highest first)
            formatted_results.sort(key=lambda x: x.get('confidence', 0), reverse=True)
            
            logger.info(f"Returning {len(formatted_results)} formatted video segments")
            # Log summary without URLs to avoid cluttering
            for i, result in enumerate(formatted_results[:3]):  # Log only first 3 results summary
                logger.info(f"Top result {i+1}: {result['segmentId']} (confidence: {result['confidence']:.3f}, duration: {result['duration']}ms)")
            
            return formatted_results
            
        else:
            error_text = response.text
            logger.error(f"Video search API failed: {response.status_code} - {error_text}")
            raise Exception(f"Video search failed: {response.status_code} - {error_text}")
                    
    except Exception as e:
        logger.error(f"Video search failed for query '{query}': {str(e)}")
        raise Exception(f"Failed to search videos: {str(e)}")

@tool
@retry_on_failure(max_retries=2, delay=2.0)
@monitor.track_api_call('video_merge')
def video_merge(
    segments: List[Dict[str, Any]],
    output_name: str,
    resolution: str = "720p",
    transition_type: str = "cut",
    transition_duration: int = 500
) -> Dict[str, Any]:
    """Merge multiple video segments into a single video
    
    Args:
        segments: List of video segments to merge. Each segment should contain:
                 - videoId: Unique identifier for the video
                 - segmentId: Unique identifier for the segment
                 - indexId: Index where the video is stored
                 - title: Title or description of the video segment
                 - confidence: Relevance confidence score (0.0 to 1.0)
                 - duration: Duration of the segment in milliseconds
                 - startTime: Start time of the segment in milliseconds
                 - endTime: End time of the segment in milliseconds
                 - s3Path: S3 path to the video file
                 - videoUrl: Signed URL for video preview
                 - thumbnailUrl: Signed URL for thumbnail
                 - videoTitle: Title of the parent video
                 - videoDescription: Description of the parent video
        output_name: Name for the output video (without extension)
        resolution: Output video resolution ("720p" or "1080p")
        transition_type: Type of transition between segments ("cut", "fade", "dissolve")
        transition_duration: Duration of transitions in milliseconds
    
    Returns:
        Dictionary containing information about the merge job:
        - success: Boolean indicating if merge was initiated successfully
        - message: Status message
        - jobId: Job ID for tracking merge progress
        - userId: User ID associated with the job
        - status: Initial job status ("queued")
        - customName: Name of the output video
    """
    # Add function entry log to confirm function is being called
    logger.info("=== VIDEO_MERGE FUNCTION CALLED ===")
    logger.info(f"Output name: {output_name}")
    logger.info(f"Number of segments: {len(segments)}")
    logger.info(f"Resolution: {resolution}")
    logger.info(f"Transition type: {transition_type}")
    # Log segment summary without full URLs to avoid cluttering logs
    for i, segment in enumerate(segments):
        logger.info(f"Segment {i+1}: {segment.get('segmentId')} (confidence: {segment.get('confidence', 0):.3f}, duration: {segment.get('duration', 0)}ms)")
    logger.info("=== END FUNCTION ENTRY LOG ===")
    
    try:
        if not VIDEO_MERGE_API_URL:
            raise ValueError("VIDEO_MERGE_API_URL environment variable is not set")
        
        logger.info(f"Merging {len(segments)} video segments into '{output_name}'")
        
        if not segments:
            raise ValueError("No segments provided for merging")
        
        # Validate segments have required fields
        required_fields = ['indexId', 'videoId', 'segmentId', 's3Path']
        for i, segment in enumerate(segments):
            missing_fields = [field for field in required_fields if field not in segment]
            if missing_fields:
                raise ValueError(f"Segment {i+1} missing required fields: {missing_fields}")

        # Validate segment data before creating merge request
        logger.info(f"Validating {len(segments)} segments before merge:")
        for i, segment in enumerate(segments):
            s3_path = segment.get("s3Path")
            duration = segment.get("duration", 0)
            start_time = segment.get("startTime", 0)
            end_time = segment.get("endTime", 0)
            
            # Compact validation logging to avoid cluttering
            s3_valid = s3_path is not None and s3_path != ''
            duration_valid = duration > 0
            time_valid = end_time > start_time
            
            logger.info(f"Segment {i+1} ({segment.get('segmentId')}): s3_path={s3_valid}, duration={duration}ms, time_range={start_time}-{end_time}")
            
            if not s3_valid:
                logger.error(f"ERROR: Segment {i+1} ({segment.get('segmentId')}) has no valid S3 path - merge will fail")
            if not duration_valid:
                logger.error(f"ERROR: Segment {i+1} ({segment.get('segmentId')}) has invalid duration ({duration})")
            if not time_valid:
                logger.error(f"ERROR: Segment {i+1} ({segment.get('segmentId')}) has invalid time range ({start_time}-{end_time})")

        # Prepare merge request matching the video-merge Lambda API with complete segment data
        merge_request = {
            "items": [
                {
                    "indexId": segment.get("indexId"),
                    "videoId": segment.get("videoId"),
                    "segmentId": segment.get("segmentId"),
                    "segmentData": {
                        "segment_id": segment.get("segmentId"),
                        "video_id": segment.get("videoId"),
                        "start_time": segment.get("startTime", 0),
                        "end_time": segment.get("endTime", 0),
                        "duration": segment.get("duration", 0),
                        "segment_video_s3_path": segment.get("s3Path"),
                        "segment_video_preview_url": segment.get("videoUrl"),
                        "segment_video_thumbnail_s3_path": segment.get("thumbnailUrl", "").replace("segment_video_thumbnail_url", "segment_video_thumbnail_s3_path") if segment.get("thumbnailUrl") else None,
                        "segment_video_thumbnail_url": segment.get("thumbnailUrl"),
                        "confidence": segment.get("confidence", 0)
                    },
                    "transitionType": transition_type,
                    "transitionDuration": transition_duration
                }
                for segment in segments
            ],
            "mergedName": output_name,
            "userId": "strands-agent",  # Identifier for agent-created videos
            "mergeOptions": {
                "resolution": resolution,
                "defaultTransition": transition_type,
                "defaultTransitionDuration": transition_duration
            }
        }
        # Log merge request summary without full URLs to avoid cluttering logs
        logger.info(f"Assembled merge request with {len(merge_request['items'])} items for '{output_name}' ({resolution})")
        # Make HTTP request to video merge API with enhanced error handling
        response = make_api_request(VIDEO_MERGE_API_URL, merge_request, timeout=30)

        if response.status_code == 200:
            result = response.json()
            logger.info(f"Started video merge job: {result.get('jobId')} for '{output_name}'")
            
            # Return formatted response
            return {
                'success': True,
                'message': result.get('message', 'Video merge job created successfully'),
                'jobId': result.get('jobId'),
                'userId': result.get('userId'),
                'status': result.get('status', 'queued'),
                'customName': result.get('customName', output_name),
                'segmentCount': len(segments),
                'resolution': resolution,
                'transitionType': transition_type
            }
            
        else:
            error_text = response.text
            logger.error(f"Video merge API failed: {response.status_code} - {error_text}")
            raise Exception(f"Video merge failed: {response.status_code} - {error_text}")
                    
    except ValueError as e:
        logger.error(f"Video merge validation error: {str(e)}")
        raise Exception(f"Invalid merge parameters: {str(e)}")
    except Exception as e:
        logger.error(f"Video merge failed for '{output_name}': {str(e)}")
        raise Exception(f"Failed to merge videos: {str(e)}")

# Utility function for validation
def validate_api_endpoints() -> Dict[str, bool]:
    """Validate that API endpoints are accessible"""
    validation_results = {
        'video_search_api': False,
        'video_merge_api': False
    }

    try:
        if VIDEO_SEARCH_API_URL:
            # Try a simple OPTIONS request to check if endpoint is accessible
            response = requests.options(VIDEO_SEARCH_API_URL, timeout=10)
            validation_results['video_search_api'] = response.status_code in [200, 204, 405]
        
        if VIDEO_MERGE_API_URL:
            response = requests.options(VIDEO_MERGE_API_URL, timeout=10)
            validation_results['video_merge_api'] = response.status_code in [200, 204, 405]
                    
    except Exception as e:
        logger.error(f"API endpoint validation failed: {str(e)}")
    
    return validation_results