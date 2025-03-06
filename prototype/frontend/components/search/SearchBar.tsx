'use client'

import { useState, useRef, ChangeEvent, FormEvent } from 'react'
import { MagnifyingGlassIcon, XMarkIcon, PhotoIcon, MusicalNoteIcon, FilmIcon, BoltIcon } from '@heroicons/react/24/outline'
import { cn } from '@/lib/utils'

interface SearchBarProps {
  onSearch: (query: string, imageFile?: File, audioFile?: File, videoFile?: File) => void
  onClear: () => void
  advancedSearch?: boolean
  onToggleAdvancedSearch?: (enabled: boolean) => void
}

export default function SearchBar({ 
  onSearch, 
  onClear,
  advancedSearch = false,
  onToggleAdvancedSearch
}: SearchBarProps) {
  const [query, setQuery] = useState('')
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [audioFile, setAudioFile] = useState<File | null>(null)
  const [videoFile, setVideoFile] = useState<File | null>(null)
  const [imageName, setImageName] = useState('')
  const [audioName, setAudioName] = useState('')
  const [videoName, setVideoName] = useState('')
  const [isAnimating, setIsAnimating] = useState(false)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const audioInputRef = useRef<HTMLInputElement>(null)
  const videoInputRef = useRef<HTMLInputElement>(null)

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (query.trim() || imageFile || audioFile || videoFile) {
      onSearch(query, imageFile || undefined, audioFile || undefined, videoFile || undefined)
    }
  }

  const handleClear = () => {
    setQuery('')
    setImageFile(null)
    setImageName('')
    setAudioFile(null)
    setAudioName('')
    setVideoFile(null)
    setVideoName('')
    onClear()
  }

  const handleImageChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0]
      setImageFile(file)
      setImageName(file.name)
    }
  }

  const handleAudioChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0]
      setAudioFile(file)
      setAudioName(file.name)
    }
  }

  const handleVideoChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0]
      setVideoFile(file)
      setVideoName(file.name)
    }
  }
  
  const toggleAdvancedSearch = () => {
    if (onToggleAdvancedSearch) {
      setIsAnimating(true);
      // Reset animation after it completes
      setTimeout(() => setIsAnimating(false), 1000);
      onToggleAdvancedSearch(!advancedSearch);
    }
  };

  return (
    <div className="w-full">
      <form onSubmit={handleSubmit} className="relative">
        <div className="flex items-center relative border border-gray-300 rounded-lg shadow-sm focus-within:ring-1 focus-within:ring-indigo-500 focus-within:border-indigo-500 bg-white">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <MagnifyingGlassIcon className="h-5 w-5 text-gray-400" aria-hidden="true" />
          </div>
          
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="block w-full pl-10 pr-10 py-3 border-0 rounded-lg focus:outline-none focus:ring-0 sm:text-sm"
            placeholder="Search videos..."
          />
          
          <div className="absolute inset-y-0 right-0 flex items-center pr-3 space-x-1">
            {/* Advanced search toggle button with enhanced styling */}
            <button
              type="button"
              className={cn(
                "p-1.5 rounded-full transition-all duration-300 relative",
                advancedSearch 
                  ? "bg-indigo-600 text-white shadow-md" 
                  : "hover:bg-gray-100 text-gray-500",
                isAnimating && advancedSearch && "animate-pulse"
              )}
              onClick={toggleAdvancedSearch}
              title={advancedSearch ? "Disable advanced search" : "Enable advanced search"}
            >
              <BoltIcon className={cn(
                "h-5 w-5 transition-transform",
                isAnimating && "animate-bounce"
              )} />
              
              {/* Highlight ring animation */}
              {isAnimating && (
                <span className="absolute inset-0 rounded-full animate-ping-slow bg-indigo-400 opacity-75"></span>
              )}
              
              {/* Active indicator dot */}
              {advancedSearch && (
                <span className="absolute top-0 right-0 block h-2 w-2 rounded-full bg-green-400 ring-1 ring-white"></span>
              )}
            </button>
            
            {/* Image upload button (always visible) */}
            <button
              type="button"
              onClick={() => imageInputRef.current?.click()}
              className={`p-1 rounded-full ${imageFile ? 'bg-indigo-100 text-indigo-600' : 'hover:bg-gray-100 text-gray-400'}`}
              title="Upload image for search"
            >
              <PhotoIcon className="h-5 w-5" />
            </button>
            
            {/* Advanced search media options */}
            {advancedSearch && (
              <>
                <button
                  type="button"
                  onClick={() => audioInputRef.current?.click()}
                  className={`p-1 rounded-full ${audioFile ? 'bg-indigo-100 text-indigo-600' : 'hover:bg-gray-100 text-gray-400'}`}
                  title="Upload audio for search"
                >
                  <MusicalNoteIcon className="h-5 w-5" />
                </button>
                
                <button
                  type="button"
                  onClick={() => videoInputRef.current?.click()}
                  className={`p-1 rounded-full ${videoFile ? 'bg-indigo-100 text-indigo-600' : 'hover:bg-gray-100 text-gray-400'}`}
                  title="Upload video for search"
                >
                  <FilmIcon className="h-5 w-5" />
                </button>
              </>
            )}
            
            {/* Clear button - only shows when there's content to clear */}
            {(query || imageFile || audioFile || videoFile) && (
              <button
                type="button"
                onClick={handleClear}
                className="p-1 rounded-full hover:bg-gray-100 text-gray-400"
                title="Clear search"
              >
                <XMarkIcon className="h-5 w-5" />
              </button>
            )}
          </div>
        </div>
        
        {/* Hidden file inputs */}
        <input
          ref={imageInputRef}
          type="file"
          accept="image/*"
          onChange={handleImageChange}
          className="hidden"
        />
        <input
          ref={audioInputRef}
          type="file"
          accept="audio/*"
          onChange={handleAudioChange}
          className="hidden"
        />
        <input
          ref={videoInputRef}
          type="file"
          accept="video/*"
          onChange={handleVideoChange}
          className="hidden"
        />
        
        {/* File preview chips */}
        <div className="flex flex-wrap mt-2 gap-2">
          {imageFile && (
            <div className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
              <PhotoIcon className="h-3 w-3 mr-1" />
              {imageName}
              <button
                type="button"
                onClick={() => {
                  setImageFile(null)
                  setImageName('')
                }}
                className="ml-1 rounded-full hover:bg-blue-200"
              >
                <XMarkIcon className="h-3 w-3" />
              </button>
            </div>
          )}
          
          {audioFile && (
            <div className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
              <MusicalNoteIcon className="h-3 w-3 mr-1" />
              {audioName}
              <button
                type="button"
                onClick={() => {
                  setAudioFile(null)
                  setAudioName('')
                }}
                className="ml-1 rounded-full hover:bg-green-200"
              >
                <XMarkIcon className="h-3 w-3" />
              </button>
            </div>
          )}
          
          {videoFile && (
            <div className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-purple-100 text-purple-800">
              <FilmIcon className="h-3 w-3 mr-1" />
              {videoName}
              <button
                type="button"
                onClick={() => {
                  setVideoFile(null)
                  setVideoName('')
                }}
                className="ml-1 rounded-full hover:bg-purple-200"
              >
                <XMarkIcon className="h-3 w-3" />
              </button>
            </div>
          )}
        </div>
        
        {/* Visually hidden submit button for form submission */}
        <button type="submit" className="sr-only">
          Search
        </button>
      </form>
    </div>
  )
} 