from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from transformers import AutoModel, AutoTokenizer
import torch
import boto3
import json
from opensearchpy import OpenSearch, RequestsHttpConnection
from requests_aws4auth import AWS4Auth
import numpy as np
from typing import List, Optional
import os
import logging
from tenacity import retry, stop_after_attempt, wait_exponential

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="BGE Embedding Service")

# Get environment variables with defaults
OPENSEARCH_ENDPOINT = os.getenv('OPENSEARCH_ENDPOINT')
AWS_REGION = os.getenv('AWS_REGION', 'us-east-1')
MODEL_PATH = os.getenv('MODEL_PATH', '/app/models/bce-embedding-base_v1')

try:
    # Initialize AWS clients
    logger.info("Initializing AWS clients...")
    s3 = boto3.client('s3')
    credentials = boto3.Session().get_credentials()
    awsauth = AWS4Auth(
        credentials.access_key,
        credentials.secret_key,
        AWS_REGION,
        'es',
        session_token=credentials.token
    )

    # Initialize OpenSearch client
    logger.info(f"Connecting to OpenSearch at {OPENSEARCH_ENDPOINT}")
    opensearch = OpenSearch(
        hosts=[{'host': OPENSEARCH_ENDPOINT, 'port': 443}],
        http_auth=awsauth,
        use_ssl=True,
        verify_certs=True,
        connection_class=RequestsHttpConnection
    )

    # Load BGE model
    logger.info(f"Loading BGE model from {MODEL_PATH}")
    tokenizer = AutoTokenizer.from_pretrained(MODEL_PATH)
    model = AutoModel.from_pretrained(MODEL_PATH)
    model.eval()
    logger.info("Model loaded successfully")

except Exception as e:
    logger.error(f"Initialization error: {str(e)}")
    raise

class TextInput(BaseModel):
    text: str

class BatchTextInput(BaseModel):
    texts: List[str]

class VideoSegment(BaseModel):
    segment_id: str
    text_content: str
    visual_description: Optional[str] = None

class VideoEmbeddingRequest(BaseModel):
    video_id: str
    segments: List[VideoSegment]

@app.get("/health")
async def health_check():
    """Health check endpoint for ECS container health monitoring"""
    try:
        # Verify model is loaded
        if model is None or tokenizer is None:
            raise Exception("Model or tokenizer not initialized")
        
        # Verify OpenSearch connection
        opensearch.info()
        
        return {
            "status": "healthy",
            "model": "loaded",
            "opensearch": "connected"
        }
    except Exception as e:
        logger.error(f"Health check failed: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/embed-text")
async def embed_text(input: TextInput):
    try:
        logger.info(f"Processing text embedding request: {input.text[:50]}...")
        # Tokenize and generate embedding
        inputs = tokenizer(input.text, return_tensors="pt", padding=True, truncation=True, max_length=512)
        with torch.no_grad():
            outputs = model(**inputs)
            embedding = outputs.last_hidden_state.mean(dim=1).numpy().tolist()[0]
        
        return {"embedding": embedding}
    except Exception as e:
        logger.error(f"Text embedding failed: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/embed-batch")
async def embed_batch(input: BatchTextInput):
    try:
        logger.info(f"Processing batch embedding request of {len(input.texts)} texts")
        # Tokenize and generate embeddings for batch
        inputs = tokenizer(input.texts, return_tensors="pt", padding=True, truncation=True, max_length=512)
        with torch.no_grad():
            outputs = model(**inputs)
            embeddings = outputs.last_hidden_state.mean(dim=1).numpy().tolist()
        
        return {"embeddings": embeddings}
    except Exception as e:
        logger.error(f"Batch embedding failed: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/process-video")
@retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=4, max=10))
async def process_video(request: VideoEmbeddingRequest):
    try:
        logger.info(f"Processing video {request.video_id} with {len(request.segments)} segments")
        # Process each segment
        for segment in request.segments:
            # Generate embeddings for text content
            text_embedding = None
            if segment.text_content:
                inputs = tokenizer(segment.text_content, return_tensors="pt", padding=True, truncation=True, max_length=512)
                with torch.no_grad():
                    outputs = model(**inputs)
                    text_embedding = outputs.last_hidden_state.mean(dim=1).numpy().tolist()[0]

            # Generate embeddings for visual description
            visual_embedding = None
            if segment.visual_description:
                inputs = tokenizer(segment.visual_description, return_tensors="pt", padding=True, truncation=True, max_length=512)
                with torch.no_grad():
                    outputs = model(**inputs)
                    visual_embedding = outputs.last_hidden_state.mean(dim=1).numpy().tolist()[0]

            logger.info(f"Updating OpenSearch for segment {segment.segment_id}")
            # Update OpenSearch document
            opensearch.update(
                index="videos",
                id=request.video_id,
                body={
                    "script": {
                        "source": """
                        def segment = ctx._source.video_segments.find(s -> s.segment_id == params.segment_id);
                        if (segment != null) {
                            if (params.text_embedding != null) {
                                segment.segment_audio.segment_audio_embedding = params.text_embedding;
                            }
                            if (params.visual_embedding != null) {
                                segment.segment_visual.segment_visual_embedding = params.visual_embedding;
                            }
                        }
                        """,
                        "lang": "painless",
                        "params": {
                            "segment_id": segment.segment_id,
                            "text_embedding": text_embedding,
                            "visual_embedding": visual_embedding
                        }
                    }
                }
            )

        logger.info(f"Successfully processed video {request.video_id}")
        return {"status": "success", "video_id": request.video_id}
    except Exception as e:
        logger.error(f"Video processing failed: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv('PORT', '8000'))
    host = os.getenv('HOST', '0.0.0.0')
    workers = int(os.getenv('WORKERS', '1'))
    logger.info(f"Starting server on {host}:{port} with {workers} workers")
    uvicorn.run(
        "app:app",
        host=host,
        port=port,
        workers=workers,
        log_level="info",
        access_log=True
    ) 