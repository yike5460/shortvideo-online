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

# Download VideoCLIP model
RUN mkdir -p /app/models && \
    cd /app/models && \
    git lfs install && \
    git clone https://huggingface.co/alibaba-pai/VideoCLIP-XL && \
    cd VideoCLIP-XL && \
    git checkout main

# Copy application code
COPY . /app
WORKDIR /app

# Run the application
CMD ["python", "app.py"] 