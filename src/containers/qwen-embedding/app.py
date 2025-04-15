import io
import logging
import tempfile
import os
import boto3
from typing import List, Union

import torch
from flask import Flask, request, jsonify
from PIL import Image
from service_streamer import ThreadedStreamer

from gme_inference import GmeQwen2VL
from qwen_vl_utils import process_vision_info

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Initialize Flask app
app = Flask(__name__)

try:
    # Initialize AWS S3 client
    logger.info("Initializing AWS S3 client...")
    s3 = boto3.client('s3')
    
    # Initialize Qwen model
    logger.info("Loading Qwen model...")
    gme = GmeQwen2VL('/app/model')
    
    # Initialize streamers for batch processing
    text_streamer = ThreadedStreamer(gme.get_text_embeddings, batch_size=32, max_latency=0.1)
    video_streamer = ThreadedStreamer(gme.get_image_embeddings, batch_size=8, max_latency=0.3)
    
    logger.info("Qwen model and streamers loaded successfully")
except Exception as e:
    logger.error(f"Initialization error: {str(e)}")
    raise

@app.route('/health', methods=['GET'])
def health_check():
    return jsonify({"status": "healthy"})

@app.route('/embed-video', methods=['POST'])
def embed_video():
    try:
        data = request.get_json()
        
        if not data or 'bucket' not in data or 'key' not in data:
            return jsonify({"error": "Missing required fields"}), 400
            
        # Create a temporary file to store the downloaded video
        with tempfile.NamedTemporaryFile(suffix='.mp4', delete=False) as temp_video:
            # Download video from S3
            s3.download_file(data['bucket'], data['key'], temp_video.name)
            
            # Generate video embedding using streamer with the video path
            video_embedding = video_streamer.predict([temp_video.name])
            
            # Clean up the temporary file
            os.unlink(temp_video.name)
            
            return jsonify({"embedding": video_embedding[0].tolist()})
    except Exception as e:
        logger.error(f"Error in embed-video: {str(e)}")
        return jsonify({"error": str(e)}), 500

@app.route('/embed-text', methods=['POST'])
def embed_text():
    try:
        data = request.get_json()
        
        if not data or 'texts' not in data:
            return jsonify({"error": "Missing required fields"}), 400
            
        # Convert single string to list if necessary
        texts = [data['texts']] if isinstance(data['texts'], str) else data['texts']
        
        # Generate text embeddings using streamer
        text_embeddings = text_streamer.predict(texts)
        
        # Convert to list format
        embeddings = [emb.tolist() for emb in text_embeddings]
        
        # If input was single string, return single embedding
        if isinstance(data['texts'], str):
            embeddings = embeddings[0]
            
        return jsonify({"embedding": embeddings})
    except Exception as e:
        logger.error(f"Error in embed-text: {str(e)}")
        return jsonify({"error": str(e)}), 500

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8001) 