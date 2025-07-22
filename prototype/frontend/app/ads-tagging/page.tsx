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
  const [isModelDropdownOpen, setIsModelDropdownOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const modelDropdownRef = useRef<HTMLDivElement>(null)
  const [selectedModel, setSelectedModel] = useState<string>('qwen-vl-2.5')
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

  // Initialize selectedIndexId from URL parameter and fetch indexes on mount
  useEffect(() => {
    const indexParam = searchParams.get('index');
    if (indexParam) {
      setSelectedIndexId(indexParam);
    }
    
    // Load saved model from localStorage
    const savedModel = localStorage.getItem('selectedVideoUnderstandingModel');
    if (savedModel) {
      setSelectedModel(savedModel);
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
  
  // Save selected model to localStorage when it changes
  useEffect(() => {
    localStorage.setItem('selectedVideoUnderstandingModel', selectedModel);
  }, [selectedModel]);

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
  
  // Handle model selection
  const handleModelSelect = (modelId: string) => {
    setSelectedModel(modelId);
    setIsModelDropdownOpen(false);
  };

  // Generate tags for the selected video
  const generateTags = async () => {
    if (!selectedVideo) {
      setError('Please select a video first');
      return;
    }
    
    try {
      setIsProcessing(true);
      setError(null);
      
      // Use the Ask API with a specific prompt to generate tags
      const initResponse = await fetch(`${API_ENDPOINT}/videos/ask/init`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(state.session ? { 'Authorization': `Bearer ${state.session.token}` } : {})
        },
        body: JSON.stringify({
          videoId: selectedVideo.id,
          indexId: selectedVideo.indexId,
          question: "Generate highly detailed advertising-focused hashtags and topics for this video. Include tags for: visual elements, emotional tone, audience demographics, ad campaign types, industry verticals, product categories, and creative style. Format as '## Hashtags' followed by hashtags and '## Topics' followed by detailed topic descriptions. Make tags extremely specific and granular for advertising campaign targeting.",
          model: selectedModel,
          bypassPromptEnhancement: true  // Bypass enhancement for direct analysis
        })
      });
      
      if (!initResponse.ok) {
        throw new Error(`Failed to initialize tag generation: ${initResponse.statusText}`);
      }
      
      const { sessionId } = await initResponse.json();
      
      // Connect to the streaming endpoint
      const eventSource = new EventSource(`${API_ENDPOINT}/videos/ask/stream/${sessionId}`);
      let fullResponse = '';
      
      // Handle incoming message events
      eventSource.addEventListener('message', (event) => {
        try {
          const data = JSON.parse(event.data);
          fullResponse += data.text;
          setResponseText(fullResponse);
        } catch (error) {
          console.error('Error parsing SSE message:', error);
        }
      });
      
      // Handle completion event
      eventSource.addEventListener('complete', () => {
        setIsProcessing(false);
        eventSource.close();
        
        // Parse the hashtags from the response
        if (isHashtagsResponse(fullResponse)) {
          // Extract hashtags
          const hashtagsMatch = fullResponse.match(/## Hashtags\s*([\s\S]*?)(?=##|$)/);
          if (hashtagsMatch && hashtagsMatch[1]) {
            const hashtagMatches = hashtagsMatch[1].match(/#\w+/g);
            if (hashtagMatches) {
              // Update the selected video with the new tags
              setSelectedVideoTags(hashtagMatches);
              
              // Update the video in the videos array
              const updatedVideos = videos.map(video => {
                if (video.id === selectedVideo.id) {
                  return {
                    ...video,
                    tags: hashtagMatches
                  };
                }
                return video;
              });
              
              setVideos(updatedVideos);
              
              // Update tag statistics
              updateTagStatistics(updatedVideos);
            }
          }
        }
      });
      
      // Handle errors
      eventSource.addEventListener('error', (event) => {
        console.error('SSE Error:', event);
        
        let errorMsg = 'Error receiving response from server';
        try {
          if (event instanceof MessageEvent && event.data) {
            const errorData = JSON.parse(event.data);
            if (errorData.error) {
              errorMsg = errorData.error;
            }
          }
        } catch (parseError) {
          console.error('Error parsing error message:', parseError);
        }
        
        setError(errorMsg);
        setErrorMessage(errorMsg);
        setIsProcessing(false);
        setHasError(true);
        eventSource.close();
      });
    } catch (error) {
      console.error('Error generating tags:', error);
      setError(error instanceof Error ? error.message : 'Failed to generate tags');
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
      if (modelDropdownRef.current && !modelDropdownRef.current.contains(event.target as Node)) {
        setIsModelDropdownOpen(false);
      }
    }
    
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
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
        
        <div className="flex space-x-3">
          <button 
            className={`px-4 py-2 rounded-md ${activePanel === 'operational' 
              ? 'bg-purple-600 text-white shadow-md' 
              : 'bg-white text-gray-700 border border-gray-300'}`}
            onClick={() => setActivePanel('operational')}
          >
            Operational
          </button>
          <button 
            className={`px-4 py-2 rounded-md ${activePanel === 'analytics' 
              ? 'bg-purple-600 text-white shadow-md' 
              : 'bg-white text-gray-700 border border-gray-300'}`}
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
      
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {activePanel === 'operational' ? (
          /* Operational Panel */
          <>
            {/* Left Sidebar - Index Selection and Tag Filtering */}
            <div className="lg:col-span-1 space-y-6">
              {/* Merged Index Selection and Tag Filtering */}
              <div className="bg-white rounded-lg shadow-md p-6">
                {/* Index Selection */}
                <div className="mb-6">
                  <h2 className="text-lg font-medium mb-4">Select an Index</h2>
                  
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
                <div className="border-t pt-6">
                  <div className="flex justify-between items-center mb-4">
                    <div>
                      <h2 className="text-lg font-medium">Filter by Tags</h2>
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
                  <div className="border border-gray-200 rounded-md p-3 bg-gray-50 h-[200px] overflow-y-auto">
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
            </div>

            {/* Main Content Area */}
            <div className="lg:col-span-3 space-y-6">
              {/* Video Selection Box */}
              <div className="bg-white rounded-lg shadow-md p-6">
                <div className="flex justify-between items-center mb-4">
                <h2 className="text-lg font-medium">Select a Video Asset</h2>
                <div className="text-sm text-gray-600">
                  {appliedTagFilters.length > 0 ? (
                    `Showing ${filteredVideos.length} of ${videos.length} videos`
                  ) : (
                    `${videos.length} videos available`
                  )}
                </div>
              </div>
              
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
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                  {filteredVideos.map((video) => (
                    <div
                      key={video.id}
                      className={`cursor-pointer rounded-md overflow-hidden ${selectedVideo?.id === video.id ? 'ring-4 ring-purple-500 shadow-md' : 'hover:shadow-md'}`}
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
            
            {/* Tag Management */}
            <div className="bg-white rounded-lg shadow-md p-6">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-lg font-medium">Enhanced Video Analysis</h2>
                
                <div className="flex items-center gap-2">
                  <div className="relative">
                    <select
                      value={selectedAnalysisType}
                      onChange={(e) => setSelectedAnalysisType(e.target.value)}
                      className="px-3 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    >
                      {ANALYSIS_TYPES.map((type) => (
                        <option key={type.id} value={type.id}>{type.name}</option>
                      ))}
                    </select>
                  </div>
                  
                  <div className="relative" ref={modelDropdownRef}>
                    <button
                      type="button"
                      className="flex items-center px-3 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-50"
                      onClick={() => setIsModelDropdownOpen(!isModelDropdownOpen)}
                    >
                      <span className="mr-2">Model:</span>
                      <span className="font-medium">{AVAILABLE_MODELS.find(model => model.id === selectedModel)?.name}</span>
                      <svg className={`ml-2 h-5 w-5 transition-transform duration-200 ${isModelDropdownOpen ? 'transform rotate-180' : ''}`} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                      </svg>
                    </button>
                    
                    {isModelDropdownOpen && (
                      <div className="absolute right-0 z-10 mt-1 w-48 bg-white shadow-lg rounded-md py-1 text-sm ring-1 ring-black ring-opacity-5 overflow-auto focus:outline-none">
                        {AVAILABLE_MODELS.map((model) => (
                          <div
                            key={model.id}
                            className={`cursor-pointer select-none relative py-2 px-3 hover:bg-purple-50 ${selectedModel === model.id ? 'bg-purple-100 text-purple-900' : 'text-gray-900'}`}
                            onClick={() => handleModelSelect(model.id)}
                          >
                            {model.name}
                            
                            {selectedModel === model.id && (
                              <span className="absolute inset-y-0 right-0 flex items-center pr-3 text-purple-600">
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
                  
                  <div className="flex gap-3">
                    <button
                      onClick={generateTags}
                      disabled={!selectedVideo || isProcessing}
                      className={`px-4 py-2 rounded-md text-white ${!selectedVideo || isProcessing ? 'bg-gray-400 cursor-not-allowed' : 'bg-purple-600 hover:bg-purple-700'}`}
                    >
                      {isProcessing ? (
                        <span className="flex items-center">
                          <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                          </svg>
                          Generating
                        </span>
                      ) : (
                        'Generate Tags'
                      )}
                    </button>
                    
                    <button
                      onClick={loadVideoSegmentation}
                      disabled={!selectedVideo || isLoadingSegmentation}
                      className={`px-4 py-2 rounded-md text-white ${!selectedVideo || isLoadingSegmentation ? 'bg-gray-400 cursor-not-allowed' : 'bg-purple-600 hover:bg-purple-700'}`}
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
                        'Load Segments'
                      )}
                    </button>
                  </div>
                </div>
              </div>
              
              {/* Analysis Type Description */}
              <div className="mb-4">
                <div className="text-sm text-gray-600">
                  {ANALYSIS_TYPES.find(type => type.id === selectedAnalysisType)?.description}
                </div>
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
                            <span>Index: {selectedVideo.indexId}</span>
                          </div>
                          
                          {/* Custom Tag Input */}
                          <div className="flex mb-4">
                            <input
                              type="text"
                              value={tagInput}
                              onChange={(e) => setTagInput(e.target.value)}
                              placeholder="Add custom tag (e.g. #professional)"
                              className="flex-1 px-3 py-2 border border-gray-300 rounded-l-md focus:outline-none focus:ring-purple-500 focus:border-purple-500"
                            />
                            <button
                              onClick={handleAddTag}
                              disabled={!tagInput.trim()}
                              className={`px-4 py-2 rounded-r-md text-white ${!tagInput.trim() ? 'bg-gray-400 cursor-not-allowed' : 'bg-purple-600 hover:bg-purple-700'}`}
                            >
                              Add
                            </button>
                          </div>
                          
                          {/* Current Tags */}
                          <div className="mb-2">
                            <h4 className="text-sm font-medium text-gray-700 mb-2">Current Tags:</h4>
                            <div className="flex flex-wrap gap-2">
                              {selectedVideoTags.length > 0 ? (
                                selectedVideoTags.map((tag, index) => (
                                  <div
                                    key={`${tag}-${index}`}
                                    className="bg-purple-100 text-purple-800 px-3 py-1 rounded-full flex items-center text-sm"
                                  >
                                    <span className="mr-1">{tag}</span>
                                    <button
                                      onClick={() => handleRemoveTag(tag)}
                                      className="text-purple-600 hover:text-purple-800"
                                    >
                                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                      </svg>
                                    </button>
                                  </div>
                                ))
                              ) : (
                                <span className="text-sm text-gray-500">No tags yet. Generate or add custom tags.</span>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                      
                      {/* Video Segmentation Preview */}
                      <div className="border-t pt-4">
                        <div className="mb-3">
                          <h4 className="text-sm font-medium text-gray-700">Video Segmentation Preview</h4>
                        </div>
                        
                        {segmentationError && (
                          <div className="mb-3 p-3 bg-red-50 border border-red-200 rounded-md">
                            <div className="text-sm text-red-600">
                              <strong>Error:</strong> {segmentationError}
                            </div>
                          </div>
                        )}
                        
                        {videoSegments.length > 0 ? (
                          <div className="space-y-3">
                            <div className="text-sm text-gray-600">
                              Found {videoSegments.length} segments • Total Duration: {selectedVideo.duration}
                            </div>
                            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 max-h-64 overflow-y-auto">
                              {videoSegments.map((segment, index) => (
                                <div
                                  key={segment.segment_id}
                                  className="bg-white rounded-md border border-gray-200 overflow-hidden hover:shadow-md transition-shadow cursor-pointer group"
                                  onClick={() => setSelectedSegment(segment)}
                                >
                                  <div className="relative aspect-video bg-gray-100">
                                    {segment.thumbnailUrl ? (
                                      <img
                                        src={segment.thumbnailUrl}
                                        alt={segment.segment_name}
                                        className="w-full h-full object-cover"
                                        loading="lazy"
                                      />
                                    ) : (
                                      <div className="w-full h-full bg-gray-200 flex items-center justify-center">
                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                        </svg>
                                      </div>
                                    )}
                                    {/* Play button overlay */}
                                    <div className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-30 transition-all duration-200 flex items-center justify-center">
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          playSegment(segment);
                                        }}
                                        className="opacity-0 group-hover:opacity-100 transition-opacity duration-200 bg-white bg-opacity-90 hover:bg-opacity-100 rounded-full p-2 shadow-lg"
                                      >
                                        <svg className="w-4 h-4 text-gray-700" fill="currentColor" viewBox="0 0 24 24">
                                          <path d="M8 5v14l11-7z"/>
                                        </svg>
                                      </button>
                                    </div>
                                    <div className="absolute bottom-0 right-0 bg-black bg-opacity-70 text-white text-xs px-2 py-1">
                                      {Math.round(segment.duration / 1000)}s
                                    </div>
                                    {segment.confidence && (
                                      <div className="absolute top-0 right-0 bg-green-500 text-white text-xs px-2 py-1 rounded-bl-md">
                                        {(segment.confidence * 100).toFixed(1)}%
                                      </div>
                                    )}
                                  </div>
                                  <div className="p-2">
                                    <div className="text-xs font-medium truncate">{segment.segment_name}</div>
                                    <div className="text-xs text-gray-500">
                                      {Math.round(segment.start_time / 1000)}s - {Math.round(segment.end_time / 1000)}s
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : (
                          <div className="text-sm text-gray-500 text-center py-8">
                            Click "Load Segments" to preview video segmentation
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                  
                  {/* Selected Segment Details */}
                  {selectedSegment && (
                    <div className="mb-4 p-4 bg-blue-50 border border-blue-200 rounded-md">
                      <div className="flex justify-between items-start mb-3">
                        <h4 className="text-sm font-medium text-blue-900">Segment Details</h4>
                        <button
                          onClick={() => setSelectedSegment(null)}
                          className="text-blue-600 hover:text-blue-800"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <div className="text-sm text-blue-800 mb-2">
                            <strong>{(selectedSegment as any).segment_name || `Segment ${selectedSegment.segment_id}`}</strong>
                          </div>
                          <div className="text-sm text-blue-700 mb-2">
                            Time: {Math.round(selectedSegment.start_time / 1000)}s - {Math.round(selectedSegment.end_time / 1000)}s
                          </div>
                          <div className="text-sm text-blue-700 mb-2">
                            Duration: {Math.round(selectedSegment.duration / 1000)} seconds
                          </div>
                          {(selectedSegment as any).confidence && (
                            <div className="text-sm text-blue-700 mb-2">
                              Confidence: {((selectedSegment as any).confidence * 100).toFixed(1)}%
                            </div>
                          )}
                        </div>
                        <div>
                          {(selectedSegment as any).segment_visual_description && (
                            <div className="text-sm text-blue-700 mb-2">
                              <strong>Visual:</strong> {(selectedSegment as any).segment_visual_description}
                            </div>
                          )}
                          {(selectedSegment as any).segment_audio_description && (
                            <div className="text-sm text-blue-700">
                              <strong>Audio:</strong> {(selectedSegment as any).segment_audio_description}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                  
                  {/* Dynamic Analysis Output */}
                  {responseText && (
                    <div className="mt-4 border border-gray-200 rounded-md p-4">
                      <div className="mb-4">
                        <div className="flex justify-between items-center mb-2">
                          <h3 className="font-medium text-gray-900">Analysis Output</h3>
                          <select
                            value={selectedAnalysisType}
                            onChange={(e) => setSelectedAnalysisType(e.target.value)}
                            className="px-3 py-1 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500"
                          >
                            <option value="comprehensive">Comprehensive Analysis</option>
                            <option value="detailed_description">Detailed Description per Segment</option>
                            <option value="summary_keywords">Summary & Keywords per Segment</option>
                            <option value="categorization_tags">Categorization Tags per Segment</option>
                          </select>
                        </div>
                      </div>
                      
                      {selectedAnalysisType === 'comprehensive' && (
                        <div className="space-y-4">
                          <div className="bg-blue-50 border border-blue-200 rounded-md p-4">
                            <h4 className="font-medium text-blue-900 mb-2">Comprehensive Video Analysis</h4>
                            {isHashtagsResponse(responseText) ? (
                              <HashtagsAndTopics content={responseText} />
                            ) : (
                              <div className="prose max-w-none text-blue-800">
                                <ReactMarkdown>{responseText}</ReactMarkdown>
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                      
                      {selectedAnalysisType === 'detailed_description' && (
                        <div className="space-y-4">
                          <div className="bg-green-50 border border-green-200 rounded-md p-4">
                            <h4 className="font-medium text-green-900 mb-2">Detailed Description per Segment</h4>
                            {videoSegments.length > 0 ? (
                              <div className="space-y-3">
                                {videoSegments.map((segment, index) => (
                                  <div key={segment.segment_id} className="border border-green-300 rounded-md p-3 bg-white">
                                    <div className="flex items-center justify-between mb-2">
                                      <h5 className="font-medium text-green-800">{segment.segment_name}</h5>
                                      <span className="text-sm text-green-600">
                                        {Math.round(segment.start_time / 1000)}s - {Math.round(segment.end_time / 1000)}s
                                      </span>
                                    </div>
                                    <div className="text-sm text-green-700">
                                      <div className="mb-1"><strong>Visual:</strong> {segment.segment_visual_description || 'No description available'}</div>
                                      <div><strong>Audio:</strong> {segment.segment_audio_description || 'No description available'}</div>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <div className="text-green-700 text-sm">Load segments first to see detailed descriptions</div>
                            )}
                          </div>
                        </div>
                      )}
                      
                      {selectedAnalysisType === 'summary_keywords' && (
                        <div className="space-y-4">
                          <div className="bg-yellow-50 border border-yellow-200 rounded-md p-4">
                            <h4 className="font-medium text-yellow-900 mb-2">Summary & Keywords per Segment</h4>
                            {videoSegments.length > 0 ? (
                              <div className="space-y-3">
                                {videoSegments.map((segment, index) => (
                                  <div key={segment.segment_id} className="border border-yellow-300 rounded-md p-3 bg-white">
                                    <div className="flex items-center justify-between mb-2">
                                      <h5 className="font-medium text-yellow-800">{segment.segment_name}</h5>
                                      <span className="text-sm text-yellow-600">
                                        {Math.round(segment.start_time / 1000)}s - {Math.round(segment.end_time / 1000)}s
                                      </span>
                                    </div>
                                    <div className="text-sm text-yellow-700">
                                      <div className="mb-2"><strong>Summary:</strong> {segment.segment_visual_description || 'Segment showing various content'}</div>
                                      <div className="flex flex-wrap gap-1">
                                        <strong>Keywords:</strong>
                                        {segment.segment_visual_description ? (
                                          segment.segment_visual_description.split(' ').slice(0, 5).map((word: string, idx: number) => (
                                            <span key={idx} className="bg-yellow-100 text-yellow-800 px-2 py-1 rounded-full text-xs">
                                              {word.replace(/[^a-zA-Z]/g, '')}
                                            </span>
                                          ))
                                        ) : (
                                          <span className="text-yellow-600 text-xs">No keywords available</span>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <div className="text-yellow-700 text-sm">Load segments first to see summary and keywords</div>
                            )}
                          </div>
                        </div>
                      )}
                      
                      {selectedAnalysisType === 'categorization_tags' && (
                        <div className="space-y-4">
                          <div className="bg-purple-50 border border-purple-200 rounded-md p-4">
                            <h4 className="font-medium text-purple-900 mb-2">Categorization Tags per Segment</h4>
                            {videoSegments.length > 0 ? (
                              <div className="space-y-3">
                                {videoSegments.map((segment, index) => (
                                  <div key={segment.segment_id} className="border border-purple-300 rounded-md p-3 bg-white">
                                    <div className="flex items-center justify-between mb-2">
                                      <h5 className="font-medium text-purple-800">{segment.segment_name}</h5>
                                      <span className="text-sm text-purple-600">
                                        {Math.round(segment.start_time / 1000)}s - {Math.round(segment.end_time / 1000)}s
                                      </span>
                                    </div>
                                    <div className="flex flex-wrap gap-1">
                                      <span className="bg-purple-100 text-purple-800 px-2 py-1 rounded-full text-xs">
                                        #{segment.segment_name.toLowerCase().replace(/\s+/g, '_')}
                                      </span>
                                      <span className="bg-purple-100 text-purple-800 px-2 py-1 rounded-full text-xs">
                                        #video_segment
                                      </span>
                                      <span className="bg-purple-100 text-purple-800 px-2 py-1 rounded-full text-xs">
                                        #duration_{Math.round(segment.duration / 1000)}s
                                      </span>
                                      {segment.confidence && (
                                        <span className="bg-purple-100 text-purple-800 px-2 py-1 rounded-full text-xs">
                                          #confidence_{(segment.confidence * 100).toFixed(0)}pct
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <div className="text-purple-700 text-sm">Load segments first to see categorization tags</div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
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
            </div>
          </>
        ) : (
          /* Analytics Panel */
          <div className="space-y-6">
            {/* Tag Analytics Dashboard */}
            <div className="bg-white rounded-lg shadow-md p-6">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-lg font-medium">Tag Analytics</h2>
                
                <button
                  onClick={exportTags}
                  disabled={!selectedIndexId || videos.length === 0}
                  className={`px-4 py-2 rounded-md text-white ${!selectedIndexId || videos.length === 0 ? 'bg-gray-400 cursor-not-allowed' : 'bg-purple-600 hover:bg-purple-700'}`}
                >
                  Export JSON
                </button>
              </div>
              
              {!selectedIndexId ? (
                <div className="bg-gray-100 p-4 rounded-md text-gray-600 text-center">
                  Please select an index to view analytics
                </div>
              ) : videos.length === 0 ? (
                <div className="bg-gray-100 p-4 rounded-md text-gray-600 text-center">
                  No videos found in this index
                </div>
              ) : filteredVideos.length === 0 && appliedTagFilters.length > 0 ? (
                <div className="bg-yellow-50 border border-yellow-200 p-4 rounded-md text-yellow-800 text-center">
                  <div className="text-sm">No videos match the selected tag filters</div>
                  <div className="text-xs mt-1">Clear filters to see all {videos.length} videos</div>
                </div>
              ) : (
                <div>
                  {/* Tag Frequency Chart */}
                  <div className="mb-8">
                    <h3 className="text-md font-medium mb-4">Tag Distribution</h3>
                    <div className="h-80 bg-gray-50 rounded-md p-4">
                      <canvas ref={chartRef}></canvas>
                    </div>
                  </div>
                  
                  {/* Tag List with Statistics */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <h3 className="text-md font-medium mb-4">Most Common Tags</h3>
                      <div className="bg-gray-50 rounded-md overflow-hidden">
                        <table className="min-w-full divide-y divide-gray-200">
                          <thead className="bg-gray-100">
                            <tr>
                              <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Tag</th>
                              <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Count</th>
                            </tr>
                          </thead>
                          <tbody className="bg-white divide-y divide-gray-200">
                            {allTags.slice(0, 10).map((stat, index) => (
                              <tr key={index} className="hover:bg-gray-50">
                                <td className="px-6 py-2 whitespace-nowrap text-sm font-medium text-gray-900">
                                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium mr-2 ${
                                    stat.type === 'category' ? getCategoryColor(stat.tag) : 'bg-gray-100 text-gray-800'
                                  }`}>
                                    {stat.type}
                                  </span>
                                  {stat.tag}
                                </td>
                                <td className="px-6 py-2 whitespace-nowrap text-sm text-gray-500">{stat.count}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                    
                    <div>
                      <h3 className="text-md font-medium mb-4">Index Statistics</h3>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="bg-gray-50 rounded-md p-4">
                          <div className="text-sm text-gray-500">
                            {appliedTagFilters.length > 0 ? 'Filtered Videos' : 'Total Videos'}
                          </div>
                          <div className="text-2xl font-semibold">{filteredVideos.length}</div>
                          {appliedTagFilters.length > 0 && (
                            <div className="text-xs text-gray-400">of {videos.length} total</div>
                          )}
                        </div>
                        <div className="bg-gray-50 rounded-md p-4">
                          <div className="text-sm text-gray-500">Unique Tags</div>
                          <div className="text-2xl font-semibold">{allTags.length}</div>
                          <div className="text-xs text-gray-400">
                            {allTags.filter(t => t.type === 'category').length} categories, {allTags.filter(t => t.type === 'alias').length} aliases
                          </div>
                        </div>
                        <div className="bg-gray-50 rounded-md p-4">
                          <div className="text-sm text-gray-500">Tagged Videos</div>
                          <div className="text-2xl font-semibold">
                            {filteredVideos.filter(video => {
                              const extendedVideo = video as any as ExtendedVideoResult;
                              if (!extendedVideo.video_objects) return false;
                              const categories = extractCategories(extendedVideo.video_objects);
                              const aliases = extractAliases(extendedVideo.video_objects);
                              return categories.length > 0 || aliases.length > 0;
                            }).length}
                          </div>
                          {appliedTagFilters.length > 0 && (
                            <div className="text-xs text-gray-400">in filtered set</div>
                          )}
                        </div>
                        <div className="bg-gray-50 rounded-md p-4">
                          <div className="text-sm text-gray-500">Avg. Tags Per Video</div>
                          <div className="text-2xl font-semibold">
                            {filteredVideos.length > 0
                              ? (filteredVideos.reduce((sum, video) => {
                                  const extendedVideo = video as any as ExtendedVideoResult;
                                  if (!extendedVideo.video_objects) return sum;
                                  const categories = extractCategories(extendedVideo.video_objects);
                                  const aliases = extractAliases(extendedVideo.video_objects);
                                  return sum + categories.length + aliases.length;
                                }, 0) / filteredVideos.length).toFixed(1)
                              : '0'}
                          </div>
                        </div>
                      </div>
                      
                      {/* Video Categories Grouping */}
                      <div className="mt-6">
                        <h3 className="text-md font-medium mb-4">Suggested Video Categories</h3>
                        <div className="bg-gray-50 rounded-md p-4">
                          {tags.length > 0 ? (
                            <div className="space-y-3">
                              {tags.length >= 5 && tagStatistics.some(stat => stat.tag.includes('product')) && (
                                <div>
                                  <h4 className="font-medium text-sm mb-2">Product Showcase</h4>
                                  <div className="flex flex-wrap gap-2">
                                    {tagStatistics
                                      .filter(stat => stat.tag.includes('product') || stat.tag.includes('showcase'))
                                      .slice(0, 4)
                                      .map((stat, idx) => (
                                        <span key={idx} className="bg-blue-100 text-blue-800 text-xs px-2 py-1 rounded-full">
                                          {stat.tag}
                                        </span>
                                      ))}
                                  </div>
                                </div>
                              )}
                              
                              {tags.length >= 5 && tagStatistics.some(stat => 
                                stat.tag.includes('emotion') || stat.tag.includes('feeling') || stat.tag.includes('mood')
                              ) && (
                                <div>
                                  <h4 className="font-medium text-sm mb-2">Emotional Appeal</h4>
                                  <div className="flex flex-wrap gap-2">
                                    {tagStatistics
                                      .filter(stat => 
                                        stat.tag.includes('emotion') || stat.tag.includes('feeling') || 
                                        stat.tag.includes('mood') || stat.tag.includes('joy') ||
                                        stat.tag.includes('happy') || stat.tag.includes('sad')
                                      )
                                      .slice(0, 4)
                                      .map((stat, idx) => (
                                        <span key={idx} className="bg-pink-100 text-pink-800 text-xs px-2 py-1 rounded-full">
                                          {stat.tag}
                                        </span>
                                      ))}
                                  </div>
                                </div>
                              )}
                              
                              {tags.length >= 5 && tagStatistics.some(stat => 
                                stat.tag.includes('lifestyle') || stat.tag.includes('life')
                              ) && (
                                <div>
                                  <h4 className="font-medium text-sm mb-2">Lifestyle</h4>
                                  <div className="flex flex-wrap gap-2">
                                    {tagStatistics
                                      .filter(stat => 
                                        stat.tag.includes('lifestyle') || stat.tag.includes('life') ||
                                        stat.tag.includes('daily') || stat.tag.includes('routine')
                                      )
                                      .slice(0, 4)
                                      .map((stat, idx) => (
                                        <span key={idx} className="bg-green-100 text-green-800 text-xs px-2 py-1 rounded-full">
                                          {stat.tag}
                                        </span>
                                      ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          ) : (
                            <p className="text-sm text-gray-500">No tags available to generate categories</p>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                  
                  {/* Asset Performance Indicators (mock data) */}
                  <div className="mt-8">
                    <h3 className="text-md font-medium mb-4">Asset Performance Indicators</h3>
                    <div className="bg-gray-50 rounded-md p-4">
                      <p className="text-sm text-gray-500 italic">
                        This feature will connect to your advertising platform analytics to show performance metrics for tagged videos.
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

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
                      <div><strong>Confidence:</strong> {(playingSegment.confidence * 100).toFixed(1)}%</div>
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