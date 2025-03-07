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

## Building and Deployment

### Building the Docker Image

The service can be built using Docker. You'll need a Hugging Face access token to download the model during the build process.

```bash
# Build the Docker image
docker build --build-arg HF_TOKEN=your_hf_token_here -t qwen-embedding-service .
```

### Running the Container

```bash
# Run the container
docker run -d --gpus all -p 8001:8001 -e AWS_ACCESS_KEY_ID=AWS_ACCESS_KEY_ID   -e AWS_SECRET_ACCESS_KEY=AWS_ACCESS_KEY_ID -e AWS_DEFAULT_REGION=AWS_DEFAULT_REGION   qwen-embedding-service:latest
```

The service will be available at `http://localhost:8001`.

Note: Make sure you have:
1. A valid Hugging Face access token with read permissions for the model
2. Sufficient disk space for the model download (approximately 6GB)
3. Docker installed with CUDA support if running on GPU 