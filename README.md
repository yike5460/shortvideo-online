# AI Video Effects Plugin for Adobe Premiere Pro

A powerful Adobe Premiere Pro plugin that combines AI-powered video processing with intelligent video search capabilities for enhanced video editing workflows.

## Features

### 🔍 **AI-Powered Video Search & Import**
- **Natural Language Search**: Search video databases using descriptive queries
- **Intelligent Matching**: AI-powered relevance scoring and content matching
- **Direct Import**: One-click import of search results into your timeline
- **Preview Integration**: Thumbnail previews and video preview capabilities
- **Configurable Parameters**: Adjustable confidence thresholds and result limits

### 🎯 **AI-Powered Face Detection & Tracking**
- **Local Processing**: Client-side face detection using Face-API.js
- **AWS Integration**: Optional AWS Rekognition for enhanced accuracy
- **Real-time Tracking**: Track detected faces across the timeline with motion data generation
- **Intelligent Application**: Automatic crop and matte effects based on detection results

### 🎨 **Intelligent Background Removal**
- **AI Segmentation**: Smart background separation using computer vision
- **Threshold Control**: Adjustable threshold settings (0-100%) for precise control
- **Quality Optimization**: Automatic edge feathering and mask cleanup
- **Multiple Algorithms**: Local OpenCV processing with cloud backup options

### 🌈 **Advanced Color Correction**
- **Histogram Analysis**: AI-powered automatic color balancing and enhancement
- **Intelligent Adjustment**: Scene-aware correction based on image analysis
- **Manual Controls**: Fine-tune brightness, contrast, and saturation with real-time preview
- **Batch Processing**: Apply corrections across multiple clips simultaneously

### 📤 **Professional Export Options**
- **Multiple Formats**: Support for H.264, ProRes, and DNxHD export formats
- **Quality Presets**: Optimized settings for different delivery requirements
- **Batch Processing**: Process multiple clips efficiently

## Installation

1. **Download the Plugin**: Clone or download this repository
2. **Copy to Extensions Folder**: 
   - Windows: `C:\Program Files (x86)\Common Files\Adobe\CEP\extensions\`
   - macOS: `/Library/Application Support/Adobe/CEP/extensions/`
3. **Enable Developer Mode** (if needed):
   - Windows: Set registry key `PlayerDebugMode` to `1` in `HKEY_CURRENT_USER\Software\Adobe\CSXS.11`
   - macOS: Run `defaults write com.adobe.CSXS.11 PlayerDebugMode 1`
4. **Restart Premiere Pro**
5. **Access Plugin**: Window → Extensions → AI Effects Panel

## Technical Requirements

### System Requirements
- **Adobe Premiere Pro**: CC 2024 or later (version 24.0+)
- **Operating System**: Windows 10/11 or macOS 10.15+
- **RAM**: 8GB minimum, 16GB recommended
- **Graphics**: GPU with CUDA or OpenCL support recommended

### Development Environment
- **CEP Version**: 11.0+
- **ExtendScript**: Support for Premiere Pro scripting API
- **Web Technologies**: HTML5, CSS3, JavaScript ES6+

## Plugin Architecture

### Core Components

#### 1. User Interface (`index.html` + `styles.css`)
- Modern, responsive UI design matching Adobe's UX guidelines
- Dark theme optimized for video editing workflows
- Intuitive controls with real-time feedback

#### 2. JavaScript Core (`script.js`)
- Event handling and user interaction management
- Real-time parameter updates and preview
- Status reporting and error handling

#### 3. Adobe CEP Interface (`CSInterface.js`)
- Communication bridge between UI and Premiere Pro
- Cross-platform compatibility layer
- Event system for real-time updates

#### 4. ExtendScript Engine (`ai-effects.jsx`)
- Direct integration with Premiere Pro API
- Effect application and parameter management
- Timeline and clip manipulation

### File Structure
```
AdobePlugin/
├── manifest.xml          # Plugin manifest and configuration
├── index.html           # Main UI interface
├── styles.css           # UI styling and theme
├── script.js            # Core JavaScript functionality
├── CSInterface.js       # Adobe CEP communication layer
├── ai-effects.jsx       # ExtendScript effects engine
├── ai-services.js       # AI service integration layer
├── image-processor.js   # Frame extraction and processing
├── config.js           # Configuration and presets
└── README.md           # Documentation (this file)
```

## Enhanced AI Implementation

### Real AI Processing Pipeline

The plugin now supports genuine AI processing through multiple pathways:

**1. Local AI Processing**
- OpenCV.js for computer vision tasks
- Face-API.js for face detection and recognition
- Client-side processing for privacy and speed

**2. Cloud AI Services** (Optional)
- AWS Rekognition integration for enhanced face detection
- Custom video search API integration
- Configurable API endpoints and authentication

**3. Hybrid Processing**
- Frame extraction from Premiere Pro clips
- AI analysis of extracted frames
- Application of results back to native effects

### Processing Architecture

#### Frame Extraction Pipeline
1. **Clip Analysis**: Extract frames at optimal intervals
2. **Quality Optimization**: Resize and enhance frames for AI processing
3. **Batch Processing**: Process multiple frames simultaneously
4. **Caching**: Store results to avoid reprocessing

#### AI Analysis Chain
1. **Video Search**: Natural language query processing and semantic matching
2. **Face Detection**: Identify faces with bounding boxes and confidence scores
3. **Object Tracking**: Track faces/objects across multiple frames
4. **Background Segmentation**: Generate masks for background removal
5. **Color Analysis**: Histogram analysis for intelligent color correction

#### Video Search Integration
1. **Query Processing**: Natural language understanding for video content search
2. **Semantic Matching**: AI-powered relevance scoring against video databases
3. **Result Filtering**: Confidence-based filtering and ranking
4. **Auto-Import**: Direct integration with Premiere Pro timeline
5. **AI Enhancement**: Automatic application of AI effects to imported videos

## API Reference

### Core Functions

#### Video Search
```javascript
// Search for videos using natural language
aiServices.searchVideos(query, options)
// Parameters: 
//   query: string - Natural language search query
//   options: {
//     topK: number (default: 5) - Maximum results to return
//     minConfidence: number (default: 0.5) - Minimum confidence threshold
//     indexes: array - Specific video indexes to search
//     fastMode: boolean (default: false) - Enable fast processing
//   }
// Returns: {success: boolean, results: array, totalResults: number}

