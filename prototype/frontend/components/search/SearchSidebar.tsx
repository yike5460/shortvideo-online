'use client'

import { useState } from 'react'
import { Switch } from '@headlessui/react'
import { ChevronDownIcon } from '@heroicons/react/24/outline'
import { cn } from '@/lib/utils'

interface SearchOptions {
  visualSearch: boolean
  audioSearch: boolean
  minConfidence: number
  showConfidenceScores: boolean
  selectedIndex: string | null
}

interface SearchSidebarProps {
  options: SearchOptions
  onOptionsChange: (options: SearchOptions) => void
  indexes: Array<{ id: string; name: string }>
}

export default function SearchSidebar({
  options,
  onOptionsChange,
  indexes
}: SearchSidebarProps) {
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false)

  const updateOptions = (updates: Partial<SearchOptions>) => {
    onOptionsChange({ ...options, ...updates })
  }

  return (
    <div className="w-80 bg-white border-l p-6 space-y-8">
      {/* Index Selection */}
      <div className="space-y-4">
        <h3 className="text-lg font-medium text-gray-900">Select Index</h3>
        <select
          value={options.selectedIndex || ''}
          onChange={(e) => updateOptions({ selectedIndex: e.target.value || null })}
          className="w-full border border-gray-300 rounded-lg p-2 focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
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
              onChange={(checked) => updateOptions({ visualSearch: checked })}
              className={cn(
                "relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2",
                options.visualSearch ? "bg-primary-600" : "bg-gray-200"
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
              onChange={(checked) => updateOptions({ audioSearch: checked })}
              className={cn(
                "relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2",
                options.audioSearch ? "bg-primary-600" : "bg-gray-200"
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
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm text-gray-700">
                Minimum Confidence ({Math.round(options.minConfidence * 100)}%)
              </label>
              <input
                type="range"
                min="0"
                max="1"
                step="0.1"
                value={options.minConfidence}
                onChange={(e) => updateOptions({ minConfidence: parseFloat(e.target.value) })}
                className="w-full"
              />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-700">Show Confidence Scores</span>
              <Switch
                checked={options.showConfidenceScores}
                onChange={(checked) => updateOptions({ showConfidenceScores: checked })}
                className={cn(
                  "relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2",
                  options.showConfidenceScores ? "bg-primary-600" : "bg-gray-200"
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