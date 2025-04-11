FROM pytorch/pytorch:2.6.0-cuda12.4-cudnn9-runtime

# Set build argument for HF token
ARG HF_TOKEN

# Set working directory
WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    git \
    python3-pip \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Create model directory
RUN mkdir -p /app/model

# Install huggingface_hub for model downloading
RUN pip install --no-cache-dir huggingface_hub

# Download model from Hugging Face
RUN python -c "from huggingface_hub import snapshot_download; snapshot_download('xiaotinghe/Qwen2.5-VL-3B-video-embedding-0331', local_dir='/app/model', token='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')"

# Download Whisper model
RUN python -c "from huggingface_hub import snapshot_download; snapshot_download('mobiuslabsgmbh/faster-whisper-large-v3-turbo', local_dir='/app/model/whisper')"

# Download BCE embedding model
RUN python -c "from huggingface_hub import snapshot_download; snapshot_download('maidalun1020/bce-embedding-base_v1', local_dir='/app/model/bce')"

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Add NVIDIA cuDNN library path to LD_LIBRARY_PATH
RUN CUDNN_PATH=$(pip show nvidia-cudnn-cu12 | grep Location | cut -d ' ' -f 2)/nvidia/cudnn/lib/ && \
    echo "export LD_LIBRARY_PATH=\$LD_LIBRARY_PATH:${CUDNN_PATH}" >> /etc/bash.bashrc

# Copy application code
COPY . .

# Expose the port the app runs on
EXPOSE 8001

# Command to run the application
CMD ["python", "app.py"] 