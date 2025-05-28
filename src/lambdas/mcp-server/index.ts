import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { VideoSearchTool } from './tools/video_search';
import { VideoMergeTool } from './tools/video_merge';
import { VideoSliceTool } from './tools/video_slice';
import { VideoMetadataTool } from './tools/video_metadata';
import { IndexQueryTool } from './tools/index_query';

// MCP Server implementation for Strands Agent
interface MCPRequest {
  method: string;
  params?: any;
  id?: string | number;
}

interface MCPResponse {
  result?: any;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
  id?: string | number;
}

interface Tool {
  name: string;
  description: string;
  inputSchema: any;
  execute(params: any): Promise<any>;
}

export class MCPServer {
  private tools: Map<string, Tool> = new Map();

  constructor() {
    // Register available tools
    this.registerTool(new VideoSearchTool());
    this.registerTool(new VideoMergeTool());
    this.registerTool(new VideoSliceTool());
    this.registerTool(new VideoMetadataTool());
    this.registerTool(new IndexQueryTool());
  }

  private registerTool(tool: Tool) {
    this.tools.set(tool.name, tool);
  }

  async handleRequest(request: MCPRequest): Promise<MCPResponse> {
    try {
      switch (request.method) {
        case 'tools/list':
          return this.listTools(request);
        case 'tools/call':
          return await this.callTool(request);
        case 'initialize':
          return this.initialize(request);
        default:
          return {
            error: {
              code: -32601,
              message: `Method not found: ${request.method}`,
            },
            id: request.id,
          };
      }
    } catch (error) {
      console.error('MCP Server error:', error);
      return {
        error: {
          code: -32603,
          message: 'Internal error',
          data: error instanceof Error ? error.message : 'Unknown error',
        },
        id: request.id,
      };
    }
  }

  private initialize(request: MCPRequest): MCPResponse {
    return {
      result: {
        protocolVersion: '2024-11-05',
        capabilities: {
          tools: {},
        },
        serverInfo: {
          name: 'video-tools-mcp-server',
          version: '1.0.0',
        },
      },
      id: request.id,
    };
  }

  private listTools(request: MCPRequest): MCPResponse {
    const toolsList = Array.from(this.tools.values()).map(tool => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    }));

    return {
      result: {
        tools: toolsList,
      },
      id: request.id,
    };
  }

  private async callTool(request: MCPRequest): Promise<MCPResponse> {
    const { name, arguments: args } = request.params || {};

    if (!name) {
      return {
        error: {
          code: -32602,
          message: 'Missing tool name',
        },
        id: request.id,
      };
    }

    const tool = this.tools.get(name);
    if (!tool) {
      return {
        error: {
          code: -32602,
          message: `Tool not found: ${name}`,
        },
        id: request.id,
      };
    }

    try {
      const result = await tool.execute(args || {});
      return {
        result: {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        },
        id: request.id,
      };
    } catch (error) {
      console.error(`Error executing tool ${name}:`, error);
      return {
        error: {
          code: -32603,
          message: `Tool execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        },
        id: request.id,
      };
    }
  }
}

// Lambda handler
const mcpServer = new MCPServer();

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Credentials': 'true'
  };

  try {
    // Handle CORS preflight
    if (event.httpMethod === 'OPTIONS') {
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: '',
      };
    }

    if (!event.body) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Missing request body' }),
      };
    }

    const request: MCPRequest = JSON.parse(event.body);
    const response = await mcpServer.handleRequest(request);

    return {
      statusCode: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(response),
    };
  } catch (error) {
    console.error('Lambda handler error:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({
        error: {
          code: -32603,
          message: 'Internal server error',
          data: error instanceof Error ? error.message : 'Unknown error',
        },
      }),
    };
  }
};