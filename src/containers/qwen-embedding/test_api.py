import requests
import json
import time

# API endpoints
BASE_URL = "http://localhost:8001"
TEXT_URL = f"{BASE_URL}/embed-text"
VIDEO_URL = f"{BASE_URL}/embed-video"

def test_text_embedding():
    """Test text embedding endpoint with both single text and batch"""
    print("\n=== Testing Text Embedding ===")
    
    # Test single text
    single_text_data = {
        "texts": "这是一个测试文本"
    }
    print("\nTesting single text...")
    response = requests.post(TEXT_URL, json=single_text_data)
    if response.status_code == 200:
        result = response.json()
        print(f"Single text embedding shape: {len(result['embeddings'])}")
    else:
        print(f"Error: {response.status_code}, {response.text}")

    # Test batch of texts
    batch_text_data = {
        "texts": [
            "第一个测试文本",
            "第二个测试文本",
            "第三个测试文本"
        ]
    }
    print("\nTesting batch texts...")
    response = requests.post(TEXT_URL, json=batch_text_data)
    if response.status_code == 200:
        result = response.json()
        print(f"Batch text embedding count: {len(result['embeddings'])}")
        print(f"Each embedding shape: {len(result['embeddings'][0])}")
    else:
        print(f"Error: {response.status_code}, {response.text}")

def test_video_embedding():
    """Test video embedding endpoint"""
    print("\n=== Testing Video Embedding ===")
    
    # Replace with your actual S3 bucket and video key
    video_data = {
        "bucket": "your-bucket-name",
        "key": "path/to/your/video.mp4"
    }
    
    print("\nTesting video embedding...")
    response = requests.post(VIDEO_URL, json=video_data)
    if response.status_code == 200:
        result = response.json()
        print(f"Video embedding shape: {len(result['embedding'])}")
    else:
        print(f"Error: {response.status_code}, {response.text}")

def test_health():
    """Test health check endpoint"""
    print("\n=== Testing Health Check ===")
    response = requests.get(f"{BASE_URL}/health")
    print(f"Health check status: {response.json()}")

if __name__ == "__main__":
    # Test health endpoint
    test_health()
    
    # Test text embedding
    test_text_embedding()
    
    # Uncomment to test video embedding once you have configured S3 bucket and key
    # test_video_embedding() 