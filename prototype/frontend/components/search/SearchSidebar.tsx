'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { Switch } from '@headlessui/react'
import { ChevronDownIcon, InformationCircleIcon } from '@heroicons/react/24/outline'
import { cn } from '@/lib/utils'
import { Tooltip } from '@/components/ui/Tooltip'
import type { SearchOptions, Index, ConfidencePreset, ConfidenceAdjustment } from '@/types'

interface SearchSidebarProps {
  options: SearchOptions
  onOptionsChange: (options: SearchOptions) => void
  indexes: Index[]
}

const CONFIDENCE_PRESETS = {
  low: { 
    label: 'Low', 
    value: 0.3, 
    description: 'Include more results with lower confidence scores (30% threshold). This will return more results but may include some less relevant matches.' 
  },
  medium: { 
    label: 'Medium', 
    value: 0.5, 
    description: 'Balanced between precision and recall (50% threshold). This provides a good balance between result quantity and quality.' 
  },
  high: { 
    label: 'High', 
    value: 0.7, 
    description: 'Only show results with high confidence scores (70% threshold). This ensures high quality matches but may return fewer results.' 
  },
} as const

const CONFIDENCE_ADJUSTMENTS = {
  less: { 
    label: 'Less strict', 
    value: -0.1, 
    description: 'Relaxed thresholds to include more potential matches. Use this if you want to see more results.' 
  },
  default: { 
    label: 'Default', 
    value: 0, 
    description: 'Standard confidence thresholds for balanced results. This is the recommended setting for most searches.' 
  },
  more: { 
    label: 'More strict', 
    value: 0.1, 
    description: 'Stricter thresholds for higher precision results. Use this if you want to ensure only the most relevant matches.' 
  },
} as const

const TOOLTIP_DESCRIPTIONS = {
  minimumConfidence: `Confidence levels are relative grouping applied to the search results, in which High/Medium/Low is optimized for Precision, both Precision and Recall, and Recall respectively`,
  
  adjustConfidence: `You can modify the overall confidence level by making it more strict (fewer search results) or less strict (more search results)`
} as const

