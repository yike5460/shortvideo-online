'use client'

import { useState, useEffect, useMemo, useRef, Fragment } from 'react'
import { ChevronDownIcon, ChevronUpIcon } from '@heroicons/react/24/outline'
import { VideoResult } from '@/types'
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
        // Add the selectedIndexId to the query parameters if it exists
        const queryParams = selectedIndexId ? `?index=${selectedIndexId}` : '';
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
        console.log('Videos data:', data);
        // Even if we get a successful response, videos might be null or undefined
        setVideos(data.videos || []); 
        
        // Update the total videos count when loading all videos
        if (!selectedIndexId && data.videos.length > 0) {
          setTotalVideos(data.videos.length);
        }
      } catch (error) {
        console.error('Error fetching videos:', error);
        setError(error instanceof Error ? error.message : 'Failed to load videos');
      } finally {
        setIsLoading(false);
      }
    };

    fetchVideos();
  }, [selectedIndexId]); // Add selectedIndexId as a dependency so videos are refreshed when index changes

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

  // Sort videos based on selection
  const sortedVideos = useMemo(() => {
    if (!videos || !Array.isArray(videos)) return [];
    
    return [...videos].sort((a, b) => {
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
  }, [videos, sortBy]);

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
  const handleDeleteIndex = () => {
    if (!selectedIndexId) return;
    
    // In a real app, you would call your API here
    if (confirm(`Are you sure you want to delete this index? This action cannot be undone.`)) {
      console.log(`Deleting index with ID: ${selectedIndexId}`);
      
      // Remove the index from the list
      setIndexes(prevIndexes => prevIndexes.filter(index => index.id !== selectedIndexId));
      
      // Reset selected index
      setSelectedIndexId(null);
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
        <div className="mb-6">
          <h1 className="text-2xl font-bold mb-4">All Videos</h1>
          <button 
            onClick={handleUploadClick}
            className="bg-gray-200 hover:bg-gray-300 text-gray-800 font-medium py-2 px-4 rounded-md flex items-center transition-colors"
          >
            Upload videos
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 ml-2" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM6.293 6.707a1 1 0 010-1.414l3-3a1 1 0 011.414 0l3 3a1 1 0 01-1.414 1.414L11 5.414V13a1 1 0 11-2 0V5.414L7.707 6.707a1 1 0 01-1.414 0z" clipRule="evenodd" />
            </svg>
          </button>
        </div>
      )}
      
      {/* Index Selection Dropdown - keep this for switching between indexes */}
      <div className="mb-6">
        <label htmlFor="index-select" className="block text-sm font-medium text-gray-700 mb-1">
          Switch Index
        </label>
        <div className="relative">
          <select
            id="index-select"
            className="w-full md:w-64 px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
            value={selectedIndexId || ''}
            onChange={(e) => {
              const newIndex = e.target.value || null;
              setSelectedIndexId(newIndex);
              // Reset videos array to show loading state when changing indexes
              setVideos([]);
              setIsLoading(true);
            }}
            disabled={isLoadingIndexes}
          >
            <option value="">All Indexes ({totalVideos})</option>
            {indexes.length > 0 ? (
              indexes.map((index) => (
                <option key={index.id} value={index.id}>
                  {index.name} ({index.videoCount} videos)
                </option>
              ))
            ) : (
              <option value="" disabled>
                {isLoadingIndexes ? 'Loading indexes...' : 'No indexes available'}
              </option>
            )}
          </select>
          {isLoading && (
            <div className="absolute right-10 top-3">
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-indigo-500"></div>
            </div>
          )}
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
              {multiselectActive && selectedVideos.size > 0 
                ? `${selectedVideos.size} selected (Total ${totalSelectedDuration})` 
                : `${videos.length} video${videos.length !== 1 ? 's' : ''} (Total ${calculateTotalDuration(new Set(videos.map(v => v.id)))})`}
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
        
        {/* Sort and multiselect controls */}
        <div className="flex items-center">
          {/* Sort By Dropdown */}
          <div className="relative mr-4" ref={sortRef}>
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
          
          <div className="flex items-center gap-4 border-l border-gray-300 pl-4">
            <button 
              onClick={() => setMultiselectActive(!multiselectActive)}
              className={`px-3 py-1 ${multiselectActive 
                ? 'bg-indigo-100 text-indigo-700 border border-indigo-300' 
                : 'text-gray-700 hover:bg-gray-100'} rounded-md`}
            >
              Multiselect
            </button>
            
            {multiselectActive && selectedVideos.size > 0 && (
              <>
                <button 
                  onClick={clearSelection}
                  className="px-3 py-1 text-gray-700 hover:bg-gray-100 rounded-md"
                >
                  Clear
                </button>
                <button 
                  onClick={deleteSelectedVideos}
                  className="px-3 py-1 text-white bg-red-600 hover:bg-red-700 rounded-md flex items-center"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                  Delete
                </button>
              </>
            )}
          </div>
        </div>
      </div>
      
      {/* Status sections, only show videos with status ready or similar processing states */}
      {Object.entries(videosByStatus).map(([status, statusVideos]) => (
        // Currently we display all the videos don't filter the status with prefix 'ready_for'
        (status.startsWith('')) && (
          <div key={status} className="mb-12">
            <h2 className="mb-4 text-lg font-semibold text-gray-900 capitalize">
              {status.replace(/_/g, ' ')}
              <span className="ml-2 text-sm text-gray-500">
                ({statusVideos.length})
              </span>
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
              {statusVideos.map((video) => (
                <div 
                  key={video.id} 
                  className="relative bg-white rounded-lg shadow-md overflow-hidden group"
                >
                  {/* Make only the thumbnail area clickable */}
                  <div className="relative aspect-video bg-gray-100 cursor-pointer"
                    onClick={(e) => {
                      if (multiselectActive) {
                        e.preventDefault();
                        toggleVideoSelection(video.id);
                      } else {
                        handleVideoClick(video);
                      }
                    }}
                  >
                    {/* Selection indicator - only visible in multiselect mode */}
                    {multiselectActive && (
                      <div className={`absolute top-3 right-3 z-10 w-6 h-6 flex items-center justify-center rounded-full border-2 ${
                        selectedVideos.has(video.id) 
                          ? 'bg-indigo-600 border-indigo-600' 
                          : 'bg-white border-gray-300'
                      }`}>
                        {selectedVideos.has(video.id) && (
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-white" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                          </svg>
                        )}
                      </div>
                    )}
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
                  </div>
                  
                  {/* Non-clickable text area */}
                  <div className="p-4">
                    <h3 className="text-lg font-medium truncate pr-8">{video.title || video.description || "Untitled Video"}</h3>
                    <p className="text-sm text-gray-500 mt-1">
                      Uploaded {new Date(video.uploadDate || Date.now()).toLocaleDateString()}
                    </p>
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
          </div>
        )
      ))}
      
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
