'use client';

import React from 'react';
import { ShoppingCartIcon } from '@heroicons/react/24/outline';
import { useCart } from '@/lib/cart/CartContext';

interface CartIconProps {
  onClick: () => void;
}

export const CartIcon: React.FC<CartIconProps> = ({ onClick }) => {
  const { getItemCount } = useCart();
  const itemCount = getItemCount();
  
  return (
    <button 
      className="relative p-2 text-gray-600 hover:text-gray-900 focus:outline-none group"
      onClick={onClick}
      aria-label="Open video clips cart"
      title="Clip Selected"
    >
      <ShoppingCartIcon className="h-6 w-6" />
      {itemCount > 0 && (
        <span className="absolute top-0 right-0 inline-flex items-center justify-center px-2 py-1 text-xs font-bold leading-none text-white transform translate-x-1/2 -translate-y-1/2 bg-indigo-600 rounded-full">
          {itemCount}
        </span>
      )}
      <span className="absolute bottom-0 left-1/2 transform -translate-x-1/2 translate-y-full text-xs font-medium text-gray-700 whitespace-nowrap bg-white px-2 py-1 rounded shadow-sm opacity-0 group-hover:opacity-100 transition-opacity">
        Clip Selected
      </span>
    </button>
  );
};

export default CartIcon;