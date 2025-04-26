'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';
import { VideoSegment } from '@/types';

export interface CartItem {
  videoId: string;
  indexId: string;
  segment: VideoSegment;
  addedAt: number;
  source: string;
  videoTitle?: string; // Optional video title
  selectedIndex?: string | null; // Optional selected index from search options
  order?: number; // For explicit ordering in merged output
  transitionType?: 'cut' | 'fade' | 'dissolve'; // Transition to next clip
  transitionDuration?: number; // Transition duration in milliseconds
}

export interface MergeOptions {
  resolution: '720p' | '1080p';
  defaultTransition: 'cut' | 'fade' | 'dissolve';
  defaultTransitionDuration: number;
}

interface CartContextType {
  items: CartItem[];
  mergeOptions: MergeOptions;
  addToCart: (item: CartItem) => void;
  removeFromCart: (segmentId: string) => void;
  clearCart: () => void;
  isInCart: (segmentId: string) => boolean;
  getItemCount: () => number;
  reorderItems: (sourceIndex: number, destinationIndex: number) => void;
  updateMergeOptions: (options: Partial<MergeOptions>) => void;
  updateItemTransition: (segmentId: string, transitionType: 'cut' | 'fade' | 'dissolve', duration: number) => void;
}

const CartContext = createContext<CartContextType | undefined>(undefined);

export const CartProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [items, setItems] = useState<CartItem[]>([]);
  const [mergeOptions, setMergeOptions] = useState<MergeOptions>({
    resolution: '720p',
    defaultTransition: 'cut',
    defaultTransitionDuration: 500, // 500ms
  });
  
  // Load cart from localStorage on mount
  useEffect(() => {
    const savedCart = localStorage.getItem('videoClipCart');
    if (savedCart) {
      try {
        setItems(JSON.parse(savedCart));
      } catch (e) {
        console.error('Failed to parse saved cart', e);
      }
    }
  }, []);
  
  // Save cart to localStorage when it changes
  useEffect(() => {
    localStorage.setItem('videoClipCart', JSON.stringify(items));
  }, [items]);
  
  const addToCart = (item: CartItem) => {
    setItems(prev => {
      // Check if item already exists
      if (prev.some(i => i.segment.segment_id === item.segment.segment_id)) {
        return prev;
      }
      return [...prev, item];
    });
  };
  
  const removeFromCart = (segmentId: string) => {
    setItems(prev => prev.filter(item => item.segment.segment_id !== segmentId));
  };
  
  const clearCart = () => {
    setItems([]);
  };
  
  const isInCart = (segmentId: string) => {
    return items.some(item => item.segment.segment_id === segmentId);
  };
  
  const getItemCount = () => {
    return items.length;
  };
  
  // Reorder items in the cart (for drag and drop)
  const reorderItems = (sourceIndex: number, destinationIndex: number) => {
    setItems(prevItems => {
      const result = Array.from(prevItems);
      const [removed] = result.splice(sourceIndex, 1);
      result.splice(destinationIndex, 0, removed);
      
      // Update order property for each item
      return result.map((item, index) => ({
        ...item,
        order: index
      }));
    });
  };
  
  // Update merge options
  const updateMergeOptions = (options: Partial<MergeOptions>) => {
    setMergeOptions(prev => ({
      ...prev,
      ...options
    }));
  };
  
  // Update transition for a specific item
  const updateItemTransition = (segmentId: string, transitionType: 'cut' | 'fade' | 'dissolve', duration: number) => {
    setItems(prevItems =>
      prevItems.map(item =>
        item.segment.segment_id === segmentId
          ? { ...item, transitionType, transitionDuration: duration }
          : item
      )
    );
  };
  
  return (
    <CartContext.Provider value={{
      items,
      mergeOptions,
      addToCart,
      removeFromCart,
      clearCart,
      isInCart,
      getItemCount,
      reorderItems,
      updateMergeOptions,
      updateItemTransition
    }}>
      {children}
    </CartContext.Provider>
  );
};

export const useCart = () => {
  const context = useContext(CartContext);
  if (context === undefined) {
    throw new Error('useCart must be used within a CartProvider');
  }
  return context;
};