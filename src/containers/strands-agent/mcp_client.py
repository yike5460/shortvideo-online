import aiohttp
import json
import logging
from typing import Dict, Any, Optional
import asyncio
import os

logger = logging.getLogger(__name__)

class HTTPMCPClient:
    """HTTP client for communicating with MCP server via Lambda"""
    
    def __init__(self, server_url: Optional[str] = None, timeout: int = 30):
        self.server_url = server_url or os.getenv('MCP_SERVER_URL')
        self.timeout = timeout
        
        if not self.server_url:
            raise ValueError("MCP_SERVER_URL environment variable is required")
    
    async def call_tool(self, tool_name: str, arguments: Dict[str, Any]) -> Dict[str, Any]:
        """Call MCP server tool via HTTP with error handling and retries"""
        request_data = {
            "method": "tools/call",
            "params": {
                "name": tool_name,
                "arguments": arguments
            },
            "id": 1
        }
        
        max_retries = 3
        for attempt in range(max_retries):
            try:
                timeout = aiohttp.ClientTimeout(total=self.timeout)
                async with aiohttp.ClientSession(timeout=timeout) as session:
                    logger.debug(f"Calling MCP tool {tool_name} (attempt {attempt + 1})")
                    
                    async with session.post(
                        self.server_url,
                        json=request_data,
                        headers={
                            "Content-Type": "application/json",
                            "Accept": "application/json"
                        }
                    ) as response:
                        if response.status != 200:
                            error_text = await response.text()
                            raise Exception(f"HTTP {response.status}: {error_text}")
                        
                        result = await response.json()
                        
                        if "error" in result:
                            error_info = result['error']
                            raise Exception(f"MCP tool error [{error_info.get('code', 'unknown')}]: {error_info.get('message', 'Unknown error')}")
                        
                        # Parse the MCP response format
                        if "result" not in result:
                            raise Exception("Invalid MCP response: missing result field")
                        
                        content = result["result"].get("content", [])
                        if not content or len(content) == 0:
                            logger.warning("Empty content in MCP response")
                            return {}
                        
                        # Parse the JSON content from the first content item
                        content_text = content[0].get("text", "{}")
                        try:
                            parsed_result = json.loads(content_text)
                            logger.info(f"MCP tool {tool_name} completed successfully")
                            return parsed_result
                        except json.JSONDecodeError as e:
                            logger.error(f"Failed to parse MCP response JSON: {content_text}")
                            raise Exception(f"Invalid JSON in MCP response: {str(e)}")
                            
            except asyncio.TimeoutError:
                logger.warning(f"MCP call timeout for {tool_name} (attempt {attempt + 1}/{max_retries})")
                if attempt == max_retries - 1:
                    raise Exception(f"MCP server timeout after {max_retries} attempts")
                await asyncio.sleep(2 ** attempt)  # Exponential backoff
                
            except aiohttp.ClientError as e:
                logger.error(f"HTTP client error for {tool_name} (attempt {attempt + 1}/{max_retries}): {str(e)}")
                if attempt == max_retries - 1:
                    raise Exception(f"HTTP client error: {str(e)}")
                await asyncio.sleep(2 ** attempt)
                
            except Exception as e:
                logger.error(f"MCP call failed for {tool_name} (attempt {attempt + 1}/{max_retries}): {str(e)}")
                if attempt == max_retries - 1:
                    raise
                await asyncio.sleep(2 ** attempt)
    
    async def list_tools(self) -> Dict[str, Any]:
        """List available tools from MCP server"""
        request_data = {
            "method": "tools/list",
            "id": 1
        }
        
        try:
            timeout = aiohttp.ClientTimeout(total=self.timeout)
            async with aiohttp.ClientSession(timeout=timeout) as session:
                async with session.post(
                    self.server_url,
                    json=request_data,
                    headers={
                        "Content-Type": "application/json",
                        "Accept": "application/json"
                    }
                ) as response:
                    if response.status != 200:
                        error_text = await response.text()
                        raise Exception(f"HTTP {response.status}: {error_text}")
                    
                    result = await response.json()
                    
                    if "error" in result:
                        error_info = result['error']
                        raise Exception(f"MCP error [{error_info.get('code', 'unknown')}]: {error_info.get('message', 'Unknown error')}")
                    
                    return result.get("result", {})
                    
        except Exception as e:
            logger.error(f"Failed to list MCP tools: {str(e)}")
            raise Exception(f"Failed to list MCP tools: {str(e)}")
    
    async def initialize(self) -> Dict[str, Any]:
        """Initialize connection with MCP server"""
        request_data = {
            "method": "initialize",
            "params": {
                "protocolVersion": "2024-11-05",
                "capabilities": {},
                "clientInfo": {
                    "name": "strands-video-agent",
                    "version": "1.0.0"
                }
            },
            "id": 1
        }
        
        try:
            timeout = aiohttp.ClientTimeout(total=self.timeout)
            async with aiohttp.ClientSession(timeout=timeout) as session:
                async with session.post(
                    self.server_url,
                    json=request_data,
                    headers={
                        "Content-Type": "application/json",
                        "Accept": "application/json"
                    }
                ) as response:
                    if response.status != 200:
                        error_text = await response.text()
                        raise Exception(f"HTTP {response.status}: {error_text}")
                    
                    result = await response.json()
                    
                    if "error" in result:
                        error_info = result['error']
                        raise Exception(f"MCP initialization error [{error_info.get('code', 'unknown')}]: {error_info.get('message', 'Unknown error')}")
                    
                    logger.info("MCP client initialized successfully")
                    return result.get("result", {})
                    
        except Exception as e:
            logger.error(f"Failed to initialize MCP client: {str(e)}")
            raise Exception(f"Failed to initialize MCP client: {str(e)}")

    async def health_check(self) -> bool:
        """Check if MCP server is healthy"""
        try:
            await self.list_tools()
            return True
        except Exception as e:
            logger.error(f"MCP health check failed: {str(e)}")
            return False