class AIServices {
    constructor() {
        this.apiKeys = {
            aws: null
        };
        this.endpoints = {
            aws: 'https://rekognition.us-east-1.amazonaws.com',
            videoSearch: 'https://api.your-domain.com/video-search',
            faceapi: 'https://api.face-api.ai/detect'
        };
        this.initialized = false;
        this.cache = new Map();
        this.videoSearchCache = new Map();
    }

    async initialize(config = {}) {
        try {
            this.apiKeys = { ...this.apiKeys, ...config.apiKeys };
        
        if (config.endpoints) {
            this.endpoints = { ...this.endpoints, ...config.endpoints };
        }
            
            if (typeof cv !== 'undefined') {
                await this.initializeOpenCV();
            }
            
            if (typeof faceapi !== 'undefined') {
                await this.initializeFaceAPI();
            }
            
            this.initialized = true;
            return { success: true, message: 'AI services initialized' };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async initializeOpenCV() {
        return new Promise((resolve) => {
            if (cv.getBuildInformation) {
                console.log('OpenCV.js loaded:', cv.getBuildInformation());
                resolve();
            } else {
                cv.onRuntimeInitialized = () => {
                    console.log('OpenCV.js initialized');
                    resolve();
                };
            }
        });
    }

    async initializeFaceAPI() {
        if (typeof faceapi !== 'undefined') {
            await faceapi.nets.tinyFaceDetector.loadFromUri('/models');
            await faceapi.nets.faceLandmark68Net.loadFromUri('/models');
            await faceapi.nets.faceRecognitionNet.loadFromUri('/models');
            console.log('Face-API.js models loaded');
        }
    }

    async detectFaces(imageData, options = {}) {
        const cacheKey = this.generateCacheKey('face-detect', imageData);
        if (this.cache.has(cacheKey)) {
            return this.cache.get(cacheKey);
        }

        try {
            let result;
            
            if (options.useLocal && typeof faceapi !== 'undefined') {
                result = await this.detectFacesLocal(imageData, options);
            } else if (this.apiKeys.aws) {
                result = await this.detectFacesAWS(imageData, options);
            } else {
                result = await this.detectFacesLocal(imageData, options);
            }

            this.cache.set(cacheKey, result);
            return result;
        } catch (error) {
            return { success: false, error: error.message, faces: [] };
        }
    }

    async detectFacesLocal(imageData, options = {}) {
        if (typeof faceapi === 'undefined') {
            return { success: false, error: 'Face-API.js not loaded', faces: [] };
        }

        try {
            const img = await this.createImageFromData(imageData);
            const detections = await faceapi
                .detectAllFaces(img, new faceapi.TinyFaceDetectorOptions())
                .withFaceLandmarks()
                .withFaceDescriptors();

            const faces = detections.map((detection, index) => ({
                id: index,
                bbox: {
                    x: detection.detection.box.x,
                    y: detection.detection.box.y,
                    width: detection.detection.box.width,
                    height: detection.detection.box.height
                },
                confidence: detection.detection.score,
                landmarks: detection.landmarks ? detection.landmarks.positions : null
            }));

            return {
                success: true,
                faces: faces,
                method: 'local-faceapi'
            };
        } catch (error) {
            return { success: false, error: error.message, faces: [] };
        }
    }

    async detectFacesAWS(imageData, options = {}) {
        try {
            const response = await fetch(`${this.endpoints.aws}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-amz-json-1.1',
                    'X-Amz-Target': 'RekognitionService.DetectFaces',
                    'Authorization': `AWS4-HMAC-SHA256 Credential=${this.apiKeys.aws}`,
                },
                body: JSON.stringify({
                    Image: {
                        Bytes: imageData
                    },
                    Attributes: ['ALL']
                })
            });

            if (!response.ok) {
                throw new Error(`AWS Rekognition error: ${response.status}`);
            }

            const data = await response.json();
            return {
                success: true,
                faces: data.FaceDetails.map((face, index) => ({
                    id: `aws_face_${index}`,
                    bbox: {
                        x: face.BoundingBox.Left * 100,
                        y: face.BoundingBox.Top * 100,
                        width: face.BoundingBox.Width * 100,
                        height: face.BoundingBox.Height * 100
                    },
                    confidence: face.Confidence / 100,
                    attributes: face
                })),
                method: 'aws-rekognition'
            };
        } catch (error) {
            return { success: false, error: error.message, faces: [] };
        }
    }

    async removeBackground(imageData, options = {}) {
        const cacheKey = this.generateCacheKey('bg-remove', imageData);
        if (this.cache.has(cacheKey)) {
            return this.cache.get(cacheKey);
        }

        try {
            let result;
            
            if (options.useLocal) {
                result = await this.removeBackgroundLocal(imageData, options);
            } else {
                result = await this.removeBackgroundCloud(imageData, options);
            }

            this.cache.set(cacheKey, result);
            return result;
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async removeBackgroundLocal(imageData, options = {}) {
        if (typeof cv === 'undefined') {
            return { success: false, error: 'OpenCV.js not loaded' };
        }

        try {
            const canvas = await this.createCanvasFromData(imageData);
            const src = cv.imread(canvas);
            const mask = new cv.Mat();
            const bgdModel = new cv.Mat();
            const fgdModel = new cv.Mat();

            const rect = new cv.Rect(10, 10, src.cols - 20, src.rows - 20);
            cv.grabCut(src, mask, rect, bgdModel, fgdModel, 5, cv.GC_INIT_WITH_RECT);

            for (let i = 0; i < mask.rows; i++) {
                for (let j = 0; j < mask.cols; j++) {
                    const pixelValue = mask.ucharPtr(i, j)[0];
                    if (pixelValue === cv.GC_BGD || pixelValue === cv.GC_PR_BGD) {
                        mask.ucharPtr(i, j)[0] = 0;
                    } else {
                        mask.ucharPtr(i, j)[0] = 255;
                    }
                }
            }

            const result = new cv.Mat();
            src.copyTo(result, mask);
            
            const resultCanvas = document.createElement('canvas');
            cv.imshow(resultCanvas, result);
            
            src.delete();
            mask.delete();
            bgdModel.delete();
            fgdModel.delete();
            result.delete();

            return {
                success: true,
                maskData: resultCanvas.toDataURL(),
                method: 'local-opencv'
            };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async analyzeColor(imageData, options = {}) {
        const cacheKey = this.generateCacheKey('color-analyze', imageData);
        if (this.cache.has(cacheKey)) {
            return this.cache.get(cacheKey);
        }

        try {
            const analysis = await this.analyzeColorLocal(imageData, options);
            this.cache.set(cacheKey, analysis);
            return analysis;
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async analyzeColorLocal(imageData, options = {}) {
        try {
            const canvas = await this.createCanvasFromData(imageData);
            const ctx = canvas.getContext('2d');
            const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const data = imgData.data;

            let totalR = 0, totalG = 0, totalB = 0;
            let minBrightness = 255, maxBrightness = 0;
            let pixelCount = 0;

            for (let i = 0; i < data.length; i += 4) {
                const r = data[i];
                const g = data[i + 1];
                const b = data[i + 2];
                const brightness = (r + g + b) / 3;

                totalR += r;
                totalG += g;
                totalB += b;
                minBrightness = Math.min(minBrightness, brightness);
                maxBrightness = Math.max(maxBrightness, brightness);
                pixelCount++;
            }

            const avgR = totalR / pixelCount;
            const avgG = totalG / pixelCount;
            const avgB = totalB / pixelCount;
            const avgBrightness = (avgR + avgG + avgB) / 3;
            const contrast = maxBrightness - minBrightness;

            const corrections = {
                brightness: avgBrightness < 128 ? (128 - avgBrightness) / 2.55 : -(avgBrightness - 128) / 2.55,
                contrast: contrast < 128 ? 20 : -10,
                saturation: avgBrightness > 180 ? -15 : 10
            };

            return {
                success: true,
                analysis: {
                    averageColor: { r: Math.round(avgR), g: Math.round(avgG), b: Math.round(avgB) },
                    brightness: avgBrightness,
                    contrast: contrast,
                    corrections: corrections
                },
                method: 'local-histogram'
            };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async trackObjects(frames, options = {}) {
        try {
            const results = [];
            let previousDetections = null;

            for (let i = 0; i < frames.length; i++) {
                const frame = frames[i];
                let detections;

                if (options.trackFaces) {
                    detections = await this.detectFaces(frame.data, options);
                } else {
                    detections = await this.detectObjects(frame.data, options);
                }

                if (previousDetections && detections.success) {
                    detections = this.associateDetections(previousDetections, detections, options);
                }

                results.push({
                    frameIndex: i,
                    timestamp: frame.timestamp,
                    detections: detections
                });

                previousDetections = detections;
            }

            return { success: true, tracking: results };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    associateDetections(previous, current, options = {}) {
        if (!previous.faces || !current.faces) return current;

        const threshold = options.associationThreshold || 0.5;
        const associated = [];

        current.faces.forEach(currentFace => {
            let bestMatch = null;
            let bestDistance = Infinity;

            previous.faces.forEach(prevFace => {
                const distance = this.calculateBBoxDistance(currentFace.bbox, prevFace.bbox);
                if (distance < bestDistance && distance < threshold) {
                    bestDistance = distance;
                    bestMatch = prevFace;
                }
            });

            if (bestMatch) {
                currentFace.trackingId = bestMatch.trackingId || bestMatch.id;
            } else {
                currentFace.trackingId = `track_${Date.now()}_${Math.random()}`;
            }

            associated.push(currentFace);
        });

        return { ...current, faces: associated };
    }

    calculateBBoxDistance(bbox1, bbox2) {
        const centerX1 = bbox1.x + bbox1.width / 2;
        const centerY1 = bbox1.y + bbox1.height / 2;
        const centerX2 = bbox2.x + bbox2.width / 2;
        const centerY2 = bbox2.y + bbox2.height / 2;

        return Math.sqrt(Math.pow(centerX2 - centerX1, 2) + Math.pow(centerY2 - centerY1, 2));
    }

    async createImageFromData(imageData) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = reject;
            
            if (imageData instanceof ArrayBuffer) {
                const blob = new Blob([imageData]);
                img.src = URL.createObjectURL(blob);
            } else if (typeof imageData === 'string') {
                img.src = imageData;
            } else {
                reject(new Error('Unsupported image data format'));
            }
        });
    }

    async createCanvasFromData(imageData) {
        const img = await this.createImageFromData(imageData);
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        return canvas;
    }

    generateCacheKey(operation, data) {
        const dataHash = this.simpleHash(data);
        return `${operation}_${dataHash}`;
    }

    simpleHash(data) {
        let hash = 0;
        const str = typeof data === 'string' ? data : data.toString();
        for (let i = 0; i < Math.min(str.length, 100); i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
        }
        return Math.abs(hash).toString(36);
    }

    clearCache() {
        this.cache.clear();
    }

    async searchVideos(query, options = {}) {
        try {
            const {
                indexes = null,
                topK = 5,
                minConfidence = 0.5,
                fastMode = false
            } = options;

            const cacheKey = this.generateCacheKey('video-search', query + JSON.stringify(options));
            if (this.videoSearchCache.has(cacheKey)) {
                return this.videoSearchCache.get(cacheKey);
            }

            const response = await fetch(this.endpoints.videoSearch, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.apiKeys.videoSearch || ''}`
                },
                body: JSON.stringify({
                    query: query,
                    indexes: indexes,
                    top_k: topK,
                    min_confidence: minConfidence,
                    fast_mode: fastMode
                })
            });

            if (!response.ok) {
                throw new Error(`Video search API error: ${response.status}`);
            }

            const results = await response.json();
            
            const processedResults = {
                success: true,
                query: query,
                totalResults: results.length,
                results: results.map(result => ({
                    videoId: result.videoId,
                    segmentId: result.segmentId,
                    indexId: result.indexId,
                    title: result.title,
                    confidence: result.confidence,
                    duration: result.duration,
                    s3Path: result.s3Path,
                    videoUrl: result.videoUrl,
                    thumbnailUrl: result.thumbnailUrl,
                    metadata: {
                        relevanceScore: result.confidence,
                        duration: result.duration,
                        source: result.indexId
                    }
                }))
            };

            this.videoSearchCache.set(cacheKey, processedResults);
            return processedResults;

        } catch (error) {
            return {
                success: false,
                error: error.message,
                query: query,
                results: []
            };
        }
    }

