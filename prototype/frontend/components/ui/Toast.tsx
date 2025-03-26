'use client'

import { createContext, useState, useContext, useCallback, useEffect } from 'react';
import { CheckCircleIcon, ExclamationCircleIcon, XMarkIcon, InformationCircleIcon } from '@heroicons/react/24/outline';

// Define the types
export type ToastType = 'success' | 'error' | 'info';

interface ToastMessage {
  id: string;
  type: ToastType;
  message: string;
  duration?: number;
  action?: {
    label: string;
    onClick: () => void;
  };
}

interface ToastContextValue {
  toasts: ToastMessage[];
  addToast: (type: ToastType, message: string, options?: { duration?: number, action?: { label: string, onClick: () => void } }) => void;
  removeToast: (id: string) => void;
}

// Create the context
const ToastContext = createContext<ToastContextValue | undefined>(undefined);

// Toast provider component
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const addToast = useCallback((type: ToastType, message: string, options?: { duration?: number, action?: { label: string, onClick: () => void } }) => {
    const id = Math.random().toString(36).substring(2, 9);
    const duration = options?.duration || 5000; // Default 5 seconds
    
    const newToast: ToastMessage = {
      id,
      type,
      message,
      duration,
      action: options?.action
    };
    
    setToasts(prev => [...prev, newToast]);
    
    // Auto-remove after duration
    if (duration > 0) {
      setTimeout(() => {
        removeToast(id);
      }, duration);
    }
    
    return id;
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(toast => toast.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ toasts, addToast, removeToast }}>
      {children}
      <ToastContainer />
    </ToastContext.Provider>
  );
}

// Hook to use toast
export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
}

// Toast container component
function ToastContainer() {
  const { toasts, removeToast } = useToast();
  
  if (toasts.length === 0) return null;
  
  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
      {toasts.map(toast => (
        <div
          key={toast.id}
          className={`relative flex items-center gap-3 py-3 px-4 min-w-72 max-w-md rounded-lg shadow-lg animate-fade-in ${
            toast.type === 'success' ? 'bg-green-50 text-green-800 border-l-4 border-green-500' :
            toast.type === 'error' ? 'bg-red-50 text-red-800 border-l-4 border-red-500' :
            'bg-blue-50 text-blue-800 border-l-4 border-blue-500'
          }`}
        >
          <div className="shrink-0">
            {toast.type === 'success' ? (
              <CheckCircleIcon className="h-5 w-5 text-green-500" />
            ) : toast.type === 'error' ? (
              <ExclamationCircleIcon className="h-5 w-5 text-red-500" />
            ) : (
              <InformationCircleIcon className="h-5 w-5 text-blue-500" />
            )}
          </div>
          
          <div className="flex-1">
            <p className="font-medium">{toast.message}</p>
            
            {toast.action && (
              <button
                onClick={toast.action.onClick}
                className={`mt-1 text-sm font-medium ${
                  toast.type === 'success' ? 'text-green-700' :
                  toast.type === 'error' ? 'text-red-700' :
                  'text-blue-700'
                } hover:underline`}
              >
                {toast.action.label}
              </button>
            )}
          </div>
          
          <button
            onClick={() => removeToast(toast.id)}
            className="shrink-0 text-gray-400 hover:text-gray-600"
          >
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>
      ))}
    </div>
  );
}

// Animation styles for the toasts
const animationStyles = `
@keyframes fadeIn {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}

.animate-fade-in {
  animation: fadeIn 0.3s ease-out forwards;
}
`;

// Add styles to the document
if (typeof document !== "undefined") {
  const styleElement = document.createElement("style");
  styleElement.textContent = animationStyles;
  document.head.appendChild(styleElement);
}
