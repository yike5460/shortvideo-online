'use client';

import React, { useState } from 'react';
import { XMarkIcon, ArrowsRightLeftIcon, CloudArrowDownIcon, TrashIcon, ShoppingCartIcon } from '@heroicons/react/24/outline';
import { useCart, CartItem } from '@/lib/cart/CartContext';
import { useToast } from '@/components/ui/Toast';

interface CartPanelProps {
  isOpen: boolean;
  onClose: () => void;
  className?: string; // Add className prop for custom styling
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
  const { items, removeFromCart, clearCart } = useCart();
  const { addToast } = useToast();
  const [selectedItems, setSelectedItems] = useState<Record<string, boolean>>({});
  const [isMerging, setIsMerging] = useState(false);
  
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
    
    // Check if all selected items are from the same video
    const firstItem = selected[0];
    const allSameVideo = selected.every(
      item => item.videoId === firstItem.videoId && item.indexId === firstItem.indexId
    );
    
    if (!allSameVideo) {
      addToast('error', 'Currently, only clips from the same video can be merged');
      return;
    }
    
    setIsMerging(true);
    
    try {
      // Get segment IDs for the API call
      const segmentIds = selected.map(item => item.segment.segment_id!);
      
      // Extract the actual video ID from the first segment ID
      // Assuming segment_id format is [videoId]_segment_[segmentNumber]
      const extractedVideoId = segmentIds[0].split('_segment_')[0];
      
      // Call the merge API
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/videos/merge`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          // Use the selectedIndex if available, otherwise fall back to the item's indexId
          indexId: firstItem.selectedIndex || firstItem.indexId,
          videoId: extractedVideoId, // Use extracted ID instead of encoded videoId
          segmentIds: segmentIds,
          mergedName: `cart_merged_${Date.now()}`
        }),
      });
      
      if (!response.ok) {
        throw new Error(`Failed to merge segments: ${response.statusText}`);
      }
      
      const result = await response.json();
      
      // Remove merged items from cart
      selected.forEach(item => {
        removeFromCart(item.segment.segment_id!);
      });
      
      addToast('success', `Successfully merged ${selected.length} clips`, {
        duration: 5000,
        action: {
          label: 'View merged video',
          onClick: () => {
            // Use the selectedIndex if available, otherwise fall back to the item's indexId
            const indexId = firstItem.selectedIndex || firstItem.indexId;
            window.location.href = `/videos?indexId=${encodeURIComponent(indexId)}&videoId=${encodeURIComponent(extractedVideoId)}`;
          }
        }
      });
    } catch (error) {
      console.error('Error merging segments:', error);
      addToast('error', `Failed to merge segments: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsMerging(false);
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
  
  if (!isOpen) return null;
  
  return (
    <div className={`${className} fixed inset-0 z-50 overflow-hidden`}>
      <div className="absolute inset-0 bg-black bg-opacity-50" onClick={onClose} />
      <div className="absolute top-16 right-0 h-[calc(100%-4rem)] max-w-md w-full bg-white shadow-xl flex flex-col rounded-l-lg">
        {/* Header */}
        <div className="p-4 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">Video Clips Cart</h2>
          <button 
            className="text-gray-500 hover:text-gray-700"
            onClick={onClose}
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
                      {videoItems.map(item => (
                        <div 
                          key={item.segment.segment_id} 
                          className={`flex items-center p-2 rounded-md ${
                            selectedItems[item.segment.segment_id!] 
                              ? 'bg-indigo-50 border border-indigo-200' 
                              : 'bg-white border border-gray-200'
                          }`}
                        >
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
                          </div>
                          
                          <button 
                            className="ml-2 text-gray-400 hover:text-gray-600"
                            onClick={() => removeFromCart(item.segment.segment_id!)}
                          >
                            <TrashIcon className="h-4 w-4" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        
        {/* Actions footer */}
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
                {isMerging ? 'Merging...' : 'Merge Selected'}
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
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default CartPanel;