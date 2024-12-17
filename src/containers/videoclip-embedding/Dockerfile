FROM pytorch/pytorch:2.1.0-cuda11.8-cudnn8-runtime

# Install system dependencies
RUN apt-get update && apt-get install -y \
    git \
    wget \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

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

# Run the application
CMD ["python", "app.py"] 