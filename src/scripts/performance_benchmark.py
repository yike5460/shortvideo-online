import requests
import json
import time
import os
import tempfile
import concurrent.futures
import numpy as np
import boto3
import matplotlib.pyplot as plt
from PIL import Image
import io
import psutil
import sys
import logging

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Check for required dependencies
def check_dependencies():
    missing_deps = []
    try:
        import torch
    except ImportError:
        missing_deps.append("torch")
    
    if missing_deps:
        print("ERROR: Missing required dependencies:")
        print(f"  - {', '.join(missing_deps)}")
        print("\nPlease install the missing dependencies:")
        print("pip install -r requirements.txt")
        print("\nOr specifically:")
        if "torch" in missing_deps:
            print("pip install torch")
        return False
    return True

# Import optional dependencies that are checked above
try:
    import torch
    HAVE_TORCH = True
except ImportError:
    HAVE_TORCH = False

# API endpoints
BASE_URL = "http://46.51.230.206:8001"
TEXT_URL = f"{BASE_URL}/embed-text"
VIDEO_URL = f"{BASE_URL}/embed-video"
HEALTH_URL = f"{BASE_URL}/health"

# Test configurations
NUM_RUNS = 10  # Number of runs for latency testing
CONCURRENCY_LEVELS = [1, 2, 4]  # Number of concurrent requests for throughput testing
TEXT_LENGTHS = [10, 50, 100]  # For input size testing

# Test video samples
TEST_VIDEOS = [
    {
        "name": "Nature Video 01",
        "bucket": "video-search-dev-ap-northeast-1",
        "key": "RawVideos/2025-06-02/nature/3ad1c377-1be5-4ebb-aef2-4c13fa93dbdc/nature-01.mp4"
    },
    {
        "name": "Beach Video",
        "bucket": "video-search-dev-ap-northeast-1",
        "key": "RawVideos/2025-06-03/debugging/bf3288b8-af11-4b61-b8b3-0b23b2e57695/Beach.mp4"
    },
    {
        "name": "EMD Tutorial",
        "bucket": "video-search-dev-ap-northeast-1",
        "key": "RawVideos/2025-05-21/broadcast/57f8a3fe-774c-471e-9926-1016e82d5dc7/Easy_Model_Deployer介绍.mp4"
    }
]

def check_service_health():
    """Check if the service is healthy before running tests"""
    try:
        response = requests.get(HEALTH_URL)
        if response.status_code == 200:
            print("Service is healthy! Starting performance tests...")
            return True
        else:
            print(f"Service health check failed: {response.status_code}")
            return False
    except Exception as e:
        print(f"Could not connect to service: {e}")
        return False

def test_text_embedding_latency():
    """Test latency for text embedding with different input sizes"""
    print("\n=== Testing Text Embedding Latency ===")
    
    results = {}
    for length in TEXT_LENGTHS:
        text = "test " * length
        vision_latencies = []
        audio_latencies = []
        
        print(f"\nTesting with text length: {length} words")
        for i in range(NUM_RUNS):
            data = {"texts": text}
            start_time = time.time()
            response = requests.post(TEXT_URL, json=data)
            end_time = time.time()
            
            if response.status_code == 200:
                latency = (end_time - start_time) * 1000  # in milliseconds
                
                # Extract both embedding types from response
                response_json = response.json()
                vision_embedding = response_json.get('vision_embedding')
                audio_embedding = response_json.get('audio_embedding')
                
                # Record latency for both embedding types
                if vision_embedding is not None:
                    vision_latencies.append(latency)
                if audio_embedding is not None:
                    audio_latencies.append(latency)
                    
                print(f"Run {i+1}/{NUM_RUNS}: {latency:.2f}ms")
            else:
                print(f"Error on run {i+1}: {response.status_code}, {response.text}")
        
        # Process vision embedding results
        if vision_latencies:
            avg_latency = sum(vision_latencies) / len(vision_latencies)
            min_latency = min(vision_latencies)
            max_latency = max(vision_latencies)
            p95_latency = sorted(vision_latencies)[int(len(vision_latencies) * 0.95)]
            
            results[length] = {
                "vision": {
                    "avg_latency": avg_latency,
                    "min_latency": min_latency,
                    "max_latency": max_latency,
                    "p95_latency": p95_latency
                }
            }
            
            print(f"Vision embedding - Text length {length}: Avg={avg_latency:.2f}ms, Min={min_latency:.2f}ms, Max={max_latency:.2f}ms, p95={p95_latency:.2f}ms")
            
        # Process audio embedding results
        if audio_latencies:
            avg_latency = sum(audio_latencies) / len(audio_latencies)
            min_latency = min(audio_latencies)
            max_latency = max(audio_latencies)
            p95_latency = sorted(audio_latencies)[int(len(audio_latencies) * 0.95)]
            
            if length in results:
                results[length]["audio"] = {
                    "avg_latency": avg_latency,
                    "min_latency": min_latency,
                    "max_latency": max_latency,
                    "p95_latency": p95_latency
                }
            else:
                results[length] = {
                    "audio": {
                        "avg_latency": avg_latency,
                        "min_latency": min_latency,
                        "max_latency": max_latency,
                        "p95_latency": p95_latency
                    }
                }
            
            print(f"Audio embedding - Text length {length}: Avg={avg_latency:.2f}ms, Min={min_latency:.2f}ms, Max={max_latency:.2f}ms, p95={p95_latency:.2f}ms")
    
    return results

