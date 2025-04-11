import io
import logging
import tempfile
import os
import boto3
from typing import List, Union

import torch
from fastapi import FastAPI, HTTPException, UploadFile, File
from pydantic import BaseModel
from PIL import Image
from service_streamer import ThreadedStreamer

from gme_inference import GmeQwen2VL
from qwen_vl_utils import process_vision_info
from audio_processor import AudioProcessor
from text_embedder import BCETextEmbedder

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Initialize FastAPI app
app = FastAPI()

try:
    # Initialize AWS S3 client
    logger.info("Initializing AWS S3 client...")
    s3 = boto3.client('s3')
    
    # Initialize Qwen model
    logger.info("Loading Qwen model...")
    gme = GmeQwen2VL('/app/model')
    
    # Initialize streamers for batch processing
    text_streamer = ThreadedStreamer(gme.get_text_embeddings, batch_size=32, max_latency=0.1)
    video_streamer = ThreadedStreamer(gme.get_image_embeddings, batch_size=8, max_latency=0.2)
    
    # Initialize audio processor (WhisperX) and text embedder (BCE)
    logger.info("Loading audio processor and text embedder...")
    audio_processor = AudioProcessor(model_name="/app/model/whisper", compute_type="float16", batch_size=16)
    text_embedder = BCETextEmbedder(model_name="/app/model/bce", batch_size=64)
    
    # Initialize streamer for text embedding
    bce_text_streamer = ThreadedStreamer(text_embedder.get_embeddings, batch_size=64, max_latency=0.1)
    
    logger.info("All models and streamers loaded successfully")
except Exception as e:
    logger.error(f"Initialization error: {str(e)}")
    raise

class TextEmbeddingRequest(BaseModel):
    texts: Union[str, List[str]]

class VideoEmbeddingRequest(BaseModel):
    bucket: str
    key: str

@app.get("/health")
async def health_check():
    return {"status": "healthy"}

@app.post("/embed-video")
async def embed_video(request: VideoEmbeddingRequest):
    try:
        # Create a temporary file to store the downloaded video
        with tempfile.NamedTemporaryFile(suffix='.mp4', delete=False) as temp_video:
            # Download video from S3
            logger.info(f"Downloading video from S3: {request.bucket}/{request.key}")
            s3.download_file(request.bucket, request.key, temp_video.name)
            
            # Process both video and audio embeddings
            video_embedding = None
            audio_embedding = None
            transcription = None
            
            try:
                # Generate video embedding
                logger.info("Generating video embedding")
                video_embedding = video_streamer.predict([temp_video.name])
                
                try:
                    # Transcribe audio using WhisperX
                    logger.info("Transcribing audio")
                    transcription = audio_processor.transcribe_audio(temp_video.name)
                    
                    # Generate text embedding using BCE model
                    logger.info("Generating embedding from transcription")
                    audio_embedding = bce_text_streamer.predict([transcription])
                except Exception as e:
                    logger.error(f"Error in audio embedding: {str(e)}")
            
            finally:
                # Clean up the temporary video file
                if os.path.exists(temp_video.name):
                    os.unlink(temp_video.name)
            
            # Prepare response
            response = {
                "vision_embedding": video_embedding[0].tolist() if video_embedding is not None else None
            }
            
            # Add audio embedding and transcription if available
            if audio_embedding is not None:
                response["audio_embedding"] = audio_embedding[0].tolist() if audio_embedding is not None else None
            return response
            
    except Exception as e:
        logger.error(f"Error in embed-video: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/embed-text")
async def embed_text(request: TextEmbeddingRequest):
    try:
        # Convert single string to list if necessary
        texts = [request.texts] if isinstance(request.texts, str) else request.texts
        
        # Generate text embeddings using both models in parallel
        # 1. Generate embeddings from Qwen model
        text_embeddings = text_streamer.predict(texts)
        
        # 2. Generate embeddings from BCE model (for audio)
        bce_embeddings = bce_text_streamer.predict(texts)
        
        # Process Qwen embeddings
        qwen_embeddings = [emb.tolist() for emb in text_embeddings]
        if isinstance(request.texts, str):
            qwen_embeddings = qwen_embeddings[0]
        
        # Process BCE embeddings
        audio_embeddings = [emb.tolist() for emb in bce_embeddings]

        if isinstance(request.texts, str):
            audio_embeddings = audio_embeddings[0]

        # Combine results in response
        return {
            "vision_embedding": qwen_embeddings,
            "audio_embedding": audio_embeddings  # Marked as audio embedding from BCE model
        }
    except Exception as e:
        logger.error(f"Error in embed-text: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001) 