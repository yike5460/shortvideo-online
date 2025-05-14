from fastapi import FastAPI, Query, HTTPException
from transformers import Qwen2_5_VLForConditionalGeneration, AutoProcessor
from qwen_vl_utils import process_vision_info
import torch
import boto3
import tempfile
import os
import logging
from typing import Optional, Union, Dict, Any
from enum import Enum

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="Qwen-VL API", description="API for Qwen-VL model with image and video support")

# Initialize S3 client
s3 = boto3.client('s3')

# Define input types
class InputType(str, Enum):
    IMAGE = "image"
    VIDEO = "video"

checkpoint = "Qwen/Qwen2.5-VL-7B-Instruct"
min_pixels = 256*28*28
max_pixels = 1280*28*28
processor = AutoProcessor.from_pretrained(
    checkpoint,
    min_pixels=min_pixels,
    max_pixels=max_pixels
)
model = Qwen2_5_VLForConditionalGeneration.from_pretrained(
    checkpoint,
    torch_dtype=torch.bfloat16,
    device_map="auto",
    # attn_implementation="flash_attention_2",
)

@app.get("/")
def read_root():
    """
    Root endpoint providing information about the API.
    """
    return {
        "message": "Qwen-VL API is live",
        "version": "1.0.0",
        "endpoints": {
            "/predict": "Process an image or video and generate a response",
            "/health": "Health check endpoint"
        },
        "supported_input_types": ["image", "video"]
    }

@app.get("/health")
def health_check():
    """
    Health check endpoint to verify the API is running.
    """
    return {"status": "healthy", "model": checkpoint}

@app.get("/predict")
def predict(
    url: str = Query(..., description="URL or S3 path of the image or video"),
    prompt: str = Query(..., description="Prompt for the model"),
    input_type: InputType = Query(InputType.IMAGE, description="Type of input (image or video)"),
    fps: Optional[float] = Query(1.0, description="Frames per second for video processing"),
    max_frames: Optional[int] = Query(8, description="Maximum number of frames to process"),
) -> Dict[str, Any]:
    """
    Process an image or video with the Qwen-VL model and generate a response.
    
    Args:
        url: URL or S3 path of the image or video
        prompt: Prompt for the model
        input_type: Type of input (image or video)
        fps: Frames per second for video processing (only used for video)
        max_frames: Maximum number of frames to process (only used for video)
        
    Returns:
        Dictionary containing the model's response and metadata
    """
    temp_path = None
    try:
        logger.info(f"Processing {input_type} input: {url}")
        
        # Handle different input types
        if input_type == InputType.IMAGE:
            logger.info("Processing image input")
            content = [{"type": "image", "image": url}, {"type": "text", "text": prompt}]
        else:
            logger.info("Processing video input")
            # Check if it's an S3 path
            if url.startswith("s3://"):
                # Parse S3 path
                s3_path = url.replace("s3://", "")
                parts = s3_path.split("/", 1)
                bucket = parts[0]
                key = parts[1] if len(parts) > 1 else ""
                
                logger.info(f"Downloading video from S3: bucket={bucket}, key={key}")
                
                # Create a temporary file to store the downloaded video
                with tempfile.NamedTemporaryFile(suffix='.mp4', delete=False) as temp_video:
                    temp_path = temp_video.name
                
                try:
                    # Download video from S3
                    s3.download_file(bucket, key, temp_path)
                    logger.info(f"Video downloaded to {temp_path}")
                    
                    # Process video
                    content = [
                        {"type": "video", "video": temp_path, "fps": fps, "max_frames": max_frames},
                        {"type": "text", "text": prompt}
                    ]
                except Exception as e:
                    logger.error(f"Error downloading video from S3: {str(e)}")
                    raise HTTPException(status_code=500, detail=f"Error downloading video from S3: {str(e)}")
            else:
                # Direct URL
                logger.info(f"Processing video from URL with fps={fps}, max_frames={max_frames}")
                content = [
                    {"type": "video", "video": url, "fps": fps, "max_frames": max_frames},
                    {"type": "text", "text": prompt}
                ]
        
        messages = [
            {"role": "system", "content": "You are a helpful assistant with vision abilities."},
            {"role": "user", "content": content},
        ]
    except Exception as e:
        logger.error(f"Error processing input: {str(e)}")
        raise HTTPException(status_code=400, detail=f"Error processing input: {str(e)}")
    try:
        logger.info("Applying chat template and processing vision info")
        text = processor.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
        image_inputs, video_inputs = process_vision_info(messages)
        
        logger.info(f"Image inputs: {len(image_inputs) if image_inputs else 0}, Video inputs: {len(video_inputs) if video_inputs else 0}")
        
        inputs = processor(
            text=[text],
            images=image_inputs,
            videos=video_inputs,
            padding=True,
            return_tensors="pt",
        ).to(model.device)
        
        logger.info("Generating response")
        with torch.no_grad():
            generated_ids = model.generate(**inputs, max_new_tokens=2048)
        
        generated_ids_trimmed = [out_ids[len(in_ids):] for in_ids, out_ids in zip(inputs.input_ids, generated_ids)]
        output_texts = processor.batch_decode(
            generated_ids_trimmed, skip_special_tokens=True, clean_up_tokenization_spaces=False
        )
        
        # Prepare response with metadata
        response = {
            "response": output_texts[0],
            "metadata": {
                "input_type": input_type,
                "prompt": prompt
            }
        }
        
        logger.info("Response generated successfully")
        return response
    except Exception as e:
        logger.error(f"Error during model inference: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error during model inference: {str(e)}")
    finally:
        # Clean up any temporary files
        if temp_path and os.path.exists(temp_path):
            try:
                os.unlink(temp_path)
                logger.info(f"Temporary file {temp_path} removed")
            except Exception as e:
                logger.warning(f"Failed to remove temporary file {temp_path}: {str(e)}")
