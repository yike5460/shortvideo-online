# Video Content Analysis Framework - Requirements

## Overview
Implement an AI-powered video parsing system that structures, semanticizes, and tags video content for precise retrieval and clip mixing based on scripts or keywords.

## Core Objectives
- **Video Segmentation**: Automatically segment videos into logical chunks
- **Content Analysis**: Extract detailed metadata from each segment
- **Semantic Tagging**: Generate searchable tags and keywords
- **Structured Output**: Provide JSON-formatted metadata for programmatic access

## Functional Requirements

### FR1: Video Segmentation
**Epic**: Automatic Video Segmentation
**Priority**: High

#### FR1.1: Scene-based Segmentation
- **Description**: Detect scene transitions using visual cues
- **Acceptance Criteria**:
  - [ Optional ] Detect hard cuts, fade in/out, dissolve transitions
  - [ ] Identify significant content/theme changes
  - [ ] Generate unique segment IDs (S001, S002, etc.)
  - [ ] Record precise start/end timecodes (HH:MM:SS:FF format)
  - [ ] Calculate segment duration in seconds
  - [ Optional] Classify transition types

#### FR1.2: Audio-based Segmentation
- **Description**: Use audio changes to refine segmentation
- **Acceptance Criteria**:
  - [ ] Detect silence gaps and audio rhythm changes
  - [ ] Identify speaker changes
  - [ ] Detect music start/stop points
  - [ ] Integrate with visual segmentation for optimal cuts

### FR2: Visual Content Analysis
**Epic**: Detailed Visual Description
**Priority**: High

#### FR2.1: Scene Description
- **Description**: Analyze and describe visual scenes
- **Acceptance Criteria**:
  - [ ] Classify indoor/outdoor environments
  - [ ] Identify specific locations (office, beach, city, kitchen)
  - [ ] Detect lighting conditions (daylight, indoor warm, neon, backlit)
  - [ ] Analyze color grading style (warm/cool tone, saturation level)

#### FR2.2: Subject and Object Detection
- **Description**: Identify main subjects and key objects
- **Acceptance Criteria**:
  - [ ] Detect and describe people (clothing, gender, age group)
  - [ ] Identify animals, vehicles, buildings, logos
  - [ ] Track subject actions (walking, speaking, driving)
  - [ ] Recognize key objects (coffee cup, laptop, signage)

#### FR2.3: Camera and Composition Analysis
- **Description**: Analyze technical aspects of footage
- **Acceptance Criteria**:
  - [ ] Classify shot types (CU, MS, LS, ELS, OTS)
  - [ ] Detect camera movements (static, dolly, pan, zoom, handheld)
  - [ ] Analyze composition (subject positioning, framing)
  - [ ] Generate key frame descriptions

### FR3: Human Behavior Analysis
**Epic**: Body Language and Expression Detection
**Priority**: Medium

#### FR3.1: Facial Expression Analysis
- **Description**: Detect and classify facial expressions
- **Acceptance Criteria**:
  - [ ] Recognize basic emotions (smile, frown, surprise, neutral)
  - [ ] Detect engagement levels (focused, distracted)
  - [ ] Classify expression intensity (subtle, moderate, strong)

#### FR3.2: Gesture and Posture Recognition
- **Description**: Analyze body language and gestures
- **Acceptance Criteria**:
  - [ ] Detect common gestures (pointing, waving, thumbs up)
  - [ ] Analyze posture (sitting, standing, walking, running)
  - [ ] Identify interactions (handshake, conversation, object manipulation)
  - [ ] Assess overall mood/atmosphere

### FR4: Audio Content Analysis
**Epic**: Audio Content Processing
**Priority**: Medium

#### FR4.1: Audio Classification
- **Description**: Classify and analyze audio content
- **Acceptance Criteria**:
  - [ ] Identify audio types (speech, music, ambient, silence)
  - [ ] Detect music characteristics (genre, tempo, mood)
  - [ ] Recognize sound effects and environmental audio
  - [ ] Generate speech content summaries when clear

### FR5: Metadata Generation
**Epic**: Semantic Tagging and Summarization
**Priority**: High

