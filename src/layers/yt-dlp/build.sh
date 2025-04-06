#!/bin/bash

# Exit on error
set -e

LAYER_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
echo "LAYER_DIR: $LAYER_DIR"
NODEJS_DIR="$LAYER_DIR/nodejs"
echo "NODEJS_DIR: $NODEJS_DIR"

# Clean up any previous builds
rm -rf "$LAYER_DIR/bin" "$LAYER_DIR/lib"
mkdir -p "$LAYER_DIR/bin"

# Download the correct Linux binary
echo "Downloading yt-dlp Linux binary..."
curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux -o "$LAYER_DIR/bin/yt-dlp"
chmod +x "$LAYER_DIR/bin/yt-dlp"

echo "Verifying binary type..."
file "$LAYER_DIR/bin/yt-dlp"

# Create the layer structure for Lambda
mkdir -p "$NODEJS_DIR"

# Create package.json for the layer
cat > "$NODEJS_DIR/package.json" << EOL
{
  "name": "yt-dlp-layer",
  "version": "1.0.0",
  "description": "Lambda layer containing yt-dlp binary",
  "author": "Aaron Yi",
  "license": "MIT"
}
EOL

echo "yt-dlp layer has been built successfully"