def test_text_embedding_throughput():
    """Test throughput (TPS) with concurrent requests"""
    print("\n=== Testing Text Embedding Throughput ===")
    
    results = {}
    text = "This is a sample text for throughput testing."
    
    for concurrency in CONCURRENCY_LEVELS:
        print(f"\nTesting with concurrency level: {concurrency}")
        
        # Function to make a single request
        def make_request():
            data = {"texts": text}
            start_time = time.time()
            response = requests.post(TEXT_URL, json=data)
            end_time = time.time()
            
            if response.status_code == 200:
                # Check if we received both embedding types
                response_json = response.json()
                has_vision = 'vision_embedding' in response_json
                has_audio = 'audio_embedding' in response_json
            else:
                has_vision = False
                has_audio = False
                
            return (response.status_code, end_time - start_time, has_vision, has_audio)
        
        # Make concurrent requests
        start_time = time.time()
        total_requests = concurrency * 5  # Each thread makes 5 requests
        
        with concurrent.futures.ThreadPoolExecutor(max_workers=concurrency) as executor:
            futures = [executor.submit(make_request) for _ in range(total_requests)]
            
            # Collect results
            latencies = []
            vision_success_count = 0
            audio_success_count = 0
            
            for future in concurrent.futures.as_completed(futures):
                status_code, latency, has_vision, has_audio = future.result()
                if status_code == 200:
                    latencies.append(latency)
                    if has_vision:
                        vision_success_count += 1
                    if has_audio:
                        audio_success_count += 1
        
        end_time = time.time()
        total_time = end_time - start_time
        
        if latencies:
            avg_latency = sum(latencies) / len(latencies)
            vision_tps = vision_success_count / total_time
            audio_tps = audio_success_count / total_time
            
            results[concurrency] = {
                "avg_latency": avg_latency * 1000,  # in ms
                "vision_throughput": vision_tps,
                "audio_throughput": audio_tps,
                "vision_success_rate": vision_success_count / total_requests,
                "audio_success_rate": audio_success_count / total_requests
            }
            
            print(f"Concurrency {concurrency}: TPS Vision={vision_tps:.2f}, TPS Audio={audio_tps:.2f}, "
                  f"Avg Latency={avg_latency*1000:.2f}ms, "
                  f"Vision Success Rate={vision_success_count/total_requests*100:.2f}%, "
                  f"Audio Success Rate={audio_success_count/total_requests*100:.2f}%")
    
    return results

def get_s3_object_size(bucket, key):
    """Get the size of an S3 object in MB"""
    try:
        s3 = boto3.client('s3')
        response = s3.head_object(Bucket=bucket, Key=key)
        size_bytes = response.get('ContentLength', 0)
        size_mb = size_bytes / (1024 * 1024)
        return size_mb
    except Exception as e:
        print(f"Error getting S3 object size: {e}")
        return None

