# Use Python 3.12 as the base image
FROM python:3.12

# Install system dependencies
RUN apt-get update && apt-get install -y \
    ffmpeg \
    git \
    && rm -rf /var/lib/apt/lists/*

# Create a non-root user
RUN useradd -m -u 1000 user
WORKDIR /app

# Install Python dependencies directly
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir \
        torch \
        torchvision \
        transformers==4.51.3 \
        accelerate \
        hf_xet \
        qwen-vl-utils[decord]==0.0.8 \
        boto3 \
        fastapi \
        uvicorn[standard]

# Copy application files
COPY --chown=user . /app

# Switch to the non-root user
USER user

# Set environment variables
ENV HOME=/home/user \
    PATH=/home/user/.local/bin:$PATH

# Command to run the application
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "7860"]
