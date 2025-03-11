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
CONCURRENCY_LEVELS = [1, 2, 4, 8]  # Number of concurrent requests for throughput testing
TEXT_LENGTHS = [10, 50, 100, 250]  # For input size testing
VIDEO_CONCURRENCY_LEVELS = [1, 2, 4, 8, 16, 32, 64, 128]  # Lower concurrency for video due to resource requirements

# Test video samples
TEST_VIDEOS = [
    {
        "name": "Snail Video",
        "bucket": "video-search-dev-ap-northeast-1",
        "key": "RawVideos/2025-03-05/ada/01688a94-fc0b-482d-83f6-3b6f7bb81e7c/Snail.mp4"
    },
    {
        "name": "黑神话-神笔马良",
        "bucket": "video-search-dev-ap-northeast-1",
        "key": "RawVideos/2025-03-05/kyiamzn/035ac4bb-bc4e-4d37-b1ab-58ad6c09a00d/黑神话-神笔马良.mp4"
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
        latencies = []
        
        print(f"\nTesting with text length: {length} words")
        for i in range(NUM_RUNS):
            data = {"texts": text}
            start_time = time.time()
            response = requests.post(TEXT_URL, json=data)
            end_time = time.time()
            
            if response.status_code == 200:
                latency = (end_time - start_time) * 1000  # in milliseconds
                latencies.append(latency)
                print(f"Run {i+1}/{NUM_RUNS}: {latency:.2f}ms")
            else:
                print(f"Error on run {i+1}: {response.status_code}, {response.text}")
        
        if latencies:
            avg_latency = sum(latencies) / len(latencies)
            min_latency = min(latencies)
            max_latency = max(latencies)
            p95_latency = sorted(latencies)[int(len(latencies) * 0.95)]
            
            results[length] = {
                "avg_latency": avg_latency,
                "min_latency": min_latency,
                "max_latency": max_latency,
                "p95_latency": p95_latency
            }
            
            print(f"Text length {length}: Avg={avg_latency:.2f}ms, Min={min_latency:.2f}ms, Max={max_latency:.2f}ms, p95={p95_latency:.2f}ms")
    
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
            return (response.status_code, end_time - start_time)
        
        # Make concurrent requests
        start_time = time.time()
        total_requests = concurrency * 5  # Each thread makes 5 requests
        
        with concurrent.futures.ThreadPoolExecutor(max_workers=concurrency) as executor:
            futures = [executor.submit(make_request) for _ in range(total_requests)]
            
            # Collect results
            latencies = []
            success_count = 0
            for future in concurrent.futures.as_completed(futures):
                status_code, latency = future.result()
                if status_code == 200:
                    success_count += 1
                    latencies.append(latency)
        
        end_time = time.time()
        total_time = end_time - start_time
        
        if latencies:
            avg_latency = sum(latencies) / len(latencies)
            tps = success_count / total_time
            
            results[concurrency] = {
                "avg_latency": avg_latency * 1000,  # in ms
                "throughput": tps,
                "success_rate": success_count / total_requests
            }
            
            print(f"Concurrency {concurrency}: TPS={tps:.2f}, Avg Latency={avg_latency*1000:.2f}ms, Success Rate={success_count/total_requests*100:.2f}%")
    
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

def test_video_embedding_throughput():
    """Test throughput and latency with concurrent video embedding requests"""
    print("\n=== Testing Video Embedding Throughput vs Concurrency ===")
    
    results = {}
    if not TEST_VIDEOS:
        print("No test videos defined! Skipping video throughput test.")
        return results
    
    # Use the first test video for throughput testing
    test_video = TEST_VIDEOS[0]
    bucket = test_video["bucket"]
    key = test_video["key"]
    video_name = test_video["name"]
    
    print(f"Using video '{video_name}' for throughput testing")
    
    for concurrency in VIDEO_CONCURRENCY_LEVELS:
        print(f"\nTesting with concurrency level: {concurrency}")
        
        # Function to make a single request
        def make_request():
            data = {"bucket": bucket, "key": key}
            start_time = time.time()
            try:
                response = requests.post(VIDEO_URL, json=data, timeout=300)  # Longer timeout for video
                end_time = time.time()
                return (response.status_code, end_time - start_time)
            except Exception as e:
                print(f"Error during video embedding request: {e}")
                return (500, None)  # Return error code and None for latency
        
        # Make concurrent requests
        start_time = time.time()
        # Each thread makes 2 requests (fewer than text due to longer processing time)
        total_requests = concurrency * 2  
        
        with concurrent.futures.ThreadPoolExecutor(max_workers=concurrency) as executor:
            futures = [executor.submit(make_request) for _ in range(total_requests)]
            
            # Collect results
            latencies = []
            success_count = 0
            for future in concurrent.futures.as_completed(futures):
                status_code, latency = future.result()
                if status_code == 200 and latency is not None:
                    success_count += 1
                    latencies.append(latency)
        
        end_time = time.time()
        total_time = end_time - start_time
        
        if latencies:
            avg_latency = sum(latencies) / len(latencies)
            tps = success_count / total_time
            max_tps = tps * (total_requests / success_count) if success_count > 0 else 0
            
            results[concurrency] = {
                "avg_latency": avg_latency * 1000,  # in ms
                "throughput": tps,
                "success_rate": success_count / total_requests,
                "max_possible_tps": max_tps
            }
            
            print(f"Concurrency {concurrency}: TPS={tps:.2f}, Avg Latency={avg_latency*1000:.2f}ms, Success Rate={success_count/total_requests*100:.2f}%")
            print(f"Maximum possible TPS (100% success): {max_tps:.2f}")
    
    return results

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
        embedding_dims = None
        
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
                    embedding = response_json.get('embedding')
                    if embedding and isinstance(embedding, list):
                        if embedding_dims is None:
                            embedding_dims = len(embedding)
                        
                    latency = (end_time - start_time) * 1000  # in milliseconds
                    latencies.append(latency)
                    print(f"Run {i+1}/3: {latency:.2f}ms, Embedding dims: {embedding_dims}")
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
                "embedding_dims": embedding_dims
            }
            
            print(f"Video {video_name}: Size={file_size:.2f}MB, Avg={avg_latency:.2f}ms, Min={min_latency:.2f}ms, Max={max_latency:.2f}ms")
    
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
        
        latencies = []
        for i in range(3):  # Fewer runs for batched requests
            start_time = time.time()
            response = requests.post(TEXT_URL, json=data)
            end_time = time.time()
            
            if response.status_code == 200:
                latency = (end_time - start_time) * 1000  # in milliseconds
                latencies.append(latency)
                print(f"Run {i+1}/3: {latency:.2f}ms")
            else:
                print(f"Error on run {i+1}: {response.status_code}, {response.text}")
        
        if latencies:
            avg_latency = sum(latencies) / len(latencies)
            results[batch_size] = {
                "avg_latency": avg_latency,
                "estimated_fps": 1000 / (avg_latency / batch_size)  # Estimated frames per second
            }
            
            print(f"Batch size {batch_size}: Avg Latency={avg_latency:.2f}ms, Est. FPS={results[batch_size]['estimated_fps']:.2f}")
    
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

def plot_results(latency_results, throughput_results, estimated_video_results, actual_video_results=None, 
                 video_throughput_results=None, output_path_prefix="performance"):
    """Plot the test results with separate plots for text and video embedding"""
    
    # Create text embedding plots
    plt.figure(figsize=(15, 12))
    plt.suptitle('Text Embedding Performance', fontsize=16)
    
    # Plot 1: Text Latency vs Input Size
    plt.subplot(2, 2, 1)
    if latency_results:
        sizes = list(latency_results.keys())
        avg_latencies = [latency_results[size]["avg_latency"] for size in sizes]
        plt.plot(sizes, avg_latencies, 'o-', color='blue')
        plt.xlabel('Input Size (words)')
        plt.ylabel('Latency (ms)')
        plt.title('Text Embedding Latency vs Input Size')
        plt.grid(True)
    
    # Plot 2: Text Throughput vs Concurrency
    plt.subplot(2, 2, 2)
    if throughput_results:
        concurrencies = list(throughput_results.keys())
        tps = [throughput_results[c]["throughput"] for c in concurrencies]
        latencies = [throughput_results[c]["avg_latency"] for c in concurrencies]
        
        ax1 = plt.gca()
        ax1.plot(concurrencies, tps, 'o-', color='blue')
        ax1.set_xlabel('Concurrency Level')
        ax1.set_ylabel('Throughput (TPS)', color='blue')
        ax1.tick_params(axis='y', labelcolor='blue')
        
        ax2 = ax1.twinx()
        ax2.plot(concurrencies, latencies, 'o-', color='red')
        ax2.set_ylabel('Latency (ms)', color='red')
        ax2.tick_params(axis='y', labelcolor='red')
        
        plt.title('Text Embedding: Throughput and Latency vs Concurrency')
        plt.grid(True)
    
    # Text embedding comparison plots or additional metrics can go in the bottom row
    # Plot 3: P95 latency
    plt.subplot(2, 2, 3)
    if latency_results:
        sizes = list(latency_results.keys())
        p95_latencies = [latency_results[size]["p95_latency"] for size in sizes]
        min_latencies = [latency_results[size]["min_latency"] for size in sizes]
        max_latencies = [latency_results[size]["max_latency"] for size in sizes]
        
        plt.plot(sizes, p95_latencies, 'o-', color='red', label='P95')
        plt.plot(sizes, min_latencies, 'o-', color='green', label='Min')
        plt.plot(sizes, max_latencies, 'o-', color='orange', label='Max')
        plt.xlabel('Input Size (words)')
        plt.ylabel('Latency (ms)')
        plt.title('Text Embedding Latency Distribution')
        plt.legend()
        plt.grid(True)
    
    # Plot 4: Success Rate vs Concurrency
    plt.subplot(2, 2, 4)
    if throughput_results:
        concurrencies = list(throughput_results.keys())
        success_rates = [throughput_results[c]["success_rate"] * 100 for c in concurrencies]
        
        plt.bar(concurrencies, success_rates, color='green')
        plt.xlabel('Concurrency Level')
        plt.ylabel('Success Rate (%)')
        plt.title('Text Embedding: Success Rate vs Concurrency')
        plt.ylim(0, 105)  # Adding some margin above 100%
        for i, rate in enumerate(success_rates):
            plt.text(concurrencies[i], rate + 2, f"{rate:.1f}%", ha='center')
        plt.grid(True, axis='y')
    
    plt.tight_layout(rect=[0, 0.03, 1, 0.95])  # Adjust for suptitle
    plt.savefig(f"{output_path_prefix}_text_results.png")
    print(f"Text embedding results plotted and saved to {output_path_prefix}_text_results.png")
    plt.close()
    
    # Create video embedding plots
    plt.figure(figsize=(15, 12))
    plt.suptitle('Video Embedding Performance', fontsize=16)
    
    # Plot 1: Estimated Video Performance (Batch Size vs Latency)
    plt.subplot(2, 2, 1)
    if estimated_video_results:
        batch_sizes = list(estimated_video_results.keys())
        latencies = [estimated_video_results[b]["avg_latency"] for b in batch_sizes]
        fps = [estimated_video_results[b]["estimated_fps"] for b in batch_sizes]
        
        ax1 = plt.gca()
        ax1.plot(batch_sizes, latencies, 'o-', color='blue')
        ax1.set_xlabel('Batch Size (frames)')
        ax1.set_ylabel('Latency (ms)', color='blue')
        ax1.tick_params(axis='y', labelcolor='blue')
        
        ax2 = ax1.twinx()
        ax2.plot(batch_sizes, fps, 'o-', color='green')
        ax2.set_ylabel('Estimated FPS', color='green')
        ax2.tick_params(axis='y', labelcolor='green')
        
        plt.title('Estimated Video Embedding Performance')
        plt.grid(True)
    
    # Plot 2: Video Throughput vs Concurrency
    plt.subplot(2, 2, 2)
    if video_throughput_results:
        concurrencies = list(video_throughput_results.keys())
        tps = [video_throughput_results[c]["throughput"] for c in concurrencies]
        latencies = [video_throughput_results[c]["avg_latency"] for c in concurrencies]
        
        ax1 = plt.gca()
        ax1.plot(concurrencies, tps, 'o-', color='blue')
        ax1.set_xlabel('Concurrency Level')
        ax1.set_ylabel('Throughput (TPS)', color='blue')
        ax1.tick_params(axis='y', labelcolor='blue')
        
        ax2 = ax1.twinx()
        ax2.plot(concurrencies, latencies, 'o-', color='red')
        ax2.set_ylabel('Latency (ms)', color='red')
        ax2.tick_params(axis='y', labelcolor='red')
        
        plt.title('Video Embedding: Throughput and Latency vs Concurrency')
        plt.grid(True)
    
    # Plot 3: Maximum Possible TPS
    plt.subplot(2, 2, 3)
    if video_throughput_results:
        concurrencies = list(video_throughput_results.keys())
        max_tps = [video_throughput_results[c].get("max_possible_tps", 0) for c in concurrencies]
        success_rates = [video_throughput_results[c]["success_rate"] * 100 for c in concurrencies]
        
        ax1 = plt.gca()
        ax1.bar(concurrencies, max_tps, color='blue')
        ax1.set_xlabel('Concurrency Level')
        ax1.set_ylabel('Maximum Possible TPS', color='blue')
        ax1.tick_params(axis='y', labelcolor='blue')
        
        ax2 = ax1.twinx()
        ax2.plot(concurrencies, success_rates, 'o-', color='green')
        ax2.set_ylabel('Success Rate (%)', color='green')
        ax2.set_ylim(0, 105)  # Add some margin above 100%
        ax2.tick_params(axis='y', labelcolor='green')
        
        plt.title('Video Embedding: Maximum Achievable TPS')
        plt.grid(True, axis='y')
    
    # Plot 4: Actual Video Embedding Performance
    plt.subplot(2, 2, 4)
    if actual_video_results:
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
            dim = actual_video_results[video_names[i]]["embedding_dims"]
            if dim:
                ax.text(bar.get_x() + bar.get_width()/2, height + 0.1,
                        f'dim: {dim}', ha='center', va='bottom', rotation=0, fontsize=8)
    
    plt.tight_layout(rect=[0, 0.03, 1, 0.95])  # Adjust for suptitle
    plt.savefig(f"{output_path_prefix}_video_results.png")
    print(f"Video embedding results plotted and saved to {output_path_prefix}_video_results.png")
    plt.close()
    
    # Create a combined visualization for key metrics as a third image
    plt.figure(figsize=(15, 10))
    plt.suptitle('Text vs Video Embedding Performance Comparison', fontsize=16)
    
    # Combined plot
    plt.tight_layout(rect=[0, 0.03, 1, 0.95])
    plt.savefig(f"{output_path_prefix}_combined_results.png")
    print(f"Combined results plotted and saved to {output_path_prefix}_combined_results.png")
    plt.close()

def summarize_results(latency_results, throughput_results, estimated_video_results, 
                     actual_video_results=None, max_input_size=None, video_throughput_results=None):
    """Generate a summary of the performance test results"""
    summary = "=== Performance Test Summary ===\n\n"
    
    # Text Embedding Latency
    summary += "1. Text Embedding Latency:\n"
    for size, result in latency_results.items():
        summary += f"   - {size} words: {result['avg_latency']:.2f}ms avg, {result['p95_latency']:.2f}ms p95\n"
    
    # Text Throughput
    summary += "\n2. Text Embedding Throughput Performance:\n"
    for concurrency, result in throughput_results.items():
        summary += f"   - Concurrency {concurrency}: {result['throughput']:.2f} TPS, {result['avg_latency']:.2f}ms avg latency\n"
    
    # Video Embedding (estimated)
    summary += "\n3. Estimated Video Embedding Performance (text simulation):\n"
    for batch_size, result in estimated_video_results.items():
        summary += f"   - {batch_size} frames: {result['avg_latency']:.2f}ms avg latency, {result['estimated_fps']:.2f} estimated FPS\n"
    
    # Actual Video Embedding
    if actual_video_results:
        summary += "\n4. Actual Video Embedding Performance:\n"
        for video_name, result in actual_video_results.items():
            summary += f"   - {video_name} ({result['file_size_mb']:.2f} MB): {result['avg_latency']:.2f}ms avg latency"
            if "embedding_dims" in result and result["embedding_dims"]:
                summary += f", {result['embedding_dims']} embedding dimensions"
            summary += "\n"
    
    # Video Throughput
    if video_throughput_results:
        summary += "\n5. Video Embedding Throughput Performance:\n"
        for concurrency, result in video_throughput_results.items():
            summary += (
                f"   - Concurrency {concurrency}: {result['throughput']:.2f} TPS, "
                f"{result['avg_latency']:.2f}ms avg latency, "
                f"{result['success_rate']*100:.2f}% success rate\n"
            )
            if "max_possible_tps" in result:
                summary += f"     Maximum possible TPS (100% success): {result['max_possible_tps']:.2f}\n"
    
    # Maximum Input Size
    if max_input_size:
        summary += f"\n6. Maximum Input Size: ~{max_input_size} words\n"
    
    # System Information
    summary += "\n7. System Information:\n"
    summary += f"   - CPU Count: {os.cpu_count()} cores\n"
    memory = psutil.virtual_memory()
    summary += f"   - Memory: {memory.total / (1024**3):.2f} GB total, {memory.available / (1024**3):.2f} GB available\n"
    
    summary += "\nNote: Video embedding performance is estimated based on text processing using similar batch sizes.\n"
    summary += "      Actual video performance may vary depending on video resolution, frame count, and complexity.\n"
    
    return summary

if __name__ == "__main__":
    # Parse command line arguments
    import argparse
    parser = argparse.ArgumentParser(description='Run performance tests for Qwen embedding service.')
    parser.add_argument('--text-only', action='store_true', help='Run only text embedding tests')
    parser.add_argument('--video-only', action='store_true', help='Run only video embedding tests')
    parser.add_argument('--skip-max-size', action='store_true', help='Skip maximum input size test')
    parser.add_argument('--skip-deps-check', action='store_true', help='Skip dependency checks')
    args = parser.parse_args()
    
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
    video_throughput_results = {}
    if not args.text_only:
        print("\n=== Running Actual Video Embedding Tests ===")
        
        actual_video_results = test_actual_video_embedding()
        memory_after_actual = monitor_memory_usage()
        print(f"Memory usage after actual video tests: {memory_after_actual:.2f} MB (delta: {memory_after_actual - initial_memory:.2f} MB)")
        
        # Test video embedding throughput and latency vs concurrency
        video_throughput_results = test_video_embedding_throughput()
        memory_after_video_throughput = monitor_memory_usage()
        print(f"Memory usage after video throughput tests: {memory_after_video_throughput:.2f} MB (delta: {memory_after_video_throughput - initial_memory:.2f} MB)")
    
    # Generate summary
    summary = summarize_results(
        latency_results, 
        throughput_results, 
        estimated_video_results, 
        actual_video_results, 
        max_input_size,
        video_throughput_results
    )
    print("\n" + summary)
    
    with open("performance_summary.txt", "w") as f:
        f.write(summary)
    
    # Plot results
    try:
        plot_results(
            latency_results, 
            throughput_results, 
            estimated_video_results, 
            actual_video_results,
            video_throughput_results,
            "performance"  # Keep the default output path prefix
        )
    except Exception as e:
        print(f"Could not generate plots: {e}")
