'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'

export type SourceType = 'local' | 'youtube' | 's3'

interface SourceSelectorProps {
  selectedSource: SourceType
  onSourceChange: (source: SourceType) => void
  disabled?: boolean
}

export default function SourceSelector({ 
  selectedSource, 
  onSourceChange,
  disabled = false 
}: SourceSelectorProps) {
  const sources = [
    { id: 'local', label: 'Local Files', icon: '📁' },
    { id: 'youtube', label: 'YouTube', icon: '▶️' },
    { id: 's3', label: 'Amazon S3', icon: '☁️' },
  ] as const

  return (
    <div className="flex border-b border-gray-200 mb-6">
      {sources.map((source) => (
        <button
          key={source.id}
          onClick={() => onSourceChange(source.id)}
          disabled={disabled}
          className={cn(
            "flex items-center px-4 py-2 border-b-2 font-medium text-sm",
            selectedSource === source.id
              ? "border-primary-500 text-primary-600"
              : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300",
            disabled && "opacity-50 cursor-not-allowed"
          )}
        >
          <span className="mr-2">{source.icon}</span>
          {source.label}
        </button>
      ))}
    </div>
  )
}