def test_actual_video_embedding():
    """Test actual video embedding performance using sample videos"""
    print("\n=== Testing Actual Video Embedding Performance ===")
    
    results = {}
    
    for video in TEST_VIDEOS:
        video_name = video["name"]
        bucket = video["bucket"]
        key = video["key"]
        
        print(f"\nTesting with video: {video_name}")
        
        # Get video file size from S3
        file_size = get_s3_object_size(bucket, key)
        if file_size is None:
            print(f"Skipping {video_name} due to S3 head object error")
            continue
            
        print(f"Video size: {file_size:.2f} MB")
        
        latencies = []
        vision_embedding_dims = None
        audio_embedding_dims = None
        
        # Test video embedding
        for i in range(3):  # Fewer runs for video embedding due to longer processing times
            try:
                start_time = time.time()
                
                # Send request with bucket and key as per VideoEmbeddingRequest in app.py
                data = {"bucket": bucket, "key": key}
                response = requests.post(VIDEO_URL, json=data)
                
                end_time = time.time()
                
                if response.status_code == 200:
                    response_json = response.json()
                    
                    # Process vision embedding
                    vision_embedding = response_json.get('vision_embedding')
                    if vision_embedding and isinstance(vision_embedding, list):
                        if vision_embedding_dims is None:
                            vision_embedding_dims = len(vision_embedding)
                    
                    # Process audio embedding
                    audio_embedding = response_json.get('audio_embedding')
                    if audio_embedding and isinstance(audio_embedding, list):
                        if audio_embedding_dims is None:
                            audio_embedding_dims = len(audio_embedding)
                        
                    latency = (end_time - start_time) * 1000  # in milliseconds
                    latencies.append(latency)
                    print(f"Run {i+1}/3: {latency:.2f}ms, Vision dims: {vision_embedding_dims}, Audio dims: {audio_embedding_dims}")
                else:
                    print(f"Error on run {i+1}: {response.status_code}, {response.text}")
            except Exception as e:
                print(f"Error during video embedding: {e}")
        
        if latencies:
            avg_latency = sum(latencies) / len(latencies)
            min_latency = min(latencies)
            max_latency = max(latencies)
            
            results[video_name] = {
                "file_size_mb": file_size,
                "avg_latency": avg_latency,
                "min_latency": min_latency, 
                "max_latency": max_latency,
                "vision_embedding_dims": vision_embedding_dims,
                "audio_embedding_dims": audio_embedding_dims
            }
            
            print(f"Video {video_name}: Size={file_size:.2f}MB, Avg={avg_latency:.2f}ms, Min={min_latency:.2f}ms, Max={max_latency:.2f}ms")
            print(f"Embedding dimensions: Vision={vision_embedding_dims}, Audio={audio_embedding_dims}")
    
    return results

