'use client'

import { useState, useRef } from 'react'
import { MagnifyingGlassIcon, PhotoIcon, XMarkIcon } from '@heroicons/react/24/outline'
import { cn } from '@/lib/utils'

interface SearchBarProps {
  onSearch: (query: string, imageFile?: File) => void
  onClear: () => void
}

export default function SearchBar({ onSearch, onClear }: SearchBarProps) {
  const [query, setQuery] = useState('')
  const [imageFile, setImageFile] = useState<File | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (query.trim() || imageFile) {
      onSearch(query.trim(), imageFile || undefined)
    }
  }

  const handleClear = () => {
    setQuery('')
    setImageFile(null)
    onClear()
  }

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      setImageFile(file)
      onSearch('', file)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="relative">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="What are you looking for?"
            className="w-full pl-10 pr-10 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
          />
          <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
          {(query || imageFile) && (
            <button
              type="button"
              onClick={handleClear}
              className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600"
            >
              <XMarkIcon className="h-4 w-4" />
            </button>
          )}
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleImageUpload}
          className="hidden"
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className={cn(
            "p-3 rounded-lg border",
            imageFile
              ? "border-primary-500 bg-primary-50 text-primary-600"
              : "border-gray-300 text-gray-600 hover:bg-gray-50"
          )}
        >
          <PhotoIcon className="h-5 w-5" />
        </button>
      </div>
      {imageFile && (
        <div className="mt-2 flex items-center gap-2 text-sm text-gray-600">
          <PhotoIcon className="h-4 w-4" />
          <span>{imageFile.name}</span>
        </div>
      )}
    </form>
  )
} 