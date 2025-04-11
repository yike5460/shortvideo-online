# Qwen-embedding Service API Documentation

This service provides endpoints for generating embeddings from text and video using the Qwen2.5-VL model and BCE embedding model with WhisperX for audio transcription.

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

Generate embeddings for text using both Qwen and BCE models.

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
    "vision_embedding": [...],  // From Qwen model
    "audio_embedding": [...]    // From BCE model
}
```

### Video and Audio Embedding

Generate both video and audio embeddings from a video stored in S3. The video embedding is generated using the Qwen model, while the audio embedding is created by extracting audio, transcribing it with WhisperX, and then embedding the transcription with the BCE model.

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
    "vision_embedding": [...],  // Video embedding from Qwen model
    "audio_embedding": [...]    // Audio embedding from BCE model
}
```

## Error Handling

The API returns appropriate HTTP status codes and error messages:

- `200`: Successful request
- `500`: Internal server error with error details in the response

## Technical Details

- The service uses batch processing with ThreadedStreamer
- Text embedding batch size (Qwen): 32, max latency: 0.1s
- Video embedding batch size: 8, max latency: 0.2s
- BCE text embedding batch size: 64, max latency: 0.1s
- Audio processing using WhisperX large-v3-turbo model
- Supports MP4 video format
- Uses Qwen2.5-VL-3B-Instruct model for video embedding
- Uses maidalun1020/bce-embedding-base_v1 model for BCE text embedding

## Requirements

- AWS S3 access configured
- Python with FastAPI
- Qwen2.5-VL model
- WhisperX model (large-v3-turbo)
- BCE embedding model
- FFmpeg for audio extraction
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

### Testing Video and Audio Embedding Functionality

You can test the combined video and audio embedding functionality using the provided test script:

```bash
python test_video_embedding.py --api_url http://localhost:8001 --video_path path/to/your/video.mp4 --bucket your-s3-bucket --key optional/custom/key.mp4
```

Note: Make sure you have:
1. A valid Hugging Face access token with read permissions for the models
2. Sufficient disk space for the model downloads (approximately 10GB in total)
3. Docker installed with CUDA support if running on GPU 
4. FFmpeg installed for audio extraction 