def estimate_video_embedding_performance():
    """Estimate video embedding performance using text as baseline"""
    print("\n=== Estimating Video Embedding Performance (Text Simulation) ===")
    
    # The video embedding uses the same model but processes frames
    # We'll simulate this by testing with increasing text batch sizes
    batch_sizes = [1, 4, 8, 16, 32]
    
    results = {}
    for batch_size in batch_sizes:
        print(f"\nTesting with batch size: {batch_size} (simulating {batch_size} frames)")
        data = {"texts": ["This is a sample text for video simulation."] * batch_size}
        
        vision_latencies = []
        audio_latencies = []
        
        for i in range(3):  # Fewer runs for batched requests
            start_time = time.time()
            response = requests.post(TEXT_URL, json=data)
            end_time = time.time()
            
            if response.status_code == 200:
                latency = (end_time - start_time) * 1000  # in milliseconds
                
                # Extract both embedding types
                response_json = response.json()
                vision_embedding = response_json.get('vision_embedding')
                audio_embedding = response_json.get('audio_embedding')
                
                # Store latencies for both types
                if vision_embedding is not None:
                    vision_latencies.append(latency)
                if audio_embedding is not None:
                    audio_latencies.append(latency)
                    
                print(f"Run {i+1}/3: {latency:.2f}ms")
            else:
                print(f"Error on run {i+1}: {response.status_code}, {response.text}")
        
        results[batch_size] = {}
        
        # Process vision embedding results
        if vision_latencies:
            avg_latency = sum(vision_latencies) / len(vision_latencies)
            results[batch_size]["vision"] = {
                "avg_latency": avg_latency,
                "estimated_fps": 1000 / (avg_latency / batch_size)  # Estimated frames per second
            }
            print(f"Vision embedding - Batch size {batch_size}: Avg Latency={avg_latency:.2f}ms, "
                  f"Est. FPS={results[batch_size]['vision']['estimated_fps']:.2f}")
        
        # Process audio embedding results
        if audio_latencies:
            avg_latency = sum(audio_latencies) / len(audio_latencies)
            results[batch_size]["audio"] = {
                "avg_latency": avg_latency,
                "estimated_fps": 1000 / (avg_latency / batch_size)  # Estimated frames per second
            }
            print(f"Audio embedding - Batch size {batch_size}: Avg Latency={avg_latency:.2f}ms, "
                  f"Est. FPS={results[batch_size]['audio']['estimated_fps']:.2f}")
    
    return results

def test_maximum_input_size():
    """Test maximum input size for text embedding"""
    print("\n=== Testing Maximum Input Size ===")
    
    # Binary search approach to find maximum size
    min_size = 1000  # Start with 1K tokens
    max_size = 100000  # Maximum to test (100K tokens)
    current_size = min_size
    
    while min_size <= max_size:
        current_size = (min_size + max_size) // 2
        text = "test " * current_size
        
        print(f"Testing with {current_size} words...")
        
        try:
            data = {"texts": text}
            response = requests.post(TEXT_URL, json=data, timeout=60)
            
            if response.status_code == 200:
                print(f"Size {current_size} succeeded. Trying larger...")
                min_size = current_size + 1
            else:
                print(f"Size {current_size} failed: {response.status_code}. Trying smaller...")
                max_size = current_size - 1
        except requests.exceptions.Timeout:
            print(f"Request timed out at size {current_size}. Trying smaller...")
            max_size = current_size - 1
        except Exception as e:
            print(f"Error at size {current_size}: {e}. Trying smaller...")
            max_size = current_size - 1
    
    max_successful_size = max_size
    print(f"Maximum successful input size: approximately {max_successful_size} words")
    return max_successful_size

def monitor_memory_usage():
    """Monitor memory usage during tests"""
    process = psutil.Process(os.getpid())
    return process.memory_info().rss / 1024 / 1024  # Return in MB

