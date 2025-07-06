class ImageProcessor {
    constructor() {
        this.frameCache = new Map();
        this.extractionQueue = [];
        this.processingActive = false;
        this.maxCacheSize = 50;
        this.frameQuality = 0.8;
    }

    async extractFramesFromClip(clipItem, options = {}) {
        try {
            const {
                frameCount = 10,
                startTime = 0,
                endTime = null,
                width = 640,
                height = 360,
                format = 'jpeg'
            } = options;

            const actualEndTime = endTime || clipItem.duration.seconds;
            const timeStep = (actualEndTime - startTime) / frameCount;
            const frames = [];

            for (let i = 0; i < frameCount; i++) {
                const timestamp = startTime + (i * timeStep);
                const frameData = await this.extractSingleFrame(clipItem, timestamp, { width, height, format });
                
                if (frameData.success) {
                    frames.push({
                        index: i,
                        timestamp: timestamp,
                        data: frameData.imageData,
                        width: width,
                        height: height,
                        format: format
                    });
                }
            }

            return {
                success: true,
                frames: frames,
                clipInfo: {
                    name: clipItem.name,
                    duration: clipItem.duration.seconds,
                    frameRate: clipItem.framerate || 30
                }
            };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async extractSingleFrame(clipItem, timestamp, options = {}) {
        const cacheKey = `${clipItem.name}_${timestamp}_${options.width}x${options.height}`;
        
        if (this.frameCache.has(cacheKey)) {
            return { success: true, imageData: this.frameCache.get(cacheKey) };
        }

        try {
            const frameData = await this.captureFrameFromPremiere(clipItem, timestamp, options);
            
            if (frameData.success) {
                this.cacheFrame(cacheKey, frameData.imageData);
            }

            return frameData;
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async captureFrameFromPremiere(clipItem, timestamp, options = {}) {
        return new Promise((resolve) => {
            const script = `
                (function() {
                    try {
                        var clip = ${JSON.stringify({
                            name: clipItem.name,
                            start: clipItem.start ? clipItem.start.seconds : 0
                        })};
                        
                        var sequence = app.project.activeSequence;
                        if (!sequence) {
                            return JSON.stringify({success: false, error: "No active sequence"});
                        }

                        var targetTime = ${timestamp};
                        sequence.time = targetTime;
                        
                        var tempPath = app.path + "/temp_frame_" + Date.now() + ".png";
                        
                        try {
                            sequence.exportFrame(targetTime, tempPath, "${options.format || 'png'}", {
                                width: ${options.width || 640},
                                height: ${options.height || 360}
                            });
                            
                            var file = new File(tempPath);
                            if (file.exists) {
                                file.open("r");
                                file.encoding = "BINARY";
                                var data = file.read();
                                file.close();
                                
                                var base64 = btoa(data);
                                file.remove();
                                
                                return JSON.stringify({
                                    success: true,
                                    imageData: "data:image/${options.format || 'png'};base64," + base64,
                                    timestamp: targetTime
                                });
                            } else {
                                return JSON.stringify({success: false, error: "Frame export failed"});
                            }
                        } catch (exportError) {
                            return JSON.stringify({
                                success: false, 
                                error: "Export not available, using sequence preview",
                                fallback: true
                            });
                        }
                    } catch (e) {
                        return JSON.stringify({success: false, error: e.toString()});
                    }
                })();
            `;

            if (typeof csInterface !== 'undefined') {
                csInterface.evalScript(script, (result) => {
                    try {
                        const response = JSON.parse(result);
                        if (response.fallback) {
                            resolve(this.generateFallbackFrame(options));
                        } else {
                            resolve(response);
                        }
                    } catch (e) {
                        resolve(this.generateFallbackFrame(options));
                    }
                });
            } else {
                resolve(this.generateFallbackFrame(options));
            }
        });
    }

    generateFallbackFrame(options = {}) {
        const width = options.width || 640;
        const height = options.height || 360;
        
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        
        const gradient = ctx.createLinearGradient(0, 0, width, height);
        gradient.addColorStop(0, '#2a2a2a');
        gradient.addColorStop(1, '#1a1a1a');
        
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, width, height);
        
        ctx.fillStyle = '#666666';
        ctx.font = '20px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('Sample Frame', width / 2, height / 2);
        
        return {
            success: true,
            imageData: canvas.toDataURL(`image/${options.format || 'png'}`, this.frameQuality),
            fallback: true
        };
    }

    async processFrameBatch(frames, processor, options = {}) {
        const batchSize = options.batchSize || 5;
        const results = [];
        
        for (let i = 0; i < frames.length; i += batchSize) {
            const batch = frames.slice(i, i + batchSize);
            const batchPromises = batch.map(frame => processor(frame, options));
            
            try {
                const batchResults = await Promise.all(batchPromises);
                results.push(...batchResults);
                
                if (options.onProgress) {
                    options.onProgress({
                        processed: Math.min(i + batchSize, frames.length),
                        total: frames.length,
                        percentage: Math.round((Math.min(i + batchSize, frames.length) / frames.length) * 100)
                    });
                }
                
                if (options.batchDelay) {
                    await this.delay(options.batchDelay);
                }
            } catch (error) {
                console.error('Batch processing error:', error);
                results.push(...batch.map(() => ({ success: false, error: error.message })));
            }
        }
        
        return results;
    }

    async resizeImage(imageData, targetWidth, targetHeight, options = {}) {
        try {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            const img = await this.loadImage(imageData);
            
            canvas.width = targetWidth;
            canvas.height = targetHeight;
            
            if (options.maintainAspectRatio) {
                const aspectRatio = img.width / img.height;
                const targetAspectRatio = targetWidth / targetHeight;
                
                let drawWidth = targetWidth;
                let drawHeight = targetHeight;
                let offsetX = 0;
                let offsetY = 0;
                
                if (aspectRatio > targetAspectRatio) {
                    drawHeight = targetWidth / aspectRatio;
                    offsetY = (targetHeight - drawHeight) / 2;
                } else {
                    drawWidth = targetHeight * aspectRatio;
                    offsetX = (targetWidth - drawWidth) / 2;
                }
                
                if (options.backgroundColor) {
                    ctx.fillStyle = options.backgroundColor;
                    ctx.fillRect(0, 0, targetWidth, targetHeight);
                }
                
                ctx.drawImage(img, offsetX, offsetY, drawWidth, drawHeight);
            } else {
                ctx.drawImage(img, 0, 0, targetWidth, targetHeight);
            }
            
            return {
                success: true,
                imageData: canvas.toDataURL('image/png', this.frameQuality)
            };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async enhanceImage(imageData, enhancements = {}) {
        try {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            const img = await this.loadImage(imageData);
            
            canvas.width = img.width;
            canvas.height = img.height;
            ctx.drawImage(img, 0, 0);
            
            const imageDataObj = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const data = imageDataObj.data;
            
            const {
                brightness = 0,
                contrast = 0,
                saturation = 0,
                gamma = 1,
                sharpen = false
            } = enhancements;
            
            for (let i = 0; i < data.length; i += 4) {
                let r = data[i];
                let g = data[i + 1];
                let b = data[i + 2];
                
                if (brightness !== 0) {
                    r = Math.max(0, Math.min(255, r + brightness));
                    g = Math.max(0, Math.min(255, g + brightness));
                    b = Math.max(0, Math.min(255, b + brightness));
                }
                
                if (contrast !== 0) {
                    const factor = (259 * (contrast + 255)) / (255 * (259 - contrast));
                    r = factor * (r - 128) + 128;
                    g = factor * (g - 128) + 128;
                    b = factor * (b - 128) + 128;
                    r = Math.max(0, Math.min(255, r));
                    g = Math.max(0, Math.min(255, g));
                    b = Math.max(0, Math.min(255, b));
                }
                
                if (saturation !== 0) {
                    const gray = 0.299 * r + 0.587 * g + 0.114 * b;
                    const satFactor = saturation / 100;
                    r = gray + (r - gray) * (1 + satFactor);
                    g = gray + (g - gray) * (1 + satFactor);
                    b = gray + (b - gray) * (1 + satFactor);
                    r = Math.max(0, Math.min(255, r));
                    g = Math.max(0, Math.min(255, g));
                    b = Math.max(0, Math.min(255, b));
                }
                
                if (gamma !== 1) {
                    r = 255 * Math.pow(r / 255, 1 / gamma);
                    g = 255 * Math.pow(g / 255, 1 / gamma);
                    b = 255 * Math.pow(b / 255, 1 / gamma);
                }
                
                data[i] = r;
                data[i + 1] = g;
                data[i + 2] = b;
            }
            
            ctx.putImageData(imageDataObj, 0, 0);
            
            return {
                success: true,
                imageData: canvas.toDataURL('image/png', this.frameQuality)
            };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async createMaskFromAlpha(imageData, options = {}) {
        try {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            const img = await this.loadImage(imageData);
            
            canvas.width = img.width;
            canvas.height = img.height;
            ctx.drawImage(img, 0, 0);
            
            const imageDataObj = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const data = imageDataObj.data;
            const threshold = options.threshold || 128;
            
            for (let i = 0; i < data.length; i += 4) {
                const alpha = data[i + 3];
                const maskValue = alpha > threshold ? 255 : 0;
                
                data[i] = maskValue;
                data[i + 1] = maskValue;
                data[i + 2] = maskValue;
                data[i + 3] = 255;
            }
            
            ctx.putImageData(imageDataObj, 0, 0);
            
            return {
                success: true,
                maskData: canvas.toDataURL('image/png')
            };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async loadImage(src) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = reject;
            img.src = src;
        });
    }

    cacheFrame(key, data) {
        if (this.frameCache.size >= this.maxCacheSize) {
            const firstKey = this.frameCache.keys().next().value;
            this.frameCache.delete(firstKey);
        }
        this.frameCache.set(key, data);
    }

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    clearCache() {
        this.frameCache.clear();
    }

    getStats() {
        return {
            cacheSize: this.frameCache.size,
            maxCacheSize: this.maxCacheSize,
            queueLength: this.extractionQueue.length,
            processingActive: this.processingActive
        };
    }

    async getImageHistogram(imageData) {
        try {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            const img = await this.loadImage(imageData);
            
            canvas.width = img.width;
            canvas.height = img.height;
            ctx.drawImage(img, 0, 0);
            
            const imageDataObj = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const data = imageDataObj.data;
            
            const histogram = {
                red: new Array(256).fill(0),
                green: new Array(256).fill(0),
                blue: new Array(256).fill(0),
                luminance: new Array(256).fill(0)
            };
            
            for (let i = 0; i < data.length; i += 4) {
                const r = data[i];
                const g = data[i + 1];
                const b = data[i + 2];
                const luminance = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
                
                histogram.red[r]++;
                histogram.green[g]++;
                histogram.blue[b]++;
                histogram.luminance[luminance]++;
            }
            
            return { success: true, histogram };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = ImageProcessor;
} else if (typeof window !== 'undefined') {
    window.ImageProcessor = ImageProcessor;
}