    async importVideoToSequence(videoResult, options = {}) {
        try {
            const {
                downloadToLocal = true,
                addToActiveTrack = true,
                position = 'end'
            } = options;

            if (!videoResult.videoUrl) {
                throw new Error('No video URL provided');
            }

            return {
                success: true,
                videoResult: videoResult,
                localPath: null,
                importReady: true,
                message: `Video "${videoResult.title}" ready for import`
            };

        } catch (error) {
            return {
                success: false,
                error: error.message,
                videoResult: videoResult
            };
        }
    }

    async downloadVideoClip(videoUrl, options = {}) {
        try {
            const response = await fetch(videoUrl);
            if (!response.ok) {
                throw new Error(`Failed to download video: ${response.status}`);
            }

            const blob = await response.blob();
            const arrayBuffer = await blob.arrayBuffer();

            return {
                success: true,
                data: arrayBuffer,
                size: arrayBuffer.byteLength,
                contentType: response.headers.get('content-type') || 'video/mp4'
            };

        } catch (error) {
            return {
                success: false,
                error: error.message
            };
        }
    }

    clearVideoSearchCache() {
        this.videoSearchCache.clear();
    }

    getServiceStatus() {
        return {
            initialized: this.initialized,
            services: {
                opencv: typeof cv !== 'undefined',
                faceapi: typeof faceapi !== 'undefined',
                aws: !!this.apiKeys.aws,
                videoSearch: !!this.endpoints.videoSearch
            },
            cacheSize: this.cache.size,
            videoSearchCacheSize: this.videoSearchCache.size
        };
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = AIServices;
} else if (typeof window !== 'undefined') {
    window.AIServices = AIServices;
}