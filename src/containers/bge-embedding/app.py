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
from tenacity import retry, stop_after_attempt, wait_exponential

app = FastAPI()

# Initialize AWS clients
s3 = boto3.client('s3')
credentials = boto3.Session().get_credentials()
awsauth = AWS4Auth(
    credentials.access_key,
    credentials.secret_key,
    os.environ.get('AWS_REGION', 'us-east-1'),
    'es',
    session_token=credentials.token
)

# Initialize OpenSearch client
opensearch = OpenSearch(
    hosts=[{'host': os.environ['OPENSEARCH_DOMAIN'], 'port': 443}],
    http_auth=awsauth,
    use_ssl=True,
    verify_certs=True,
    connection_class=RequestsHttpConnection
)

# Load BGE model
model_path = "/app/models/bce-embedding-base_v1"
tokenizer = AutoTokenizer.from_pretrained(model_path)
model = AutoModel.from_pretrained(model_path)
model.eval()

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
    return {"status": "healthy"}

@app.post("/embed-text")
async def embed_text(input: TextInput):
    try:
        # Tokenize and generate embedding
        inputs = tokenizer(input.text, return_tensors="pt", padding=True, truncation=True, max_length=512)
        with torch.no_grad():
            outputs = model(**inputs)
            embedding = outputs.last_hidden_state.mean(dim=1).numpy().tolist()[0]
        
        return {"embedding": embedding}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/embed-batch")
async def embed_batch(input: BatchTextInput):
    try:
        # Tokenize and generate embeddings for batch
        inputs = tokenizer(input.texts, return_tensors="pt", padding=True, truncation=True, max_length=512)
        with torch.no_grad():
            outputs = model(**inputs)
            embeddings = outputs.last_hidden_state.mean(dim=1).numpy().tolist()
        
        return {"embeddings": embeddings}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/process-video")
@retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=4, max=10))
async def process_video(request: VideoEmbeddingRequest):
    try:
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
                                segment.segment_audio.segment_audio_semantic_embedding = params.text_embedding;
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

        return {"status": "success", "video_id": request.video_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000) 