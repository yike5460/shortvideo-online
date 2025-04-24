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
}

interface CartContextType {
  items: CartItem[];
  addToCart: (item: CartItem) => void;
  removeFromCart: (segmentId: string) => void;
  clearCart: () => void;
  isInCart: (segmentId: string) => boolean;
  getItemCount: () => number;
}

const CartContext = createContext<CartContextType | undefined>(undefined);

export const CartProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [items, setItems] = useState<CartItem[]>([]);
  
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
  
  return (
    <CartContext.Provider value={{ 
      items, 
      addToCart, 
      removeFromCart, 
      clearCart, 
      isInCart,
      getItemCount
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