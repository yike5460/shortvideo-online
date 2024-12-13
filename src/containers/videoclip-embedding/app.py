from fastapi import FastAPI, HTTPException, UploadFile, File
from pydantic import BaseModel
from transformers import AutoProcessor, AutoModel
import torch
import boto3
import json
from opensearchpy import OpenSearch, RequestsHttpConnection
from requests_aws4auth import AWS4Auth
import numpy as np
from typing import List, Optional
import os
import tempfile
from tenacity import retry, stop_after_attempt, wait_exponential
import subprocess
from PIL import Image
import io

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

# Load VideoCLIP model
model_path = "/app/models/VideoCLIP-XL"
processor = AutoProcessor.from_pretrained(model_path)
model = AutoModel.from_pretrained(model_path)
model.eval()

class VideoSegment(BaseModel):
    segment_id: str
    start_time: float
    end_time: float
    keyframe_path: Optional[str] = None

class VideoEmbeddingRequest(BaseModel):
    video_id: str
    bucket: str
    key: str
    segments: List[VideoSegment]

@app.get("/health")
async def health_check():
    return {"status": "healthy"}

def extract_frames(video_path: str, timestamp: float) -> Image.Image:
    """Extract a frame from video at specified timestamp using ffmpeg"""
    cmd = [
        'ffmpeg',
        '-ss', str(timestamp),
        '-i', video_path,
        '-vframes', '1',
        '-f', 'image2pipe',
        '-vcodec', 'png',
        '-'
    ]
    
    process = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    output, error = process.communicate()
    
    if process.returncode != 0:
        raise Exception(f"Frame extraction failed: {error.decode()}")
    
    return Image.open(io.BytesIO(output))

@app.post("/process-video")
@retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=4, max=10))
async def process_video(request: VideoEmbeddingRequest):
    try:
        # Download video from S3
        with tempfile.NamedTemporaryFile(suffix='.mp4') as video_file:
            s3.download_file(request.bucket, request.key, video_file.name)
            
            # Process each segment
            for segment in request.segments:
                # Extract frames at the start and middle of segment
                frames = []
                timestamps = [
                    segment.start_time,
                    segment.start_time + (segment.end_time - segment.start_time) / 2
                ]
                
                for timestamp in timestamps:
                    frame = extract_frames(video_file.name, timestamp)
                    frames.append(frame)
                
                # Generate video embedding
                inputs = processor(images=frames, return_tensors="pt", padding=True)
                with torch.no_grad():
                    outputs = model(**inputs)
                    # Average pooling over frames
                    video_embedding = outputs.last_hidden_state.mean(dim=1).numpy().tolist()[0]
                
                # If keyframe exists, generate image embedding
                image_embedding = None
                if segment.keyframe_path:
                    keyframe_obj = s3.get_object(Bucket=request.bucket, Key=segment.keyframe_path)
                    keyframe = Image.open(io.BytesIO(keyframe_obj['Body'].read()))
                    
                    inputs = processor(images=[keyframe], return_tensors="pt", padding=True)
                    with torch.no_grad():
                        outputs = model(**inputs)
                        image_embedding = outputs.last_hidden_state.mean(dim=1).numpy().tolist()[0]

                # Update OpenSearch document
                opensearch.update(
                    index="videos",
                    id=request.video_id,
                    body={
                        "script": {
                            "source": """
                            def segment = ctx._source.video_segments.find(s -> s.segment_id == params.segment_id);
                            if (segment != null) {
                                segment.segment_visual.segment_visual_embedding = params.video_embedding;
                                if (params.image_embedding != null) {
                                    segment.segment_visual.segment_keyframe_embedding = params.image_embedding;
                                }
                            }
                            """,
                            "lang": "painless",
                            "params": {
                                "segment_id": segment.segment_id,
                                "video_embedding": video_embedding,
                                "image_embedding": image_embedding
                            }
                        }
                    }
                )

        return {"status": "success", "video_id": request.video_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/embed-video")
async def embed_video(video: UploadFile = File(...)):
    try:
        # Save uploaded video to temporary file
        with tempfile.NamedTemporaryFile(suffix='.mp4') as temp_video:
            temp_video.write(await video.read())
            temp_video.flush()
            
            # Extract middle frame
            video_info = subprocess.check_output([
                'ffprobe',
                '-v', 'error',
                '-show_entries', 'format=duration',
                '-of', 'default=noprint_wrappers=1:nokey=1',
                temp_video.name
            ])
            duration = float(video_info.decode().strip())
            middle_frame = extract_frames(temp_video.name, duration/2)
            
            # Generate embedding
            inputs = processor(images=[middle_frame], return_tensors="pt", padding=True)
            with torch.no_grad():
                outputs = model(**inputs)
                embedding = outputs.last_hidden_state.mean(dim=1).numpy().tolist()[0]
            
            return {"embedding": embedding}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001) 