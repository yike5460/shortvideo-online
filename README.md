# shortvideo-online

## Search Service

### Overall Workflow:
1. user input multimodal queries (text or image) along with the video path (Youtube url for remote video and local video path for local video) to search video clips with the following options:
- exact keywords search according to the video image, e.g. hummingbird in the video, or joe biden, caption American 
- exact keywords search according to the video audio, e.g. make america great again speech in the video
- fuzzy semantic expression search, e.g. all the slang prompted in the video
- image search, e.g. find the video clip that contains the image of a hummingbird

2. user will get output inlcude list of (top k) video clips along with the duration timestamp include the queries, in format of json
```json
{
    // Youtube url or local video path
    "video_path": "path/to/video",
    // SMPTE format
    "video_clips": [
        {"start_time": "00:00:12:34", "end_time": "00:00:56:78", "duration": "00:00:44:44", "top K": 5, "query": "hummingbird in the video"}
    ]
}
```

### Frontend Module
Using Next.js, Tailwind CSS, Shadcn UI to build the frontend UI. The frontend will include a search bar to input the queries and the video path, and a button to trigger the search. The search result will be displayed in grid view for a list of video clips with the timestamp and the duration, user can hover on each video clip to see the detail information and see the preview of the video clip.

### Backend Module

### Download Video
Using [YoutubeDL](https://github.com/ytdl-org/youtube-dl) to download the video from Youtube URL and store to Amazon S3. To consider the performance, we will use Amazon Cloudwatch Event to trigger the Lambda function to crawl the video specific Youtube category (e.g. trending, music, gaming, etc.) and store to Amazon S3.

### Video Extraction
Using S3 event notification to trigger the Lambda function to extract metadata from the video, including the raw audio, the raw image, the raw text description of the video and summary of the video.
- Using FFMPEG to extract the audio from the video.
- Using Amazon Transcribe to extract the text from the audio.
- Using FFMPEG to capture the video key frames intervally and send to Amazon Bedrock for image extraction.
- Using Amazon Bedrock summarize the video content into a short paragraph.

### Video Metadata Storage
Using Amazon Opensearch to store the video information and the search result. The schema of the metadata stored in Opensearch is as follows:
```json
{
    "video_id": "string",  // Unique identifier for the video
    "video_path": "string",  // Youtube URL or local video path
    "s3_path": "string",  // S3 storage location
    "title": "string",  // Video title
    "description": "string",  // Original video description
    "summary": "string",  // AI-generated summary
    "duration": "string",  // Total video duration in SMPTE format
    "upload_date": "datetime",
    "metadata": {
        "audio_transcript": {
            "segments": [
                {
                    "start_time": "string",  // SMPTE format
                    "end_time": "string",
                    "text": "string",
                    "confidence": "float"
                }
            ]
        },
        "visual_content": {
            "keyframes": [
                {
                    "timestamp": "string",  // SMPTE format
                    "s3_path": "string",  // Path to stored keyframe
                    "objects": ["string"],  // Detected objects
                    "scene_description": "string",  // AI-generated scene description
                    "embeddings": [0.0]  // Vector embeddings for similarity search
                }
            ]
        },
        "tags": ["string"],  // Auto-generated and manual tags
        "categories": ["string"]  // Video categories
    },
    "search_vectors": {
        "text_embedding": [0.0],  // Combined text embeddings
        "visual_embedding": [0.0]  // Combined visual embeddings
    }
}
```

### Backend Architecture

#### Data Processing Pipeline
1. **Video Ingestion Service**
   - Handles video upload/URL submission
   - Validates video format and content
   - Triggers the download process for YouTube videos
   - Manages S3 storage organization

2. **Video Processing Service**
   - Manages distributed video processing tasks
   - Extracts keyframes using FFMPEG
   - Generates audio transcripts using Amazon Transcribe
   - Creates embeddings using Amazon Bedrock
   - Handles parallel processing for large videos

3. **Search Engine Service**
   - Manages search queries across different modalities
   - Implements vector similarity search
   - Handles text-based search with fuzzy matching
   - Provides relevance scoring and ranking
   - Supports multi-modal query processing

4. **Cache and Performance Layer**
   - Implements Redis for frequent search results
   - Caches processed video segments
   - Manages hot/cold storage optimization
   - Handles rate limiting and request queuing

### System Components

#### AWS Infrastructure
- **Amazon S3**
  - Raw video storage
  - Processed keyframes
  - Extracted audio files
  - Temporary processing artifacts

- **Amazon OpenSearch**
  - Video metadata indexing
  - Vector search capabilities
  - Full-text search functionality
  - Real-time analytics

- **Amazon Lambda**
  - Video processing triggers
  - Search query handling
  - Metadata updates
  - Event-driven processing

- **Amazon ECS/EKS**
  - Video processing workers
  - Search API services
  - Background task processing


### RESTful API Endpoints

```plaintext
POST /api/v1/videos
- Upload or register new video

GET /api/v1/videos/{video_id}
- Retrieve video metadata

POST /api/v1/search
- Multi-modal search endpoint
- Supports text, image, and combined queries

GET /api/v1/videos/{video_id}/segments
- Retrieve video segments matching criteria

POST /api/v1/process
- Trigger video processing manually

GET /api/v1/status/{job_id}
- Check processing status
```

## Editing Service

## Template Service