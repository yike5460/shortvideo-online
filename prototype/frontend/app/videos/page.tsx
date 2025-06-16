'use client'

import { useState, useEffect, useMemo, useRef, Fragment } from 'react'
import { ChevronDownIcon, ChevronUpIcon, XMarkIcon } from '@heroicons/react/24/outline'
import { VideoResult, TimestampedLabel, LabelInfo, NamedEntity } from '@/types'

// Extend VideoResult to include video_objects for TypeScript
interface ExtendedVideoResult extends VideoResult {
  video_objects?: TimestampedLabel[];
}
import VideoGrid from '@/components/VideoGrid'
import VideoModal from '@/components/VideoModal'
import { useSearchParams } from 'next/navigation'
import { useAuth } from '@/lib/auth/AuthContext'
import { EllipsisVerticalIcon } from '@heroicons/react/24/outline'
import IndexHeader from '@/components/IndexHeader'

// Add API configuration
const API_ENDPOINT = process.env.NEXT_PUBLIC_API_URL

interface VideoResponse {
  videos: VideoResult[];
  total: number;
  hasMore: boolean;
}

interface Index {
  id: string;
  name: string;
  status: 'ready' | 'indexing' | 'error';
  videoCount: number;
  isDefault?: boolean;
  expiresIn?: number; // Days until expiration
  indexId?: string;
  models?: {
    name: string;
    version: string;
    capabilities: ('visual' | 'audio')[];
  }[];
}

// Add a VideoCardMenu component for the dropdown
const VideoCardMenu = ({ 
  video, 
  onDelete, 
  onViewDetails,
  isOpen, 
  setIsOpen,
}: { 
  video: VideoResult, 
  onDelete: (video: VideoResult) => Promise<void>, 
  onViewDetails: (video: VideoResult) => void,
  isOpen: boolean, 
  setIsOpen: (open: boolean) => void,
}) => {
  // Create a local ref for this specific menu instance
  const menuRef = useRef<HTMLDivElement>(null);
  
  // Use useEffect to handle clicks outside this specific menu
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node) && isOpen) {
        setIsOpen(false);
      }
    }
    
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen, setIsOpen]);
  
  return (
    <div ref={menuRef} className="relative z-20">
      <button
        onClick={(e) => {
          e.stopPropagation();
          setIsOpen(!isOpen);
        }}
        className="p-2 rounded-full hover:bg-gray-200 transition-colors"
        aria-label="More options"
      >
        <EllipsisVerticalIcon className="h-5 w-5 text-gray-600" />
      </button>
      
      {isOpen && (
        <div className="absolute right-0 top-full mt-1 w-48 bg-white rounded-md shadow-lg py-1 ring-1 ring-black ring-opacity-5 z-50">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onViewDetails(video);
              setIsOpen(false);
            }}
            className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
          >
            View Details
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete(video);
              setIsOpen(false);
            }}
            className="block w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-gray-100"
          >
            Delete
          </button>
        </div>
      )}
    </div>
  );
};

