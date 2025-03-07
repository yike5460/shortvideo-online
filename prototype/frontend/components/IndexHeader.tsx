'use client'

import { useState } from 'react'
import { EllipsisVerticalIcon, DocumentDuplicateIcon } from '@heroicons/react/24/outline'
import { CheckIcon } from '@heroicons/react/24/solid'

interface Model {
  name: string;
  version: string;
  capabilities: ('visual' | 'audio')[];
}

interface IndexHeaderProps {
  indexId: string;
  indexName: string;
  isDefault?: boolean;
  expiresIn?: number;
  models?: Model[];
  onUploadClick: () => void;
  onDeleteIndex?: () => void;
}

export default function IndexHeader({
  indexId,
  indexName,
  isDefault = false,
  expiresIn,
  models = [],
  onUploadClick,
  onDeleteIndex
}: IndexHeaderProps) {
  const [isCopied, setIsCopied] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  
  // Handle copy index ID
  const copyIndexId = () => {
    navigator.clipboard.writeText(indexId).then(() => {
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    });
  };

  // Get appropriate expiration message color
  const getExpirationColor = () => {
    if (!expiresIn) return 'text-gray-500';
    if (expiresIn <= 3) return 'text-red-600';
    if (expiresIn <= 7) return 'text-orange-500';
    return 'text-gray-500';
  };

  return (
    <div className="mb-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between mb-4">
        <div className="flex items-center">
          <h1 className="text-2xl font-bold">
            {indexName} {isDefault && <span className="font-bold">(Default)</span>}
          </h1>
          
          {/* Index ID with copy button */}
          <div className="ml-4 flex items-center bg-gray-100 rounded-md px-2 py-1">
            <span className="text-sm text-gray-600 mr-1">index-id: {indexId.substring(0, 5)}...</span>
            <button
              onClick={copyIndexId}
              className="p-1 hover:bg-gray-200 rounded-full transition-colors"
              aria-label="Copy index ID"
            >
              {isCopied ? (
                <CheckIcon className="h-4 w-4 text-green-600" />
              ) : (
                <DocumentDuplicateIcon className="h-4 w-4 text-gray-600" />
              )}
            </button>
          </div>
          
          {/* Expiration notice */}
          {expiresIn !== undefined && (
            <div className={`ml-4 ${getExpirationColor()}`}>
              <span className="inline-flex items-center rounded-md bg-red-50 px-2 py-1 text-sm font-medium text-red-600">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                </svg>
                Expires in {expiresIn} days
              </span>
            </div>
          )}
        </div>
        
        {/* Action buttons */}
        <div className="flex items-center mt-4 md:mt-0">
          <button 
            onClick={onUploadClick}
            className="bg-gray-200 hover:bg-gray-300 text-gray-800 font-medium py-2 px-4 rounded-md flex items-center transition-colors mr-2"
          >
            Upload videos
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 ml-2" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM6.293 6.707a1 1 0 010-1.414l3-3a1 1 0 011.414 0l3 3a1 1 0 01-1.414 1.414L11 5.414V13a1 1 0 11-2 0V5.414L7.707 6.707a1 1 0 01-1.414 0z" clipRule="evenodd" />
            </svg>
          </button>
          
          {/* Menu button */}
          <div className="relative">
            <button
              onClick={() => setShowMenu(!showMenu)}
              className="bg-black hover:bg-gray-800 text-white font-medium py-2 px-4 rounded-md flex items-center transition-colors"
            >
              Select action
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 ml-2" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
            </button>
            
            {showMenu && (
              <div className="absolute right-0 mt-2 w-48 bg-white rounded-md shadow-lg ring-1 ring-black ring-opacity-5 z-10">
                <div className="py-1">
                  <button
                    onClick={() => {
                      setShowMenu(false);
                      onDeleteIndex?.();
                    }}
                    className="block w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-gray-100"
                  >
                    Delete Index
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
      
      {/* Models section - enhanced to match the screenshot */}
      <div className="space-y-2 mt-2">
        {models.map((model, index) => (
          <div key={index} className="flex items-center">
            <div className="mr-3">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-gray-600" viewBox="0 0 20 20" fill="currentColor">
                <path d="M13 7H7v6h6V7z" />
                <path fillRule="evenodd" d="M7 2a1 1 0 012 0v1h2V2a1 1 0 112 0v1h2a2 2 0 012 2v2h1a1 1 0 110 2h-1v2h1a1 1 0 110 2h-1v2a2 2 0 01-2 2h-2v1a1 1 0 11-2 0v-1H9v1a1 1 0 11-2 0v-1H5a2 2 0 01-2-2v-2H2a1 1 0 110-2h1V9H2a1 1 0 010-2h1V5a2 2 0 012-2h2V2a1 1 0 011-1z" clipRule="evenodd" />
              </svg>
            </div>
            <span className="font-bold text-gray-800 mr-3">{model.name} {model.version}</span>
            <div className="flex items-center space-x-3 text-sm">
              {model.capabilities.includes('visual') && (
                <div className="flex items-center text-gray-600">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  </svg>
                  Visual
                </div>
              )}
              
              {model.capabilities.includes('audio') && (
                <div className="flex items-center text-gray-600">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 12h1l2-3 4 6 4-10 4 6 2-3h3" />
                  </svg>
                  Audio
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
