'use client'

import { useState } from 'react'
import { HandThumbUpIcon, HandThumbDownIcon } from '@heroicons/react/24/outline'
import { HandThumbUpIcon as HandThumbUpSolidIcon, HandThumbDownIcon as HandThumbDownSolidIcon } from '@heroicons/react/24/solid'
import { cn } from '@/lib/utils'

interface FeedbackBarProps {
  onFeedback: (isHelpful: boolean) => void
}

export default function FeedbackBar({ onFeedback }: FeedbackBarProps) {
  const [isVisible, setIsVisible] = useState(true)

  const handleFeedback = (isHelpful: boolean) => {
    onFeedback(isHelpful)
    // Hide the feedback bar after animation
    setTimeout(() => setIsVisible(false), 300)
  }

  if (!isVisible) return null

  return (
    <div className="fixed bottom-8 left-1/2 -translate-x-1/2 bg-white rounded-full shadow-lg border animate-fade-in">
      <div className="flex items-center gap-4 px-6 py-3">
        <span className="text-sm text-gray-600 whitespace-nowrap">
          How is the search results?
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={() => handleFeedback(true)}
            className="p-2 rounded-full hover:bg-green-50 text-gray-600 hover:text-green-600 transition-colors"
            title="Yes, helpful"
          >
            <HandThumbUpIcon className="h-5 w-5" />
          </button>
          <button
            onClick={() => handleFeedback(false)}
            className="p-2 rounded-full hover:bg-red-50 text-gray-600 hover:text-red-600 transition-colors"
            title="No, not helpful"
          >
            <HandThumbDownIcon className="h-5 w-5" />
          </button>
        </div>
      </div>
    </div>
  )
} 