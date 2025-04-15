#!/bin/bash

# Exit on error
set -e

LAYER_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
echo "LAYER_DIR: $LAYER_DIR"
NODEJS_DIR="$LAYER_DIR/nodejs"
echo "NODEJS_DIR: $NODEJS_DIR"

# Clean up any previous builds
rm -rf "$LAYER_DIR/bin"
mkdir -p "$LAYER_DIR/bin"

# Create a note file in the bin directory about cookie automation
cat > "$LAYER_DIR/bin/COOKIE_NOTES.txt" << EOL
The fixed yt-dlp-cookies.txt file is now used as a fallback only.
Cookie extraction is automated via headless Chrome in the YouTube Lambda function.
The automated cookies are stored securely in AWS Parameter Store.
EOL


# Download the correct Linux binary for yt-dlp
echo "Downloading yt-dlp Linux binary..."
curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux -o "$LAYER_DIR/bin/yt-dlp"
chmod +x "$LAYER_DIR/bin/yt-dlp"

echo "Verifying yt-dlp binary type..."
file "$LAYER_DIR/bin/yt-dlp"

# Download and setup FFmpeg
echo "Downloading FFmpeg static build..."
cd /tmp
FFMPEG_VERSION="4.4"
curl -O "https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz"
tar xf ffmpeg-release-amd64-static.tar.xz
cd ffmpeg-*-static

# Copy FFmpeg binaries to layer
echo "Copying FFmpeg binaries to layer..."
cp ffmpeg ffprobe "$LAYER_DIR/bin/"
chmod 755 "$LAYER_DIR/bin/ffmpeg" "$LAYER_DIR/bin/ffprobe"

# Clean up temporary files
cd "$LAYER_DIR"
rm -rf /tmp/ffmpeg-*-static /tmp/ffmpeg-release-amd64-static.tar.xz

# Create the layer structure for Lambda
mkdir -p "$NODEJS_DIR"

# Create package.json for the layer
cat > "$NODEJS_DIR/package.json" << EOL
{
  "name": "yt-dlp-layer",
  "version": "1.0.0",
  "description": "Lambda layer containing yt-dlp, FFmpeg, and Chrome for cookie automation",
  "author": "Aaron Yi",
  "license": "MIT",
  "dependencies": {
    "chrome-aws-lambda": "^10.1.0",
    "puppeteer-core": "^10.1.0"
  }
}
EOL

# Install Node.js dependencies
echo "Installing Node.js dependencies..."
cd "$NODEJS_DIR"
npm install --production

echo "Layer has been built successfully with yt-dlp, FFmpeg, and Chrome dependencies"

# Create a README for the layer
cat > "$LAYER_DIR/README.md" << EOL
# YouTube Download Lambda Layer

This layer contains:
- yt-dlp binary for video downloading
- FFmpeg and ffprobe for video processing
- chrome-aws-lambda for cookie automation
- puppeteer-core for browser automation

## Structure
- /bin - Contains yt-dlp, ffmpeg, and ffprobe binaries
- /nodejs - Contains Chrome and Puppeteer dependencies

## Cookie Automation
Cookies are now automatically extracted using headless Chrome and stored in AWS Parameter Store.
The yt-dlp-cookies.txt file is kept as a fallback mechanism.
EOL
