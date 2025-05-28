import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';

interface Tool {
  name: string;
  description: string;
  inputSchema: any;
  execute(params: any): Promise<any>;
}

interface VideoSegment {
  indexId: string;
  videoId: string;
  segmentId: string;
  transitionType?: 'cut' | 'fade' | 'dissolve';
  transitionDuration?: number;
}

export class VideoMergeTool implements Tool {
  name = 'video_merge';
  description = 'Merge multiple video segments into a single video';
  inputSchema = {
    type: 'object',
    properties: {
      segments: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            indexId: { type: 'string' },
            videoId: { type: 'string' },
            segmentId: { type: 'string' },
            transitionType: { 
              type: 'string', 
              enum: ['cut', 'fade', 'dissolve'],
              default: 'cut'
            },
            transitionDuration: { 
              type: 'number',
              default: 500,
              description: 'Transition duration in milliseconds'
            }
          },
          required: ['indexId', 'videoId', 'segmentId']
        },
        description: 'Array of video segments to merge'
      },
      mergedName: {
        type: 'string',
        description: 'Name for the merged video'
      },
      options: {
        type: 'object',
        properties: {
          resolution: {
            type: 'string',
            enum: ['720p', '1080p'],
            default: '720p'
          },
          defaultTransition: {
            type: 'string',
            enum: ['cut', 'fade', 'dissolve'],
            default: 'cut'
          },
          defaultTransitionDuration: {
            type: 'number',
            default: 500
          }
        }
      }
    },
    required: ['segments']
  };

  private lambdaClient = new LambdaClient({});

  async execute(params: any): Promise<any> {
    const { segments, mergedName, options = {} } = params;

    if (!segments || segments.length < 2) {
      return {
        success: false,
        error: 'At least 2 segments are required for merging'
      };
    }

    try {
      // Prepare merge request for the existing video-merge Lambda
      const mergeRequest = {
        items: segments.map((segment: VideoSegment) => ({
          indexId: segment.indexId,
          videoId: segment.videoId,
          segmentId: segment.segmentId,
          transitionType: segment.transitionType || options.defaultTransition || 'cut',
          transitionDuration: segment.transitionDuration || options.defaultTransitionDuration || 500
        })),
        mergedName: mergedName || `merged_${Date.now()}`,
        userId: 'strands-agent', // Special user ID for agent operations
        mergeOptions: {
          resolution: options.resolution || '720p',
          defaultTransition: options.defaultTransition || 'cut',
          defaultTransitionDuration: options.defaultTransitionDuration || 500
        }
      };

      const command = new InvokeCommand({
        FunctionName: process.env.VIDEO_MERGE_FUNCTION_NAME || 'video-merge-lambda',
        Payload: JSON.stringify({
          httpMethod: 'POST',
          path: '/videos/merge',
          body: JSON.stringify(mergeRequest),
          headers: {
            'Content-Type': 'application/json'
          }
        })
      });

      const response = await this.lambdaClient.send(command);
      const payload = JSON.parse(new TextDecoder().decode(response.Payload));
      
      if (payload.statusCode !== 200) {
        throw new Error(`Video merge failed: ${payload.body}`);
      }

      const result = JSON.parse(payload.body);
      
      // Poll for completion (simplified for this example)
      if (result.jobId) {
        // In a real implementation, we would poll the job status
        // For now, return the job information
        return {
          success: true,
          jobId: result.jobId,
          status: result.status,
          message: 'Merge job started successfully',
          segments: segments.length,
          estimatedDuration: segments.length * 30 // Rough estimate
        };
      }

      return {
        success: true,
        result: result,
        segments: segments.length
      };
    } catch (error) {
      console.error('Video merge tool error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        segments: segments.length
      };
    }
  }
}