def plot_results(latency_results, throughput_results, estimated_video_results, actual_video_results=None, output_path="performance_results.png"):
    """Plot the test results"""
    plt.figure(figsize=(15, 15))
    
    # Plot 1: Text Latency vs Input Size
    plt.subplot(3, 2, 1)
    sizes = list(latency_results.keys())
    
    # Plot vision embedding latency
    vision_avg_latencies = [latency_results[size]["vision"]["avg_latency"] if "vision" in latency_results[size] else 0 for size in sizes]
    plt.plot(sizes, vision_avg_latencies, 'o-', label='Vision')
    
    # Plot audio embedding latency
    audio_avg_latencies = [latency_results[size]["audio"]["avg_latency"] if "audio" in latency_results[size] else 0 for size in sizes]
    plt.plot(sizes, audio_avg_latencies, 's-', label='Audio')
    
    plt.xlabel('Input Size (words)')
    plt.ylabel('Latency (ms)')
    plt.title('Text Embedding Latency vs Input Size')
    plt.grid(True)
    plt.legend()
    
    # Plot 2: Throughput vs Concurrency
    plt.subplot(3, 2, 2)
    concurrencies = list(throughput_results.keys())
    vision_tps = [throughput_results[c]["vision_throughput"] for c in concurrencies]
    audio_tps = [throughput_results[c]["audio_throughput"] for c in concurrencies]
    latencies = [throughput_results[c]["avg_latency"] for c in concurrencies]
    
    ax1 = plt.gca()
    ax1.plot(concurrencies, vision_tps, 'o-', color='blue', label='Vision TPS')
    ax1.plot(concurrencies, audio_tps, 's-', color='green', label='Audio TPS')
    ax1.set_xlabel('Concurrency Level')
    ax1.set_ylabel('Throughput (TPS)')
    ax1.tick_params(axis='y')
    ax1.legend(loc='upper left')
    
    ax2 = ax1.twinx()
    ax2.plot(concurrencies, latencies, 'd-', color='red', label='Latency')
    ax2.set_ylabel('Latency (ms)', color='red')
    ax2.tick_params(axis='y', labelcolor='red')
    ax2.legend(loc='upper right')
    
    plt.title('Throughput and Latency vs Concurrency')
    plt.grid(True)
    
    # Plot 3: Estimated Vision Embedding Performance
    plt.subplot(3, 2, 3)
    batch_sizes = list(estimated_video_results.keys())
    
    # Get latency and FPS for vision embedding
    vision_latencies = [estimated_video_results[b]["vision"]["avg_latency"] 
                        if "vision" in estimated_video_results[b] else 0 
                        for b in batch_sizes]
    vision_fps = [estimated_video_results[b]["vision"]["estimated_fps"] 
                 if "vision" in estimated_video_results[b] else 0 
                 for b in batch_sizes]
    
    ax1 = plt.gca()
    ax1.plot(batch_sizes, vision_latencies, 'o-', color='blue')
    ax1.set_xlabel('Batch Size (frames)')
    ax1.set_ylabel('Vision Latency (ms)', color='blue')
    ax1.tick_params(axis='y', labelcolor='blue')
    
    ax2 = ax1.twinx()
    ax2.plot(batch_sizes, vision_fps, 'o-', color='green')
    ax2.set_ylabel('Estimated Vision FPS', color='green')
    ax2.tick_params(axis='y', labelcolor='green')
    
    plt.title('Estimated Vision Embedding Performance')
    plt.grid(True)
    
    # Plot 4: Estimated Audio Embedding Performance
    plt.subplot(3, 2, 4)
    
    # Get latency and FPS for audio embedding
    audio_latencies = [estimated_video_results[b]["audio"]["avg_latency"] 
                       if "audio" in estimated_video_results[b] else 0 
                       for b in batch_sizes]
    audio_fps = [estimated_video_results[b]["audio"]["estimated_fps"] 
                if "audio" in estimated_video_results[b] else 0 
                for b in batch_sizes]
    
    ax1 = plt.gca()
    ax1.plot(batch_sizes, audio_latencies, 's-', color='blue')
    ax1.set_xlabel('Batch Size (frames)')
    ax1.set_ylabel('Audio Latency (ms)', color='blue')
    ax1.tick_params(axis='y', labelcolor='blue')
    
    ax2 = ax1.twinx()
    ax2.plot(batch_sizes, audio_fps, 's-', color='green')
    ax2.set_ylabel('Estimated Audio FPS', color='green')
    ax2.tick_params(axis='y', labelcolor='green')
    
    plt.title('Estimated Audio Embedding Performance')
    plt.grid(True)
    
    # Plot 5: Actual Video Embedding Performance
    if actual_video_results:
        plt.subplot(3, 2, 5)
        video_names = list(actual_video_results.keys())
        avg_latencies = [actual_video_results[v]["avg_latency"] for v in video_names]
        file_sizes = [actual_video_results[v]["file_size_mb"] for v in video_names]
        
        ax = plt.gca()
        bars = ax.bar(range(len(video_names)), avg_latencies, color='purple')
        ax.set_ylabel('Latency (ms)')
        ax.set_title('Actual Video Embedding Performance')
        ax.set_xticks(range(len(video_names)))
        ax.set_xticklabels([f"{name}\n({size:.1f} MB)" for name, size in zip(video_names, file_sizes)], rotation=45, ha='right')
        
        # Add embedding dimensions as text on the bars
        for i, bar in enumerate(bars):
            height = bar.get_height()
            vision_dim = actual_video_results[video_names[i]].get("vision_embedding_dims")
            audio_dim = actual_video_results[video_names[i]].get("audio_embedding_dims")
            
            text = ""
            if vision_dim:
                text += f'Vision: {vision_dim}'
            if audio_dim:
                if text:
                    text += '\n'
                text += f'Audio: {audio_dim}'
                
            if text:
                ax.text(bar.get_x() + bar.get_width()/2, height + 0.1,
                        text, ha='center', va='bottom', rotation=0, fontsize=8)
    
    plt.tight_layout()
    plt.savefig(output_path)
    print(f"Results plotted and saved to {output_path}")
    plt.close()

