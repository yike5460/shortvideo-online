FROM node:18-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && \
    apt-get install -y ffmpeg && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Copy application files
COPY package*.json ./
COPY . .

# Install dependencies
RUN npm install

# Start the application
CMD ["node", "index.js"] 