FROM pytorch/pytorch:2.6.0-cuda12.4-cudnn9-runtime

# Set build argument for HF token
ARG HF_TOKEN

# Set working directory
WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    git \
    python3-pip \
    && rm -rf /var/lib/apt/lists/*

# Create model directory
RUN mkdir -p /app/model

# Install huggingface_hub for model downloading
RUN pip install --no-cache-dir huggingface_hub

# Download model from Hugging Face
RUN python -c "from huggingface_hub import snapshot_download; snapshot_download('xiaotinghe/Qwen2.5-VL-3B-video-embedding-0306', local_dir='/app/model', token='${HF_TOKEN}')"

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY . .

# Expose the port the app runs on
EXPOSE 8001

# Command to run the application
CMD ["python", "app.py"] 