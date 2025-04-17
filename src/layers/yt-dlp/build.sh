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

# Create a minimal fallback cookie file
cat > "$LAYER_DIR/bin/yt-dlp-cookies.txt" << EOL
# Netscape HTTP Cookie File
# This is a minimal fallback cookie file for when headless Chrome extraction fails
# It will likely work for non-age-restricted videos only

.youtube.com	TRUE	/	TRUE	2147483647	CONSENT	YES+cb
.youtube.com	TRUE	/	TRUE	2147483647	GPS	1
.youtube.com	TRUE	/	TRUE	2147483647	VISITOR_INFO1_LIVE	w5LjvMEQYHQ
.youtube.com	TRUE	/	TRUE	2147483647	YSC	nt3dIdo2cZM
EOL
chmod 644 "$LAYER_DIR/bin/yt-dlp-cookies.txt"

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

# Create lib directory for Chrome dependencies
mkdir -p "$LAYER_DIR/lib"

# Download Chrome dependencies
echo "Downloading Chrome dependencies..."

cd /tmp

# We need to install necessary tools
yum update -y
yum install -y wget binutils

# Create a directory to download and extract the packages
mkdir -p chrome-deps
cd chrome-deps

# Download required .deb packages for Chrome dependencies
wget http://archive.ubuntu.com/ubuntu/pool/main/n/nss/libnss3_3.108-1ubuntu1_amd64.deb
wget http://archive.ubuntu.com/ubuntu/pool/main/n/nspr/libnspr4_4.35-0ubuntu0.20.04.1_amd64.deb
# wget http://archive.ubuntu.com/ubuntu/pool/main/a/atk1.0/libatk1.0-0_2.35.1-1ubuntu2_amd64.deb
# wget http://archive.ubuntu.com/ubuntu/pool/main/a/at-spi2-atk/libatk-bridge2.0-0_2.34.2-0ubuntu2~20.04.1_amd64.deb
# wget http://archive.ubuntu.com/ubuntu/pool/main/c/cups/libcups2_2.3.1-9ubuntu1.1_amd64.deb
# wget http://archive.ubuntu.com/ubuntu/pool/main/libd/libdrm/libdrm2_2.4.105-3~20.04.2_amd64.deb
# wget http://archive.ubuntu.com/ubuntu/pool/main/libx/libxkbcommon/libxkbcommon0_0.10.0-1_amd64.deb
# wget http://archive.ubuntu.com/ubuntu/pool/main/libx/libxcomposite/libxcomposite1_0.4.5-1_amd64.deb
# wget http://archive.ubuntu.com/ubuntu/pool/main/libx/libxdamage/libxdamage1_1.1.5-2_amd64.deb
# wget http://archive.ubuntu.com/ubuntu/pool/main/libx/libxext/libxext6_1.3.4-0ubuntu1_amd64.deb
# wget http://archive.ubuntu.com/ubuntu/pool/main/libx/libxfixes/libxfixes3_5.0.3-2_amd64.deb
# wget http://archive.ubuntu.com/ubuntu/pool/main/libx/libxshmfence/libxshmfence1_1.3-1_amd64.deb

# Install tools for extracting .deb files on Amazon Linux
yum install -y tar

# Extract the .deb files (without dpkg which isn't available on Amazon Linux)
mkdir -p ./extract
for deb in *.deb; do
  echo "Extracting $deb"
  # Extract the data.tar.xz or data.tar.gz from the .deb file
  ar -x "$deb"
  # Extract the data archive to our extract directory
  if [ -f data.tar.xz ]; then
    tar -xf data.tar.xz -C ./extract
    rm data.tar.xz
  elif [ -f data.tar.gz ]; then
    tar -xzf data.tar.gz -C ./extract
    rm data.tar.gz
  elif [ -f data.tar.zst ]; then
    # Some newer .deb files use zst compression
    # Install zstd if available
    yum install -y zstd || echo "zstd not available, some packages may fail to extract"
    zstd -d data.tar.zst -o data.tar
    tar -xf data.tar -C ./extract
    rm data.tar data.tar.zst
  fi
done

# Copy all .so files to the layer's lib directory
find ./extract -name "*.so*" -exec cp -v {} "$LAYER_DIR/lib/" \;

# Clean up
cd "$LAYER_DIR"
rm -rf /tmp/chrome-deps

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
- /lib - Contains Chrome shared libraries
- /nodejs - Contains Chrome and Puppeteer dependencies

## Cookie Automation
Cookies are now automatically extracted using headless Chrome and stored securely.
The yt-dlp-cookies.txt file is kept as a fallback mechanism.

## Build Environment
This layer is designed to be built on Amazon Linux, which is the same environment used by AWS Lambda.
The build script uses yum package manager to install necessary dependencies like binutils
and handles extracting libraries from Ubuntu .deb packages for Chrome dependencies.

## System Requirements
- Amazon Linux 2 (for production build)
- Node.js and npm
- Yum package manager
EOL
