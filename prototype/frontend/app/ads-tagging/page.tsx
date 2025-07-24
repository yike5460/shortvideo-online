'use client'

import { useState, useEffect, useRef, useMemo } from 'react'
import { useAuth } from '@/lib/auth/AuthContext'
import { useSearchParams } from 'next/navigation'
import { VideoResult, TimestampedLabel, LabelInfo, NamedEntity, VideoSegment } from '@/types'
import HashtagsAndTopics, { isHashtagsResponse } from '@/components/HashtagsAndTopics'
import ReactMarkdown from 'react-markdown'
import { Chart } from 'chart.js/auto'
import 'chart.js/auto'

// API configuration
const API_ENDPOINT = process.env.NEXT_PUBLIC_API_URL

// Extend VideoResult to include video_objects and segments for TypeScript
interface ExtendedVideoResult extends VideoResult {
  video_objects?: TimestampedLabel[];
  segments?: VideoSegment[];
}

// Enhanced video analysis result interface
interface VideoAnalysisResult {
  videoId: string;
  segments: AnalyzedSegment[];
  processingStats: {
    totalSegments: number;
    analyzedSegments: number;
    processingTime: number;
  };
}

// Enhanced segment analysis interface
interface AnalyzedSegment {
  segment_id: string;
  start_time: number;
  end_time: number;
  duration: number;
  enhanced_analysis?: {
    scene_description?: {
      environment: 'indoor' | 'outdoor' | 'mixed';
      location: string;
      lighting: string;
      atmosphere: string;
      visual_style_keywords: string[];
    };
    camera_analysis?: {
      shot_type: string;
      camera_movement: string;
      composition_notes: string;
    };
    emotion_analysis?: {
      facial_expressions: Array<{
        type: string;
        intensity: 'low' | 'medium' | 'high';
        confidence: number;
      }>;
      overall_mood: string;
      engagement_level: string;
    };
    generated_tags?: {
      primary_keywords: string[];
      emotion_keywords: string[];
      visual_style_keywords: string[];
      utility_tags: string[];
      technical_tags: string[];
    };
  };
  analysis_summary?: string;
}

// Panel component interfaces
interface AnalysisPanelProps {
  options: any;
  onOptionsChange: (options: any) => void;
  videoSegments: any[];
  selectedVideo: VideoThumbnail | null;
  onAnalyze: (segmentId: string) => void;
  results: { [key: string]: string };
  isAnalyzing: boolean;
}

interface DetailedAnalysisOptions {
  visualElements: boolean;
  bodyLanguage: boolean;
  audioElements: boolean;
}

interface SummaryAnalysisOptions {
  coreSummary: boolean;
  primaryKeywords: boolean;
  emotionKeywords: boolean;
  visualStyleKeywords: boolean;
}

interface CategorizationAnalysisOptions {
  thematicCategory: boolean;
  emotionalIntensity: boolean;
  technicalAttributes: boolean;
  practicalUtility: boolean;
  customTags: boolean;
}

// Helper function to extract unique categories from video objects
// Updated to handle optimized backend response format with shortened property names
const extractCategories = (videoObjects?: any[]): string[] => {
  if (!videoObjects || !Array.isArray(videoObjects)) return [];
  
  // Create a Set to store unique category names
  const uniqueCategories = new Set<string>();
  
  // Process each timestamped label (t = timestamp, l = labels)
  videoObjects.forEach(timestamped => {
    // Process each label within the timestamped label (l = labels)
    (timestamped.l || timestamped.labels || []).forEach((label: any) => {
      // Process each category within the label (cat = categories)
      const categories = label.cat || label.categories || [];
      
      if (Array.isArray(categories)) {
        // Handle both direct string arrays and object arrays with Name property
        categories.forEach((category: any) => {
          const categoryName = typeof category === 'string' ? category : category?.Name;
          if (categoryName) {
            uniqueCategories.add(categoryName);
          }
        });
      }
    });
  });
  
  // Convert the Set to an array and return
  return Array.from(uniqueCategories);
};

// Helper function to extract unique aliases from video objects
// Updated to handle optimized backend response format with shortened property names
const extractAliases = (videoObjects?: any[]): string[] => {
  if (!videoObjects || !Array.isArray(videoObjects)) return [];
  
  const uniqueAliases = new Set<string>();
  
  videoObjects.forEach(timestamped => {
    // Support both shortened (l) and full (labels) property names
    (timestamped.l || timestamped.labels || []).forEach((label: any) => {
      // Process aliases (ali = aliases)
      const aliases = label.ali || label.aliases || [];
      
      if (Array.isArray(aliases)) {
        // Handle both direct string arrays and object arrays with Name property
        aliases.forEach((alias: any) => {
          const aliasName = typeof alias === 'string' ? alias : alias?.Name;
          if (aliasName) {
            uniqueAliases.add(aliasName);
          }
        });
      }
    });
  });
  
  return Array.from(uniqueAliases);
};

// Function to extract all tags (categories and aliases) from all videos
const extractAllTags = (videos: VideoThumbnail[]): {tag: string, count: number, type: 'category' | 'alias'}[] => {
  const tagCounts = new Map<string, {count: number, type: 'category' | 'alias'}>();
  
  videos.forEach(video => {
    // Cast to ExtendedVideoResult to access video_objects
    const extendedVideo = video as any as ExtendedVideoResult;
    
    // Extract categories from video objects
    if (extendedVideo.video_objects) {
      const categories = extractCategories(extendedVideo.video_objects);
      categories.forEach(category => {
        const existingTag = tagCounts.get(category);
        if (existingTag) {
          existingTag.count++;
        } else {
          tagCounts.set(category, {count: 1, type: 'category'});
        }
      });
      
      // Extract aliases
      const aliases = extractAliases(extendedVideo.video_objects);
      aliases.forEach(alias => {
        const existingTag = tagCounts.get(alias);
        if (existingTag) {
          existingTag.count++;
        } else {
          tagCounts.set(alias, {count: 1, type: 'alias'});
        }
      });
    }
  });
  
  // Convert Map to array and sort by count (descending order)
  return Array.from(tagCounts.entries())
    .map(([tag, data]) => ({
    tag,
    count: data.count,
    type: data.type
    }))
    .sort((a, b) => b.count - a.count);
};

