const PluginConfig = {
    ai: {
        services: {
            aws: {
                endpoint: 'https://rekognition.us-east-1.amazonaws.com',
                timeout: 25000,
                retries: 2
            },
            local: {
                opencv: true,
                faceapi: true,
                fallbackMode: true
            },
            videoSearch: {
                endpoint: 'https://api.your-domain.com/video-search',
                timeout: 30000,
                retries: 3,
                maxCacheSize: 100,
                cacheExpiry: 300000
            }
        },
        processing: {
            batchSize: 5,
            maxConcurrent: 3,
            frameExtraction: {
                defaultFrameCount: 5,
                maxFrameCount: 15,
                defaultResolution: { width: 640, height: 360 },
                quality: 0.8
            },
            caching: {
                enabled: true,
                maxCacheSize: 50,
                ttl: 300000
            }
        },
        faceDetection: {
            confidence: 0.7,
            maxFaces: 10,
            trackingFrames: 30
        },
        backgroundRemoval: {
            defaultThreshold: 50,
            edgeFeathering: 2,
            maskSmoothing: true
        },
        colorCorrection: {
            analysisFrames: 3,
            autoAdjustment: {
                brightness: { min: -20, max: 20 },
                contrast: { min: -15, max: 15 },
                saturation: { min: -10, max: 10 }
            }
        },
        videoSearch: {
            defaultTopK: 5,
            maxTopK: 15,
            defaultMinConfidence: 0.5,
            autoImport: true,
            autoApplyAI: false,
            previewOnHover: true,
            supportedFormats: ['mp4', 'mov', 'avi', 'mkv'],
            thumbnailSize: { width: 80, height: 45 }
        }
    },
    
    ui: {
        animations: true,
        progressIndicators: true,
        realTimePreview: false,
        statusTimeout: 5000
    },
    
    performance: {
        debounceDelay: 300,
        throttleLimit: 1000,
        memoryWarningThreshold: 100,
        processingTimeout: 60000
    },
    
    debugging: {
        enabled: false,
        verbose: false,
        logLevel: 'info'
    },

    presets: {
        faceDetection: {
            quick: { frameCount: 3, confidence: 0.6 },
            standard: { frameCount: 5, confidence: 0.7 },
            thorough: { frameCount: 10, confidence: 0.8 }
        },
        backgroundRemoval: {
            subtle: { threshold: 30, feathering: 1 },
            standard: { threshold: 50, feathering: 2 },
            aggressive: { threshold: 70, feathering: 3 }
        },
        colorCorrection: {
            gentle: { analysisFrames: 2, adjustmentStrength: 0.5 },
            standard: { analysisFrames: 3, adjustmentStrength: 1.0 },
            dramatic: { analysisFrames: 5, adjustmentStrength: 1.5 }
        },
        videoSearch: {
            precise: { topK: 3, minConfidence: 0.8, fastMode: false },
            balanced: { topK: 5, minConfidence: 0.5, fastMode: false },
            broad: { topK: 10, minConfidence: 0.3, fastMode: true }
        }
    },

    getConfig: function(path) {
        return path.split('.').reduce((obj, key) => obj && obj[key], this);
    },

    setConfig: function(path, value) {
        const keys = path.split('.');
        const lastKey = keys.pop();
        const target = keys.reduce((obj, key) => {
            if (!obj[key]) obj[key] = {};
            return obj[key];
        }, this);
        target[lastKey] = value;
    },

    validateConfig: function() {
        const errors = [];
        
        if (!this.ai.processing.batchSize || this.ai.processing.batchSize < 1) {
            errors.push('Invalid batch size');
        }
        
        if (!this.ai.processing.frameExtraction.defaultFrameCount || 
            this.ai.processing.frameExtraction.defaultFrameCount < 1) {
            errors.push('Invalid frame count');
        }
        
        if (this.ai.faceDetection.confidence < 0 || this.ai.faceDetection.confidence > 1) {
            errors.push('Face detection confidence must be between 0 and 1');
        }
        
        return { valid: errors.length === 0, errors };
    },

    exportConfig: function() {
        return JSON.stringify(this, null, 2);
    },

    importConfig: function(configJson) {
        try {
            const config = JSON.parse(configJson);
            Object.assign(this, config);
            return this.validateConfig();
        } catch (e) {
            return { valid: false, errors: ['Invalid JSON configuration'] };
        }
    },

    resetToDefaults: function() {
        const validation = this.validateConfig();
        if (!validation.valid) {
            this.ai.processing.batchSize = 5;
            this.ai.processing.frameExtraction.defaultFrameCount = 5;
            this.ai.faceDetection.confidence = 0.7;
        }
    }
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = PluginConfig;
} else if (typeof window !== 'undefined') {
    window.PluginConfig = PluginConfig;
}