def summarize_results(latency_results, throughput_results, estimated_video_results, actual_video_results=None, max_input_size=None):
    """Generate a summary of the performance test results"""
    summary = "=== Performance Test Summary ===\n\n"
    
    # Text Embedding Latency
    summary += "1. Text Embedding Latency:\n"
    for size, result in latency_results.items():
        summary += f"   - {size} words:\n"
        
        if "vision" in result:
            vision = result["vision"]
            summary += f"     - Vision: {vision['avg_latency']:.2f}ms avg, {vision['p95_latency']:.2f}ms p95\n"
        
        if "audio" in result:
            audio = result["audio"]
            summary += f"     - Audio: {audio['avg_latency']:.2f}ms avg, {audio['p95_latency']:.2f}ms p95\n"
    
    # Throughput
    summary += "\n2. Throughput Performance:\n"
    for concurrency, result in throughput_results.items():
        summary += f"   - Concurrency {concurrency}:\n"
        summary += f"     - Vision: {result['vision_throughput']:.2f} TPS, {result['vision_success_rate']*100:.2f}% success rate\n"
        summary += f"     - Audio: {result['audio_throughput']:.2f} TPS, {result['audio_success_rate']*100:.2f}% success rate\n"
        summary += f"     - Combined avg latency: {result['avg_latency']:.2f}ms\n"
    
    # Video Embedding (estimated)
    summary += "\n3. Estimated Video Embedding Performance (text simulation):\n"
    for batch_size, result in estimated_video_results.items():
        summary += f"   - {batch_size} frames:\n"
        
        if "vision" in result:
            vision = result["vision"]
            summary += f"     - Vision: {vision['avg_latency']:.2f}ms avg latency, {vision['estimated_fps']:.2f} estimated FPS\n"
        
        if "audio" in result:
            audio = result["audio"]
            summary += f"     - Audio: {audio['avg_latency']:.2f}ms avg latency, {audio['estimated_fps']:.2f} estimated FPS\n"
    
    # Actual Video Embedding
    if actual_video_results:
        summary += "\n4. Actual Video Embedding Performance:\n"
        for video_name, result in actual_video_results.items():
            summary += f"   - {video_name} ({result['file_size_mb']:.2f} MB): {result['avg_latency']:.2f}ms avg latency\n"
            
            if "vision_embedding_dims" in result and result["vision_embedding_dims"]:
                summary += f"     - Vision embedding dimensions: {result['vision_embedding_dims']}\n"
                
            if "audio_embedding_dims" in result and result["audio_embedding_dims"]:
                summary += f"     - Audio embedding dimensions: {result['audio_embedding_dims']}\n"
    
    # Maximum Input Size
    if max_input_size:
        summary += f"\n5. Maximum Input Size: ~{max_input_size} words\n"
    
    # System Information
    summary += "\n6. System Information:\n"
    summary += f"   - CPU Count: {os.cpu_count()} cores\n"
    memory = psutil.virtual_memory()
    summary += f"   - Memory: {memory.total / (1024**3):.2f} GB total, {memory.available / (1024**3):.2f} GB available\n"
    
    summary += "\nNote: Video embedding performance includes both vision (Qwen2.5-VL) and audio (BCE) embeddings.\n"
    summary += "      Video embedding involves extracting visual features and transcribing audio using WhisperX.\n"
    summary += "      Actual performance may vary depending on video resolution, frame count, audio quality, and complexity.\n"
    
    return summary

