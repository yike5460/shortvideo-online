import requests
import json
import sys
import logging
import boto3
import os
import argparse
from botocore.exceptions import ClientError

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

def upload_to_s3(file_path, bucket, object_name=None):
    """Upload a file to an S3 bucket

    Args:
        file_path: File to upload
        bucket: Bucket to upload to
        object_name: S3 object name (if None, file_name is used)

    Returns:
        True if file was uploaded, else False
    """
    # If S3 object_name was not specified, use file_name
    if object_name is None:
        object_name = os.path.basename(file_path)

    # Upload the file
    s3_client = boto3.client('s3')
    try:
        s3_client.upload_file(file_path, bucket, object_name)
        logger.info(f"Successfully uploaded {file_path} to {bucket}/{object_name}")
        return True
    except ClientError as e:
        logger.error(f"Error uploading file to S3: {e}")
        return False

def test_video_embedding(api_url, video_path, bucket_name, object_key=None):
    """Test the combined video and audio embedding API endpoint

    Args:
        api_url: URL of the API
        video_path: Path to the video file
        bucket_name: S3 bucket name
        object_key: S3 object key (if None, the filename is used)
    """
    if object_key is None:
        object_key = os.path.basename(video_path)
    
    # First, upload the video to S3
    logger.info(f"Uploading video to S3: {video_path}")
    if not upload_to_s3(video_path, bucket_name, object_key):
        logger.error("Failed to upload video to S3")
        return
    
    # Now test the video embedding endpoint (which now includes audio embedding)
    endpoint = f"{api_url}/embed-video"
    payload = {
        "bucket": bucket_name,
        "key": object_key
    }
    
    try:
        logger.info(f"Sending request to {endpoint} with payload: {payload}")
        response = requests.post(endpoint, json=payload)
        
        if response.status_code == 200:
            result = response.json()
            
            # Extract video embedding
            video_embedding = result.get("vision_embedding")
            if video_embedding:
                logger.info(f"Video embedding generated successfully!")
                logger.info(f"Video embedding shape: {len(video_embedding)} dimensions")
                logger.info(f"First 5 dimensions of video embedding: {video_embedding[:5]}")
            else:
                logger.warning("No video embedding returned")
            
            # Extract audio embedding and transcription
            audio_embedding = result.get("audio_embedding")
            transcription = result.get("transcription")
            
            if audio_embedding:
                logger.info(f"Audio embedding generated successfully!")
                logger.info(f"Audio embedding shape: {len(audio_embedding)} dimensions")
                logger.info(f"First 5 dimensions of audio embedding: {audio_embedding[:5]}")
            else:
                logger.warning("No audio embedding returned")
                
            if transcription:
                logger.info(f"Transcription: {transcription}")
            else:
                logger.warning("No transcription returned")
        else:
            logger.error(f"API request failed with status code {response.status_code}")
            logger.error(f"Response: {response.text}")
    
    except Exception as e:
        logger.error(f"Error during API request: {str(e)}")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Test video and audio embedding API")
    parser.add_argument("--api_url", default="http://localhost:8001", help="API URL")
    parser.add_argument("--video_path", required=True, help="Path to video file")
    parser.add_argument("--bucket", required=True, help="S3 bucket name")
    parser.add_argument("--key", help="S3 object key (default: filename)")
    
    args = parser.parse_args()
    
    test_video_embedding(args.api_url, args.video_path, args.bucket, args.key) 