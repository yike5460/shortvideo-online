FROM 763104351884.dkr.ecr.us-east-1.amazonaws.com/djl-inference:0.21.0-deepspeed0.8.3-cu117

# Install system dependencies
RUN apt-get update && \
    apt-get install -y \
    git \
    git-lfs \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy requirements file
COPY requirements.txt .

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Download BGE model
RUN mkdir -p /app/models && \
    cd /app/models && \
    git lfs install && \
    git clone https://huggingface.co/InfiniFlow/bce-embedding-base_v1 && \
    cd bce-embedding-base_v1 && \
    git checkout 00a7db29f2f740ce3aef3b4ed9653a5bd9b9ce7d

# Copy application code
COPY . .

# Expose port
EXPOSE 8000

# Run the application
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]