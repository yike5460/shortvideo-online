import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';

interface Tool {
  name: string;
  description: string;
  inputSchema: any;
  execute(params: any): Promise<any>;
}

export class VideoSearchTool implements Tool {
  name = 'video_search';
  description = 'Search existing video library using natural language queries';
  inputSchema = {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Natural language search query'
      },
      indexes: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional list of video indexes to search in'
      },
      topK: {
        type: 'number',
        description: 'Number of results to return (default: 5)',
        default: 5
      },
      minConfidence: {
        type: 'number',
        description: 'Minimum confidence score for results (0-1)',
        default: 0.3
      }
    },
    required: ['query']
  };

  private lambdaClient = new LambdaClient({});

  async execute(params: any): Promise<any> {
    const { query, indexes, topK = 5, minConfidence = 0.3 } = params;

    try {
      // Call the existing video-search Lambda function
      const searchRequest = {
        searchType: 'text',
        searchQuery: query,
        exactMatch: false,
        topK,
        weights: {
          text: 0.4,
          image: 0.3,
          video: 0.2,
          audio: 0.1
        },
        minConfidence,
        selectedIndex: indexes?.[0] || 'videos', // Use first index or default
        advancedSearch: true,
        visualSearch: true,
        audioSearch: true
      };

      const command = new InvokeCommand({
        FunctionName: process.env.VIDEO_SEARCH_FUNCTION_NAME || 'video-search-lambda',
        Payload: JSON.stringify({
          httpMethod: 'POST',
          body: JSON.stringify(searchRequest),
          headers: {
            'Content-Type': 'application/json'
          }
        })
      });

      const response = await this.lambdaClient.send(command);
      const payload = JSON.parse(new TextDecoder().decode(response.Payload));
      
      if (payload.statusCode !== 200) {
        throw new Error(`Video search failed: ${payload.body}`);
      }

      const results = JSON.parse(payload.body);
      
      return {
        success: true,
        query,
        results: results.map((video: any) => ({
          videoId: video.id,
          title: video.title,
          description: video.description,
          duration: video.videoDuration,
          thumbnailUrl: video.videoThumbnailUrl,
          videoUrl: video.videoPreviewUrl,
          s3Path: video.videoS3Path,
          confidence: video.searchConfidence,
          segments: video.segments.map((segment: any) => ({
            segmentId: segment.segment_id,
            startTime: segment.start_time,
            endTime: segment.end_time,
            duration: segment.duration,
            confidence: segment.confidence,
            videoUrl: segment.segment_video_preview_url,
            thumbnailUrl: segment.segment_video_thumbnail_url,
            s3Path: segment.segment_video_s3_path
          }))
        })),
        totalResults: results.length
      };
    } catch (error) {
      console.error('Video search tool error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        query
      };
    }
  }
}