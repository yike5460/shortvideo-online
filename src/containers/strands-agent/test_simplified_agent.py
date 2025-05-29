#!/usr/bin/env python3
"""
Test script for simplified Strands Agent implementation with custom tools
"""

import asyncio
import os
import sys
import logging
from typing import Dict, Any

# Add current directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from agent_config import create_strands_agent, validate_agent_setup, get_agent_info

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(levelname)s | %(name)s | %(message)s",
    handlers=[logging.StreamHandler()]
)
logger = logging.getLogger(__name__)

# Suppress boto3/botocore debug logs
logging.getLogger("botocore").setLevel(logging.WARNING)
logging.getLogger("boto3").setLevel(logging.WARNING)
logging.getLogger("urllib3").setLevel(logging.WARNING)

async def test_api_endpoints():
    """Test API endpoint connectivity"""
    logger.info("Testing API endpoint connectivity...")
    
    try:
        from video_tools import validate_api_endpoints
        validation_results = await validate_api_endpoints()
        
        logger.info(f"API endpoint validation results: {validation_results}")
        
        if all(validation_results.values()):
            logger.info("✅ API endpoints test: PASSED")
            return True
        else:
            logger.error("❌ API endpoints test: FAILED")
            return False
            
    except Exception as e:
        logger.error(f"❌ API endpoints test FAILED: {str(e)}")
        return False

def test_agent_creation():
    """Test Strands Agent creation with custom tools"""
    logger.info("Testing Strands Agent creation...")
    
    try:
        agent = create_strands_agent()
        logger.info("✅ Agent creation test: PASSED")
        
        # Get agent info
        agent_info = get_agent_info()
        logger.info(f"Agent info: {agent_info}")
        
        return True
        
    except Exception as e:
        logger.error(f"❌ Agent creation test FAILED: {str(e)}")
        return False

async def test_agent_validation():
    """Test agent setup validation"""
    logger.info("Testing agent setup validation...")
    
    try:
        validation_results = await validate_agent_setup()
        logger.info(f"Agent validation results: {validation_results}")
        
        if all(validation_results.values()):
            logger.info("✅ Agent validation test: PASSED")
            return True
        else:
            logger.warning("⚠️ Agent validation test: PARTIAL - some checks failed")
            return False
            
    except Exception as e:
        logger.error(f"❌ Agent validation test FAILED: {str(e)}")
        return False

async def test_video_search_tool():
    """Test video search tool functionality"""
    logger.info("Testing video search tool...")
    
    try:
        from video_tools import video_search
        
        # Test a simple search query
        test_query = "English education for students"
        logger.info(f"Testing search query: {test_query}")
        
        results = await video_search(
            query=test_query,
            top_k=3,
            min_confidence=0.1  # Lower threshold for testing
        )
        
        logger.info(f"Search returned {len(results)} results")
        
        if results:
            # Log first result details
            first_result = results[0]
            logger.info(f"First result: {first_result.get('title', 'No title')} "
                       f"(confidence: {first_result.get('confidence', 0):.2f})")
            
        logger.info("✅ Video search tool test: PASSED")
        return True
        
    except Exception as e:
        logger.error(f"❌ Video search tool test FAILED: {str(e)}")
        return False

async def test_agent_query():
    """Test agent with a simple query"""
    logger.info("Testing agent query...")
    
    try:
        agent = create_strands_agent()
        
        # Test a simple query
        test_query = "Hello, can you help me understand what video tools you have available?"
        logger.info(f"Testing query: {test_query}")
        
        response = agent(test_query)
        logger.info(f"Agent response: {response.message[:200]}...")
        
        logger.info("✅ Agent query test: PASSED")
        return True
        
    except Exception as e:
        logger.error(f"❌ Agent query test FAILED: {str(e)}")
        return False

async def run_all_tests():
    """Run all simplified agent tests"""
    logger.info("Starting Simplified Strands Agent tests...")
    
    test_results = {
        'api_endpoints': False,
        'agent_creation': False,
        'agent_validation': False,
        'video_search_tool': False,
        'agent_query': False
    }
    
    # Test API endpoints
    test_results['api_endpoints'] = await test_api_endpoints()
    
    # Test agent creation
    test_results['agent_creation'] = test_agent_creation()
    
    # Test agent validation
    if test_results['agent_creation']:
        test_results['agent_validation'] = await test_agent_validation()
    
    # Test video search tool (only if API endpoints are working)
    if test_results['api_endpoints']:
        test_results['video_search_tool'] = await test_video_search_tool()
    else:
        logger.warning("Skipping video search tool test due to API endpoint issues")
    
    # Test agent query (only if agent creation succeeded)
    if test_results['agent_creation']:
        test_results['agent_query'] = await test_agent_query()
    else:
        logger.warning("Skipping agent query test due to agent creation failure")
    
    # Summary
    passed_tests = sum(test_results.values())
    total_tests = len(test_results)
    
    logger.info(f"\n{'='*60}")
    logger.info(f"Simplified Agent Test Results: {passed_tests}/{total_tests} PASSED")
    logger.info(f"{'='*60}")
    
    for test_name, result in test_results.items():
        status = "✅ PASSED" if result else "❌ FAILED"
        logger.info(f"{test_name}: {status}")
    
    return test_results

def main():
    """Main test function"""
    # Check environment variables
    required_env_vars = ['AWS_REGION']
    missing_vars = [var for var in required_env_vars if not os.getenv(var)]
    
    if missing_vars:
        logger.error(f"Missing required environment variables: {missing_vars}")
        logger.info("Please set the following environment variables:")
        for var in missing_vars:
            logger.info(f"  export {var}=<value>")
        sys.exit(1)
    
    # Set default values for optional variables
    os.environ.setdefault('OPENSEARCH_ENDPOINT', 'https://test-endpoint.us-east-1.aoss.amazonaws.com')
    os.environ.setdefault('VIDEO_BUCKET', 'test-video-bucket')
    os.environ.setdefault('JOBS_TABLE', 'test-jobs-table')
    os.environ.setdefault('INDEXES_TABLE', 'test-indexes-table')
    
    # API endpoints are optional for basic testing
    video_search_url = os.getenv('VIDEO_SEARCH_API_URL')
    video_merge_url = os.getenv('VIDEO_MERGE_API_URL')
    
    logger.info(f"AWS Region: {os.getenv('AWS_REGION')}")
    logger.info(f"Video Search API URL: {video_search_url or 'Not set'}")
    logger.info(f"Video Merge API URL: {video_merge_url or 'Not set'}")
    
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