#### FR5.1: Content Summarization
- **Description**: Generate concise segment summaries
- **Acceptance Criteria**:
  - [ ] Create 1-2 sentence core content summaries
  - [ ] Extract 3-5 primary keywords (nouns/verbs)
  - [ ] Generate 1-3 emotion keywords
  - [ ] Identify 1-3 visual style keywords

#### FR5.2: Categorization and Tagging
- **Description**: Apply structured tags to segments
- **Acceptance Criteria**:
  - [ ] Assign thematic categories (product demo, interview, landscape)
  - [ ] Rate emotional intensity (low, medium, high)
  - [ ] Tag technical attributes (shot type, movement, lighting)
  - [ ] Add utility tags (suitable for opening, transition, B-roll)
  - [ ] Support custom tags for project-specific needs

### FR6: Data Output and Integration
**Epic**: Structured Data Export
**Priority**: High

#### FR6.1: JSON Output Format
- **Description**: Export analysis results in structured JSON
- **Acceptance Criteria**:
  - [ ] Include video metadata (filename, duration, resolution, frame rate)
  - [ ] Structure segments array with all analysis fields
  - [ ] Ensure valid JSON format with proper nesting
  - [ ] Support UTF-8 encoding for international content

#### FR6.2: API Integration
- **Description**: Integrate with existing video management system
- **Acceptance Criteria**:
  - [ ] Store analysis results in video_objects field
  - [ ] Support existing VideoResult interface
  - [ ] Enable filtering by extracted tags
  - [ ] Maintain backward compatibility with current system

## Non-Functional Requirements

### NFR1: Performance
- Process 1-minute video segments within 30 seconds
- Support videos up to 4K resolution
- Handle concurrent analysis of multiple videos

### NFR2: Accuracy
- Achieve >85% accuracy in scene segmentation
- Maintain >80% precision in object/subject detection
- Generate relevant keywords with >90% contextual accuracy

### NFR3: Scalability
- Support batch processing of multiple videos
- Handle videos up to 60 minutes in length
- Scale horizontally for increased throughput

### NFR4: Reliability
- Graceful handling of corrupted or unsupported video formats
- Comprehensive error logging and recovery
- Validate input parameters and provide meaningful error messages

## Technical Constraints
- Compatible with existing Next.js/TypeScript frontend
- Integrate with current AWS API infrastructure
- Support common video formats (MP4, MOV, AVI, WebM)
- Maintain existing authentication and authorization patterns

## Existing Infrastructure Analysis

### Requirements Fulfillment via Existing APIs and Models

Based on the current codebase analysis, the following requirements can be fulfilled by multiplexing existing RESTful APIs, models, and data schema:

#### **Fully Supported via Existing Infrastructure (80-90% complete)**

**FR1: Video Segmentation**
- ✅ **FR1.1 Scene-based Segmentation**: Amazon Rekognition shot detection API provides automated scene segmentation with confidence scores
- ✅ **FR1.2 Audio-based Segmentation**: FFmpeg integration supports audio analysis and silence detection
- ✅ **Data Schema**: `VideoSegment` interface in `common.ts` already supports segment_id, start_time, end_time, duration, and confidence
- ✅ **API Endpoints**: `/videos/{videoId}/segments` for retrieving existing segments

**FR2: Visual Content Analysis**
- ✅ **FR2.1 Scene Description**: QwenVL model with specialized prompts for environment, location, and lighting analysis
- ✅ **FR2.2 Subject/Object Detection**: Amazon Rekognition label detection with `TimestampedLabel[]` schema
- ✅ **FR2.3 Camera Analysis**: QwenVL capable of shot type and camera movement detection
- ✅ **Data Schema**: `video_objects` field supports hierarchical object detection with categories and aliases

**FR5: Metadata Generation**
- ✅ **FR5.1 Content Summarization**: QwenVL with prompt templates for summary generation
- ✅ **FR5.2 Categorization**: Existing embedding models support keyword extraction and tagging
- ✅ **Data Schema**: `SearchMetadata` interface supports exact_match_keywords and semantic_vectors

**FR6: Data Output and Integration**
- ✅ **FR6.1 JSON Output**: Complete `VideoResult` and `VideoMetadata` interfaces
- ✅ **FR6.2 API Integration**: Existing video management system with OpenSearch integration

