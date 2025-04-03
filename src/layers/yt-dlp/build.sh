#!/bin/bash

# Exit on error
set -e

LAYER_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
echo "LAYER_DIR: $LAYER_DIR"
NODEJS_DIR="$LAYER_DIR/nodejs"
echo "NODEJS_DIR: $NODEJS_DIR"

# Clean up any previous builds
rm -rf "$NODEJS_DIR/node_modules"
mkdir -p "$NODEJS_DIR/node_modules"

# Download latest yt-dlp binary
curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux -o "$LAYER_DIR/yt-dlp"
chmod +x "$LAYER_DIR/yt-dlp"

# Create the layer structure
mkdir -p "$LAYER_DIR/bin"
mv "$LAYER_DIR/yt-dlp" "$LAYER_DIR/bin/"

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