export default function SearchSidebar({
  options,
  onOptionsChange,
  indexes
}: SearchSidebarProps) {
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const sliderRef = useRef<HTMLDivElement>(null)

  const handleConfidencePresetChange = useCallback((preset: ConfidencePreset) => {
    const baseConfidence = CONFIDENCE_PRESETS[preset].value
    const adjustment = CONFIDENCE_ADJUSTMENTS[options.confidenceAdjustment].value
    onOptionsChange({
      ...options,
      confidencePreset: preset,
      minConfidence: Math.max(0, Math.min(1, baseConfidence + adjustment))
    })
  }, [options, onOptionsChange])

  const handleConfidenceAdjustmentChange = useCallback((adjustment: ConfidenceAdjustment) => {
    const baseConfidence = CONFIDENCE_PRESETS[options.confidencePreset].value
    const newAdjustment = CONFIDENCE_ADJUSTMENTS[adjustment].value
    onOptionsChange({
      ...options,
      confidenceAdjustment: adjustment,
      minConfidence: Math.max(0, Math.min(1, baseConfidence + newAdjustment))
    })
  }, [options, onOptionsChange])

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setIsDragging(true)
    const adjustment = getAdjustmentFromPosition(e.clientX)
    handleConfidenceAdjustmentChange(adjustment)
  }, [handleConfidenceAdjustmentChange])

  const getAdjustmentFromPosition = useCallback((clientX: number): ConfidenceAdjustment => {
    if (!sliderRef.current) return 'default'
    
    const rect = sliderRef.current.getBoundingClientRect()
    const position = (clientX - rect.left) / rect.width
    
    if (position < 0.33) return 'less'
    if (position < 0.66) return 'default'
    return 'more'
  }, [])

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isDragging) return
    const adjustment = getAdjustmentFromPosition(e.clientX)
    if (adjustment !== options.confidenceAdjustment) {
      handleConfidenceAdjustmentChange(adjustment)
    }
  }, [isDragging, options.confidenceAdjustment, getAdjustmentFromPosition, handleConfidenceAdjustmentChange])

  const handleMouseUp = useCallback(() => {
    setIsDragging(false)
  }, [])

  useEffect(() => {
    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove)
      window.addEventListener('mouseup', handleMouseUp)
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isDragging, handleMouseMove, handleMouseUp])

  const getDotPosition = useCallback((): string => {
    switch (options.confidenceAdjustment) {
      case 'less': return '0%'
      case 'default': return '50%'
      case 'more': return '100%'
    }
  }, [options.confidenceAdjustment])

  return (
    <div className="w-80 bg-white border-l p-6 space-y-8">
      {/* Index Selection */}
      <div className="space-y-4">
        <h3 className="text-lg font-medium text-gray-900">Select Index</h3>
        <select
          id="index-select"
          value={options.selectedIndex || ''}
          onChange={(e) => onOptionsChange({ ...options, selectedIndex: e.target.value || null })}
          className="w-full border border-gray-300 rounded-lg p-2 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
        >
          <option value="">Select an index</option>
          {indexes.map((index) => (
            <option key={index.id} value={index.id}>
              {index.name}
            </option>
          ))}
        </select>
      </div>

      {/* Search Options */}
      <div className="space-y-4">
        <h3 className="text-lg font-medium text-gray-900">Search Options</h3>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-700">Visual Search</span>
            <Switch
              checked={options.visualSearch}
              onChange={(checked) => onOptionsChange({ ...options, visualSearch: checked })}
              className={cn(
                "relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2",
                options.visualSearch ? "bg-gradient-to-r from-indigo-600 to-purple-600" : "bg-gray-200"
              )}
            >
              <span
                className={cn(
                  "inline-block h-4 w-4 transform rounded-full bg-white transition-transform",
                  options.visualSearch ? "translate-x-6" : "translate-x-1"
                )}
              />
            </Switch>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-700">Audio Search</span>
            <Switch
              checked={options.audioSearch}
              onChange={(checked) => onOptionsChange({ ...options, audioSearch: checked })}
              className={cn(
                "relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2",
                options.audioSearch ? "bg-gradient-to-r from-indigo-600 to-purple-600" : "bg-gray-200"
              )}
            >
              <span
                className={cn(
                  "inline-block h-4 w-4 transform rounded-full bg-white transition-transform",
                  options.audioSearch ? "translate-x-6" : "translate-x-1"
                )}
              />
            </Switch>
          </div>
        </div>
      </div>

      {/* Advanced Options */}
      <div className="space-y-4">
        <button
          onClick={() => setIsAdvancedOpen(!isAdvancedOpen)}
          className="flex items-center justify-between w-full text-left"
        >
          <h3 className="text-lg font-medium text-gray-900">Advanced Options</h3>
          <ChevronDownIcon
            className={cn(
              "h-5 w-5 text-gray-500 transition-transform",
              isAdvancedOpen ? "transform rotate-180" : ""
            )}
          />
        </button>
        {isAdvancedOpen && (
          <div className="space-y-6">
            {/* Minimum Confidence Level */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <label className="text-sm font-medium text-gray-700">
                  Minimum Confidence Level
                </label>
                <Tooltip content={TOOLTIP_DESCRIPTIONS.minimumConfidence} position="right">
                  <InformationCircleIcon className="h-4 w-4 text-gray-400 cursor-help" />
                </Tooltip>
              </div>
              <select
                value={options.confidencePreset}
                onChange={(e) => handleConfidencePresetChange(e.target.value as ConfidencePreset)}
                className="w-full border border-gray-300 rounded-lg p-2 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              >
                {Object.entries(CONFIDENCE_PRESETS).map(([key, { label }]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
              <p className="text-xs text-gray-500 mt-1">
                {CONFIDENCE_PRESETS[options.confidencePreset].description}
              </p>
            </div>

            {/* Confidence Adjustment */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <label className="text-sm font-medium text-gray-700">
                  Adjust Confidence Level
                </label>
                <Tooltip content={TOOLTIP_DESCRIPTIONS.adjustConfidence} position="right">
                  <InformationCircleIcon className="h-4 w-4 text-gray-400 cursor-help" />
                </Tooltip>
              </div>
              <div className="relative pt-1">
                <div
                  ref={sliderRef}
                  className="h-1.5 bg-gray-200 rounded-full relative cursor-pointer"
                  onMouseDown={handleMouseDown}
                >
                  {/* Track markers */}
                  <div className="absolute inset-0 flex justify-between items-center px-[2px]">
                    {(['less', 'default', 'more'] as const).map((position) => (
                      <div
                        key={position}
                        className="w-1 h-1 rounded-full bg-gray-400"
                      />
                    ))}
                  </div>
                  {/* Moving dot */}
                  <div
                    className={cn(
                      "absolute top-1/2 -translate-y-1/2 -translate-x-1/2",
                      "w-3 h-3 rounded-full bg-white border-2 transition-all duration-200",
                      isDragging
                        ? "scale-110 border-indigo-600 shadow-lg"
                        : "border-indigo-600"
                    )}
                    style={{
                      left: getDotPosition()
                    }}
                  />
                </div>
                <div className="flex justify-between mt-4">
                  <span className={cn(
                    "text-xs font-medium transition-colors",
                    options.confidenceAdjustment === 'less'
                      ? "text-indigo-600"
                      : "text-gray-500"
                  )}>
                    Less strict
                  </span>
                  <span className={cn(
                    "text-xs font-medium transition-colors",
                    options.confidenceAdjustment === 'default'
                      ? "text-indigo-600"
                      : "text-gray-500"
                  )}>
                    Default
                  </span>
                  <span className={cn(
                    "text-xs font-medium transition-colors",
                    options.confidenceAdjustment === 'more'
                      ? "text-indigo-600"
                      : "text-gray-500"
                  )}>
                    More strict
                  </span>
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  {CONFIDENCE_ADJUSTMENTS[options.confidenceAdjustment].description}
                </p>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-700">Show Confidence Scores</span>
              <Switch
                checked={options.showConfidenceScores}
                onChange={(checked) => onOptionsChange({ ...options, showConfidenceScores: checked })}
                className={cn(
                  "relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2",
                  options.showConfidenceScores ? "bg-gradient-to-r from-indigo-600 to-purple-600" : "bg-gray-200"
                )}
              >
                <span
                  className={cn(
                    "inline-block h-4 w-4 transform rounded-full bg-white transition-transform",
                    options.showConfidenceScores ? "translate-x-6" : "translate-x-1"
                  )}
                />
              </Switch>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