#### **Partially Supported (50-70% complete)**

**FR3: Human Behavior Analysis**
- ⚠️ **FR3.1 Facial Expression Analysis**: Amazon Rekognition supports face detection but limited emotion analysis
- ⚠️ **FR3.2 Gesture Recognition**: QwenVL can analyze gestures but needs specialized prompts
- ⚠️ **Gap**: Advanced emotion intensity classification and gesture taxonomy need custom implementation

**FR4: Audio Content Analysis**
- ⚠️ **FR4.1 Audio Classification**: Basic audio type detection via FFmpeg, WhisperX for speech transcription
- ⚠️ **Gap**: Music genre detection and advanced audio mood analysis need additional models

### Implementation Gaps Requiring New Code

#### **High Priority Gaps (30-40% new implementation)**

**FR1.2 Audio-based Segmentation Enhancement**
- **Gap**: Advanced audio rhythm detection and speaker change identification
- **Solution**: Integrate WhisperX with custom audio analysis models
- **Effort**: 2-3 weeks

**FR3: Human Behavior Analysis Enhancement**
- **Gap**: Advanced facial expression intensity classification
- **Solution**: Custom emotion detection model or enhanced QwenVL prompts
- **Effort**: 3-4 weeks

**FR4.1 Audio Classification Enhancement**
- **Gap**: Music genre detection, tempo analysis, and mood classification
- **Solution**: Audio feature extraction models (librosa) + classification
- **Effort**: 2-3 weeks

#### **Medium Priority Gaps (20-30% new implementation)**

**FR2.3 Camera Analysis Enhancement**
- **Gap**: Precise camera movement detection (dolly, pan, zoom quantification)
- **Solution**: Computer vision algorithms for motion vector analysis
- **Effort**: 2-3 weeks

**FR5.2 Advanced Categorization**
- **Gap**: Custom project-specific tagging system
- **Solution**: Extensible tag taxonomy with machine learning classification
- **Effort**: 1-2 weeks

#### **Low Priority Gaps (10-20% new implementation)**

**Performance Optimization**
- **Gap**: Batch processing optimization for multiple videos
- **Solution**: Queue management and parallel processing optimization
- **Effort**: 1-2 weeks

**Advanced Search Features**
- **Gap**: Cross-video semantic search and similarity matching
- **Solution**: Enhanced vector search with cross-modal embeddings
- **Effort**: 1-2 weeks

### Fast Prototype Implementation Strategy

**Phase 1: Leverage Existing Infrastructure (1-2 weeks)**
1. Use existing video upload and segmentation APIs
2. Implement QwenVL-based analysis with specialized prompts
3. Utilize current `VideoSegment` and `TimestampedLabel` schemas
4. Integrate with existing search and filtering APIs

**Phase 2: Fill Critical Gaps (4-6 weeks)**
1. Enhance audio analysis with WhisperX integration
2. Implement advanced emotion detection
3. Add custom tagging system
4. Optimize performance for batch processing

**Phase 3: Advanced Features (2-4 weeks)**
1. Implement cross-video similarity search
2. Add advanced camera movement analysis
3. Integrate custom behavior analysis models
4. Performance tuning and production optimization

### Resource Requirements

**Existing Infrastructure Utilization**: 70-80%
- Amazon Rekognition: Object/face detection
- QwenVL: Video understanding and analysis
- FFmpeg: Video processing and segmentation
- OpenSearch: Search and indexing
- S3: Storage and retrieval

**New Implementation Required**: 20-30%
- Audio enhancement models
- Advanced emotion detection
- Custom tagging systems
- Performance optimizations

**Estimated Timeline**: 8-12 weeks total (vs. 18-24 weeks from scratch)

## Acceptance Criteria Summary
The video analysis framework is considered complete when:
1. Videos can be automatically segmented based on visual and audio cues
2. Each segment contains comprehensive metadata covering visual, audio, and behavioral elements
3. Structured JSON output integrates seamlessly with existing video management system
4. Users can filter and search videos using extracted tags and metadata
5. System meets performance and accuracy requirements for production use