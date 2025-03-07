# Qwen-embedding Service API Documentation

This service provides endpoints for generating embeddings from text and video using the Qwen2.5-VL model.

## Base URL

```
http://<host>:8001
```

## Endpoints

### Health Check

Check if the service is running.

```
GET /health
```

**Response**
```json
{
    "status": "healthy"
}
```

### Text Embedding

Generate embeddings for one or multiple text inputs.

```
POST /embed-text
```

**Request Body**
```json
{
    "texts": "single text string"
}
```
or
```json
{
    "texts": ["text1", "text2", "text3"]
}
```

**Response**
```json
{
    "embedding": [...]  // For single text input
}
```
or
```json
{
    "embedding": [[...], [...], [...]]  // For multiple text inputs
}
```

### Video Embedding

Generate embeddings for a video stored in S3.

```
POST /embed-video
```

**Request Body**
```json
{
    "bucket": "your-s3-bucket",
    "key": "path/to/video.mp4"
}
```

**Response**
```json
{
    "embedding": [...]
}
```

## Error Handling

The API returns appropriate HTTP status codes and error messages:

- `200`: Successful request
- `500`: Internal server error with error details in the response

## Technical Details

- The service uses batch processing with ThreadedStreamer
- Text embedding batch size: 32, max latency: 0.1s
- Video embedding batch size: 8, max latency: 0.2s
- Supports MP4 video format
- Uses Qwen2.5-VL-3B-Instruct model for embedding generation

## Requirements

- AWS S3 access configured
- Python with FastAPI
- Qwen2.5-VL model
- Required Python packages (see requirements.txt) 