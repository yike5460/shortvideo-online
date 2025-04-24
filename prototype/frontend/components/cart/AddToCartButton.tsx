'use client';

import React from 'react';
import { ShoppingCartIcon } from '@heroicons/react/24/outline';
import { useCart } from '@/lib/cart/CartContext';
import { VideoSegment } from '@/types';
import { useToast } from '@/components/ui/Toast';

interface AddToCartButtonProps {
  videoId: string;
  indexId: string;
  segment: VideoSegment;
  searchQuery: string;
  videoTitle?: string; // Optional video title
  selectedIndex?: string | null; // Optional selected index from search options
}

export const AddToCartButton: React.FC<AddToCartButtonProps> = ({
  videoId,
  indexId,
  segment,
  searchQuery,
  videoTitle = "Untitled Video", // Default to "Untitled Video" if not provided
  selectedIndex = null // Default to null if not provided
}) => {
  const { addToCart, isInCart, removeFromCart } = useCart();
  const { addToast } = useToast();
  
  const inCart = isInCart(segment.segment_id!);
  
  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent triggering parent click handlers
    
    if (inCart) {
      removeFromCart(segment.segment_id!);
      addToast('info', 'Clip removed from cart', { duration: 2000 });
    } else {
      addToCart({
        videoId,
        indexId,
        segment,
        addedAt: Date.now(),
        source: searchQuery,
        videoTitle, // Add video title to the cart item
        selectedIndex // Add selected index from search options
      });
      addToast('success', 'Clip added to cart', { duration: 2000 });
    }
  };
  
  return (
    <button
      className={`inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md transition-colors ${
        inCart 
          ? 'bg-indigo-100 text-indigo-800 hover:bg-indigo-200' 
          : 'bg-gray-100 text-gray-800 hover:bg-gray-200'
      }`}
      onClick={handleClick}
      title={inCart ? 'Remove from cart' : 'Add to cart'}
    >
      <ShoppingCartIcon className="h-3 w-3" />
      {inCart ? 'In Cart' : 'Add to Cart'}
    </button>
  );
};

export default AddToCartButton;