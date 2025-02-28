#!/bin/bash
# Script to download and package FFmpeg for Lambda layer
set -euo pipefail

FFMPEG_VERSION="4.4"
LAYER_DIR="$(pwd)"

# Create directories
mkdir -p "${LAYER_DIR}/bin"
cd /tmp

# Download static build of FFmpeg for Amazon Linux 2
curl -O "https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz"
tar xf ffmpeg-release-amd64-static.tar.xz
cd ffmpeg-*-static

# Copy binaries to layer
cp ffmpeg ffprobe "${LAYER_DIR}/bin/"
chmod 755 "${LAYER_DIR}/bin/ffmpeg" "${LAYER_DIR}/bin/ffprobe"

echo "FFmpeg Layer prepared successfully" 