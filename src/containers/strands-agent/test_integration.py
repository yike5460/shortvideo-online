#!/usr/bin/env python3
"""
Simple integration test for Strands Agent implementation
"""

import asyncio
import os
import sys
import logging
from typing import Dict, Any

# Add current directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from mcp_client import HTTPMCPClient
from video_tools import video_search, video_merge, validate_mcp_connection
from agent_config import create_strands_agent, validate_agent_setup

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

async def test_mcp_connection():
    """Test MCP client connection"""
    logger.info("Testing MCP connection...")
    try:
        is_healthy = await validate_mcp_connection()
        logger.info(f"MCP connection test: {'PASSED' if is_healthy else 'FAILED'}")
        return is_healthy
    except Exception as e:
        logger.error(f"MCP connection test FAILED: {str(e)}")
        return False

async def test_video_tools():
    """Test video tools functionality"""
    logger.info("Testing video tools...")
    
    # Set required environment variables for testing
    os.environ.setdefault('MCP_SERVER_URL', 'http://localhost:8001')
    
    try:
        # Test video search
        logger.info("Testing video_search tool...")
        search_results = await video_search("test query", top_k=2)
        logger.info(f"Video search returned {len(search_results)} results")
        
        if search_results:
            # Test video merge with mock segments
            logger.info("Testing video_merge tool...")
            mock_segments = [
                {
                    'indexId': 'test_index',
                    'videoId': 'test_video_1',
                    'segmentId': 'test_segment_1',
                    'duration': 30000
                },
                {
                    'indexId': 'test_index',
                    'videoId': 'test_video_2',
                    'segmentId': 'test_segment_2',
                    'duration': 25000
                }
            ]
            
            merge_result = await video_merge(mock_segments, "test_output")
            logger.info(f"Video merge completed: {merge_result.get('message', 'Success')}")
            
        logger.info("Video tools test: PASSED")
        return True
        
    except Exception as e:
        logger.error(f"Video tools test FAILED: {str(e)}")
        return False

async def test_agent_creation():
    """Test Strands Agent creation"""
    logger.info("Testing Strands Agent creation...")
    
    # Set required environment variables
    os.environ.setdefault('AWS_REGION', 'us-east-1')
    
    try:
        agent = create_strands_agent()
        logger.info("Strands Agent created successfully")
        
        # Test a simple query
        test_prompt = "Hello, can you help me create a video?"
        response = agent(test_prompt)
        logger.info(f"Agent response: {response.message[:100]}...")
        
        logger.info("Agent creation test: PASSED")
        return True
        
    except Exception as e:
        logger.error(f"Agent creation test FAILED: {str(e)}")
        return False

async def test_agent_validation():
    """Test agent setup validation"""
    logger.info("Testing agent setup validation...")
    
    try:
        validation_results = await validate_agent_setup()
        logger.info(f"Validation results: {validation_results}")
        
        all_passed = all(validation_results.values())
        logger.info(f"Agent validation test: {'PASSED' if all_passed else 'FAILED'}")
        return all_passed
        
    except Exception as e:
        logger.error(f"Agent validation test FAILED: {str(e)}")
        return False

async def run_all_tests():
    """Run all integration tests"""
    logger.info("Starting Strands Agent integration tests...")
    
    test_results = {
        'mcp_connection': False,
        'video_tools': False,
        'agent_creation': False,
        'agent_validation': False
    }
    
    # Test MCP connection
    test_results['mcp_connection'] = await test_mcp_connection()
    
    # Test video tools (depends on MCP connection)
    if test_results['mcp_connection']:
        test_results['video_tools'] = await test_video_tools()
    else:
        logger.warning("Skipping video tools test due to MCP connection failure")
    
    # Test agent creation
    test_results['agent_creation'] = await test_agent_creation()
    
    # Test agent validation
    test_results['agent_validation'] = await test_agent_validation()
    
    # Summary
    passed_tests = sum(test_results.values())
    total_tests = len(test_results)
    
    logger.info(f"\n{'='*50}")
    logger.info(f"Integration Test Results: {passed_tests}/{total_tests} PASSED")
    logger.info(f"{'='*50}")
    
    for test_name, result in test_results.items():
        status = "PASSED" if result else "FAILED"
        logger.info(f"{test_name}: {status}")
    
    return test_results

def main():
    """Main test function"""
    # Check if we're in the right environment
    if not os.path.exists('requirements.txt'):
        logger.error("Please run this test from the strands-agent directory")
        sys.exit(1)
    
    # Run tests
    try:
        results = asyncio.run(run_all_tests())
        
        # Exit with appropriate code
        all_passed = all(results.values())
        sys.exit(0 if all_passed else 1)
        
    except KeyboardInterrupt:
        logger.info("Tests interrupted by user")
        sys.exit(1)
    except Exception as e:
        logger.error(f"Test execution failed: {str(e)}")
        sys.exit(1)

if __name__ == "__main__":
    main()