if __name__ == "__main__":
    # Parse command line arguments
    import argparse
    parser = argparse.ArgumentParser(description='Run performance tests for Qwen embedding service.')
    parser.add_argument('--text-only', action='store_true', help='Run only text embedding tests')
    parser.add_argument('--video-only', action='store_true', help='Run only video embedding tests')
    parser.add_argument('--skip-max-size', action='store_true', help='Skip maximum input size test')
    parser.add_argument('--skip-deps-check', action='store_true', help='Skip dependency checks')
    parser.add_argument('--plot-prefix', default='performance', help='Prefix for plot file names')
    args = parser.parse_args()
    
    plot_prefix = args.plot_prefix
    
    # Check dependencies
    if not args.skip_deps_check and not check_dependencies():
        print("\nWARNING: Some dependencies are missing. Install them or use --skip-deps-check to proceed anyway.")
        if not args.text_only and not HAVE_TORCH:
            print("PyTorch is required for video embedding tests. Run with --text-only or install torch.")
            sys.exit(1)
            
    # Check if service is healthy
    if not check_service_health():
        sys.exit(1)
    
    # Record initial memory usage
    initial_memory = monitor_memory_usage()
    print(f"Initial memory usage: {initial_memory:.2f} MB")
    
    latency_results = {}
    throughput_results = {}
    estimated_video_results = {}
    actual_video_results = {}
    max_input_size = None
    
    # Run text embedding tests
    if not args.video_only:
        print("\n=== Running Text Embedding Tests ===")
        
        latency_results = test_text_embedding_latency()
        memory_after_latency = monitor_memory_usage()
        print(f"Memory usage after latency tests: {memory_after_latency:.2f} MB (delta: {memory_after_latency - initial_memory:.2f} MB)")
        
        throughput_results = test_text_embedding_throughput()
        memory_after_throughput = monitor_memory_usage()
        print(f"Memory usage after throughput tests: {memory_after_throughput:.2f} MB (delta: {memory_after_throughput - initial_memory:.2f} MB)")
        
        estimated_video_results = estimate_video_embedding_performance()
        memory_after_estimated = monitor_memory_usage()
        print(f"Memory usage after estimated video tests: {memory_after_estimated:.2f} MB (delta: {memory_after_estimated - initial_memory:.2f} MB)")
        
        if not args.skip_max_size:
            max_input_size = test_maximum_input_size()
            memory_after_max = monitor_memory_usage()
            print(f"Memory usage after max input size test: {memory_after_max:.2f} MB (delta: {memory_after_max - initial_memory:.2f} MB)")
    
    # Run actual video embedding tests
    if not args.text_only:
        print("\n=== Running Actual Video Embedding Tests ===")
        
        actual_video_results = test_actual_video_embedding()
        memory_after_actual = monitor_memory_usage()
        print(f"Memory usage after actual video tests: {memory_after_actual:.2f} MB (delta: {memory_after_actual - initial_memory:.2f} MB)")
    
    # Generate summary
    summary = summarize_results(
        latency_results, 
        throughput_results, 
        estimated_video_results, 
        actual_video_results, 
        max_input_size
    )
    print("\n" + summary)
    
    with open(f"{plot_prefix}_summary.txt", "w") as f:
        f.write(summary)
    
    # Plot results
    try:
        # Plot combined results
        plot_results(
            latency_results, 
            throughput_results, 
            estimated_video_results, 
            actual_video_results,
            f"{plot_prefix}_results.png"
        )
        
        # Plot separate vision and audio results if we have both
        if not args.text_only and actual_video_results:
            print("Generating separate vision and audio plots...")
            
            # Get text sizes for latency plots
            text_sizes = list(latency_results.keys())
            
            # Plot vision-only results
            plt.figure(figsize=(10, 8))
            
            # Vision text latency plot
            plt.subplot(2, 1, 1)
            vision_avg_latencies = [latency_results[size]["vision"]["avg_latency"] 
                                  if "vision" in latency_results[size] else 0 
                                  for size in text_sizes]
            plt.plot(text_sizes, vision_avg_latencies, 'o-')
            plt.xlabel('Input Size (words)')
            plt.ylabel('Vision Latency (ms)')
            plt.title('Vision Embedding Latency vs Input Size')
            plt.grid(True)
            
            # Vision video performance
            if actual_video_results:
                plt.subplot(2, 1, 2)
                video_names = list(actual_video_results.keys())
                file_sizes = [actual_video_results[v]["file_size_mb"] for v in video_names]
                
                # Check which videos have vision embeddings
                vision_videos = []
                vision_latencies = []
                vision_sizes = []
                vision_dims = []
                
                for v in video_names:
                    if actual_video_results[v].get("vision_embedding_dims"):
                        vision_videos.append(v)
                        vision_latencies.append(actual_video_results[v]["avg_latency"])
                        vision_sizes.append(actual_video_results[v]["file_size_mb"])
                        vision_dims.append(actual_video_results[v]["vision_embedding_dims"])
                
                if vision_videos:
                    bars = plt.bar(range(len(vision_videos)), vision_latencies, color='blue')
                    plt.ylabel('Latency (ms)')
                    plt.title('Vision Embedding Performance')
                    plt.xticks(range(len(vision_videos)), 
                              [f"{name}\n({size:.1f} MB)" for name, size in zip(vision_videos, vision_sizes)], 
                              rotation=45, ha='right')
                    
                    # Add dimensions as text on bars
                    for i, bar in enumerate(bars):
                        height = bar.get_height()
                        plt.text(bar.get_x() + bar.get_width()/2, height + 0.1,
                                f'dim: {vision_dims[i]}', ha='center', va='bottom', fontsize=8)
            
            plt.tight_layout()
            plt.savefig(f"{plot_prefix}_vision_results.png")
            print(f"Vision results plotted and saved to {plot_prefix}_vision_results.png")
            plt.close()
            
            # Plot audio-only results
            plt.figure(figsize=(10, 8))
            
            # Audio text latency plot
            plt.subplot(2, 1, 1)
            audio_avg_latencies = [latency_results[size]["audio"]["avg_latency"] 
                                  if "audio" in latency_results[size] else 0 
                                  for size in text_sizes]
            plt.plot(text_sizes, audio_avg_latencies, 's-', color='green')
            plt.xlabel('Input Size (words)')
            plt.ylabel('Audio Latency (ms)')
            plt.title('Audio Embedding Latency vs Input Size')
            plt.grid(True)
            
            # Audio video performance
            plt.subplot(2, 1, 2)
            
            # Check which videos have audio embeddings
            audio_videos = []
            audio_latencies = []
            audio_sizes = []
            audio_dims = []
            
            # Process audio embeddings from video results
            if actual_video_results:
                video_names = list(actual_video_results.keys())
                for v in video_names:
                    if actual_video_results[v].get("audio_embedding_dims"):
                        audio_videos.append(v)
                        audio_latencies.append(actual_video_results[v]["avg_latency"])
                        audio_sizes.append(actual_video_results[v]["file_size_mb"])
                        audio_dims.append(actual_video_results[v]["audio_embedding_dims"])
            
            if audio_videos:
                bars = plt.bar(range(len(audio_videos)), audio_latencies, color='green')
                plt.ylabel('Latency (ms)')
                plt.title('Audio Embedding Performance')
                plt.xticks(range(len(audio_videos)), 
                          [f"{name}\n({size:.1f} MB)" for name, size in zip(audio_videos, audio_sizes)], 
                          rotation=45, ha='right')
                
                # Add dimensions as text on bars
                for i, bar in enumerate(bars):
                    height = bar.get_height()
                    plt.text(bar.get_x() + bar.get_width()/2, height + 0.1,
                            f'dim: {audio_dims[i]}', ha='center', va='bottom', fontsize=8)
            
            plt.tight_layout()
            plt.savefig(f"{plot_prefix}_audio_results.png")
            print(f"Audio results plotted and saved to {plot_prefix}_audio_results.png")
            plt.close()
    except Exception as e:
        print(f"Could not generate plots: {e}")
