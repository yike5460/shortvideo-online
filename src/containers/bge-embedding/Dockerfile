FROM pytorch/pytorch:2.1.0-cuda11.8-cudnn8-runtime

# Install system dependencies
RUN apt-get update && apt-get install -y \
    git \
    wget \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Download BGE model
RUN mkdir -p /app/models && \
    cd /app/models && \
    git lfs install && \
    git clone https://huggingface.co/InfiniFlow/bce-embedding-base_v1 && \
    cd bce-embedding-base_v1 && \
    git checkout 00a7db29f2f740ce3aef3b4ed9653a5bd9b9ce7d

# Copy application code
COPY . /app
WORKDIR /app

# Run the application
CMD ["python", "app.py"] 