FROM pytorch/pytorch:2.6.0-cuda12.4-cudnn9-runtime

# Set build arguments for AWS credentials
ARG AWS_ACCESS_KEY_ID
ARG AWS_SECRET_ACCESS_KEY
ARG AWS_DEFAULT_REGION

# Set working directory
WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    git \
    python3-pip \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install s5cmd
RUN curl -L https://github.com/peak/s5cmd/releases/download/v2.3.0/s5cmd_2.3.0_Linux-64bit.tar.gz | tar -xz && \
    chmod +x s5cmd && \
    mv s5cmd /usr/local/bin/

# Create model directory
RUN mkdir -p /app/model

# Copy model files from S3
RUN --mount=type=secret,id=aws \
    export AWS_ACCESS_KEY_ID=${AWS_ACCESS_KEY_ID} && \
    export AWS_SECRET_ACCESS_KEY=${AWS_SECRET_ACCESS_KEY} && \
    export AWS_DEFAULT_REGION=${AWS_DEFAULT_REGION} && \
    s5cmd cp 's3://xiaotih/Qwen2.5-VL-3B-Instruct-embedding-stage2-0306/*' /app/model/

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
# Copy application code
COPY . .

# Expose the port the app runs on
EXPOSE 8001

# Command to run the application
CMD ["python", "app.py"] 