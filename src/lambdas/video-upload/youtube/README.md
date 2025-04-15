# YouTube Video Download Lambda

This Lambda function handles downloading videos from YouTube using yt-dlp and uploading them to Amazon S3.

## Recent Changes

### Chrome Dependencies for Headless Browser

- Added required system libraries (libnss3.so and others) to the Lambda layer
- Fixed "Failed to launch browser process" errors
- Implemented fallback mechanism when cookie extraction fails
- Created minimal default cookies file for non-age-restricted videos

## Key Components

### 1. Automated Cookie Management

The function now uses a headless Chrome browser to automatically extract fresh YouTube cookies for each download request, instead of relying on static cookie files that expire.

- **Cookie Manager**: Uses puppeteer-core and chrome-aws-lambda to launch a headless Chrome browser that visits YouTube and extracts cookies
- **Format Conversion**: Converts browser cookies to the Netscape format required by yt-dlp
- **Temporary Storage**: Stores cookies in a temporary file that is cleaned up after use

### 2. YouTube Downloader Integration

- Leverages yt-dlp for video downloading with fresh cookies for each request
- Handles video format selection and quality settings
- Uploads downloaded videos to S3 buckets

### 3. Workflow

1. Lambda function receives a request for a YouTube video
2. Fresh cookies are extracted through the headless browser
3. The video is downloaded using yt-dlp with the fresh cookies
4. The video is uploaded to S3
5. Thumbnail extraction and metadata processing is performed
6. All temporary files (video and cookies) are cleaned up

## Dependencies

- `puppeteer-core`: Headless Chrome API
- `chrome-aws-lambda`: Optimized Chrome binary for AWS Lambda environments
- `yt-dlp`: Enhanced YouTube downloader fork of youtube-dl

## Usage

The function is designed to be invoked via API Gateway with a payload containing the YouTube URL and metadata.

```json
{
  "videoUrl": "https://www.youtube.com/watch?v=VIDEO_ID",
  "metadata": {
    "title": "Optional video title",
    "description": "Optional video description",
    "tags": ["tag1", "tag2"]
  },
  "indexId": "optional_custom_index_name"
}
