'use client';

import React, { useState, useRef, useEffect } from 'react';
import { XMarkIcon, ArrowsRightLeftIcon, CloudArrowDownIcon, TrashIcon, ShoppingCartIcon, ChevronUpDownIcon } from '@heroicons/react/24/outline';
import { useCart, CartItem, MergeOptions } from '@/lib/cart/CartContext';
import { useToast } from '@/components/ui/Toast';
import { mergeUtility } from '@/lib/merge/MergeUtility';
import { useAuth } from '@/lib/auth/AuthContext';

interface CartPanelProps {
  isOpen: boolean;
  onClose: () => void;
  className?: string;
}

// Helper function to format time display
const formatTimeDisplay = (timeMs: number): string => {
  const totalSeconds = Math.floor(timeMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  
  if (hours > 0) {
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
};

export const CartPanel: React.FC<CartPanelProps> = ({ isOpen, onClose, className = '' }) => {
  const {
    items,
    removeFromCart,
    clearCart,
    mergeOptions,
    updateMergeOptions,
    reorderItems,
    updateItemTransition
  } = useCart();
  const { addToast } = useToast();
  const { state: authState } = useAuth();
  const userId = authState.user?.id || 'anonymous';
  const [selectedItems, setSelectedItems] = useState<Record<string, boolean>>({});
  const [isMerging, setIsMerging] = useState(false);
  const [mergeProgress, setMergeProgress] = useState(0);
  const [customMergeName, setCustomMergeName] = useState<string>('');
  const [draggedItem, setDraggedItem] = useState<number | null>(null);
  const [dragOverItem, setDragOverItem] = useState<number | null>(null);
  
  // Group items by video
  const itemsByVideo = items.reduce<Record<string, CartItem[]>>((acc, item) => {
    const key = `${item.indexId}-${item.videoId}`;
    if (!acc[key]) {
      acc[key] = [];
    }
    acc[key].push(item);
    return acc;
  }, {});
  
  const handleSelectItem = (segmentId: string) => {
    setSelectedItems(prev => ({
      ...prev,
      [segmentId]: !prev[segmentId]
    }));
  };
  
  const handleSelectAll = () => {
    const newSelected: Record<string, boolean> = {};
    items.forEach(item => {
      newSelected[item.segment.segment_id!] = true;
    });
    setSelectedItems(newSelected);
  };
  
  const handleDeselectAll = () => {
    setSelectedItems({});
  };
  
  const getSelectedCount = () => {
    return Object.values(selectedItems).filter(Boolean).length;
  };
  
  const getSelectedItems = () => {
    return items.filter(item => selectedItems[item.segment.segment_id!]);
  };
  
  const handleMergeSelected = async () => {
    const selected = getSelectedItems();
    if (selected.length < 2) {
      addToast('error', 'Please select at least 2 clips to merge');
      return;
    }
    
    // Get the first item for reference
    const firstItem = selected[0];
    
    setIsMerging(true);
    setMergeProgress(0);
    
    try {
      // Get segment IDs for the API call
      const segmentIds = selected.map(item => item.segment.segment_id!);
      
      // Use the video_id from the segment data (this is the correct OpenSearch document ID)
      const extractedVideoId = selected[0].segment.video_id;
      
      // Use the selectedIndex if available, otherwise fall back to the item's indexId
      const indexId = firstItem.selectedIndex || firstItem.indexId;
      
      // Use custom merge name if provided, otherwise use default
      const mergedName = customMergeName.trim()
        ? customMergeName.trim()
        : `cart_merged_${Date.now()}`;
      
      // Create merge parameters with complete segment data
      const mergeParams = {
        indexId,
        videoId: extractedVideoId,
        segmentIds,
        segmentsData: selected.map(item => item.segment), // Pass complete segment data
        mergedName,
        userId,
        mergeOptions: {
          resolution: mergeOptions.resolution,
          transition: mergeOptions.defaultTransition,
          transitionDuration: mergeOptions.defaultTransitionDuration,
          clipTransitions: selected.map(item => ({
            segmentId: item.segment.segment_id,
            transitionType: item.transitionType || mergeOptions.defaultTransition,
            transitionDuration: item.transitionDuration || mergeOptions.defaultTransitionDuration
          }))
        }
      };
      
      // Show processing toast
      addToast('info', 'Starting merge process. This may take a minute...');
      
      // Initiate merge job
      const jobId = await mergeUtility.initiateVideoMerge(mergeParams);
      
      // Poll for job status
      mergeUtility.pollMergeJobStatus(jobId, userId, {
        onProgress: (progress) => {
          setMergeProgress(progress);
        },
        onComplete: (result) => {
          // Remove merged items from cart
          selected.forEach(item => {
            removeFromCart(item.segment.segment_id!);
          });
          
          addToast('success', `Successfully merged ${selected.length} clips`, {
            duration: 5000,
            action: {
              label: 'View merged video',
              onClick: () => {
                window.location.href = `/videos?indexId=${encodeURIComponent(indexId)}&videoId=${encodeURIComponent(extractedVideoId)}`;
              }
            }
          });
          
          setIsMerging(false);
          setMergeProgress(0);
          setCustomMergeName(''); // Clear the custom merge name after successful merge
        },
        onFailed: (error) => {
          addToast('error', `Failed to merge segments: ${error}`);
          setIsMerging(false);
          setMergeProgress(0);
        }
      });
    } catch (error) {
      console.error('Error merging segments:', error);
      addToast('error', `Failed to merge segments: ${error instanceof Error ? error.message : 'Unknown error'}`);
      setIsMerging(false);
      setMergeProgress(0);
    }
  };
  
  const handleDownloadSelected = () => {
    const selected = getSelectedItems();
    if (selected.length === 0) {
      addToast('error', 'Please select at least one clip to download');
      return;
    }
    
    // Use existing download functionality
    // This is simplified - in reality, you'd need to implement proper download logic
    selected.forEach((item, index) => {
      const segmentUrl = item.segment.segment_video_preview_url;
      if (!segmentUrl) {
        addToast('error', `No URL available for clip ${index + 1}`);
        return;
      }
      
      setTimeout(() => {
        const link = document.createElement('a');
        link.href = segmentUrl;
        link.setAttribute('download', `clip-${index}.mp4`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      }, 1000 * index); // Stagger downloads
    });
    
    addToast('info', `Starting download for ${selected.length} clips`, {
      duration: 5000
    });
  };
  
  return (
    <>
      {/* Backdrop overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 z-40 transition-opacity duration-300"
          onClick={onClose}
          aria-hidden="true"
        />
      )}
      
      {/* Modal dialog */}
      <div
        className={`${className} fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-full max-w-md max-h-[80vh] bg-white rounded-lg shadow-xl z-50 transition-all duration-300 ${
          isOpen ? 'opacity-100 scale-100' : 'opacity-0 scale-95 pointer-events-none'
        }`}
      >
        <div className="flex flex-col h-full max-h-[80vh] rounded-lg">
          {/* Header */}
          <div className="p-4 border-b border-gray-200 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900">Video Clips Cart</h2>
            <button
              className="text-gray-500 hover:text-gray-700"
              onClick={onClose}
              aria-label="Close cart"
              title="Close cart"
            >
              <XMarkIcon className="h-5 w-5" />
            </button>
          </div>
          
          {/* Cart content */}
          <div className="flex-1 overflow-y-auto p-4">
          {items.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-500">
              <ShoppingCartIcon className="h-12 w-12 mb-2" />
              <p>Your cart is empty</p>
              <p className="text-sm mt-2">Add clips from search results to get started</p>
            </div>
          ) : (
            <div className="space-y-6">
              {Object.entries(itemsByVideo).map(([videoKey, videoItems]) => {
                const firstItem = videoItems[0];
                
                // Use the videoTitle property if available, otherwise use a fallback
                const videoTitle = firstItem.videoTitle || 'Untitled Video';
                
                return (
                  <div key={videoKey} className="bg-gray-50 rounded-lg p-3">
                    <div className="mb-2">
                      <h3 className="font-medium text-gray-900 line-clamp-1">
                        {videoTitle}
                      </h3>
                      <p className="text-xs text-gray-500">
                        {videoItems.length} clip{videoItems.length !== 1 ? 's' : ''}
                      </p>
                    </div>
                    
                    <div className="space-y-2">
                      {videoItems.map((item, itemIndex) => {
                        const globalIndex = items.findIndex(i => i.segment.segment_id === item.segment.segment_id);
                        return (
                        <div
                          key={item.segment.segment_id}
                          className={`flex items-center p-2 rounded-md ${
                            selectedItems[item.segment.segment_id!]
                              ? 'bg-indigo-50 border border-indigo-200'
                              : 'bg-white border border-gray-200'
                          } ${draggedItem === globalIndex ? 'opacity-50' : ''} ${dragOverItem === globalIndex ? 'border-2 border-indigo-400' : ''}`}
                          draggable
                          onDragStart={() => setDraggedItem(globalIndex)}
                          onDragEnd={() => {
                            if (draggedItem !== null && dragOverItem !== null && draggedItem !== dragOverItem) {
                              reorderItems(draggedItem, dragOverItem);
                              addToast('success', 'Reordered clips', { duration: 2000 });
                            }
                            setDraggedItem(null);
                            setDragOverItem(null);
                          }}
                          onDragOver={(e) => {
                            e.preventDefault();
                            if (dragOverItem !== globalIndex) {
                              setDragOverItem(globalIndex);
                            }
                          }}
                        >
                          <div className="flex-shrink-0 mr-2 cursor-move">
                            <ChevronUpDownIcon className="h-4 w-4 text-gray-400" />
                          </div>
                          <div className="flex-shrink-0 mr-3">
                            <input
                              type="checkbox"
                              checked={!!selectedItems[item.segment.segment_id!]}
                              onChange={() => handleSelectItem(item.segment.segment_id!)}
                              className="h-4 w-4 text-indigo-600 rounded"
                            />
                          </div>
                          
                          <div className="flex-shrink-0 w-16 h-9 bg-gray-200 rounded overflow-hidden mr-3">
                            {item.segment.segment_video_thumbnail_url && (
                              <img 
                                src={item.segment.segment_video_thumbnail_url} 
                                alt="Clip thumbnail" 
                                className="w-full h-full object-cover"
                              />
                            )}
                          </div>
                          
                          <div className="flex-1 min-w-0">
                            <p className="text-xs text-gray-900">
                              {formatTimeDisplay(item.segment.start_time)} - {formatTimeDisplay(item.segment.end_time)}
                            </p>
                            <p className="text-xs text-gray-500 truncate">
                              {item.segment.segment_visual?.segment_visual_description || 'No description'}
                            </p>
                            {/* Transition type indicator */}
                            {globalIndex < items.length - 1 && (
                              <div className="mt-1">
                                <select
                                  className="text-xs border border-gray-200 rounded p-0.5"
                                  value={item.transitionType || mergeOptions.defaultTransition}
                                  onChange={(e) => updateItemTransition(
                                    item.segment.segment_id!,
                                    e.target.value as 'cut' | 'fade' | 'dissolve',
                                    item.transitionDuration || mergeOptions.defaultTransitionDuration
                                  )}
                                >
                                  <option value="cut">Cut</option>
                                  <option value="fade">Fade</option>
                                  <option value="dissolve">Dissolve</option>
                                </select>
                              </div>
                            )}
                          </div>
                          
                          <button 
                            className="ml-2 text-gray-400 hover:text-gray-600"
                            onClick={() => removeFromCart(item.segment.segment_id!)}
                          >
                            <TrashIcon className="h-4 w-4" />
                          </button>
                        </div>
                      )})}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        
          {/* Actions footer - only show when there are items */}
          {items.length > 0 && (
          <div className="p-4 border-t border-gray-200 bg-gray-50">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center">
                <input
                  type="checkbox"
                  checked={getSelectedCount() > 0 && getSelectedCount() === items.length}
                  onChange={getSelectedCount() === items.length ? handleDeselectAll : handleSelectAll}
                  className="h-4 w-4 text-indigo-600 rounded mr-2"
                />
                <span className="text-sm text-gray-700">
                  {getSelectedCount()} of {items.length} selected
                </span>
              </div>
              
              {getSelectedCount() > 0 && (
                <button
                  className="text-sm text-indigo-600 hover:text-indigo-800"
                  onClick={handleDeselectAll}
                >
                  Un-select all
                </button>
              )}
            </div>
            
            {/* Merge options panel */}
            <div className="mb-4 p-3 bg-gray-100 rounded-md">
              <h4 className="text-sm font-medium text-gray-700 mb-2">Merge Options</h4>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Resolution</label>
                  <select
                    value={mergeOptions.resolution}
                    onChange={(e) => updateMergeOptions({resolution: e.target.value as '720p' | '1080p'})}
                    className="w-full text-sm border border-gray-300 rounded-md p-1"
                  >
                    <option value="720p">720p</option>
                    <option value="1080p">1080p</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Default Transition</label>
                  <select
                    value={mergeOptions.defaultTransition}
                    onChange={(e) => updateMergeOptions({defaultTransition: e.target.value as 'cut' | 'fade' | 'dissolve'})}
                    className="w-full text-sm border border-gray-300 rounded-md p-1"
                  >
                    <option value="cut">Cut (No Transition)</option>
                    <option value="fade">Fade</option>
                    <option value="dissolve">Dissolve</option>
                  </select>
                </div>
              </div>
              <div className="mt-2">
                <label className="block text-xs text-gray-500 mb-1">Transition Duration (ms)</label>
                <input
                  type="number"
                  min="0"
                  max="2000"
                  step="100"
                  value={mergeOptions.defaultTransitionDuration}
                  onChange={(e) => updateMergeOptions({defaultTransitionDuration: parseInt(e.target.value)})}
                  className="w-full text-sm border border-gray-300 rounded-md p-1"
                />
              </div>
              <div className="mt-2">
                <label className="block text-xs text-gray-500 mb-1">Merged Clip Name</label>
                <input
                  type="text"
                  placeholder={`cart_merged_${Date.now()}`}
                  value={customMergeName}
                  onChange={(e) => setCustomMergeName(e.target.value)}
                  className="w-full text-sm border border-gray-300 rounded-md p-1"
                />
              </div>
            </div>
            
            <div className="grid grid-cols-2 gap-3">
              <button
                className={`flex items-center justify-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white ${
                  getSelectedCount() < 2 || isMerging
                    ? 'bg-gray-400 cursor-not-allowed'
                    : 'bg-indigo-600 hover:bg-indigo-700'
                }`}
                disabled={getSelectedCount() < 2 || isMerging}
                onClick={handleMergeSelected}
              >
                <ArrowsRightLeftIcon className="h-4 w-4 mr-1" />
                {isMerging ? `Merging... ${mergeProgress}%` : 'Merge Selected'}
              </button>
              
              <button
                className={`flex items-center justify-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white ${
                  getSelectedCount() === 0
                    ? 'bg-gray-400 cursor-not-allowed'
                    : 'bg-indigo-600 hover:bg-indigo-700'
                }`}
                disabled={getSelectedCount() === 0}
                onClick={handleDownloadSelected}
              >
                <CloudArrowDownIcon className="h-4 w-4 mr-1" />
                Download
              </button>
              
              <button
                className="col-span-2 flex items-center justify-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md shadow-sm text-gray-700 bg-white hover:bg-gray-50"
                onClick={clearCart}
              >
                <TrashIcon className="h-4 w-4 mr-1" />
                Clear Cart
              </button>
              
              {/* Progress bar for merge operation */}
              {isMerging && (
                <div className="col-span-2 mt-3">
                  <div className="w-full bg-gray-200 rounded-full h-2.5">
                    <div
                      className="bg-indigo-600 h-2.5 rounded-full transition-all duration-500 ease-in-out"
                      style={{ width: `${mergeProgress}%` }}
                    ></div>
                  </div>
                  <p className="text-xs text-gray-600 mt-1 text-center">
                    {mergeProgress}% complete
                  </p>
                </div>
              )}
            </div>
          </div>
          )}
        </div>
      </div>
    </>
  );
};

export default CartPanel;