// Helper function to estimate processing time based on video duration
const estimateProcessingTime = (duration: string): number => {
  // Parse duration string (MM:SS or HH:MM:SS)
  const parts = duration.split(':').map(Number);
  let totalSeconds = 0;
  
  if (parts.length === 2) {
    // MM:SS format
    totalSeconds = parts[0] * 60 + parts[1];
  } else if (parts.length === 3) {
    // HH:MM:SS format
    totalSeconds = parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  
  // Estimate: roughly 5-10 seconds processing per minute of video
  return Math.max(totalSeconds * 0.15, 10); // Minimum 10 seconds
};

// Helper function to estimate processing time for a segment
const estimateSegmentProcessingTime = (segmentDurationMs: number): number => {
  const durationSeconds = segmentDurationMs / 1000;
  // Estimate: roughly 8-12 seconds processing per minute of segment
  return Math.max(durationSeconds * 0.2, 8); // Minimum 8 seconds
};



// Generate detailed analysis prompt
const generateDetailedPrompt = (options: any, segment: any): string => {
  const sections = [];
  
  if (options.visualElements) {
    sections.push(`
Visual Elements:
- Scene description (environment, location, objects)
- Subject identification and actions
- Composition analysis (framing, depth, balance)
- Camera movement and techniques
- Key frame descriptions
    `);
  }
  
  if (options.bodyLanguage) {
    sections.push(`
Body Language & Expressions:
- Facial expressions and emotional states
- Gestures and hand movements
- Posture and stance analysis
- Interaction patterns between subjects
    `);
  }
  
  if (options.audioElements) {
    sections.push(`
Audio Elements:
- (Placeholder for future audio analysis)
    `);
  }
  
  return `Analyze this video segment (${Math.round(segment.start_time / 1000)}s - ${Math.round(segment.end_time / 1000)}s) and provide detailed descriptions for the following aspects:

${sections.join('\n')}

Format your response as clear, structured sections with specific details for each aspect.`;
};

// Generate summary and keywords prompt
const generateSummaryPrompt = (options: SummaryAnalysisOptions, segment: any): string => {
  const sections = [];
  
  if (options.coreSummary) {
    sections.push('- Core summary in 1-2 sentences');
  }
  
  if (options.primaryKeywords) {
    sections.push('- Primary keywords (3-5 descriptive words)');
  }
  
  if (options.emotionKeywords) {
    sections.push('- Emotion keywords (1-3 emotional descriptors)');
  }
  
  if (options.visualStyleKeywords) {
    sections.push('- Visual style keywords (1-3 style descriptors)');
  }
  
  if (sections.length === 0) {
    return `Analyze this video segment (${Math.round(segment.start_time / 1000)}s - ${Math.round(segment.end_time / 1000)}s) and provide a general summary with keywords.`;
  }
  
  return `Analyze this video segment (${Math.round(segment.start_time / 1000)}s - ${Math.round(segment.end_time / 1000)}s) and provide:

${sections.join('\n')}

Format your response as structured sections with clear labels for each type of content.`;
};

// Generate categorization tags prompt
const generateCategorizationPrompt = (options: any, segment: any): string => {
  const sections = [];
  
  if (options.thematicCategory) {
    sections.push('thematic_category');
  }
  
  if (options.emotionalIntensity) {
    sections.push('emotional_intensity');
  }
  
  if (options.technicalAttributes) {
    sections.push('technical_attributes');
  }
  
  if (options.practicalUtility) {
    sections.push('practical_utility');
  }
  
  if (options.customTags) {
    sections.push('custom_tags');
  }
  
  return `Analyze this video segment (${Math.round(segment.start_time / 1000)}s - ${Math.round(segment.end_time / 1000)}s) and provide categorization tags in JSON format.

Return ONLY a valid JSON object with the following structure:
{
  ${options.thematicCategory ? '"thematic_category": ["tag1", "tag2", "tag3"],' : ''}
  ${options.emotionalIntensity ? '"emotional_intensity": {"level": "medium", "descriptors": ["tag1", "tag2"]},' : ''}
  ${options.technicalAttributes ? '"technical_attributes": {"shot_type": "close-up", "movement": "static", "lighting": "natural", "color_grading": "warm"},' : ''}
  ${options.practicalUtility ? '"practical_utility": ["opening", "b-roll", "transition"],' : ''}
  ${options.customTags ? '"custom_tags": ["context1", "context2"]' : ''}
}

Guidelines:
- For thematic_category: Provide 2-4 genre/subject matter tags
- For emotional_intensity: Use level (low/medium/high) and 2-3 descriptive tags
- For technical_attributes: Specify shot_type, movement, lighting, color_grading
- For practical_utility: List suitable use cases (opening, ending, b-roll, transition, etc.)
- For custom_tags: Add contextual tags specific to the content

Ensure the JSON is valid and parseable. Do not include any explanations or markdown formatting.`;
};

// Helper function to get a color for a category tag based on its name (for consistent colors)
const getCategoryColor = (category: string): string => {
  // Simple hash function to generate consistent colors
  const hash = category.split('').reduce((acc, char) => {
    return char.charCodeAt(0) + ((acc << 5) - acc);
  }, 0);
  
  // List of tailwind color classes for tags
  const colorClasses = [
    'bg-blue-100 text-blue-800',
    'bg-green-100 text-green-800',
    'bg-yellow-100 text-yellow-800',
    'bg-red-100 text-red-800',
    'bg-purple-100 text-purple-800',
    'bg-pink-100 text-pink-800',
    'bg-indigo-100 text-indigo-800',
    'bg-teal-100 text-teal-800',
  ];
  
  // Use the hash to pick a color
  const index = Math.abs(hash) % colorClasses.length;
  return colorClasses[index];
};

// Define interfaces for the Ads Asset Tagging feature
interface VideoThumbnail {
  id: string;
  title: string;
  thumbnailUrl: string;
  videoPreviewUrl?: string;
  duration: string;
  indexId: string;
  tags?: string[];
  video_objects?: TimestampedLabel[];
  segments?: VideoSegment[];
}

interface VideoTag {
  id: string;
  name: string;
  count: number;
  videoIds: string[];
}

interface Index {
  id: string;
  name: string;
  videoCount: number;
}

interface TagStatistics {
  tag: string;
  count: number;
}

// Define AI models
const AVAILABLE_MODELS = [
  { id: 'qwen-vl-2.5', name: 'Qwen-VL 2.5' },
  { id: 'nova', name: 'Amazon Nova' }
];

// Analysis types for enhanced video content analysis
const ANALYSIS_TYPES = [
  { id: 'scene_description', name: 'Scene Description', description: 'Analyze environment, location, lighting, and atmosphere' },
  { id: 'camera_analysis', name: 'Camera Analysis', description: 'Detect shot types, camera movements, and composition' },
  { id: 'emotion_analysis', name: 'Emotion Analysis', description: 'Analyze facial expressions, mood, and engagement levels' },
  { id: 'object_detection', name: 'Object Detection', description: 'Identify subjects, objects, and their interactions' },
  { id: 'comprehensive', name: 'Comprehensive Analysis', description: 'Full analysis including all aspects' }
];

// Specialized prompts for video content analysis
const ANALYSIS_PROMPTS = {
  scene_description: `Analyze this video segment and provide detailed scene information:
1. Environment type (indoor/outdoor/mixed)
2. Specific location description (office, beach, city, kitchen, etc.)
3. Lighting conditions (daylight, indoor warm, neon, backlit, etc.)
4. Color grading and atmosphere (warm/cool tone, saturation, mood)
5. Visual style keywords (3-5 descriptive words)

Format as JSON: {"environment": "indoor", "location": "modern office", "lighting": "soft daylight", "atmosphere": "professional, clean", "visual_style_keywords": ["modern", "minimalist", "bright"]}`,
  
  camera_analysis: `Analyze camera work and composition in this video segment:
1. Shot type (Close-up, Medium shot, Long shot, Extreme long shot, Over-the-shoulder)
2. Camera movement (Static, Dolly, Pan, Tilt, Zoom, Handheld)
3. Composition analysis (Rule of thirds, framing, subject positioning)
4. Technical quality notes

Format as JSON: {"shot_type": "Medium shot", "camera_movement": "Static with slight pan", "composition_notes": "Subject centered, good depth of field"}`,
  
  emotion_analysis: `Analyze human emotions and behavior in this video segment:
1. For each person visible, identify:
   - Facial expression type (smile, frown, surprise, neutral, focused, etc.)
   - Expression intensity (low/medium/high)
   - Confidence level (0-100%)
2. Overall mood assessment
3. Engagement level evaluation

Format as JSON: {"facial_expressions": [{"type": "smile", "intensity": "high", "confidence": 85}], "overall_mood": "positive, energetic", "engagement_level": "high"}`,
  
  object_detection: `Identify and describe all visible objects and subjects in this video segment:
1. Main subjects (people, animals, vehicles) with descriptions
2. Key objects with confidence levels
3. Subject actions and interactions
4. Spatial relationships between objects

Provide detailed descriptions for advertising context.`,
  
  comprehensive: `Perform comprehensive video content analysis for advertising purposes:
1. Scene description (environment, location, lighting, atmosphere)
2. Camera work (shot type, movement, composition)
3. Human behavior (expressions, emotions, engagement)
4. Objects and subjects (detailed identification)
5. Generate advertising-focused tags:
   - Primary keywords (5-7 nouns/verbs)
   - Emotion keywords (3-5 emotional descriptors)
   - Visual style keywords (3-5 style descriptors)
   - Technical tags (camera, lighting, composition)
   - Utility tags (suitable for opening, transition, B-roll, etc.)

Provide comprehensive analysis suitable for advertising campaign planning.`
};

// Panel Components
const DetailedAnalysisPanel: React.FC<AnalysisPanelProps> = ({ options, onOptionsChange, videoSegments, selectedVideo, onAnalyze, results, isAnalyzing }) => (
  <div className="space-y-4">
    <div className="grid grid-cols-3 gap-4">
      <label className="flex items-center">
        <input
          type="checkbox"
          checked={options.visualElements}
          onChange={(e) => onOptionsChange({...options, visualElements: e.target.checked})}
          className="mr-2"
        />
        <span className="text-sm">Visual Elements</span>
      </label>
      <label className="flex items-center">
        <input
          type="checkbox"
          checked={options.bodyLanguage}
          onChange={(e) => onOptionsChange({...options, bodyLanguage: e.target.checked})}
          className="mr-2"
        />
        <span className="text-sm">Body Language & Expressions</span>
      </label>
      <label className="flex items-center">
        <input
          type="checkbox"
          checked={options.audioElements}
          onChange={(e) => onOptionsChange({...options, audioElements: e.target.checked})}
          className="mr-2"
          disabled
        />
        <span className="text-sm text-gray-400">Audio Elements (Coming Soon)</span>
      </label>
    </div>
    
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 max-h-96 overflow-y-auto">
      {videoSegments.map((segment: any) => (
        <div key={segment.segment_id} className="border border-blue-200 rounded-md p-3">
          <div className="flex justify-between items-center mb-2">
            <h5 className="font-medium text-sm text-blue-800">{segment.segment_name}</h5>
            <button
              onClick={() => onAnalyze(segment.segment_id)}
              disabled={isAnalyzing}
              className={`px-2 py-1 text-xs rounded ${isAnalyzing ? 'bg-gray-300' : 'bg-blue-600 hover:bg-blue-700'} text-white`}
            >
              {isAnalyzing ? 'Analyzing...' : 'Analyze'}
            </button>
          </div>
          <div className="text-xs text-blue-600 mb-2">
            {Math.round(segment.start_time / 1000)}s - {Math.round(segment.end_time / 1000)}s
          </div>
          {results[`${segment.segment_id}_detailed`] && (
            <div className="text-xs text-gray-700 bg-blue-50 p-2 rounded max-h-32 overflow-y-auto">
              <div className="prose prose-xs max-w-none">
                <ReactMarkdown>
                  {results[`${segment.segment_id}_detailed`]}
                </ReactMarkdown>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  </div>
);

const SummaryAnalysisPanel: React.FC<AnalysisPanelProps> = ({ options, onOptionsChange, videoSegments, selectedVideo, onAnalyze, results, isAnalyzing }) => (
  <div className="space-y-4">
    <div className="grid grid-cols-2 gap-4">
      <label className="flex items-center">
        <input
          type="checkbox"
          checked={options.coreSummary}
          onChange={(e) => onOptionsChange({...options, coreSummary: e.target.checked})}
          className="mr-2"
        />
        <span className="text-sm">Core Summary (1-2 sentences)</span>
      </label>
      <label className="flex items-center">
        <input
          type="checkbox"
          checked={options.primaryKeywords}
          onChange={(e) => onOptionsChange({...options, primaryKeywords: e.target.checked})}
          className="mr-2"
        />
        <span className="text-sm">Primary Keywords (3-5 words)</span>
      </label>
      <label className="flex items-center">
        <input
          type="checkbox"
          checked={options.emotionKeywords}
          onChange={(e) => onOptionsChange({...options, emotionKeywords: e.target.checked})}
          className="mr-2"
        />
        <span className="text-sm">Emotion Keywords (1-3 words)</span>
      </label>
      <label className="flex items-center">
        <input
          type="checkbox"
          checked={options.visualStyleKeywords}
          onChange={(e) => onOptionsChange({...options, visualStyleKeywords: e.target.checked})}
          className="mr-2"
        />
        <span className="text-sm">Visual Style Keywords (1-3 words)</span>
      </label>
    </div>
    
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 max-h-96 overflow-y-auto">
      {videoSegments.map((segment: any) => (
        <div key={segment.segment_id} className="border border-green-200 rounded-md p-3">
          <div className="flex justify-between items-center mb-2">
            <h5 className="font-medium text-sm text-green-800">{segment.segment_name}</h5>
            <button
              onClick={() => onAnalyze(segment.segment_id)}
              disabled={isAnalyzing}
              className={`px-2 py-1 text-xs rounded ${isAnalyzing ? 'bg-gray-300' : 'bg-green-600 hover:bg-green-700'} text-white`}
            >
              {isAnalyzing ? 'Analyzing...' : 'Analyze'}
            </button>
          </div>
          <div className="text-xs text-green-600 mb-2">
            {Math.round(segment.start_time / 1000)}s - {Math.round(segment.end_time / 1000)}s
          </div>
          {results[`${segment.segment_id}_summary`] && (
            <div className="text-xs text-gray-700 bg-green-50 p-2 rounded max-h-32 overflow-y-auto">
              <div className="prose prose-xs max-w-none">
                <ReactMarkdown>
                  {results[`${segment.segment_id}_summary`]}
                </ReactMarkdown>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  </div>
);

const CategorizationAnalysisPanel: React.FC<AnalysisPanelProps> = ({ options, onOptionsChange, videoSegments, selectedVideo, onAnalyze, results, isAnalyzing }) => (
  <div className="space-y-4">
    <div className="grid grid-cols-2 gap-4">
      <label className="flex items-center">
        <input
          type="checkbox"
          checked={options.thematicCategory}
          onChange={(e) => onOptionsChange({...options, thematicCategory: e.target.checked})}
          className="mr-2"
        />
        <span className="text-sm">Thematic Category</span>
      </label>
      <label className="flex items-center">
        <input
          type="checkbox"
          checked={options.emotionalIntensity}
          onChange={(e) => onOptionsChange({...options, emotionalIntensity: e.target.checked})}
          className="mr-2"
        />
        <span className="text-sm">Emotional Intensity</span>
      </label>
      <label className="flex items-center">
        <input
          type="checkbox"
          checked={options.technicalAttributes}
          onChange={(e) => onOptionsChange({...options, technicalAttributes: e.target.checked})}
          className="mr-2"
        />
        <span className="text-sm">Technical Attributes</span>
      </label>
      <label className="flex items-center">
        <input
          type="checkbox"
          checked={options.practicalUtility}
          onChange={(e) => onOptionsChange({...options, practicalUtility: e.target.checked})}
          className="mr-2"
        />
        <span className="text-sm">Practical Utility Tags</span>
      </label>
    </div>
    
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 max-h-96 overflow-y-auto">
      {videoSegments.map((segment: any) => (
        <div key={segment.segment_id} className="border border-purple-200 rounded-md p-3">
          <div className="flex justify-between items-center mb-2">
            <h5 className="font-medium text-sm text-purple-800">{segment.segment_name}</h5>
            <button
              onClick={() => onAnalyze(segment.segment_id)}
              disabled={isAnalyzing}
              className={`px-2 py-1 text-xs rounded ${isAnalyzing ? 'bg-gray-300' : 'bg-purple-600 hover:bg-purple-700'} text-white`}
            >
              {isAnalyzing ? 'Analyzing...' : 'Analyze'}
            </button>
          </div>
          <div className="text-xs text-purple-600 mb-2">
            {Math.round(segment.start_time / 1000)}s - {Math.round(segment.end_time / 1000)}s
          </div>
          {results[`${segment.segment_id}_categorization`] && (
            <div className="text-xs text-gray-700 bg-purple-50 p-2 rounded max-h-32 overflow-y-auto">
              <div className="prose prose-xs max-w-none">
                <ReactMarkdown>
                  {results[`${segment.segment_id}_categorization`]}
                </ReactMarkdown>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  </div>
);

export default function AdsTaggingPage() {
  const { state } = useAuth()
  const searchParams = useSearchParams()
  const [videos, setVideos] = useState<VideoThumbnail[]>([])
  const [indexes, setIndexes] = useState<Index[]>([])
  const [selectedVideo, setSelectedVideo] = useState<VideoThumbnail | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isLoadingVideos, setIsLoadingVideos] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [responseText, setResponseText] = useState('')
  const [selectedIndexId, setSelectedIndexId] = useState<string | null>(null)
  const [hasError, setHasError] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string>('')
  const [isDropdownOpen, setIsDropdownOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const [selectedModel] = useState<string>('qwen-vl-2.5')
  const videoRef = useRef<HTMLVideoElement>(null)
  const [isVideoModalOpen, setIsVideoModalOpen] = useState(false)
  const [tags, setTags] = useState<VideoTag[]>([])
  const [tagInput, setTagInput] = useState<string>('')
  const [tagStatistics, setTagStatistics] = useState<TagStatistics[]>([])
  const [selectedVideoTags, setSelectedVideoTags] = useState<string[]>([])
  const chartRef = useRef<HTMLCanvasElement>(null)
  const chartInstanceRef = useRef<Chart>()
  const [activePanel, setActivePanel] = useState<'operational' | 'analytics'>('operational')
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [appliedTagFilters, setAppliedTagFilters] = useState<string[]>([])
  // Add state for extracted tags from video_objects
  const [allTags, setAllTags] = useState<{tag: string, count: number, type: 'category' | 'alias'}[]>([])
  
  // Enhanced video analysis states
  const [videoAnalysis, setVideoAnalysis] = useState<VideoAnalysisResult | null>(null)
  const [selectedAnalysisType, setSelectedAnalysisType] = useState<string>('comprehensive')
  const [analysisProgress, setAnalysisProgress] = useState<{
    current: number;
    total: number;
    currentSegment?: string;
    stage: string;
  }>({ current: 0, total: 0, stage: 'idle' })
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [analyzedSegments, setAnalyzedSegments] = useState<AnalyzedSegment[]>([])
  const [showSegmentDetails, setShowSegmentDetails] = useState(false)
  const [selectedSegment, setSelectedSegment] = useState<AnalyzedSegment | null>(null)
  
  // Video segmentation states
  const [videoSegments, setVideoSegments] = useState<any[]>([])
  const [isLoadingSegmentation, setIsLoadingSegmentation] = useState(false)
  const [segmentationError, setSegmentationError] = useState<string | null>(null)
  const [isSegmentPlayerOpen, setIsSegmentPlayerOpen] = useState(false)
  const [playingSegment, setPlayingSegment] = useState<any>(null)
  
  // Polling management
  const pollingTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  
  // Progress tracking
  const [processingProgress, setProcessingProgress] = useState(0)
  const processingStartTime = useRef<number | null>(null)
  
  // Dynamic analysis panels
  const [selectedAnalysisPanel, setSelectedAnalysisPanel] = useState<'detailed' | 'summary' | 'categorization' | null>(null)
  const [analysisOptions, setAnalysisOptions] = useState<{
    detailed: DetailedAnalysisOptions;
    summary: SummaryAnalysisOptions;
    categorization: CategorizationAnalysisOptions;
  }>({
    detailed: {
      visualElements: true,
      bodyLanguage: true,
      audioElements: false // Placeholder for now
    },
    summary: {
      coreSummary: true,
      primaryKeywords: true,
      emotionKeywords: true,
      visualStyleKeywords: true
    },
    categorization: {
      thematicCategory: true,
      emotionalIntensity: true,
      technicalAttributes: true,
      practicalUtility: true,
      customTags: false
    }
  })
  const [segmentAnalysisResults, setSegmentAnalysisResults] = useState<{[key: string]: any}>({})
  const [isAnalyzingSegment, setIsAnalyzingSegment] = useState(false)
  
  // Batch segment selection states
  const [selectedSegments, setSelectedSegments] = useState<string[]>([])
  const [selectAllSegments, setSelectAllSegments] = useState(false)
  
  // Progress tracking for batch analysis
  const [batchAnalysisProgress, setBatchAnalysisProgress] = useState<{
    current: number;
    total: number;
    currentSegmentId?: string;
    estimatedTimeRemaining?: number;
  }>({ current: 0, total: 0 })
  
  // Collapsible segments state
  const [collapsedSegments, setCollapsedSegments] = useState<Set<string>>(new Set())

  // Initialize selectedIndexId from URL parameter and fetch indexes on mount
  useEffect(() => {
    const indexParam = searchParams.get('index');
    if (indexParam) {
      setSelectedIndexId(indexParam);
    }
    
    
    // Fetch available indexes
    const fetchIndexes = async () => {
      try {
        setIsLoading(true); // Ensure we're in loading state
        const response = await fetch(`${API_ENDPOINT}/indexes`, {
          headers: {
            'Content-Type': 'application/json',
            ...(state.session ? { 'Authorization': `Bearer ${state.session.token}` } : {})
          }
        });
        
        if (!response.ok) {
          throw new Error(`Failed to fetch indexes: ${response.statusText}`);
        }
        
        const data = await response.json();
        
        // Create a map to deduplicate indexes and preserve video counts
        const indexMap = new Map();
        
        // First pass: collect all unique indexIds
        data.forEach((item: any) => {
          if (!indexMap.has(item.indexId)) {
            // Add enhanced index information
            indexMap.set(item.indexId, {
              id: item.indexId,
              name: item.indexId.split('-')[0] || item.indexId,
              videoCount: item.videoCount || 0
            });
          } else if (item.videoCount) {
            // If this entry has a videoCount and we've already seen this indexId,
            // update the videoCount in our map
            const existing = indexMap.get(item.indexId);
            existing.videoCount = item.videoCount;
            indexMap.set(item.indexId, existing);
          }
        });
        
        // Convert the map back to an array
        const formattedIndexes = Array.from(indexMap.values());
        
        // Sort indexes alphabetically by name
        formattedIndexes.sort((a, b) => a.name.localeCompare(b.name));
        
        setIndexes(formattedIndexes);
        setIsLoading(false); // Set loading to false after indexes are fetched
      } catch (error) {
        console.error('Error fetching indexes:', error);
        setError(error instanceof Error ? error.message : 'Failed to load indexes');
        setIsLoading(false); // Set loading to false even if there's an error
      }
    };
    
    fetchIndexes();
  }, [searchParams, state.session, API_ENDPOINT]);
  

  // Fetch videos when selectedIndexId changes
  useEffect(() => {
    const fetchVideos = async () => {
      if (!selectedIndexId) {
        setVideos([]);
        return;
      }
      
      try {
        setIsLoadingVideos(true);
        // Build query parameters with selectedIndexId
        let queryParams = '';
        if (selectedIndexId) {
          queryParams = `?index=${selectedIndexId}`;
        }
        
        const response = await fetch(`${API_ENDPOINT}/videos${queryParams}`, {
          headers: {
            'Content-Type': 'application/json',
            ...(state.session ? { 'Authorization': `Bearer ${state.session.token}` } : {})
          }
        });
        
        if (!response.ok) {
          if (response.status === 404) {
            // 404 could mean "no videos found" in some API designs - treat as empty array
            setVideos([]);
            return;
          }
          throw new Error(`Failed to fetch videos: ${response.statusText}`);
        }
        
        const data = await response.json();
        // Transform the videos to the format we need
        const videoThumbnails: VideoThumbnail[] = (data.videos || []).map((video: VideoResult) => ({
          id: video.id,
          title: video.title || 'Untitled Video',
          thumbnailUrl: video.videoThumbnailUrl || '',
          videoPreviewUrl: video.videoPreviewUrl || '',
          duration: video.videoDuration || '00:00',
          indexId: video.indexId || 'videos',
          tags: video.tags || [],
          video_objects: (video as any).video_objects || [],
          segments: (video as any).segments || []
        }));
        
        setVideos(videoThumbnails);
        
        // Extract all tags from video_objects
        const extractedTags = extractAllTags(videoThumbnails);
        setAllTags(extractedTags);
        
        // Update tag statistics based on videos (keeping for compatibility)
        updateTagStatistics(videoThumbnails);
        
        // Reset tag filters when changing index
        setSelectedTags([]);
        setAppliedTagFilters([]);
      } catch (error) {
        console.error('Error fetching videos:', error);
        setError(error instanceof Error ? error.message : 'Failed to load videos');
      } finally {
        setIsLoadingVideos(false);
      }
    };

    fetchVideos();
  }, [selectedIndexId, state.session, API_ENDPOINT]);

  // Update tag statistics
  const updateTagStatistics = (videoCollection: VideoThumbnail[]) => {
    const tagCounts: Record<string, number> = {};
    const tagToVideos: Record<string, string[]> = {};
    
    videoCollection.forEach(video => {
      if (video.tags) {
        video.tags.forEach(tag => {
          tagCounts[tag] = (tagCounts[tag] || 0) + 1;
          
          if (!tagToVideos[tag]) {
            tagToVideos[tag] = [];
          }
          
          if (!tagToVideos[tag].includes(video.id)) {
            tagToVideos[tag].push(video.id);
          }
        });
      }
    });
    
    const stats: TagStatistics[] = Object.keys(tagCounts).map(tag => ({
      tag,
      count: tagCounts[tag]
    })).sort((a, b) => b.count - a.count);
    
    setTagStatistics(stats);
    
    // Create VideoTag objects
    const videoTags: VideoTag[] = Object.keys(tagToVideos).map(tagName => ({
      id: tagName.toLowerCase().replace(/\s+/g, '-'),
      name: tagName,
      count: tagCounts[tagName],
      videoIds: tagToVideos[tagName]
    }));
    
    setTags(videoTags);
  };

  // Update the chart when tag statistics change
  useEffect(() => {
    if (chartRef.current && activePanel === 'analytics' && tagStatistics.length > 0) {
      // Destroy previous chart if it exists
      if (chartInstanceRef.current) {
        chartInstanceRef.current.destroy();
      }
      
      // Get the top 15 tags
      const topTags = tagStatistics.slice(0, 15);
      
      // Create new chart
      const ctx = chartRef.current.getContext('2d');
      if (ctx) {
        chartInstanceRef.current = new Chart(ctx, {
          type: 'bar',
          data: {
            labels: topTags.map(stat => stat.tag),
            datasets: [{
              label: 'Tag Frequency',
              data: topTags.map(stat => stat.count),
              backgroundColor: 'rgba(79, 70, 229, 0.7)',
              borderColor: 'rgba(79, 70, 229, 1)',
              borderWidth: 1
            }]
          },
          options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            scales: {
              x: {
                beginAtZero: true,
                title: {
                  display: true,
                  text: 'Count'
                }
              },
              y: {
                title: {
                  display: true,
                  text: 'Tags'
                }
              }
            }
          }
        });
      }
    }
  }, [tagStatistics, activePanel]);

  // Handle video selection
  const handleVideoSelect = (video: VideoThumbnail) => {
    setSelectedVideo(video);
    setSelectedVideoTags(video.tags || []);
    // Reset segmentation state when a new video is selected
    setVideoSegments([]);
    setSelectedSegment(null);
    setSegmentationError(null);
  };

  // Handle index selection
  const handleIndexSelect = (indexId: string) => {
    setSelectedIndexId(indexId);
    setIsDropdownOpen(false);
  };

  // Generate video summary for the selected video using async polling
  const generateVideoSummary = async () => {
    if (!selectedVideo) {
      setError('Please select a video first for summary generation');
      return;
    }
    
    try {
      setIsProcessing(true);
      setError(null);
      setResponseText('');
      setProcessingProgress(0);
      
      // Clear any existing polling
      if (pollingTimeoutRef.current) {
        clearTimeout(pollingTimeoutRef.current);
        pollingTimeoutRef.current = null;
      }
      
      // Initialize progress tracking
      processingStartTime.current = Date.now();
      const estimatedDuration = estimateProcessingTime(selectedVideo.duration);
      
      // Submit the video analysis job
      const initResponse = await fetch(`${API_ENDPOINT}/videos/ask/init`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(state.session ? { 'Authorization': `Bearer ${state.session.token}` } : {})
        },
        body: JSON.stringify({
          videoId: selectedVideo.id,
          indexId: selectedVideo.indexId,
          question: "Please provide a comprehensive video summary in markdown format. Include: ## Executive Summary (2-3 sentences overview), ## Key Content (main topics and themes), ## Visual Elements (notable scenes, composition, style), ## Audience & Context (target audience and use cases), ## Technical Details (duration, pacing, production quality), and ## Recommendations (suggested applications or improvements). Use clear headings and bullet points for easy reading.",
          model: selectedModel,
          bypassPromptEnhancement: true  // Bypass enhancement for direct analysis
        })
      });
      
      if (!initResponse.ok) {
        throw new Error(`Failed to initialize video summary generation: ${initResponse.statusText}`);
      }
      
      const { sessionId } = await initResponse.json();
      
      // Start polling for results
      const pollForResults = async () => {
        try {
          const statusResponse = await fetch(`${API_ENDPOINT}/videos/ask/status/${sessionId}`, {
            method: 'GET',
            headers: {
              'Content-Type': 'application/json',
              ...(state.session ? { 'Authorization': `Bearer ${state.session.token}` } : {})
            }
          });
          
          if (!statusResponse.ok) {
            throw new Error(`Failed to check status: ${statusResponse.statusText}`);
          }
          
          const statusData = await statusResponse.json();
          
          if (statusData.status === 'completed') {
            // Processing completed
            setIsProcessing(false);
            setProcessingProgress(100);
            const fullResponse = statusData.result || '';
            setResponseText(fullResponse);
            
            // For video summary, we just store the full markdown response
            // No need to parse hashtags since we're now generating comprehensive summaries
            console.log('Video summary generated successfully');
          } else if (statusData.status === 'error') {
            // Processing failed
            setIsProcessing(false);
            setProcessingProgress(0);
            setError(statusData.error || 'Video summary generation failed');
            setErrorMessage(statusData.error || 'Video summary generation failed');
            setHasError(true);
          } else if (statusData.status === 'processing') {
            // Still processing, update progress
            if (processingStartTime.current) {
              const elapsedTime = (Date.now() - processingStartTime.current) / 1000;
              const estimatedDuration = estimateProcessingTime(selectedVideo.duration);
              const progress = Math.min((elapsedTime / estimatedDuration) * 100, 90); // Cap at 90% until completion
              
              setProcessingProgress(progress);
            }
            
            // Show partial results if available
            if (statusData.partialResult) {
              setResponseText(statusData.partialResult);
            }
            // Continue polling
            pollingTimeoutRef.current = setTimeout(pollForResults, 2000); // Poll every 2 seconds
          } else {
            // Still pending, continue polling
            pollingTimeoutRef.current = setTimeout(pollForResults, 2000); // Poll every 2 seconds
          }
        } catch (pollError) {
          console.error('Error polling for results:', pollError);
          setIsProcessing(false);
          setError(pollError instanceof Error ? pollError.message : 'Failed to check processing status');
        }
      };
      
      // Start polling
      pollForResults();
      
    } catch (error) {
      console.error('Error generating video summary:', error);
      setError(error instanceof Error ? error.message : 'Failed to generate video summary');
      setIsProcessing(false);
    }
  };

  // Load video segmentation preview
  const loadVideoSegmentation = async () => {
    if (!selectedVideo) {
      setSegmentationError('Please select a video first');
      return;
    }
    
    try {
      setIsLoadingSegmentation(true);
      setSegmentationError(null);
      
      // Call the video segmentation preview endpoint
      // The backend now always generates fresh pre-signed URLs to prevent expiration
      const response = await fetch(`${API_ENDPOINT}/videos/segmentation/${selectedVideo.id}/${selectedVideo.indexId}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          ...(state.session ? { 'Authorization': `Bearer ${state.session.token}` } : {})
        }
      });
      
      if (!response.ok) {
        throw new Error(`Failed to load video segmentation: ${response.statusText}`);
      }
      
      const segmentationData = await response.json();
      setVideoSegments(segmentationData.segments || []);
      
    } catch (error) {
      console.error('Error loading video segmentation:', error);
      setSegmentationError(error instanceof Error ? error.message : 'Failed to load video segmentation');
    } finally {
      setIsLoadingSegmentation(false);
    }
  };

  // Handle segment playback
  const playSegment = (segment: any) => {
    setPlayingSegment(segment);
    setIsSegmentPlayerOpen(true);
  };

  // Batch analyze multiple segments with progress tracking
  const batchAnalyzeSegments = async () => {
    if (selectedSegments.length === 0 || !selectedVideo || !selectedAnalysisPanel) return;
    
    setIsAnalyzingSegment(true);
    setBatchAnalysisProgress({ current: 0, total: selectedSegments.length });
    
    try {
      // Calculate estimated total time
      const totalEstimatedTime = selectedSegments.reduce((total, segmentId) => {
        const segment = videoSegments.find(s => s.segment_id === segmentId);
        if (segment) {
          const duration = (segment.end_time || 0) - (segment.start_time || 0);
          return total + estimateSegmentProcessingTime(duration);
        }
        return total + 8; // Default 8 seconds if segment not found
      }, 0);

      let processedCount = 0;
      const startTime = Date.now();

      // Process segments sequentially to avoid overwhelming the backend
      for (const segmentId of selectedSegments) {
        const segment = videoSegments.find(s => s.segment_id === segmentId);
        const segmentDuration = segment ? (segment.end_time || 0) - (segment.start_time || 0) : 0;
        const estimatedTime = estimateSegmentProcessingTime(segmentDuration);
        
        // Update progress
        setBatchAnalysisProgress({
          current: processedCount,
          total: selectedSegments.length,
          currentSegmentId: segmentId,
          estimatedTimeRemaining: Math.max(0, totalEstimatedTime - ((Date.now() - startTime) / 1000))
        });

        // Process the segment
        await analyzeSegmentInternal(segmentId, selectedAnalysisPanel);
        
        processedCount++;
        
        // Add delay between requests to prevent backend overload (2-3 seconds)
        if (processedCount < selectedSegments.length) {
          await new Promise(resolve => setTimeout(resolve, 2500));
        }
      }

      // Final progress update
      setBatchAnalysisProgress({
        current: selectedSegments.length,
        total: selectedSegments.length,
        estimatedTimeRemaining: 0
      });

    } catch (error) {
      console.error('Error in batch analysis:', error);
      setError(error instanceof Error ? error.message : 'Failed to analyze segments');
    } finally {
      setIsAnalyzingSegment(false);
      // Reset progress after a short delay
      setTimeout(() => {
        setBatchAnalysisProgress({ current: 0, total: 0 });
      }, 2000);
    }
  };
  
  // Toggle segment selection
  const toggleSegmentSelection = (segmentId: string) => {
    setSelectedSegments(prev => {
      if (prev.includes(segmentId)) {
        const newSelection = prev.filter(id => id !== segmentId);
        setSelectAllSegments(newSelection.length === videoSegments.length);
        return newSelection;
      } else {
        const newSelection = [...prev, segmentId];
        setSelectAllSegments(newSelection.length === videoSegments.length);
        return newSelection;
      }
    });
  };

  // Toggle segment collapse state
  const toggleSegmentCollapse = (segmentId: string) => {
    setCollapsedSegments(prev => {
      const newSet = new Set(prev);
      if (newSet.has(segmentId)) {
        newSet.delete(segmentId);
      } else {
        newSet.add(segmentId);
      }
      return newSet;
    });
  };

  // Parse and render structured analysis results
  const renderStructuredAnalysis = (result: string, analysisType: string) => {
    if (analysisType === 'categorization') {
      try {
        const parsed = JSON.parse(result);
        return (
          <div className="space-y-3">
            {parsed.thematic_category && (
              <div>
                <h6 className="text-xs font-semibold text-gray-700 mb-1">Thematic Category</h6>
                <div className="flex flex-wrap gap-1">
                  {parsed.thematic_category.map((tag: string, index: number) => (
                    <span key={index} className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            )}
            
            {parsed.emotional_intensity && (
              <div>
                <h6 className="text-xs font-semibold text-gray-700 mb-1">Emotional Intensity</h6>
                <div className="flex items-center space-x-2">
                  <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                    parsed.emotional_intensity.level === 'high' ? 'bg-red-100 text-red-800' :
                    parsed.emotional_intensity.level === 'medium' ? 'bg-yellow-100 text-yellow-800' :
                    'bg-green-100 text-green-800'
                  }`}>
                    {parsed.emotional_intensity.level}
                  </span>
                  <div className="flex flex-wrap gap-1">
                    {parsed.emotional_intensity.descriptors?.map((desc: string, index: number) => (
                      <span key={index} className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-purple-100 text-purple-800">
                        {desc}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            )}
            
            {parsed.technical_attributes && (
              <div>
                <h6 className="text-xs font-semibold text-gray-700 mb-1">Technical Attributes</h6>
                <div className="grid grid-cols-2 gap-2">
                  {Object.entries(parsed.technical_attributes).map(([key, value]) => (
                    <div key={key} className="flex items-center space-x-2">
                      <span className="text-xs text-gray-500 capitalize">{key.replace('_', ' ')}:</span>
                      <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
                        {value as string}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            
            {parsed.practical_utility && (
              <div>
                <h6 className="text-xs font-semibold text-gray-700 mb-1">Practical Utility</h6>
                <div className="flex flex-wrap gap-1">
                  {parsed.practical_utility.map((tag: string, index: number) => (
                    <span key={index} className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-indigo-100 text-indigo-800">
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            )}
            
            {parsed.custom_tags && (
              <div>
                <h6 className="text-xs font-semibold text-gray-700 mb-1">Custom Tags</h6>
                <div className="flex flex-wrap gap-1">
                  {parsed.custom_tags.map((tag: string, index: number) => (
                    <span key={index} className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-teal-100 text-teal-800">
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      } catch (error) {
        // Fallback to markdown if JSON parsing fails
        return (
          <div className="prose prose-xs max-w-none">
            <ReactMarkdown>{result}</ReactMarkdown>
          </div>
        );
      }
    } else {
      // For detailed and summary analysis, use markdown
      return (
        <div className="prose prose-xs max-w-none">
          <ReactMarkdown>{result}</ReactMarkdown>
        </div>
      );
    }
  };

  // Export analysis results
  const exportAnalysisResults = () => {
    const results: any = {
      exportDate: new Date().toISOString(),
      videoId: selectedVideo?.id,
      videoTitle: selectedVideo?.title,
      analysisType: selectedAnalysisPanel,
      totalSegments: selectedSegments.length,
      segments: []
    };

    // Collect all analysis results for selected segments
    selectedSegments.forEach(segmentId => {
      const segment = videoSegments.find(s => s.segment_id === segmentId);
      const analysisResult = segmentAnalysisResults[`${segmentId}_${selectedAnalysisPanel}`];
      
      if (segment && analysisResult) {
        results.segments.push({
          segment_id: segmentId,
          segment_name: segment.segment_name,
          start_time: segment.start_time,
          end_time: segment.end_time,
          duration: segment.end_time - segment.start_time,
          analysis_result: analysisResult
        });
      }
    });

    // Create and download JSON file
    const blob = new Blob([JSON.stringify(results, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `video-analysis-${selectedVideo?.id}-${selectedAnalysisPanel}-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Internal segment analysis function (renamed to avoid conflict with batch function)
  const analyzeSegmentInternal = async (segmentId: string, analysisType: 'detailed' | 'summary' | 'categorization') => {
    if (!selectedVideo) return;
    
    const segment = videoSegments.find(s => s.segment_id === segmentId);
    if (!segment) return;
    
    // Don't set isAnalyzingSegment here as batch function handles it
    return new Promise<void>(async (resolve, reject) => {
      try {
        await performSegmentAnalysis(segmentId, analysisType);
        resolve();
      } catch (error) {
        reject(error);
      }
    });
  };

  // Analyze individual segment (for direct calls)
  const analyzeSegment = async (segmentId: string, analysisType: 'detailed' | 'summary' | 'categorization') => {
    setIsAnalyzingSegment(true);
    try {
      await analyzeSegmentInternal(segmentId, analysisType);
    } finally {
      setIsAnalyzingSegment(false);
    }
  };
  
  // Core segment analysis logic
  const performSegmentAnalysis = async (segmentId: string, analysisType: 'detailed' | 'summary' | 'categorization') => {
    if (!selectedVideo) return;
    
    const segment = videoSegments.find(s => s.segment_id === segmentId);
    if (!segment) return;
    
    try {
      // Generate specialized prompt based on analysis type
      let prompt = '';
      
      switch (analysisType) {
        case 'detailed':
          prompt = generateDetailedPrompt(analysisOptions.detailed, segment);
          break;
        case 'summary':
          prompt = generateSummaryPrompt(analysisOptions.summary, segment);
          break;
        case 'categorization':
          prompt = generateCategorizationPrompt(analysisOptions.categorization, segment);
          break;
      }
      
      // Submit analysis job
      const initResponse = await fetch(`${API_ENDPOINT}/videos/ask/init`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(state.session ? { 'Authorization': `Bearer ${state.session.token}` } : {})
        },
        body: JSON.stringify({
          videoId: selectedVideo.id,
          indexId: selectedVideo.indexId,
          question: prompt,
          model: selectedModel,
          bypassPromptEnhancement: true,
          segmentId: segmentId,
          analysisType: analysisType
        })
      });
      
      if (!initResponse.ok) {
        throw new Error(`Failed to initialize segment analysis: ${initResponse.statusText}`);
      }
      
      const { sessionId } = await initResponse.json();
      
      // Poll for results
      const pollSegmentResults = async () => {
        try {
          const statusResponse = await fetch(`${API_ENDPOINT}/videos/ask/status/${sessionId}`, {
            method: 'GET',
            headers: {
              'Content-Type': 'application/json',
              ...(state.session ? { 'Authorization': `Bearer ${state.session.token}` } : {})
            }
          });
          
          if (!statusResponse.ok) {
            throw new Error(`Failed to check segment analysis status: ${statusResponse.statusText}`);
          }
          
          const statusData = await statusResponse.json();
          
          if (statusData.status === 'completed') {
            const result = statusData.result || '';
            
            // Store result
            setSegmentAnalysisResults(prev => ({
              ...prev,
              [`${segmentId}_${analysisType}`]: result
            }));
          } else if (statusData.status === 'error') {
            throw new Error(statusData.error || 'Segment analysis failed');
          } else {
            // Continue polling
            setTimeout(pollSegmentResults, 2000);
          }
        } catch (pollError) {
          console.error('Error polling segment results:', pollError);
          throw pollError;
        }
      };
      
      pollSegmentResults();
      
    } catch (error) {
      console.error('Error analyzing segment:', error);
      throw error;
    }
  };

  // Handle adding a custom tag to the selected video
  const handleAddTag = () => {
    if (!selectedVideo || !tagInput.trim()) {
      return;
    }
    
    const formattedTag = tagInput.trim().startsWith('#') ? tagInput.trim() : `#${tagInput.trim()}`;
    
    if (selectedVideoTags.includes(formattedTag)) {
      return; // Tag already exists
    }
    
    // Add tag to selected video tags
    const newTags = [...selectedVideoTags, formattedTag];
    setSelectedVideoTags(newTags);
    
    // Update the video in the videos array
    const updatedVideos = videos.map(video => {
      if (video.id === selectedVideo.id) {
        return {
          ...video,
          tags: newTags
        };
      }
      return video;
    });
    
    setVideos(updatedVideos);
    
    // Update tag statistics
    updateTagStatistics(updatedVideos);
    
    // Clear the input
    setTagInput('');
  };

  // Handle removing a tag from the selected video
  const handleRemoveTag = (tag: string) => {
    if (!selectedVideo) {
      return;
    }
    
    // Remove tag from selected video tags
    const newTags = selectedVideoTags.filter(t => t !== tag);
    setSelectedVideoTags(newTags);
    
    // Update the video in the videos array
    const updatedVideos = videos.map(video => {
      if (video.id === selectedVideo.id) {
        return {
          ...video,
          tags: newTags
        };
      }
      return video;
    });
    
    setVideos(updatedVideos);
    
    // Update tag statistics
    updateTagStatistics(updatedVideos);
  };

  // Export tags as JSON
  const exportTags = () => {
    const videosToExport = appliedTagFilters.length > 0 ? filteredVideos : videos;
    const tagsData = {
      exportDate: new Date().toISOString(),
      indexId: selectedIndexId,
      appliedFilters: appliedTagFilters,
      videos: videosToExport.map(video => ({
        id: video.id,
        title: video.title,
        tags: video.tags || []
      })),
      tags: tags.map(tag => ({
        name: tag.name,
        count: tag.count,
        videoIds: tag.videoIds
      }))
    };
    
    const blob = new Blob([JSON.stringify(tagsData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ads-tags-${selectedIndexId}-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Filter videos based on applied tag filters using video_objects
  const filteredVideos = useMemo(() => {
    if (appliedTagFilters.length === 0) {
      return videos;
    }
    
    return videos.filter(video => {
      // Cast to ExtendedVideoResult to access video_objects
      const extendedVideo = video as any as ExtendedVideoResult;
      if (!extendedVideo.video_objects) return false;
      
      // Extract all categories and aliases from this video
      const categories = extractCategories(extendedVideo.video_objects);
      const aliases = extractAliases(extendedVideo.video_objects);
      const allVideoTags = [...categories, ...aliases];
      
      // Check if any of the applied filters match this video's tags
      return appliedTagFilters.some(filter => allVideoTags.includes(filter));
    });
  }, [videos, appliedTagFilters]);

  // Handle tag selection
  const toggleTagSelection = (tag: string) => {
    if (selectedTags.includes(tag)) {
      setSelectedTags(prev => prev.filter(t => t !== tag));
    } else {
      setSelectedTags(prev => [...prev, tag]);
    }
  };

  // Apply selected tags as filters
  const applyTagFilters = () => {
    setAppliedTagFilters([...selectedTags]);
  };

  // Clear all tag filters
  const clearTagFilters = () => {
    setSelectedTags([]);
    setAppliedTagFilters([]);
  };

  // Handle click outside to close dropdowns
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false);
      }
    }
    
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  // Cleanup polling when component unmounts
  useEffect(() => {
    return () => {
      if (pollingTimeoutRef.current) {
        clearTimeout(pollingTimeoutRef.current);
      }
    };
  }, []);

  // Loading state
  if (isLoading) {
    return (
      <div className="container mx-auto p-4">
        <h1 className="text-2xl font-bold mb-6">Ads Asset Tagging</h1>
        <div className="flex items-center justify-center h-64">
          <div className="flex flex-col items-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-500 mb-4"></div>
            <div className="text-gray-600">Loading videos...</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-4 pb-6 min-h-screen bg-gray-50">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold bg-gradient-to-r from-purple-700 to-indigo-500 bg-clip-text text-transparent">
          Ads Asset Tagging
        </h1>
        
        <div className="flex bg-gray-100 p-1 rounded-lg border border-gray-200">
          <button 
            className={`px-4 py-2 rounded-md font-semibold border-2 transition-all duration-300 transform ${activePanel === 'operational' 
              ? 'bg-purple-600 text-white border-purple-600 shadow-lg scale-105' 
              : 'bg-white text-gray-700 border-gray-300 hover:border-purple-400 hover:bg-purple-50 hover:text-purple-700 hover:scale-102'}`}
            onClick={() => setActivePanel('operational')}
          >
            Operational
          </button>
          <button 
            className={`px-4 py-2 rounded-md font-semibold border-2 transition-all duration-300 transform ml-1 ${activePanel === 'analytics' 
              ? 'bg-indigo-600 text-white border-indigo-600 shadow-lg scale-105' 
              : 'bg-white text-gray-700 border-gray-300 hover:border-indigo-400 hover:bg-indigo-50 hover:text-indigo-700 hover:scale-102'}`}
            onClick={() => setActivePanel('analytics')}
          >
            Analytics
          </button>
        </div>
      </div>
      
      {error && (
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
          {error}
        </div>
      )}
      
      {/* Top Row - Three fixed-height components */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6 h-96">
        {activePanel === 'operational' ? (
          /* Operational Panel */
          <>
            {/* Left Component - Index Selection and Tag Filtering */}
            <div className="bg-white rounded-lg shadow-md p-6 flex flex-col h-96 overflow-hidden">
              {/* Index Selection */}
              <div className="mb-6">
                <h2 className="text-lg font-medium mb-4 text-blue-900">Select an Index</h2>
                
                {indexes.length === 0 ? (
                  <div className="bg-gray-100 p-4 rounded-md text-gray-600">
                    No indexes found. <a href="/create" className="text-purple-600 hover:underline">Create your first index</a>
                  </div>
                ) : (
                  <div className="relative" ref={dropdownRef}>
                    <div 
                      className="block w-full pl-3 pr-10 py-2 text-base border border-gray-300 focus:outline-none focus:ring-purple-500 focus:border-purple-500 rounded-md cursor-pointer"
                      onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                    >
                      <div className="flex justify-between items-center">
                        <span className="text-sm">{selectedIndexId ? indexes.find(idx => idx.id === selectedIndexId)?.name || 'Select an index' : 'Select an index'}</span>
                        <svg className={`h-5 w-5 transition-transform duration-200 ${isDropdownOpen ? 'transform rotate-180' : ''}`} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                          <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                        </svg>
                      </div>
                    </div>
                    
                    {isDropdownOpen && (
                      <div className="absolute z-10 mt-1 w-full bg-white shadow-lg max-h-60 rounded-md py-1 text-base ring-1 ring-black ring-opacity-5 overflow-auto focus:outline-none sm:text-sm">
                        <div 
                          className="cursor-pointer select-none relative py-2 pl-3 pr-9 hover:bg-purple-50 text-gray-500"
                          onClick={() => handleIndexSelect('')}
                        >
                          Select an index
                        </div>
                        
                        {indexes.map((index) => (
                          <div
                            key={index.id}
                            className={`cursor-pointer select-none relative py-2 pl-3 pr-9 hover:bg-purple-50 ${selectedIndexId === index.id ? 'bg-purple-100 text-purple-900' : 'text-gray-900'}`}
                            onClick={() => handleIndexSelect(index.id)}
                          >
                            <span className="text-sm">{index.name} ({index.videoCount})</span>
                            
                            {selectedIndexId === index.id && (
                              <span className="absolute inset-y-0 right-0 flex items-center pr-4 text-purple-600">
                                <svg className="h-5 w-5" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                </svg>
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Tag Filtering Section */}
              <div className="border-t pt-6 flex-1 flex flex-col overflow-hidden">
                <div className="flex justify-between items-center mb-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-lg font-medium text-blue-900">Filter by Tags</h2>
                      <div className="relative group">
                        <svg className="w-4 h-4 text-gray-400 cursor-help" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-3 py-2 bg-gray-900 text-white text-xs rounded-md opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none whitespace-nowrap z-10">
                          Click on tags below to select them for filtering
                        </div>
                      </div>
                    </div>
                    <p className="text-xs text-gray-600 mt-1">
                      Select tags to filter videos
                    </p>
                  </div>
                  {selectedTags.length > 0 && (
                    <div className="flex flex-col space-y-2">
                      <button
                        type="button"
                        className="inline-flex items-center px-2 py-1 text-xs font-medium text-white bg-purple-600 hover:bg-purple-700 rounded-md transition-colors duration-200 shadow-sm"
                        onClick={applyTagFilters}
                      >
                        <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
                        </svg>
                        Apply ({selectedTags.length})
                      </button>
                      <button
                        type="button"
                        className="inline-flex items-center px-2 py-1 text-xs font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-md transition-colors duration-200"
                        onClick={clearTagFilters}
                      >
                        <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                        Clear
                      </button>
                    </div>
                  )}
                </div>
                
                {/* Show active filters if any */}
                {appliedTagFilters.length > 0 && (
                  <div className="mb-4 p-3 bg-purple-50 border border-purple-200 rounded-md">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center">
                        <svg className="w-4 h-4 text-purple-600 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
                        </svg>
                        <span className="text-xs font-medium text-purple-800">Active:</span>
                        <div className="flex flex-wrap gap-1 ml-2">
                          {appliedTagFilters.map(tag => (
                            <span key={tag} className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-800">
                              {tag}
                              <button
                                onClick={() => {
                                  const newFilters = appliedTagFilters.filter(t => t !== tag);
                                  setAppliedTagFilters(newFilters);
                                  setSelectedTags(newFilters);
                                }}
                                className="ml-1 hover:text-purple-600"
                              >
                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                              </button>
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
                
                {/* Tag Selection Area */}
                <div className="border border-gray-200 rounded-md p-3 bg-gray-50 flex-1 overflow-y-auto max-h-48">
                  {allTags.length > 0 ? (
                    <div className="flex flex-wrap gap-1">
                      {allTags.map(({ tag, count, type }) => (
                        <button
                          key={tag}
                          onClick={() => toggleTagSelection(tag)}
                          className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium cursor-pointer transition-all duration-200 transform hover:scale-105 hover:shadow-sm
                            ${selectedTags.includes(tag) 
                              ? 'bg-purple-100 text-purple-800 border-2 border-purple-300 shadow-sm ring-2 ring-purple-200' 
                              : type === 'category' 
                                ? `${getCategoryColor(tag)} hover:opacity-80 border border-transparent hover:border-gray-300` 
                                : 'bg-gray-100 text-gray-800 hover:bg-gray-200 border border-transparent hover:border-gray-300'
                            }`}
                          title={`Click to ${selectedTags.includes(tag) ? 'remove' : 'add'} "${tag}" filter (${type})`}
                        >
                          {selectedTags.includes(tag) && (
                            <svg className="w-3 h-3 mr-1 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                            </svg>
                          )}
                          {tag}
                          <span className={`ml-1 text-xs px-1 py-0.5 rounded-full ${selectedTags.includes(tag) ? 'bg-purple-200 text-purple-800' : 'bg-white text-gray-600'}`}>
                            {count}
                          </span>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="flex items-center justify-center h-full">
                      <div className="text-center">
                        <svg className="w-6 h-6 text-gray-400 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
                        </svg>
                        <div className="text-gray-500 text-xs">No tags available yet</div>
                        <div className="text-gray-400 text-xs mt-1">Generate tags first</div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Middle Component - Video Selection */}
            <div className="bg-white rounded-lg shadow-md p-6 flex flex-col h-96 overflow-hidden">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-lg font-medium text-blue-900">Select a Video Asset</h2>
                <div className="text-sm text-gray-600">
                  {appliedTagFilters.length > 0 ? (
                    `Showing ${filteredVideos.length} of ${videos.length} videos`
                  ) : (
                    `${videos.length} videos available`
                  )}
                </div>
              </div>
              
              <div className="flex-1 overflow-y-auto max-h-72">
                {!selectedIndexId ? (
                  <div className="bg-gray-100 p-4 rounded-md text-gray-600">
                    Please select an index first
                  </div>
                ) : isLoadingVideos ? (
                  <div className="flex items-center justify-center h-40">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-500"></div>
                  </div>
                ) : filteredVideos.length === 0 ? (
                  <div className="bg-gray-100 p-4 rounded-md text-gray-600">
                    {appliedTagFilters.length > 0 
                      ? "No videos match the selected tag filters." 
                      : "No videos found in this index."} <a href="/create" className="text-purple-600 hover:underline">Upload videos</a>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                    {filteredVideos.map((video) => (
                      <div
                        key={video.id}
                        className={`cursor-pointer rounded-md overflow-hidden transition-all duration-200 ${selectedVideo?.id === video.id ? 'ring-2 ring-inset ring-purple-500 shadow-lg border-2 border-purple-500' : 'border-2 border-transparent hover:shadow-md hover:border-gray-300'}`}
                        onClick={() => handleVideoSelect(video)}
                      >
                        <div className="relative aspect-video bg-gray-100">
                          {video.thumbnailUrl ? (
                            <img
                              src={video.thumbnailUrl}
                              alt={video.title}
                              className="w-full h-full object-cover"
                              loading="lazy"
                            />
                          ) : (
                            <div className="w-full h-full bg-gray-200 flex items-center justify-center">
                              <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                              </svg>
                            </div>
                          )}
                          <div className="absolute bottom-0 right-0 bg-black bg-opacity-70 text-white text-xs px-2 py-1">
                            {video.duration}
                          </div>
                          
                          {video.tags && video.tags.length > 0 && (
                            <div className="absolute top-0 right-0 bg-purple-500 text-white text-xs px-2 py-1 rounded-bl-md">
                              {video.tags.length}
                            </div>
                          )}
                        </div>
                        <div className="p-2">
                          <h3 className="text-sm font-medium truncate">{video.title}</h3>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              
              {/* Video Summary and Load Segment buttons */}
              <div className="mt-4 pt-4 border-t">
                <div className="flex gap-3">
                  <button
                    onClick={generateVideoSummary}
                    disabled={!selectedVideo || isProcessing}
                    className={`px-4 py-2 rounded-md font-semibold transition-all duration-200 border-2 ${!selectedVideo || isProcessing ? 'bg-gray-400 text-white border-gray-400 cursor-not-allowed' : 'bg-white text-gray-700 border-gray-300 hover:border-purple-400 hover:bg-purple-50 hover:text-purple-700'}`}
                  >
                    {isProcessing ? (
                      <span className="flex items-center">
                        <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        Processing...
                      </span>
                    ) : (
                      'Video Summary'
                    )}
                  </button>
                  
                  <button
                    onClick={loadVideoSegmentation}
                    disabled={!selectedVideo || isLoadingSegmentation}
                    className={`px-4 py-2 rounded-md font-semibold transition-all duration-200 border-2 ${!selectedVideo || isLoadingSegmentation ? 'bg-gray-400 text-white border-gray-400 cursor-not-allowed' : 'bg-white text-gray-700 border-gray-300 hover:border-indigo-400 hover:bg-indigo-50 hover:text-indigo-700'}`}
                  >
                    {isLoadingSegmentation ? (
                      <span className="flex items-center">
                        <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        Loading...
                      </span>
                    ) : (
                      'Load Segment'
                    )}
                  </button>
                </div>
              </div>
            </div>
            
            {/* Right Component - Video Summary */}
            <div className="bg-white rounded-lg shadow-md p-6 flex flex-col h-96 overflow-hidden">
              <div className="mb-4">
                <h2 className="text-lg font-medium text-blue-900">Video Summary</h2>
              </div>
              
              <div className="flex-1 overflow-y-auto max-h-80">
                {!selectedVideo ? (
                  <div className="flex items-center justify-center h-full">
                    <div className="text-center text-gray-500">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 mx-auto text-gray-400 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                      <p className="text-sm">Select a video to view summary</p>
                    </div>
                  </div>
                ) : !responseText ? (
                  <div className="flex items-center justify-center h-full">
                    <div className="text-center text-gray-500">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 mx-auto text-gray-400 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                      <p className="text-sm">No summary generated yet</p>
                    </div>
                  </div>
                ) : (
                  <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-lg p-4">
                    <div className="prose prose-sm max-w-none">
                      <ReactMarkdown
                        components={{
                          h1: ({children}) => <h1 className="text-lg font-bold text-blue-900 mb-2 border-b border-blue-200 pb-1">{children}</h1>,
                          h2: ({children}) => <h2 className="text-md font-semibold text-blue-800 mb-2 mt-4">{children}</h2>,
                          h3: ({children}) => <h3 className="text-sm font-medium text-blue-700 mb-1 mt-3">{children}</h3>,
                          ul: ({children}) => <ul className="list-disc list-inside space-y-1 text-gray-700 mb-2 text-sm">{children}</ul>,
                          ol: ({children}) => <ol className="list-decimal list-inside space-y-1 text-gray-700 mb-2 text-sm">{children}</ol>,
                          li: ({children}) => <li className="text-gray-700 text-sm">{children}</li>,
                          p: ({children}) => <p className="text-gray-700 mb-2 leading-relaxed text-sm">{children}</p>,
                          strong: ({children}) => <strong className="font-semibold text-gray-900">{children}</strong>,
                          em: ({children}) => <em className="italic text-gray-600">{children}</em>,
                          blockquote: ({children}) => <blockquote className="border-l-4 border-blue-300 pl-3 italic text-gray-600 mb-2 text-sm">{children}</blockquote>,
                          code: ({children}) => <code className="bg-gray-100 text-gray-800 px-1 py-0.5 rounded text-xs font-mono">{children}</code>,
                        }}
                      >
                        {responseText}
                      </ReactMarkdown>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </>
        ) : (
          /* Analytics Panel - spans all three columns */
          <div className="col-span-3">
            <div className="bg-white rounded-lg shadow-md p-6">
              <h2 className="text-lg font-medium text-blue-900 mb-4">Analytics Panel</h2>
              <p className="text-gray-600">Analytics content will be displayed here in full width.</p>
            </div>
          </div>
        )}
      </div>
      
      {/* Bottom Section - Video Analysis & Summary (Full Width) */}
      {activePanel === 'operational' && (
        <div className="bg-white rounded-lg shadow-md p-6">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-medium text-blue-900">Video Analysis & Summary</h2>
          </div>
          
          {selectedVideo ? (
            <div>
                  {/* Video Information and Segmentation Preview */}
                  <div className="mb-4 p-4 bg-gray-50 rounded-md">
                    <div className="flex flex-col gap-4">
                      {/* Video Header */}
                      <div className="flex flex-col sm:flex-row gap-4">
                        <div className="w-full sm:w-1/3 lg:w-1/4">
                          <div className="relative aspect-video bg-gray-100 rounded-md overflow-hidden">
                            {selectedVideo.thumbnailUrl ? (
                              <img
                                src={selectedVideo.thumbnailUrl}
                                alt={selectedVideo.title}
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <div className="w-full h-full bg-gray-200 flex items-center justify-center">
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                </svg>
                              </div>
                            )}
                          </div>
                        </div>
                        
                        <div className="flex-1">
                          <h3 className="text-lg font-medium mb-2">{selectedVideo.title}</h3>
                          <div className="text-sm text-gray-500 mb-4">
                            <span className="mr-4">Duration: {selectedVideo.duration}</span>
                            <span className="mr-4">Index: {selectedVideo.indexId}</span>
                            {responseText && (
                              <span className="inline-flex items-center px-2 py-1 bg-green-100 text-green-800 text-xs rounded-full">
                                <svg className="w-3 h-3 mr-1" viewBox="0 0 20 20" fill="currentColor">
                                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                </svg>
                                Summary Available
                              </span>
                            )}
                          </div>
                          
                        </div>
                      </div>
                      
                      {/* Processing Progress Bar */}
                      {isProcessing && (
                        <div className="mb-4 p-4 bg-blue-50 border border-blue-200 rounded-md">
                          <div className="flex justify-between items-center mb-2">
                            <h4 className="text-sm font-medium text-blue-900">Generating Video Summary</h4>
                            <span className="text-sm text-blue-700">
                              {processingProgress.toFixed(0)}% Complete
                            </span>
                          </div>
                          <div className="w-full bg-blue-200 rounded-full h-3">
                            <div 
                              className="bg-blue-600 h-3 rounded-full transition-all duration-300 ease-out"
                              style={{ width: `${processingProgress}%` }}
                            ></div>
                          </div>
                          <div className="text-xs text-blue-600 mt-2">
                            Creating comprehensive video summary with AI analysis...
                          </div>
                        </div>
                      )}
                      
                      {/* Video Segment Preview Panel */}
                      <div className="border-t pt-4">
                        <div className="mb-3">
                          <h4 className="text-sm font-medium text-gray-700">video segment preview</h4>
                        </div>
                        
                        {segmentationError && (
                          <div className="mb-3 p-3 bg-red-50 border border-red-200 rounded-md">
                            <div className="text-sm text-red-600">
                              <strong>Error:</strong> {segmentationError}
                            </div>
                          </div>
                        )}
                        
                        {videoSegments.length > 0 ? (
                          <div className="space-y-4">
                            <div className="text-sm text-gray-600">
                              Found {videoSegments.length} segments
                            </div>
                            
                            
                            {/* Professional Video Timeline */}
                            <div className="bg-gradient-to-b from-gray-50 to-indigo-50/80 border border-purple-300/40 rounded-xl p-6 shadow-2xl">
                              {/* Timeline Header with Integrated Analysis Controls */}
                              <div className="space-y-4">
                                {/* Main Header */}
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center space-x-3">
                                    <div className="w-3 h-3 bg-purple-500 rounded-full shadow-lg recording-indicator"></div>
                                    <span className="text-gray-800 font-semibold text-lg">Video Timeline</span>
                                    <div className="bg-purple-100 border border-purple-300 px-3 py-1 rounded-full">
                                      <span className="text-purple-800 text-sm font-medium">{videoSegments.length} segments</span>
                                    </div>
                                  </div>
                                  <div className="text-gray-700 text-sm font-medium">
                                    Duration: {selectedVideo?.duration || '00:00'}
                                  </div>
                                </div>
                                
                                {/* Integrated Analysis Controls */}
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center space-x-4">
                                    {/* Analysis Type Tabs */}
                                    <div className="inline-flex bg-gray-100 p-1 rounded-lg border border-gray-200">
                                      <div className="relative group">
                                        <button
                                          onClick={() => setSelectedAnalysisPanel('detailed')}
                                          className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all duration-200 ${
                                            selectedAnalysisPanel === 'detailed' 
                                              ? 'bg-purple-600 text-white shadow-sm' 
                                              : 'bg-white text-gray-700 hover:bg-purple-50 hover:text-purple-700'
                                          }`}
                                        >
                                          DETAILED
                                        </button>
                                        <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-3 py-2 bg-gray-900 text-white text-xs rounded-md opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none whitespace-nowrap z-10">
                                          Visual elements, body language, and scene analysis
                                        </div>
                                      </div>
                                      <div className="relative group ml-1">
                                        <button
                                          onClick={() => setSelectedAnalysisPanel('summary')}
                                          className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all duration-200 ${
                                            selectedAnalysisPanel === 'summary' 
                                              ? 'bg-purple-600 text-white shadow-sm' 
                                              : 'bg-white text-gray-700 hover:bg-purple-50 hover:text-purple-700'
                                          }`}
                                        >
                                          SUMMARY
                                        </button>
                                        <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-3 py-2 bg-gray-900 text-white text-xs rounded-md opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none whitespace-nowrap z-10">
                                          Core summary and key insights
                                        </div>
                                      </div>
                                      <div className="relative group ml-1">
                                        <button
                                          onClick={() => setSelectedAnalysisPanel('categorization')}
                                          className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all duration-200 ${
                                            selectedAnalysisPanel === 'categorization' 
                                              ? 'bg-purple-600 text-white shadow-sm' 
                                              : 'bg-white text-gray-700 hover:bg-purple-50 hover:text-purple-700'
                                          }`}
                                        >
                                          TAGS
                                        </button>
                                        <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-3 py-2 bg-gray-900 text-white text-xs rounded-md opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none whitespace-nowrap z-10">
                                          Thematic categories and utility tags
                                        </div>
                                      </div>
                                    </div>
                                    
                                    {/* Quick Selection Controls */}
                                    <div className="flex items-center space-x-2">
                                      <label className="inline-flex items-center">
                                        <input
                                          type="checkbox"
                                          checked={selectAllSegments}
                                          onChange={(e) => {
                                            setSelectAllSegments(e.target.checked)
                                            if (e.target.checked) {
                                              setSelectedSegments(videoSegments.map(s => s.segment_id))
                                            } else {
                                              setSelectedSegments([])
                                            }
                                          }}
                                          className="w-3 h-3 text-purple-600 border-gray-300 rounded focus:ring-purple-500 mr-1"
                                        />
                                        <span className="text-xs text-gray-600 font-medium">All</span>
                                      </label>
                                      <span className="text-xs text-gray-500">
                                        {selectedSegments.length}/{videoSegments.length}
                                      </span>
                                    </div>
                                  </div>
                                  
                                  {/* Analyze and Export Buttons */}
                                  <div className="flex items-center space-x-2">
                                    <button
                                      onClick={() => batchAnalyzeSegments()}
                                      disabled={selectedSegments.length === 0 || isAnalyzingSegment || !selectedAnalysisPanel}
                                      className={`px-4 py-2 rounded-lg text-xs font-semibold transition-all duration-200 shadow-sm ${
                                        selectedSegments.length === 0 || isAnalyzingSegment || !selectedAnalysisPanel
                                          ? 'bg-gray-400 text-gray-600 cursor-not-allowed'
                                          : 'bg-purple-600 hover:bg-purple-700 text-white shadow-purple-200/50'
                                      }`}
                                    >
                                      {isAnalyzingSegment ? (
                                        <span className="flex items-center">
                                          <svg className="animate-spin -ml-1 mr-2 h-3 w-3 text-current" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 714 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                          </svg>
                                          Analyzing...
                                        </span>
                                      ) : (
                                        'Analyze Selected'
                                      )}
                                    </button>
                                    
                                    <button
                                      onClick={exportAnalysisResults}
                                      disabled={!selectedAnalysisPanel || selectedSegments.length === 0 || !selectedSegments.some(segmentId => 
                                        segmentAnalysisResults[`${segmentId}_${selectedAnalysisPanel}`]
                                      )}
                                      className={`px-3 py-2 rounded-lg text-xs font-semibold transition-all duration-200 shadow-sm border-2 ${
                                        !selectedAnalysisPanel || selectedSegments.length === 0 || !selectedSegments.some(segmentId => 
                                          segmentAnalysisResults[`${segmentId}_${selectedAnalysisPanel}`]
                                        )
                                          ? 'bg-gray-100 text-gray-400 border-gray-300 cursor-not-allowed'
                                          : 'bg-white text-purple-600 border-purple-600 hover:bg-purple-50'
                                      }`}
                                      title="Export analysis results as JSON"
                                    >
                                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                      </svg>
                                    </button>
                                  </div>
                                </div>
                              </div>

                              {/* Time Axis with Professional Markers */}
                              <div className="relative mb-4 mt-6">
                                {(() => {
                                  const totalDurationMs = videoSegments.length > 0 
                                    ? Math.max(...videoSegments.map(s => s.end_time || 0))
                                    : 180000; // Default 3 minutes
                                  const totalSeconds = Math.ceil(totalDurationMs / 1000);
                                  const intervalSeconds = totalSeconds <= 60 ? 10 : totalSeconds <= 300 ? 30 : 60;
                                  const markers = [];
                                  
                                  for (let i = 0; i <= totalSeconds; i += intervalSeconds) {
                                    const percentage = (i / totalSeconds) * 100;
                                    const minutes = Math.floor(i / 60);
                                    const seconds = i % 60;
                                    const timeLabel = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
                                    
                                    markers.push(
                                      <div 
                                        key={i} 
                                        className="absolute flex flex-col items-center timeline-marker"
                                        style={{ left: `${percentage}%`, transform: 'translateX(-50%)' }}
                                      >
                                        <div className="w-px h-4 bg-gray-600"></div>
                                        <span className="text-xs text-purple-800 mt-1 font-mono font-semibold">{timeLabel}</span>
                                      </div>
                                    );
                                  }
                                  
                                  return (
                                    <div className="relative h-8 bg-gray-200 border border-gray-300 rounded">
                                      <div className="absolute inset-0 bg-gradient-to-r from-purple-100/60 to-indigo-100/60 rounded"></div>
                                      {markers}
                                    </div>
                                  );
                                })()}
                              </div>

                              {/* Professional Segment Timeline */}
                              <div className="relative">
                                <div className="flex overflow-x-auto pb-4 timeline-scrollbar">
                                  <div className="flex space-x-1 min-w-full">
                                    {videoSegments.map((segment, index) => {
                                      const totalDurationMs = Math.max(...videoSegments.map(s => s.end_time || 0));
                                      const segmentDurationMs = (segment.end_time || 0) - (segment.start_time || 0);
                                      const widthPercent = Math.max((segmentDurationMs / totalDurationMs) * 100, 8); // Minimum 8% width
                                      const isSelected = selectedSegments.includes(segment.segment_id);
                                      
                                      return (
                                        <div
                                          key={segment.segment_id}
                                          className={`timeline-segment group relative flex-shrink-0 cursor-pointer ${isSelected ? 'selected selection-ripple' : ''}`}
                                          style={{ width: `${widthPercent}%`, minWidth: '120px' }}
                                          onClick={() => {
                                            if (isSelected) {
                                              setSelectedSegments(prev => prev.filter(id => id !== segment.segment_id));
                                            } else {
                                              setSelectedSegments(prev => [...prev, segment.segment_id]);
                                            }
                                            setSelectedSegment(segment);
                                          }}
                                        >
                                          {/* Segment Block */}
                                          <div className={`relative h-20 rounded-lg overflow-hidden border-2 transition-all duration-300 ${
                                            isSelected 
                                              ? 'border-purple-500 shadow-lg shadow-purple-500/30' 
                                              : 'border-gray-300 hover:border-purple-400/70'
                                          }`}>
                                            
                                            {/* Thumbnail Background */}
                                            {segment.thumbnailUrl ? (
                                              <div className="absolute inset-0">
                                                <img
                                                  src={segment.thumbnailUrl}
                                                  alt={segment.segment_name}
                                                  className="w-full h-full object-cover"
                                                  loading="lazy"
                                                />
                                                {/* Subtle overlay only for text readability */}
                                                <div className="absolute inset-0 bg-gradient-to-t from-black/30 via-transparent to-transparent"></div>
                                              </div>
                                            ) : (
                                              <div className="absolute inset-0 bg-gray-100 flex items-center justify-center">
                                                <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                                </svg>
                                              </div>
                                            )}
                                            
                                            {/* Visual Waveform Effect */}
                                            <div className="absolute bottom-0 left-0 right-0 h-6 flex items-end justify-center space-x-px overflow-hidden">
                                              {Array.from({ length: 20 }, (_, i) => (
                                                <div
                                                  key={i}
                                                  className={`waveform-bar w-1 bg-gradient-to-t transition-all duration-1000 ${
                                                    isSelected 
                                                      ? 'from-white/90 to-purple-200' 
                                                      : 'from-purple-400 to-purple-200'
                                                  }`}
                                                  style={{ 
                                                    height: `${Math.random() * 16 + 4}px`,
                                                    animationDelay: `${i * 100}ms`
                                                  }}
                                                ></div>
                                              ))}
                                            </div>
                                            
                                            {/* Segment Info Overlay */}
                                            <div className="absolute inset-0 p-2 flex flex-col justify-between">
                                              <div className="flex justify-between items-start">
                                                {/* Selection Checkbox */}
                                                <div className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-all duration-200 ${
                                                  isSelected 
                                                    ? 'bg-white border-white shadow-lg' 
                                                    : 'bg-white/90 border-gray-400 group-hover:border-purple-500'
                                                }`}>
                                                  {isSelected && (
                                                    <svg className="w-3 h-3 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                                    </svg>
                                                  )}
                                                </div>
                                                
                                                {/* Segment Number Badge */}
                                                <div className={`px-2 py-1 rounded text-xs font-bold shadow-sm ${
                                                  isSelected 
                                                    ? 'bg-white/95 text-purple-700' 
                                                    : 'bg-gray-800/80 text-white'
                                                }`}>
                                                  #{index + 1}
                                                </div>
                                              </div>
                                              
                                              {/* Bottom Info */}
                                              <div>
                                                <div className={`text-xs font-mono px-2 py-1 rounded shadow-sm font-semibold ${
                                                  isSelected 
                                                    ? 'bg-white/95 text-purple-700' 
                                                    : 'bg-gray-800/80 text-white'
                                                }`}>
                                                  {Math.round((segment.start_time || 0) / 1000)}s - {Math.round((segment.end_time || 0) / 1000)}s
                                                </div>
                                              </div>
                                            </div>
                                            
                                            {/* Play Button Overlay */}
                                            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-all duration-200 flex items-center justify-center">
                                              <button
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  playSegment(segment);
                                                }}
                                                className="opacity-0 group-hover:opacity-100 transition-all duration-200 bg-white/90 hover:bg-white hover:scale-110 rounded-full p-2 shadow-xl"
                                              >
                                                <svg className="w-4 h-4 text-gray-800" fill="currentColor" viewBox="0 0 24 24">
                                                  <path d="M8 5v14l11-7z"/>
                                                </svg>
                                              </button>
                                            </div>
                                            
                                            {/* Confidence Indicator */}
                                            {segment.confidence && (
                                              <div className="absolute top-1 right-1">
                                                <div className={`w-2 h-2 rounded-full shadow-lg ${
                                                  (segment.confidence || 0) > 0.8 ? 'bg-green-400 confidence-high' :
                                                  (segment.confidence || 0) > 0.6 ? 'bg-indigo-400' : 'bg-purple-400'
                                                }`}></div>
                                              </div>
                                            )}
                                          </div>
                                          
                                          {/* Segment Metadata Tooltip */}
                                          <div className="absolute -top-16 left-1/2 transform -translate-x-1/2 segment-tooltip text-white p-2 rounded-lg text-xs opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none z-10 min-w-max shadow-xl">
                                            <div className="font-semibold">{segment.segment_name || `Segment ${index + 1}`}</div>
                                            <div>Duration: {Math.round(((segment.end_time || 0) - (segment.start_time || 0)) / 1000)}s</div>
                                            {segment.confidence && (
                                              <div>Confidence: {Math.round((segment.confidence || 0) * 100)}%</div>
                                            )}
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                                
                                {/* Timeline Scale */}
                                <div className="mt-2 h-1 bg-gradient-to-r from-purple-300 via-indigo-300 to-blue-300 rounded-full opacity-90 timeline-scale"></div>
                              </div>
                              
                              {/* Timeline Controls */}
                              <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-300">
                                <div className="flex items-center space-x-4">
                                  <button className="text-gray-600 hover:text-purple-600 zoom-control">
                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                                    </svg>
                                  </button>
                                  <span className="text-gray-700 text-sm font-medium">Zoom to fit</span>
                                </div>
                                
                                {/* Analysis Options - Condensed */}
                                {selectedAnalysisPanel && (
                                  <div className="flex items-center space-x-3">
                                    <span className="text-xs text-gray-600 font-medium">
                                      {selectedAnalysisPanel === 'detailed' && 'Options:'}
                                      {selectedAnalysisPanel === 'summary' && 'Include:'}
                                      {selectedAnalysisPanel === 'categorization' && 'Generate:'}
                                    </span>
                                    <div className="flex space-x-2">
                                      {selectedAnalysisPanel === 'detailed' && (
                                        <>
                                          <label className="inline-flex items-center">
                                            <input
                                              type="checkbox"
                                              checked={analysisOptions.detailed.visualElements}
                                              onChange={(e) => setAnalysisOptions(prev => ({
                                                ...prev,
                                                detailed: {...prev.detailed, visualElements: e.target.checked}
                                              }))}
                                              className="w-3 h-3 text-purple-600 border-gray-300 rounded focus:ring-purple-500 mr-1"
                                            />
                                            <span className="text-xs text-gray-700">Visual</span>
                                          </label>
                                          <label className="inline-flex items-center">
                                            <input
                                              type="checkbox"
                                              checked={analysisOptions.detailed.bodyLanguage}
                                              onChange={(e) => setAnalysisOptions(prev => ({
                                                ...prev,
                                                detailed: {...prev.detailed, bodyLanguage: e.target.checked}
                                              }))}
                                              className="w-3 h-3 text-purple-600 border-gray-300 rounded focus:ring-purple-500 mr-1"
                                            />
                                            <span className="text-xs text-gray-700">Body Language</span>
                                          </label>
                                        </>
                                      )}
                                      
                                      {selectedAnalysisPanel === 'summary' && (
                                        <>
                                          <label className="inline-flex items-center">
                                            <input
                                              type="checkbox"
                                              checked={analysisOptions.summary.coreSummary}
                                              onChange={(e) => setAnalysisOptions(prev => ({
                                                ...prev,
                                                summary: {...prev.summary, coreSummary: e.target.checked}
                                              }))}
                                              className="w-3 h-3 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500 mr-1"
                                            />
                                            <span className="text-xs text-gray-700">Summary</span>
                                          </label>
                                          <label className="inline-flex items-center">
                                            <input
                                              type="checkbox"
                                              checked={analysisOptions.summary.primaryKeywords}
                                              onChange={(e) => setAnalysisOptions(prev => ({
                                                ...prev,
                                                summary: {...prev.summary, primaryKeywords: e.target.checked}
                                              }))}
                                              className="w-3 h-3 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500 mr-1"
                                            />
                                            <span className="text-xs text-gray-700">Keywords</span>
                                          </label>
                                        </>
                                      )}
                                      
                                      {selectedAnalysisPanel === 'categorization' && (
                                        <>
                                          <label className="inline-flex items-center">
                                            <input
                                              type="checkbox"
                                              checked={analysisOptions.categorization.thematicCategory}
                                              onChange={(e) => setAnalysisOptions(prev => ({
                                                ...prev,
                                                categorization: {...prev.categorization, thematicCategory: e.target.checked}
                                              }))}
                                              className="w-3 h-3 text-gray-600 border-gray-300 rounded focus:ring-gray-500 mr-1"
                                            />
                                            <span className="text-xs text-gray-700">Thematic</span>
                                          </label>
                                          <label className="inline-flex items-center">
                                            <input
                                              type="checkbox"
                                              checked={analysisOptions.categorization.technicalAttributes}
                                              onChange={(e) => setAnalysisOptions(prev => ({
                                                ...prev,
                                                categorization: {...prev.categorization, technicalAttributes: e.target.checked}
                                              }))}
                                              className="w-3 h-3 text-gray-600 border-gray-300 rounded focus:ring-gray-500 mr-1"
                                            />
                                            <span className="text-xs text-gray-700">Technical</span>
                                          </label>
                                        </>
                                      )}
                                    </div>
                                  </div>
                                )}
                              </div>
                            </div>
                            
                            {/* Analysis Progress Bar */}
                            {isAnalyzingSegment && batchAnalysisProgress.total > 0 && (
                              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
                                <div className="flex items-center justify-between mb-2">
                                  <h4 className="text-sm font-medium text-blue-900">Analyzing Segments</h4>
                                  <span className="text-sm text-blue-700">
                                    {batchAnalysisProgress.current}/{batchAnalysisProgress.total}
                                  </span>
                                </div>
                                <div className="w-full bg-blue-200 rounded-full h-3 mb-2">
                                  <div 
                                    className="bg-blue-600 h-3 rounded-full transition-all duration-300 ease-out"
                                    style={{ width: `${(batchAnalysisProgress.current / batchAnalysisProgress.total) * 100}%` }}
                                  ></div>
                                </div>
                                <div className="flex items-center justify-between text-xs text-blue-600">
                                  <span>
                                    {batchAnalysisProgress.currentSegmentId && (
                                      <>Processing: {videoSegments.find(s => s.segment_id === batchAnalysisProgress.currentSegmentId)?.segment_name || 'Unknown segment'}</>
                                    )}
                                  </span>
                                  <span>
                                    {batchAnalysisProgress.estimatedTimeRemaining && batchAnalysisProgress.estimatedTimeRemaining > 0 && (
                                      <>Est. {Math.ceil(batchAnalysisProgress.estimatedTimeRemaining)}s remaining</>
                                    )}
                                  </span>
                                </div>
                              </div>
                            )}

                            {/* Analysis Results Display */}
                            {selectedAnalysisPanel && selectedSegments.length > 0 && (
                              <div className="bg-white border border-gray-300 rounded-lg overflow-hidden">
                                {/* Results Header */}
                                <div className="bg-gradient-to-r from-purple-50 to-indigo-50 border-b border-gray-200 px-4 py-3">
                                  <div className="flex items-center justify-between">
                                    <h3 className="text-sm font-semibold text-gray-800 flex items-center">
                                      <svg className="w-4 h-4 mr-2 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                      </svg>
                                      {selectedAnalysisPanel === 'detailed' && 'Detailed Analysis Results'}
                                      {selectedAnalysisPanel === 'summary' && 'Summary Analysis Results'}
                                      {selectedAnalysisPanel === 'categorization' && 'Tag Analysis Results'}
                                    </h3>
                                    <div className="text-xs text-gray-600 bg-white px-2 py-1 rounded border">
                                      {selectedSegments.length} segment{selectedSegments.length !== 1 ? 's' : ''} selected
                                    </div>
                                  </div>
                                </div>
                                
                                {/* Compact Results Display */}
                                <div className="max-h-64 overflow-y-auto">
                                  {selectedSegments.length > 0 ? (
                                    <div className="divide-y divide-gray-200">
                                      {videoSegments
                                        .filter(segment => selectedSegments.includes(segment.segment_id))
                                        .map((segment) => {
                                          const isCollapsed = collapsedSegments.has(segment.segment_id);
                                          const hasResult = segmentAnalysisResults[`${segment.segment_id}_${selectedAnalysisPanel}`];
                                          
                                          return (
                                            <div key={segment.segment_id} className="p-4 hover:bg-gray-50">
                                              <div className="flex items-start space-x-3">
                                                {/* Compact Thumbnail */}
                                                <div className="flex-shrink-0 w-16 h-12 bg-gray-100 rounded overflow-hidden border border-gray-200">
                                                  {segment.thumbnailUrl ? (
                                                    <img
                                                      src={segment.thumbnailUrl}
                                                      alt={segment.segment_name}
                                                      className="w-full h-full object-cover"
                                                      loading="lazy"
                                                    />
                                                  ) : (
                                                    <div className="w-full h-full bg-gray-200 flex items-center justify-center">
                                                      <svg className="h-4 w-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                                      </svg>
                                                    </div>
                                                  )}
                                                </div>
                                                
                                                {/* Segment Info & Results */}
                                                <div className="flex-1 min-w-0">
                                                  <div className="flex items-center justify-between mb-2">
                                                    <div className="flex items-center space-x-2">
                                                      <h4 className="text-sm font-medium text-gray-900 truncate">
                                                        {segment.segment_name}
                                                      </h4>
                                                      {hasResult && (
                                                        <button
                                                          onClick={() => toggleSegmentCollapse(segment.segment_id)}
                                                          className="flex items-center justify-center w-5 h-5 rounded-full hover:bg-gray-200 transition-colors duration-200"
                                                          title={isCollapsed ? 'Expand results' : 'Collapse results'}
                                                        >
                                                          <svg 
                                                            className={`w-3 h-3 text-gray-500 transform transition-transform duration-200 ${isCollapsed ? 'rotate-90' : 'rotate-0'}`}
                                                            fill="none" 
                                                            stroke="currentColor" 
                                                            viewBox="0 0 24 24"
                                                          >
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                                          </svg>
                                                        </button>
                                                      )}
                                                    </div>
                                                    <span className="text-xs text-gray-500 font-mono ml-2">
                                                      {Math.round(segment.start_time / 1000)}s - {Math.round(segment.end_time / 1000)}s
                                                    </span>
                                                  </div>
                                                  
                                                  {/* Analysis Result */}
                                                  {hasResult ? (
                                                    <div className={`bg-gray-50 border border-gray-200 rounded p-3 text-xs transition-all duration-200 ${isCollapsed ? 'max-h-0 overflow-hidden opacity-0 p-0 border-0' : 'max-h-96 overflow-y-auto opacity-100'}`}>
                                                      {renderStructuredAnalysis(
                                                        segmentAnalysisResults[`${segment.segment_id}_${selectedAnalysisPanel}`],
                                                        selectedAnalysisPanel || 'detailed'
                                                      )}
                                                    </div>
                                                  ) : (
                                                    <div className="text-xs text-gray-500 italic">
                                                      Click "Analyze" to process this segment
                                                    </div>
                                                  )}
                                                </div>
                                              </div>
                                            </div>
                                          );
                                        })
                                      }
                                    </div>
                                  ) : (
                                    <div className="p-8 text-center text-gray-500">
                                      <svg className="w-12 h-12 mx-auto mb-4 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                                      </svg>
                                      <p className="text-sm">Select segments from the timeline above to analyze them</p>
                                      <p className="text-xs text-gray-400 mt-1">Choose analysis options and click the analyze button</p>
                                    </div>
                                  )}
                                </div>
                              </div>
                            )}
                          </div>
                        ) : (
                          <div className="text-sm text-gray-500 text-center py-8">
                            Click "Load Segments" to preview video segmentation
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                  
                  
                  
                </div>
            ) : (
              <div className="flex items-center justify-center h-40 bg-gray-50 rounded-md">
                <div className="text-center text-gray-500">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 mx-auto text-gray-400 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                  <p>Select a video asset to manage tags</p>
                </div>
              </div>
            )}
        </div>
      )}

      {/* Segment Video Player Modal */}
      {isSegmentPlayerOpen && playingSegment && selectedVideo && (
        <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg max-w-4xl max-h-[90vh] w-full mx-4 overflow-hidden">
            <div className="flex justify-between items-center p-4 border-b">
              <div>
                <h3 className="text-lg font-medium">{playingSegment.segment_name}</h3>
                <p className="text-sm text-gray-600">
                  {Math.round(playingSegment.start_time / 1000)}s - {Math.round(playingSegment.end_time / 1000)}s 
                  ({Math.round(playingSegment.duration / 1000)}s duration)
                </p>
              </div>
              <button
                onClick={() => setIsSegmentPlayerOpen(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            
            <div className="p-4">
              <div className="aspect-video bg-black rounded-lg overflow-hidden mb-4">
                {selectedVideo.videoPreviewUrl ? (
                  <video
                    controls
                    autoPlay
                    className="w-full h-full"
                    poster={playingSegment.thumbnailUrl}
                  >
                    <source src={`${selectedVideo.videoPreviewUrl}#t=${playingSegment.start_time / 1000},${playingSegment.end_time / 1000}`} type="video/mp4" />
                    Your browser does not support the video tag.
                  </video>
                ) : (
                  <div className="w-full h-full bg-gray-200 flex items-center justify-center">
                    <div className="text-center text-gray-500">
                      <svg className="w-16 h-16 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                      <p>Video preview not available</p>
                    </div>
                  </div>
                )}
              </div>
              
              {/* Segment Details */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <h4 className="font-medium text-gray-900 mb-2">Segment Information</h4>
                  <div className="space-y-1 text-sm">
                    <div><strong>Name:</strong> {playingSegment.segment_name}</div>
                    <div><strong>Duration:</strong> {Math.round(playingSegment.duration / 1000)} seconds</div>
                    <div><strong>Time Range:</strong> {Math.round(playingSegment.start_time / 1000)}s - {Math.round(playingSegment.end_time / 1000)}s</div>
                    {playingSegment.confidence && (
                      <div><strong>Confidence:</strong> {playingSegment.confidence > 1 ? playingSegment.confidence.toFixed(1) : (playingSegment.confidence * 100).toFixed(1)}%</div>
                    )}
                  </div>
                </div>
                
                <div>
                  <h4 className="font-medium text-gray-900 mb-2">Content Description</h4>
                  <div className="space-y-1 text-sm">
                    {playingSegment.segment_visual_description && (
                      <div><strong>Visual:</strong> {playingSegment.segment_visual_description}</div>
                    )}
                    {playingSegment.segment_audio_description && (
                      <div><strong>Audio:</strong> {playingSegment.segment_audio_description}</div>
                    )}
                    {!playingSegment.segment_visual_description && !playingSegment.segment_audio_description && (
                      <div className="text-gray-500 italic">No detailed description available</div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}