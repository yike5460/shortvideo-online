import io
import os
import subprocess
import sys
import tempfile
from typing import List, Optional, Union

import boto3
import cv2
import numpy as np
import torch
from fastapi import FastAPI, HTTPException, UploadFile, File
from opensearchpy import OpenSearch, RequestsHttpConnection
from PIL import Image
from pydantic import BaseModel
from requests_aws4auth import AWS4Auth
from tenacity import retry, stop_after_attempt, wait_exponential
from torchvision import transforms
from transformers import AutoModel

model_path = "/app/models/VideoCLIP-XL"
sys.path.append(model_path)
from modeling import VideoCLIP_XL
from utils.text_encoder import text_encoder

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
videoclip_model = VideoCLIP_XL()
state_dict = torch.load(os.path.join(model_path, "VideoCLIP-XL.bin"), map_location="cpu")
videoclip_model.load_state_dict(state_dict)
videoclip_model.cuda().eval()

# Initialize Jina-CLIP model
image_model = AutoModel.from_pretrained('/app/models/jina-clip-v1', trust_remote_code=True)
image_model.cuda().eval()

# 定义标准化转换
normalize = transforms.Normalize(
    mean=[0.485, 0.456, 0.406],
    std=[0.229, 0.224, 0.225]
)

def preprocess_frame(frame):
    """预处理单个视频帧
    Args:
        frame: numpy array, shape (H, W, C)
    Returns:
        tensor: normalized frame tensor
    """
    # Convert to float and scale to [0, 1]
    frame = frame.astype(np.float32) / 255.0
    # Convert to tensor and change to (C, H, W)
    frame = torch.from_numpy(frame).permute(2, 0, 1)
    # Normalize
    frame = normalize(frame)
    return frame

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

class TextEmbeddingRequest(BaseModel):
    texts: Union[str, List[str]]

@app.get("/health")
async def health_check():
    return {"status": "healthy"}
def extract_frames(video_path: str, start_time: float, end_time: float, num_frames: int = 8) -> List[np.ndarray]:
    """Extract uniformly sampled frames from video between start_time and end_time
    
    Args:
        video_path: Path to video file
        start_time: Start time in seconds
        end_time: End time in seconds
        num_frames: Number of frames to extract (default: 8)
    
    Returns:
        List of numpy arrays in RGB format
    """
    cap = cv2.VideoCapture(video_path)
    
    # Set start position
    cap.set(cv2.CAP_PROP_POS_MSEC, start_time * 1000)
    
    frames = []
    while cap.isOpened():
        ret, frame = cap.read()
        if not ret or cap.get(cv2.CAP_PROP_POS_MSEC) > end_time * 1000:
            break
        # Convert BGR to RGB
        frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        frames.append(frame)
    
    cap.release()
    
    # Uniform sampling using step
    if len(frames) > num_frames:
        step = len(frames) // num_frames
        frames = frames[::step][:num_frames]
    
    return frames

def video_preprocessing(frames):
    """Post-process extracted frames for model input
    Args:
        frames: List of numpy arrays in RGB format
        fnum: Target number of frames
    Returns:
        torch.Tensor: Processed and normalized frame tensor
    """
    processed_frames = []
    for frame in frames:
        # Resize frame
        frame = cv2.resize(frame, (224, 224))
        # Preprocess individual frame
        frame = preprocess_frame(frame)
        processed_frames.append(frame)
    
    # Stack frames along time dimension
    video_tensor = torch.stack(processed_frames)
    # Add batch dimension
    video_tensor = video_tensor.unsqueeze(0)
    
    return video_tensor

@app.post("/process-video")
@retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=4, max=10))
async def process_video(request: VideoEmbeddingRequest):
    try:
        # Download video from S3
        with tempfile.NamedTemporaryFile(suffix='.mp4') as video_file:
            s3.download_file(request.bucket, request.key, video_file.name)
            
            # Process each segment
            for segment in request.segments:
                # Extract frames
                raw_frames = extract_frames(video_file.name, segment.start_time, segment.end_time)
                # Post-process frames
                processed_frames = video_preprocessing(raw_frames)
                
                # Generate video embedding
                with torch.no_grad():
                    video_inputs = processed_frames.float().cuda()
                    video_features = videoclip_model.vision_model.get_vid_features(video_inputs).float()
                    video_embedding = (video_features / video_features.norm(dim=-1, keepdim=True)).cpu().numpy().tolist()[0]
                
                # If keyframe exists, generate image embedding using Jina-CLIP
                image_embedding = None
                if segment.keyframe_path:
                    keyframe_obj = s3.get_object(Bucket=request.bucket, Key=segment.keyframe_path)
                    keyframe = Image.open(io.BytesIO(keyframe_obj['Body'].read()))
                    
                    # Generate image embedding using Jina-CLIP
                    with torch.no_grad():
                        image_embedding = image_model.encode_image([keyframe])[0].tolist()

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
            
            # Extract frames from the entire video
            video_info = subprocess.check_output([
                'ffprobe',
                '-v', 'error',
                '-show_entries', 'format=duration',
                '-of', 'default=noprint_wrappers=1:nokey=1',
                temp_video.name
            ])
            duration = float(video_info.decode().strip())
            
            # Extract frames from the whole video
            raw_frames = extract_frames(temp_video.name, 0, duration)
            
            # Process frames
            processed_frames = video_preprocessing(raw_frames)
            
            # Generate video embedding using VideoCLIP
            with torch.no_grad():
                video_inputs = processed_frames.float().cuda()
                video_features = videoclip_model.vision_model.get_vid_features(video_inputs).float()
                video_embedding = (video_features / video_features.norm(dim=-1, keepdim=True)).cpu().numpy().tolist()[0]
            
            return {"embedding": video_embedding}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/embed-image")
async def embed_image(image: UploadFile = File(...)):
    try:
        # Read and process the uploaded image
        image_content = await image.read()
        image = Image.open(io.BytesIO(image_content))
        
        # Generate image embedding using Jina-CLIP
        with torch.no_grad():
            image_embedding = image_model.encode_image([image])[0].tolist()
            
        return {"embedding": image_embedding}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/embed-text-for-video")
async def embed_text_for_video(request: TextEmbeddingRequest):
    try:
        # Convert single string to list if necessary
        is_single_text = isinstance(request.texts, str)
        texts = [request.texts] if is_single_text else request.texts
        
        with torch.no_grad():
            text_inputs = text_encoder.tokenize(texts, truncate=True).cuda()
            text_features = videoclip_model.text_model.encode_text(text_inputs).float()
            text_embeddings = (text_features / text_features.norm(dim=-1, keepdim=True)).cpu().numpy().tolist()
            if is_single_text:
                text_embeddings = text_embeddings[0]
        return {"embeddings": text_embeddings}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/embed-text-for-image")
async def embed_text_for_image(request: TextEmbeddingRequest):
    try:
        # Convert single string to list if necessary
        is_single_text = isinstance(request.texts, str)
        texts = [request.texts] if is_single_text else request.texts
        
        with torch.no_grad():
            text_embeddings = image_model.encode_text(texts)
            # Convert numpy array to list
            text_embeddings = text_embeddings.tolist()
            # If input was a single string, return the first embedding as a flat list
            if is_single_text:
                text_embeddings = text_embeddings[0]
        return {"embeddings": text_embeddings}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001) 