// Helper function to check if a video is a merged video
const isMergedVideo = (video: VideoResult): boolean => {
  return Boolean(video.isMerged || (video.source && video.source === 'merged' as any));
};

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
const extractAllTags = (videos: VideoResult[]): {tag: string, count: number, type: 'category' | 'alias'}[] => {
  const tagCounts = new Map<string, {count: number, type: 'category' | 'alias'}>();
  
  videos.forEach(video => {
    // Cast to ExtendedVideoResult to access video_objects
    const extendedVideo = video as ExtendedVideoResult;
    
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

// Helper function to get limited tags for display in card (to avoid overcrowding)
const getLimitedTags = (tags: string[], limit: number = 3): { displayed: string[], remaining: number } => {
  if (!tags || !Array.isArray(tags)) return { displayed: [], remaining: 0 };
  
  if (tags.length <= limit) {
    return { displayed: tags, remaining: 0 };
  }
  
  return {
    displayed: tags.slice(0, limit),
    remaining: tags.length - limit
  };
};

// Custom dropdown component with scrollable options
function CustomSelect({
  options,
  value,
  onChange,
  placeholder,
  disabled
}: {
  options: {value: string, label: string}[],
  value: string,
  onChange: (value: string) => void,
  placeholder?: string,
  disabled?: boolean
}) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  
  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);
  
  // Find the selected option label
  const selectedOption = options.find(option => option.value === value);
  
  return (
    <div className="relative" ref={dropdownRef}>
      <button
        type="button"
        className={`w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm text-left focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 ${disabled ? 'bg-gray-100 cursor-not-allowed' : 'bg-white cursor-pointer'}`}
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled}
      >
        <span>{selectedOption ? selectedOption.label : placeholder || 'Select an option'}</span>
        <span className="absolute inset-y-0 right-0 flex items-center pr-2 pointer-events-none">
          <ChevronDownIcon className="h-5 w-5 text-gray-400" aria-hidden="true" />
        </span>
      </button>
      
      {isOpen && (
        <div className="absolute z-50 mt-1 w-full bg-white shadow-lg max-h-60 rounded-md py-1 text-base ring-1 ring-black ring-opacity-5 overflow-auto focus:outline-none sm:text-sm">
          {options.map((option) => (
            <div
              key={option.value}
              className={`cursor-pointer select-none relative py-2 pl-3 pr-9 hover:bg-gray-100 ${
                option.value === value ? 'bg-indigo-100 text-indigo-900' : 'text-gray-900'
              }`}
              onClick={() => {
                onChange(option.value);
                setIsOpen(false);
              }}
            >
              {option.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function VideosPage() {
  const { state } = useAuth()
  const searchParams = useSearchParams()
  const [videos, setVideos] = useState<VideoResult[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedVideo, setSelectedVideo] = useState<VideoResult | null>(null)
  const [indexes, setIndexes] = useState<Index[]>([])
  const [selectedIndexId, setSelectedIndexId] = useState<string | null>(null)
  const [isLoadingIndexes, setIsLoadingIndexes] = useState(false)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [modalViewMode, setModalViewMode] = useState<"play" | "details">("play")
  // Add a state to track the actual video counts per index
  const [indexVideoCounts, setIndexVideoCounts] = useState<Record<string, number>>({})
  // Track total videos for "All Videos" option
  const [totalVideos, setTotalVideos] = useState<number>(0)
  // Add a state to track which video's menu is open
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  // Add a state for delete confirmation
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [videoToDelete, setVideoToDelete] = useState<VideoResult | null>(null)
  // Add a ref to handle clicking outside the menu
  const menuRef = useRef<HTMLDivElement>(null)
  // Add state for sorting
  const [sortBy, setSortBy] = useState<string>("recent_upload")
  const [isSortDropdownOpen, setIsSortDropdownOpen] = useState<boolean>(false)
  const sortRef = useRef<HTMLDivElement>(null)
  // Add state for multiselect
  const [multiselectActive, setMultiselectActive] = useState<boolean>(false)
  const [selectedVideos, setSelectedVideos] = useState<Set<string>>(new Set())
  // Track total duration of selected videos
  const [totalSelectedDuration, setTotalSelectedDuration] = useState<string>("0m 0s")
  const [showConfidenceScores, setShowConfidenceScores] = useState(false)
  // Add state for showing merged videos
  const [includeMerged, setIncludeMerged] = useState(false)
  // Add state for tag management and filtering
  const [allTags, setAllTags] = useState<{tag: string, count: number, type: 'category' | 'alias'}[]>([])
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [appliedTags, setAppliedTags] = useState<string[]>([])
  
  // Add pagination state
  const [currentPage, setCurrentPage] = useState(1)
  const VIDEOS_PER_PAGE = 12
  
  // Initialize selectedIndexId from URL parameter
  useEffect(() => {
    const indexParam = searchParams.get('index');
    if (indexParam) {
      setSelectedIndexId(indexParam);
    }
  }, [searchParams]); // This will run when the component mounts and if searchParams changes
  
  // Define sort options
  const sortOptions = [
    { value: "recent_upload", label: "Recent upload" },
    { value: "video_duration", label: "Video duration" },
    { value: "video_name", label: "Video name" },
    { value: "video_resolution", label: "Video resolution" }
  ]
  
  // Parse duration string (HH:MM:SS) to seconds for sorting
  const parseDurationToSeconds = (duration: string): number => {
    if (!duration) return 0;
    const parts = duration.split(':').map(Number);
    if (parts.length === 3) {
      return parts[0] * 3600 + parts[1] * 60 + parts[2];
    } else if (parts.length === 2) {
      return parts[0] * 60 + parts[1];
    }
    return 0;
  };

  // Format seconds to human-readable duration
  const formatDuration = (totalSeconds: number): string => {
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = Math.floor(totalSeconds % 60);
    
    let result = '';
    if (hours > 0) {
      result += `${hours}h `;
    }
    if (minutes > 0 || hours > 0) {
      result += `${minutes}m `;
    }
    result += `${seconds}s`;
    
    return result;
  };
  
  // Calculate total duration of selected videos
  const calculateTotalDuration = (selectedIds: Set<string>) => {
    if (selectedIds.size === 0) return "0m 0s";
    
    let totalSeconds = 0;
    videos.forEach(video => {
      if (selectedIds.has(video.id)) {
        totalSeconds += parseDurationToSeconds(video.videoDuration || "0:00");
      }
    });
    
    return formatDuration(totalSeconds);
  };
  
  // Toggle selection of a video
  const toggleVideoSelection = (videoId: string) => {
    const newSelection = new Set(selectedVideos);
    if (newSelection.has(videoId)) {
      newSelection.delete(videoId);
    } else {
      newSelection.add(videoId);
    }
    setSelectedVideos(newSelection);
    setTotalSelectedDuration(calculateTotalDuration(newSelection));
  };
  
  // Clear all selections
  const clearSelection = () => {
    setSelectedVideos(new Set());
    setTotalSelectedDuration("0m 0s");
  };
  
  // Delete all selected videos
  const deleteSelectedVideos = async () => {
    if (selectedVideos.size === 0) return;
    
    try {
      setIsLoading(true);
      const deletePromises = Array.from(selectedVideos).map(id => {
        const video = videos.find(v => v.id === id);
        if (!video) return Promise.resolve();
        
        return fetch(`${API_ENDPOINT}/videos?index=${video.indexId}&videoId=${video.id}`, {
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/json',
            ...(state.session ? { 'Authorization': `Bearer ${state.session.token}` } : {})
          }
        });
      });
      
      await Promise.all(deletePromises);
      
      // Remove the deleted videos from the list
      setVideos(prevVideos => prevVideos.filter(v => !selectedVideos.has(v.id)));
      
      // Update video counts
      setTotalVideos(prev => prev - selectedVideos.size);
      
      // Clear selection
      clearSelection();
      
    } catch (error) {
      console.error('Error deleting videos:', error);
      setError(error instanceof Error ? error.message : 'Failed to delete videos');
    } finally {
      setIsLoading(false);
    }
  };

  // Add click outside handlers for menus and dropdowns
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      // Handle menu clicks outside
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setOpenMenuId(null);
      }
      
      // Handle sort dropdown clicks outside
      if (sortRef.current && !sortRef.current.contains(event.target as Node)) {
        setIsSortDropdownOpen(false);
      }
    }
    
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [menuRef, sortRef]);

  // Fetch videos on mount
  useEffect(() => {
    const fetchVideos = async () => {
      try {
        setIsLoading(true);
        // Build query parameters with selectedIndexId and includeMerged
        let queryParams = '';
        if (selectedIndexId || includeMerged) {
          queryParams = '?';
          if (selectedIndexId) {
            queryParams += `index=${selectedIndexId}`;
          }
          if (includeMerged) {
            queryParams += `${selectedIndexId ? '&' : ''}includeMerged=true`;
          }
        }
        const response = await fetch(`${API_ENDPOINT}/videos${queryParams}`);
        
        // Only throw for actual HTTP errors, not for empty results
        if (!response.ok) {
          if (response.status === 404) {
            // 404 could mean "no videos found" in some API designs - treat as empty array
            setVideos([]);
            return;
          }
          throw new Error(`Failed to fetch videos: ${response.statusText}`);
        }
        
        const data: VideoResponse = await response.json();
        // Even if we get a successful response, videos might be null or undefined
        const videosData = data.videos || [];
        setVideos(videosData); 
        
        // Extract all tags from videos
        const extractedTags = extractAllTags(videosData);
        setAllTags(extractedTags);
        
        // Update the total videos count when loading all videos
        if (!selectedIndexId && data.total) {
          setTotalVideos(data.total);
        }
      } catch (error) {
        console.error('Error fetching videos:', error);
        setError(error instanceof Error ? error.message : 'Failed to load videos');
      } finally {
        setIsLoading(false);
      }
    };

    fetchVideos();
  }, [selectedIndexId, includeMerged]); // Reload videos when index or includeMerged changes

  // Fetch indexes from backend - similar to implementation in page.tsx
  useEffect(() => {
    const fetchIndexes = async () => {
      if (!state.session) return;
      
      setIsLoadingIndexes(true);
      try {
        const response = await fetch(`${API_ENDPOINT}/indexes`, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${state.session.token}`
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
              status: item.video_status === 'error' ? 'error' : 'ready',
              videoCount: item.videoCount || 0,
              isDefault: item.isDefault || true, // Default to true for now
              expiresIn: Math.floor(Math.random() * 10) + 1, // Mock expiration days
              models: [
                {
                  name: 'OmniSpectra',
                  version: '1.0',
                  capabilities: ['visual', 'audio']
                }
              ]
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

        setIndexes(formattedIndexes);
      } catch (error) {
        console.error('Error fetching indexes:', error);
      } finally {
        setIsLoadingIndexes(false);
      }
    };

    fetchIndexes();
  }, [state.session, selectedIndexId]);

  // Filter videos by applied tags and sort them
  const sortedVideos = useMemo(() => {
    if (!videos || !Array.isArray(videos)) return [];
    
    // First filter by applied tags if any
    let filteredVideos = [...videos];
    if (appliedTags.length > 0) {
      filteredVideos = videos.filter(video => {
        // Cast to ExtendedVideoResult to access video_objects
        const extendedVideo = video as ExtendedVideoResult;
        if (!extendedVideo.video_objects) return false;
        
        // Extract all categories and aliases from this video
        const categories = extractCategories(extendedVideo.video_objects);
        const aliases = extractAliases(extendedVideo.video_objects);
        const allVideoTags = [...categories, ...aliases];
        
        // Check if any of the applied tags match this video's tags
        return appliedTags.some(appliedTag => allVideoTags.includes(appliedTag));
      });
    }
    
    // Then sort the filtered videos
    return filteredVideos.sort((a, b) => {
      switch (sortBy) {
        case "recent_upload":
          return new Date(b.uploadDate || 0).getTime() - new Date(a.uploadDate || 0).getTime();
        case "video_duration":
          return parseDurationToSeconds(b.videoDuration || "0") - parseDurationToSeconds(a.videoDuration || "0");
        case "video_name":
          return (a.title || "").localeCompare(b.title || "");
        case "video_resolution":
          // Would need video resolution data, default to title if not available
          return (a.title || "").localeCompare(b.title || "");
        default:
          return 0;
      }
    });
  }, [videos, sortBy, appliedTags]);

  // Calculate pagination values
  const totalFilteredVideos = sortedVideos.length;
  const totalPages = Math.ceil(totalFilteredVideos / VIDEOS_PER_PAGE);
  const startIndex = (currentPage - 1) * VIDEOS_PER_PAGE;
  const endIndex = startIndex + VIDEOS_PER_PAGE;
  const paginatedVideos = sortedVideos.slice(startIndex, endIndex);

  // Reset to page 1 when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [appliedTags, selectedIndexId, sortBy]);

  // Pagination handlers
  const goToPage = (page: number) => {
    setCurrentPage(Math.max(1, Math.min(page, totalPages)));
  };

  const goToPrevPage = () => {
    setCurrentPage(prev => Math.max(1, prev - 1));
  };

  const goToNextPage = () => {
    setCurrentPage(prev => Math.min(totalPages, prev + 1));
  };

  // Group videos by status
  const videosByStatus = useMemo(() => {
    if (!sortedVideos || !sortedVideos.length) return {}
    
    return sortedVideos.reduce((acc: { [key: string]: VideoResult[] }, video) => {
      const status = video.status || 'unknown'
      if (!acc[status]) {
        acc[status] = []
      }
      acc[status].push(video)
      return acc
    }, {})
  }, [sortedVideos])

  // Function to handle video card click - opens modal in play mode
  const handleVideoClick = (video: VideoResult) => {
    console.log("Video clicked:", video);
    setSelectedVideo(video);
    setModalViewMode("play");
    setIsModalOpen(true);
  };
  
  // Function to handle "View Details" click - opens modal in details mode
  const handleViewDetails = (video: VideoResult) => {
    console.log("View details clicked:", video);
    setSelectedVideo(video);
    setModalViewMode("details");
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setSelectedVideo(null);
  };
  
  // Function to handle video deletion
  const handleDeleteVideo = async (video: VideoResult) => {
    setVideoToDelete(video);
    setShowDeleteConfirm(true);
  };
  
  // Function to confirm video deletion
  const confirmDeleteVideo = async () => {
    if (!videoToDelete) return;
    
    try {
      setIsLoading(true);
      
      const { id, indexId } = videoToDelete;
      // Update to use query parameters instead of path parameters
      const response = await fetch(`${API_ENDPOINT}/videos?index=${indexId}&videoId=${id}`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          ...(state.session ? { 'Authorization': `Bearer ${state.session.token}` } : {})
        }
      });
      
      if (!response.ok) {
        throw new Error(`Failed to delete video: ${response.statusText}`);
      }
      
      // Remove the deleted video from the list
      setVideos(prevVideos => prevVideos.filter(v => v.id !== id));
      
      // Update video counts
      if (indexId) {
        setIndexVideoCounts(prev => ({
          ...prev,
          [indexId]: (prev[indexId] || 1) - 1
        }));
      }
      setTotalVideos(prev => prev - 1);
      
      // Close the confirmation dialog
      setShowDeleteConfirm(false);
      setVideoToDelete(null);
      
    } catch (error) {
      console.error('Error deleting video:', error);
      setError(error instanceof Error ? error.message : 'Failed to delete video');
    } finally {
      setIsLoading(false);
    }
  };
  

  // Handle delete index
  const handleDeleteIndex = async () => {
    if (!selectedIndexId) return;
    
    if (confirm(`Are you sure you want to delete this index? This action cannot be undone.`)) {
      try {
        setIsLoading(true);
        
        // Make API call to delete the index
        const response = await fetch(`${API_ENDPOINT}/indexes/${selectedIndexId}`, {
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/json',
            ...(state.session ? { 'Authorization': `Bearer ${state.session.token}` } : {})
          }
        });
        
        if (!response.ok) {
          throw new Error(`Failed to delete index: ${response.statusText}`);
        }
        
        const result = await response.json();
        console.log(`Successfully deleted index: ${selectedIndexId}`, result);
        
        // Remove the index from the list
        setIndexes(prevIndexes => prevIndexes.filter(index => index.id !== selectedIndexId));
        
        // Reset selected index
        setSelectedIndexId(null);
      } catch (error) {
        console.error('Error deleting index:', error);
        setError(error instanceof Error ? error.message : 'Failed to delete index');
      } finally {
        setIsLoading(false);
      }
    }
  };
  
  // Handle upload videos
  const handleUploadClick = () => {
    // Navigate to upload page
    window.location.href = "/create";
  };
  
  const selectedIndex = selectedIndexId 
    ? indexes.find(index => index.id === selectedIndexId)
    : null;

  if (isLoading) {
    return (
      <div className="container mx-auto p-4">
        {selectedIndex ? (
          <IndexHeader 
            indexId={selectedIndex.id}
            indexName={selectedIndex.name}
            isDefault={selectedIndex.isDefault}
            expiresIn={selectedIndex.expiresIn}
            models={selectedIndex.models}
            onUploadClick={handleUploadClick}
            onDeleteIndex={handleDeleteIndex}
          />
        ) : (
          <h1 className="text-2xl font-bold mb-6">My Videos</h1>
        )}
        
        <div className="flex items-center justify-center h-64">
          <div className="flex flex-col items-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-500 mb-4"></div>
            <div className="text-gray-600">Loading videos{selectedIndexId ? ` from ${selectedIndexId}` : ''}...</div>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="container mx-auto p-4">
        {selectedIndex ? (
          <IndexHeader 
            indexId={selectedIndex.id}
            indexName={selectedIndex.name}
            isDefault={selectedIndex.isDefault}
            expiresIn={selectedIndex.expiresIn}
            models={selectedIndex.models}
            onUploadClick={handleUploadClick}
            onDeleteIndex={handleDeleteIndex}
          />
        ) : (
          <h1 className="text-2xl font-bold mb-6">My Videos</h1>
        )}
        
        <div className="flex items-center justify-center h-64">
          <div className="text-red-600">{error}</div>
        </div>
      </div>
    );
  }

  if (!videos.length) {
    return (
      <div className="container mx-auto p-4">
        {selectedIndex ? (
          <IndexHeader 
            indexId={selectedIndex.id}
            indexName={selectedIndex.name}
            isDefault={selectedIndex.isDefault}
            expiresIn={selectedIndex.expiresIn}
            models={selectedIndex.models}
            onUploadClick={handleUploadClick}
            onDeleteIndex={handleDeleteIndex}
          />
        ) : (
          <h1 className="text-2xl font-bold mb-6">My Videos</h1>
        )}
        
        <div className="flex items-center justify-center h-64">
          <div className="text-gray-600">
            {selectedIndexId 
              ? `No videos found in index "${selectedIndexId}".` 
              : "No videos found across all indexes."} <a href="/create" className="text-blue-600 hover:underline">Upload your first video</a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-4">
      {/* Index Header with Selection UI */}
      <div className="mb-6">
        {selectedIndex ? (
          <IndexHeader 
            indexId={selectedIndex.id}
            indexName={selectedIndex.name}
            isDefault={selectedIndex.isDefault}
            expiresIn={selectedIndex.expiresIn}
            models={selectedIndex.models}
            onUploadClick={handleUploadClick}
            onDeleteIndex={handleDeleteIndex}
          />
        ) : (
          <h1 className="text-2xl font-bold">All Videos</h1>
        )}
      </div>
      
      {/* Index Selection and Tag Library Section */}
      <div className="mb-6 md:flex md:space-x-8 items-start">
        {/* Index Selection Dropdown */}
        <div className="md:w-1/4 mb-4 md:mb-0">
          <label htmlFor="index-select" className="block text-sm font-medium text-gray-700 mb-2">
            Switch Index
          </label>
          <div className="relative mb-3">
            <CustomSelect
              options={[
                { value: '', label: `All Indexes (${totalVideos})` },
                ...indexes
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map(index => ({
                    value: index.id,
                    label: `${index.name} (${index.videoCount} videos)`
                  }))
              ]}
              value={selectedIndexId || ''}
              onChange={(newIndex) => {
                setSelectedIndexId(newIndex || null);
                // Reset videos array to show loading state when changing indexes
                setVideos([]);
                setIsLoading(true);
                // Reset selected tags when changing index
                setSelectedTags([]);
              }}
              placeholder="Select an index"
              disabled={isLoadingIndexes}
            />
            {isLoading && (
              <div className="absolute right-10 top-3">
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-indigo-500"></div>
              </div>
            )}
          </div>
          
          {/* Add checkbox for merged videos */}
          <div className="flex items-center">
            <input
              id="include-merged"
              type="checkbox"
              className="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded"
              checked={includeMerged}
              onChange={(e) => setIncludeMerged(e.target.checked)}
            />
            <label htmlFor="include-merged" className="ml-2 block text-sm text-gray-700">
              Include merged video clips
            </label>
          </div>
        </div>
        
        {/* Tag Library */}
        <div className="flex-1">
          <div className="flex justify-between items-center mb-2">
            <div>
            <label className="block text-sm font-medium text-gray-700">
              Categories & Tags
            </label>
              <p className="text-xs text-gray-500 mt-1">
                Click tags to select, then apply filters to show matching videos
              </p>
            </div>
            {selectedTags.length > 0 && (
              <div className="flex space-x-3">
                <button
                  type="button"
                  className="inline-flex items-center px-3 py-1.5 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-md transition-colors duration-200 shadow-sm"
                  onClick={() => setAppliedTags([...selectedTags])}
                >
                  <svg className="w-4 h-4 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
                  </svg>
                  Apply filters ({selectedTags.length})
                </button>
                <button
                  type="button"
                  className="inline-flex items-center px-3 py-1.5 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-md transition-colors duration-200"
                  onClick={() => {
                    setSelectedTags([]);
                    setAppliedTags([]);
                  }}
                >
                  <svg className="w-4 h-4 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                  Clear
                </button>
              </div>
            )}
          </div>
          
          {/* Show active filters if any */}
          {appliedTags.length > 0 && (
            <div className="mb-3 p-2 bg-indigo-50 border border-indigo-200 rounded-md">
              <div className="flex items-center justify-between">
                <div className="flex items-center">
                  <svg className="w-4 h-4 text-indigo-600 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
                  </svg>
                  <span className="text-sm font-medium text-indigo-800">Active filters:</span>
                  <div className="flex flex-wrap gap-1 ml-2">
                    {appliedTags.map(tag => (
                      <span key={tag} className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-indigo-100 text-indigo-800">
                        {tag}
                        <button
                          onClick={() => {
                            const newAppliedTags = appliedTags.filter(t => t !== tag);
                            setAppliedTags(newAppliedTags);
                            setSelectedTags(newAppliedTags);
                          }}
                          className="ml-1 hover:text-indigo-600"
                        >
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </span>
                    ))}
                  </div>
                </div>
                <button
                  onClick={() => {
                    setAppliedTags([]);
                    setSelectedTags([]);
                  }}
                  className="text-xs text-indigo-600 hover:text-indigo-800 font-medium"
                >
                  Clear all
                </button>
              </div>
            </div>
          )}
          
          <div className="border border-gray-200 rounded-md p-3 bg-gray-50 h-[105px] overflow-y-auto">
            {allTags.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {allTags.map(tag => (
                  <button
                    key={tag.tag}
                    onClick={() => {
                      // Toggle tag selection
                      if (selectedTags.includes(tag.tag)) {
                        setSelectedTags(prev => prev.filter(t => t !== tag.tag));
                      } else {
                        setSelectedTags(prev => [...prev, tag.tag]);
                      }
                    }}
                    className={`inline-flex items-center px-3 py-1.5 rounded-full text-xs font-medium cursor-pointer transition-all duration-200 transform hover:scale-105 hover:shadow-sm
                      ${selectedTags.includes(tag.tag) 
                        ? 'bg-indigo-100 text-indigo-800 border-2 border-indigo-300 shadow-sm ring-2 ring-indigo-200' 
                        : tag.type === 'category' 
                          ? `${getCategoryColor(tag.tag)} hover:opacity-80 border border-transparent hover:border-gray-300` 
                          : 'bg-gray-100 text-gray-800 hover:bg-gray-200 border border-transparent hover:border-gray-300'
                      }`}
                    title={`Click to ${selectedTags.includes(tag.tag) ? 'remove' : 'add'} "${tag.tag}" filter`}
                  >
                    {selectedTags.includes(tag.tag) && (
                      <svg className="w-3 h-3 mr-1 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                    {tag.tag} 
                    <span className={`ml-1.5 text-xs px-1.5 py-0.5 rounded-full ${selectedTags.includes(tag.tag) ? 'bg-indigo-200 text-indigo-800' : 'bg-white text-gray-600'}`}>
                      {tag.count}
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="flex items-center justify-center h-full">
                <div className="text-center">
                  <svg className="w-8 h-8 text-gray-400 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
                  </svg>
              <div className="text-gray-500 text-sm">No categories or tags detected</div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
      
      {/* Divider line */}
      <div className="border-b border-gray-200 mb-6"></div>
      
              {/* Video info and Sorting - combined section */}
      <div className="flex justify-between items-center mb-6">
        <div className="flex items-center space-x-4">
          {/* Video count and total duration */}
          <div className="flex items-center">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-gray-500 mr-2" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm3 2h6v4H7V5zm8 8v2h1v-2h-1zm-2-2H7v4h6v-4zm2 0h1V9h-1v2zm1-4V5h-1v2h1zM5 5v2H4V5h1zm0 4H4v2h1V9zm-1 4h1v2H4v-2z" clipRule="evenodd" />
            </svg>
            <span className="font-semibold">
              {totalFilteredVideos > 0 ? (
                <>
                  {`${totalFilteredVideos} video${totalFilteredVideos !== 1 ? 's' : ''}`}
                  {totalPages > 1 && (
                    <span className="text-gray-600 font-normal"> (showing {paginatedVideos.length} on page {currentPage})</span>
                  )}
                  <span className="text-gray-600 font-normal"> - Total {calculateTotalDuration(new Set(sortedVideos.map(v => v.id)))}</span>
                </>
              ) : (
                'No videos found'
              )}
            </span>
          </div>
          
          {/* Index creation date */}
          <div className="flex items-center text-gray-600">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            <span>Index created on {new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
          </div>
        </div>
        
        {/* Sort controls */}
        <div className="flex items-center">
          {/* Sort By Dropdown */}
          <div className="relative" ref={sortRef}>
            <div className="flex items-center">
              <span className="text-gray-700 mr-2">Sort by :</span>
              <button
                type="button"
                className="flex items-center px-3 py-1 bg-gray-200 rounded-md text-gray-800 hover:bg-gray-300 focus:outline-none"
                onClick={() => setIsSortDropdownOpen(!isSortDropdownOpen)}
              >
                <span>{sortOptions.find(opt => opt.value === sortBy)?.label || "Recent upload"}</span>
                <span className="ml-2">
                  {isSortDropdownOpen ? (
                    <ChevronUpIcon className="h-4 w-4" />
                  ) : (
                    <ChevronDownIcon className="h-4 w-4" />
                  )}
                </span>
              </button>
            </div>

            {/* Dropdown menu */}
            {isSortDropdownOpen && (
              <div className="absolute right-0 mt-1 w-48 bg-white rounded-md shadow-lg py-1 z-50">
                {sortOptions.map((option) => (
                  <button
                    key={option.value}
                    className={`block w-full text-left px-4 py-2 text-sm ${
                      sortBy === option.value ? 'bg-gray-200' : 'hover:bg-gray-100'
                    }`}
                    onClick={() => {
                      setSortBy(option.value);
                      setIsSortDropdownOpen(false);
                    }}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
      
      {/* Unified video grid */}
      <div className="mb-12">
        {totalFilteredVideos === 0 ? (
          <div className="flex items-center justify-center h-64">
            <div className="text-center">
              <svg className="w-12 h-12 text-gray-400 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
              </svg>
              <div className="text-gray-500 text-lg">No videos match your current filters</div>
              <div className="text-gray-400 text-sm mt-1">Try adjusting your search criteria or clearing the filters</div>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {paginatedVideos.map((video) => (
                <div 
                  key={video.id} 
                  className={`relative bg-white rounded-lg shadow-md overflow-hidden group
                    ${video.isMerged ? 'border-2 border-purple-500' : ''}
                  `}
                >
                  {/* Make only the thumbnail area clickable */}
                  <div className="relative aspect-video bg-gray-100 cursor-pointer"
                    onClick={() => handleVideoClick(video)}
                  >
                    {/* Display static thumbnail instead of video */}
                    {video.videoThumbnailUrl ? (
                      <img
                        src={video.videoThumbnailUrl}
                        alt={video.title || video.description || "Video thumbnail"}
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
                    
                    {/* Play icon overlay */}
                    <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                      <div className="w-16 h-16 bg-black bg-opacity-60 rounded-full flex items-center justify-center">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                      </div>
                    </div>
                    
                    {/* Duration badge */}
                    <div className="absolute bottom-2 right-2 bg-black bg-opacity-70 text-white text-xs px-2 py-1 rounded">
                      {video.videoDuration || '00:00'}
                    </div>
                    
                    {/* Index badge - show the index if we're not already filtering by index */}
                    {!selectedIndexId && video.indexId && (
                      <div className="absolute top-2 left-2 bg-black bg-opacity-70 text-white text-xs px-2 py-1 rounded">
                        {video.indexId}
                      </div>
                    )}
                    
                    {/* Merged video badge */}
                    {isMergedVideo(video) && (
                      <div className="absolute top-2 right-14 bg-purple-600 text-white text-xs px-2 py-1 rounded">
                        Merged
                      </div>
                    )}
                  </div>
                  
                  {/* Non-clickable text area */}
                  <div className="p-4">
                    <h3 className="text-lg font-medium truncate pr-8">{video.title || video.description || "Untitled Video"}</h3>
                    <p className="text-sm text-gray-500 mt-1">
                      Uploaded {new Date(video.uploadDate || Date.now()).toLocaleDateString()}
                    </p>
                    
                    {/* Category tags */}
                    {(() => {
                      // Cast to ExtendedVideoResult to access video_objects
                      const extendedVideo = video as ExtendedVideoResult;
                      if (extendedVideo.video_objects) {
                        const categories = extractCategories(extendedVideo.video_objects);
                        if (categories.length > 0) {
                          const { displayed, remaining } = getLimitedTags(categories, 3);
                          return (
                            <div className="mt-2 flex flex-wrap gap-1">
                              {displayed.map((category, index) => (
                                <span 
                                  key={`${video.id}-${category}-${index}`} 
                                  className={`px-2 py-0.5 rounded-full text-xs ${getCategoryColor(category)}`}
                                >
                                  {category}
                                </span>
                              ))}
                              {remaining > 0 && (
                                <span className="px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-800" title={`${remaining} more categories`}>
                                  +{remaining} more
                                </span>
                              )}
                            </div>
                          );
                        }
                      }
                      return null;
                    })()}
                  </div>
                  
                  {/* Video card menu in absolute position - hide during multiselect */}
                  {!multiselectActive && (
                    <div className="absolute top-2 right-2 z-20">
                      <VideoCardMenu
                        video={video}
                        onDelete={handleDeleteVideo}
                        onViewDetails={handleViewDetails}
                        isOpen={openMenuId === video.id}
                        setIsOpen={(open) => setOpenMenuId(open ? video.id : null)}
                      />
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
          
                {/* Pagination Controls */}
        {totalPages > 1 && totalFilteredVideos > 0 && (
            <div className="mt-8 p-4 bg-gray-50 rounded-lg border border-gray-200 flex flex-col md:flex-row items-center justify-between gap-4">
              <div className="flex flex-col sm:flex-row items-center text-sm text-gray-600 space-y-2 sm:space-y-0 sm:space-x-4">
                <span className="text-center sm:text-left">
                  Showing {startIndex + 1} to {Math.min(endIndex, totalFilteredVideos)} of {totalFilteredVideos} videos
                </span>
                <div className="flex items-center">
                  <span className="text-gray-500">Page</span>
                  <span className="mx-2 px-2 py-1 bg-gradient-blue-teal text-white text-xs font-semibold rounded-md shadow-sm">
                    {currentPage}
                  </span>
                  <span className="text-gray-500">of {totalPages}</span>
                </div>
              </div>
              
              <div className="flex items-center space-x-1 sm:space-x-2">
                {/* Previous button */}
                <button
                  onClick={goToPrevPage}
                  disabled={currentPage === 1}
                  className={`flex items-center px-3 py-2 text-sm font-medium rounded-lg transition-all duration-200 ${
                    currentPage === 1
                      ? 'text-gray-400 cursor-not-allowed bg-gray-100'
                      : 'text-blue-deep hover:bg-blue-50 hover:shadow-sm focus:bg-blue-50'
                  }`}
                >
                  <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                  Previous
                </button>
                
                {/* Page numbers */}
                <div className="flex items-center space-x-1">
                  {Array.from({ length: Math.min(7, totalPages) }, (_, i) => {
                    let pageNum;
                    if (totalPages <= 7) {
                      pageNum = i + 1;
                    } else if (currentPage <= 4) {
                      pageNum = i + 1;
                    } else if (currentPage >= totalPages - 3) {
                      pageNum = totalPages - 6 + i;
                    } else {
                      pageNum = currentPage - 3 + i;
                    }
                    
                    return (
                      <button
                        key={pageNum}
                        onClick={() => goToPage(pageNum)}
                        className={`px-4 py-2 text-sm font-medium rounded-lg transition-all duration-200 ${
                          currentPage === pageNum
                            ? 'bg-white text-blue-deep border-2 border-blue-deep shadow-md ring-2 ring-blue-300 ring-opacity-50 transform scale-105 font-bold'
                            : 'text-gray-700 hover:bg-blue-50 hover:text-blue-deep hover:shadow-sm'
                        }`}
                      >
                        {pageNum}
                      </button>
                    );
                  })}
                </div>
                
                {/* Next button */}
                <button
                  onClick={goToNextPage}
                  disabled={currentPage === totalPages}
                  className={`flex items-center px-3 py-2 text-sm font-medium rounded-lg transition-all duration-200 ${
                    currentPage === totalPages
                      ? 'text-gray-400 cursor-not-allowed bg-gray-100'
                      : 'text-blue-deep hover:bg-blue-50 hover:shadow-sm focus:bg-blue-50'
                  }`}
                >
                  Next
                  <svg className="w-4 h-4 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              </div>
            </div>
          )}
      
      
      {/* Use the shared VideoModal component */}
      <VideoModal
        video={selectedVideo}
        isOpen={isModalOpen}
        onClose={closeModal}
        viewMode={modalViewMode}
      />
      
      {/* Delete Confirmation Dialog */}
      {showDeleteConfirm && videoToDelete && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg max-w-md w-full p-6 shadow-xl">
            <h3 className="text-lg font-medium text-gray-900 mb-4">Confirm Delete</h3>
            <p className="text-gray-600 mb-6">
              Are you sure you want to delete "{videoToDelete.title || 'Untitled Video'}"? This action cannot be undone.
            </p>
            <div className="flex justify-end space-x-3">
              <button
                type="button"
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-md"
                onClick={() => {
                  setShowDeleteConfirm(false);
                  setVideoToDelete(null);
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-md"
                onClick={confirmDeleteVideo}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
