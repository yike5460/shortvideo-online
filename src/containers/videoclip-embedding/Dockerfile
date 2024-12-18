FROM pytorch/pytorch:2.1.0-cuda11.8-cudnn8-runtime

# Set non-interactive installation and timezone
ENV DEBIAN_FRONTEND=noninteractive \
    TZ=Asia/Shanghai

# Install system dependencies
RUN apt-get update && apt-get install -y \
    git \
    git-lfs \
    wget \
    ffmpeg \
    curl \
    libgl1-mesa-glx \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt && \
    pip install --no-cache-dir \
    opencv-python-headless \
    pillow \
    torchvision \
    transformers \
    fastapi \
    uvicorn \
    python-multipart \
    boto3 \
    requests-aws4auth \
    opensearch-py

# Download VideoCLIP and Jina-CLIP models
RUN mkdir -p /app/models && \
    cd /app/models && \
    git lfs install && \
    # Download VideoCLIP-XL
    git clone https://huggingface.co/alibaba-pai/VideoCLIP-XL && \
    cd VideoCLIP-XL && \
    git checkout main && \
    cd .. && \
    # Download VideoCLIP-XL-v2 weights
    git clone https://huggingface.co/alibaba-pai/VideoCLIP-XL-v2 && \
    cd VideoCLIP-XL-v2 && \
    git checkout main && \
    # Copy v2 weights to VideoCLIP-XL directory
    cp VideoCLIP-XL-v2.bin ../VideoCLIP-XL/ && \
    cd .. && \
    # Clean up v2 repo to save space
    rm -rf VideoCLIP-XL-v2 && \
    # Download Jina-CLIP model
    mkdir -p jina-clip-v1 && \
    cd jina-clip-v1 && \
    git clone https://huggingface.co/jinaai/jina-clip-v1 . && \
    git checkout main

# Copy application code
COPY . /app
WORKDIR /app

# Environment variables for CUDA
ENV NVIDIA_VISIBLE_DEVICES=all \
    NVIDIA_DRIVER_CAPABILITIES=compute,utility \
    TORCH_CUDA_ARCH_LIST="6.0 6.1 7.0 7.5 8.0 8.6"

# Expose port
EXPOSE 8001

# Healthcheck
HEALTHCHECK --interval=30s --timeout=10s --start-period=180s --retries=3 \
    CMD curl -f http://localhost:8001/health || exit 1

# Run the application
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8001", "--workers", "1"] 