// Import video from search results
AIEffects.importVideoFromSearch(videoData, options)
// Returns: {success: boolean, message: string, videoData: object}
```

#### Face Detection
```javascript
AIEffects.detectFaces(clipItem, options)
// Parameters: clipItem (object), options: {frameCount, useAI}
// Returns: {success: boolean, message: string, faceCount?: number}
```

#### Face Tracking
```javascript
AIEffects.trackFaces(sequence, options)
// Returns: {success: boolean, message: string, processed: number, totalFaces: number}
```

#### Background Removal
```javascript
AIEffects.removeBackground(clipItem, threshold, options)
// Parameters: clipItem (object), threshold (0-100), options: {frameCount, useLocal}
// Returns: {success: boolean, message: string}
```

#### Color Correction
```javascript
// Automatic with AI analysis
AIEffects.autoColorCorrect(clipItem, options)
// Parameters: clipItem (object), options: {frameCount, analysisFrames}

// Manual adjustment
AIEffects.manualColorCorrect(clipItem, brightness, contrast, saturation)
// Parameters: brightness (-100 to 100), contrast (-100 to 100), saturation (-100 to 100)
```

#### AI-Enhanced Workflow
```javascript
// Apply AI effects to imported videos
AIEffects.applyAIEffectsToImportedVideo(clipItem, videoData, aiOptions)
// Parameters:
//   aiOptions: {
//     autoFaceDetection: boolean,
//     autoColorCorrection: boolean,
//     backgroundRemoval: boolean
//   }
// Returns: {success: boolean, appliedEffects: array}
```

## Usage Guide

### Basic Workflow

1. **Open Premiere Pro** and load your project
2. **Launch Plugin**: Window → Extensions → AI Effects Panel
3. **Search Videos** (Optional): Use natural language to find relevant video content
4. **Import Content**: Import search results directly into your timeline
5. **Apply AI Effects**: Use automated or manual AI processing
6. **Fine-tune Results**: Adjust parameters using the intuitive controls
7. **Export**: Choose your desired format and export

### Video Search Workflow

1. **Enter Search Query**: Type descriptive text like "sunset beach waves"
2. **Adjust Parameters**: Set confidence threshold and number of results
3. **Review Results**: Browse thumbnails and confidence scores
4. **Preview Content**: Use preview button to review video segments
5. **Import to Timeline**: Click import to add videos to your active sequence
6. **Apply AI Enhancement**: Optionally apply automated AI effects to imported content

### Best Practices

- **Sequence Preparation**: Ensure your sequence is active before applying effects
- **Clip Selection**: Select specific clips for targeted effect application
- **Performance**: Close unnecessary applications for optimal AI processing
- **Preview**: Use Premiere's preview features to review effects in real-time

## Advanced Features

### Custom Effect Chains
The plugin supports combining multiple AI effects:
1. Face Detection → Background Removal → Color Correction
2. Auto Color Correction → Manual Fine-tuning → Export

### Batch Processing
Process multiple clips efficiently:
- Select multiple clips in timeline
- Apply effects to all selected clips
- Monitor progress through status updates

## Troubleshooting

### Common Issues

#### Plugin Not Loading
- Verify installation path
- Check Developer Mode settings
- Restart Premiere Pro
- Check CEP version compatibility

#### Effects Not Applying
- Ensure sequence is active
- Verify clip selection
- Check clip format compatibility
- Review error messages in status area

#### Performance Issues
- Close other applications
- Increase available RAM
- Use proxy media for large files
- Enable GPU acceleration

### Debug Mode
Enable debug mode for detailed logging:
```javascript
// In browser console (F12)
localStorage.setItem('debug', 'true');
```

## Development

### Building from Source
1. Clone the repository
2. Modify source files as needed
3. Test in development environment
4. Package for distribution

### Extending Functionality
The plugin architecture supports easy extension:
- Add new UI elements in `index.html`
- Implement functionality in `script.js`
- Create ExtendScript functions in `ai-effects.jsx`
- Update manifest for new permissions

## License

This plugin is provided as-is for educational and development purposes. Please ensure compliance with Adobe's plugin development guidelines and licensing terms.

## Support

For technical support and questions:
- Review this documentation
- Check Adobe's CEP documentation
- Consult Premiere Pro scripting guides
- Test with sample projects

---

**Note**: This plugin demonstrates advanced integration techniques with Adobe Premiere Pro. Actual AI processing capabilities may vary based on system configuration and Adobe's API limitations.