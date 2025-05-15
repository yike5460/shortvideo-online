'use client'

import { useState, useEffect, useRef } from 'react'
import './styles.css'
import { useAuth } from '@/lib/auth/AuthContext'
import { useSearchParams } from 'next/navigation'
import { VideoResult } from '@/types'

// API configuration
const API_ENDPOINT = process.env.NEXT_PUBLIC_API_URL

// Define interfaces for the Ask feature
interface VideoThumbnail {
  id: string;
  title: string;
  thumbnailUrl: string;
  duration: string;
  indexId: string;
}

// Define interface for AI models
interface AIModel {
  id: string;
  name: string;
}

interface Index {
  id: string;
  name: string;
  videoCount: number;
}

interface AskResponse {
  sessionId: string;
}

interface StreamMessage {
  text: string;
}

// Define message type for chat history
interface ChatMessage {
  type: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

// Sample questions for the input box
const SAMPLE_QUESTIONS = [
  "Summarize this video",
  "What happens in this video?",
  "What are highlighted moments of this video?"
];

// Available AI models for video understanding
const AVAILABLE_MODELS: AIModel[] = [
  { id: 'qwen-vl-2.5', name: 'Qwen-VL 2.5' },
  { id: 'nova', name: 'Amazon Nova' }
];

export default function AskPage() {
  const { state } = useAuth()
  const searchParams = useSearchParams()
  const [videos, setVideos] = useState<VideoThumbnail[]>([])
  const [indexes, setIndexes] = useState<Index[]>([])
  const [selectedVideo, setSelectedVideo] = useState<VideoThumbnail | null>(null)
  const [question, setQuestion] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isLoadingVideos, setIsLoadingVideos] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [responseText, setResponseText] = useState('')
  const [isComplete, setIsComplete] = useState(false)
  const [selectedIndexId, setSelectedIndexId] = useState<string | null>(null)
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [hasError, setHasError] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string>('')
  const chatContainerRef = useRef<HTMLDivElement>(null)
  const eventSourceRef = useRef<EventSource | null>(null)
  const [isDropdownOpen, setIsDropdownOpen] = useState(false)
  const [isModelDropdownOpen, setIsModelDropdownOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const modelDropdownRef = useRef<HTMLDivElement>(null)
  const [selectedModel, setSelectedModel] = useState<string>('qwen-vl-2.5')

  // Initialize selectedIndexId from URL parameter and fetch indexes on mount
  useEffect(() => {
    const indexParam = searchParams.get('index');
    if (indexParam) {
      setSelectedIndexId(indexParam);
    }
    
    // Load saved model from localStorage
    const savedModel = localStorage.getItem('selectedVideoUnderstandingModel');
    if (savedModel) {
      setSelectedModel(savedModel);
    }
    
    // Fetch available indexes
    const fetchIndexes = async () => {
      try {
        setIsLoading(true); // Ensure we're in loading state
        const response = await fetch(`${API_ENDPOINT}/indexes`, {
          headers: {
            'Content-Type': 'application/json',
            ...(state.session ? { 'Authorization': `Bearer ${state.session.token}` } : {})
          }
        });
        
        if (!response.ok) {
          throw new Error(`Failed to fetch indexes: ${response.statusText}`);
        }
        
        const data = await response.json();
        
        // Create a map to deduplicate indexes and preserve video counts
        const indexMap = new Map();
        
        // First pass: collect all unique indexIds
        data.forEach((item: any) => {
          if (!indexMap.has(item.indexId)) {
            // Add enhanced index information
            indexMap.set(item.indexId, {
              id: item.indexId,
              name: item.indexId.split('-')[0] || item.indexId,
              videoCount: item.videoCount || 0
            });
          } else if (item.videoCount) {
            // If this entry has a videoCount and we've already seen this indexId,
            // update the videoCount in our map
            const existing = indexMap.get(item.indexId);
            existing.videoCount = item.videoCount;
            indexMap.set(item.indexId, existing);
          }
        });
        
        // Convert the map back to an array
        const formattedIndexes = Array.from(indexMap.values());
        
        // Sort indexes alphabetically by name
        formattedIndexes.sort((a, b) => a.name.localeCompare(b.name));
        
        setIndexes(formattedIndexes);
        setIsLoading(false); // Set loading to false after indexes are fetched
      } catch (error) {
        console.error('Error fetching indexes:', error);
        setError(error instanceof Error ? error.message : 'Failed to load indexes');
        setIsLoading(false); // Set loading to false even if there's an error
      }
    };
    
    fetchIndexes();
  }, [searchParams, state.session, API_ENDPOINT]);
  
  // Save selected model to localStorage when it changes
  useEffect(() => {
    localStorage.setItem('selectedVideoUnderstandingModel', selectedModel);
  }, [selectedModel]);

  // Fetch videos when selectedIndexId changes
  useEffect(() => {
    const fetchVideos = async () => {
      if (!selectedIndexId) {
        setVideos([]);
        return;
      }
      
      try {
        setIsLoadingVideos(true);
        // Build query parameters with selectedIndexId
        let queryParams = '';
        if (selectedIndexId) {
          queryParams = `?index=${selectedIndexId}`;
        }
        
        const response = await fetch(`${API_ENDPOINT}/videos${queryParams}`, {
          headers: {
            'Content-Type': 'application/json',
            ...(state.session ? { 'Authorization': `Bearer ${state.session.token}` } : {})
          }
        });
        
        if (!response.ok) {
          if (response.status === 404) {
            // 404 could mean "no videos found" in some API designs - treat as empty array
            setVideos([]);
            return;
          }
          throw new Error(`Failed to fetch videos: ${response.statusText}`);
        }
        
        const data = await response.json();
        // Transform the videos to the format we need
        const videoThumbnails: VideoThumbnail[] = (data.videos || []).map((video: VideoResult) => ({
          id: video.id,
          title: video.title || 'Untitled Video',
          thumbnailUrl: video.videoThumbnailUrl || '',
          duration: video.videoDuration || '00:00',
          indexId: video.indexId || 'videos'
        }));
        
        setVideos(videoThumbnails);
      } catch (error) {
        console.error('Error fetching videos:', error);
        setError(error instanceof Error ? error.message : 'Failed to load videos');
      } finally {
        setIsLoadingVideos(false);
      }
    };

    fetchVideos();
  }, [selectedIndexId, state.session, API_ENDPOINT]);

  // Handle video selection
  const handleVideoSelect = (video: VideoThumbnail) => {
    setSelectedVideo(video);
  };

  // Handle question input change
  const handleQuestionChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setQuestion(e.target.value);
  };

  // Handle sample question click
  const handleSampleQuestionClick = (sampleQuestion: string) => {
    setQuestion(sampleQuestion);
  };

  // Scroll to bottom of chat
  const scrollToBottom = () => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  };

  // Effect to scroll to bottom when messages change
  useEffect(() => {
    scrollToBottom();
  }, [chatMessages]);

  // Handle form submission
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!selectedVideo) {
      setError('Please select a video first');
      return;
    }
    
    if (!question.trim()) {
      setError('Please enter a question');
      return;
    }
    
    try {
      setIsProcessing(true);
      setError(null);
      setResponseText('');
      setIsComplete(false);
      setHasError(false);
      setErrorMessage('');
      
      // Add user message to chat
      const userMessage: ChatMessage = {
        type: 'user',
        content: question,
        timestamp: new Date()
      };
      setChatMessages(prev => [...prev, userMessage]);
      
      // Close any existing EventSource
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      
      // Initialize assistant message
      const assistantMessage: ChatMessage = {
        type: 'assistant',
        content: '',
        timestamp: new Date()
      };
      setChatMessages(prev => [...prev, assistantMessage]);
      
      // Initialize the streaming session
      const initResponse = await fetch(`${API_ENDPOINT}/videos/ask/init`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(state.session ? { 'Authorization': `Bearer ${state.session.token}` } : {})
        },
        body: JSON.stringify({
          videoId: selectedVideo.id,
          indexId: selectedVideo.indexId,
          question: question,
          model: selectedModel
        })
      });
      
      if (!initResponse.ok) {
        throw new Error(`Failed to initialize streaming: ${initResponse.statusText}`);
      }
      
      const { sessionId }: AskResponse = await initResponse.json();
      
      // Clear question after submitting
      setQuestion('');
      
      // Connect to the streaming endpoint
      const eventSource = new EventSource(`${API_ENDPOINT}/videos/ask/stream/${sessionId}`);
      eventSourceRef.current = eventSource;
      
      // Handle incoming message events
      eventSource.addEventListener('message', (event) => {
        try {
          const data: StreamMessage = JSON.parse(event.data);
          
          // Update the last assistant message with new content
          setChatMessages(prev => {
            const updated = [...prev];
            const lastMessage = updated[updated.length - 1];
            if (lastMessage && lastMessage.type === 'assistant') {
              lastMessage.content += data.text;
            }
            return updated;
          });
          
        } catch (error) {
          console.error('Error parsing SSE message:', error);
        }
      });
      
      // Handle completion event
      eventSource.addEventListener('complete', () => {
        setIsComplete(true);
        setIsProcessing(false);
        eventSource.close();
        eventSourceRef.current = null;
      });
      
      // Handle errors
      eventSource.addEventListener('error', (event) => {
        console.error('SSE Error:', event);
        
        // Try to parse error message from the event data
        let errorMsg = 'Error receiving response from server';
        try {
          if (event instanceof MessageEvent && event.data) {
            const errorData = JSON.parse(event.data);
            if (errorData.error) {
              errorMsg = errorData.error;
            }
          }
        } catch (parseError) {
          console.error('Error parsing error message:', parseError);
        }
        
        setError(errorMsg);
        setErrorMessage(errorMsg);
        setIsProcessing(false);
        setIsComplete(true); // Set isComplete to true to stop the waiting animation
        setHasError(true); // Set hasError to true to show error indicator in chat
        eventSource.close();
        eventSourceRef.current = null;
      });
    } catch (error) {
      console.error('Error submitting question:', error);
      setError(error instanceof Error ? error.message : 'Failed to submit question');
      setIsProcessing(false);
    }
  };

  // Clean up EventSource on unmount
  useEffect(() => {
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    };
  }, []);

  // Handle click outside to close dropdowns
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false);
      }
      if (modelDropdownRef.current && !modelDropdownRef.current.contains(event.target as Node)) {
        setIsModelDropdownOpen(false);
      }
    }
    
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  // Handle index selection
  const handleIndexSelect = (indexId: string) => {
    setSelectedIndexId(indexId);
    setIsDropdownOpen(false);
  };
  
  // Handle model selection
  const handleModelSelect = (modelId: string) => {
    setSelectedModel(modelId);
    setIsModelDropdownOpen(false);
  };

  if (isLoading) {
    return (
      <div className="container mx-auto p-4">
        <h1 className="text-2xl font-bold mb-6">Ask About Your Videos</h1>
        <div className="flex items-center justify-center h-64">
          <div className="flex flex-col items-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-500 mb-4"></div>
            <div className="text-gray-600">Loading videos...</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-4">
      <h1 className="text-2xl font-bold mb-6">Ask About Your Videos</h1>
      
      {error && (
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
          {error}
        </div>
      )}
      
      <div className="flex flex-col gap-6">
        {/* Index Selection */}
        <div className="bg-white rounded-lg shadow-md p-6">
          <h2 className="text-lg font-medium mb-4">Select an Index</h2>
          
          {indexes.length === 0 ? (
            <div className="bg-gray-100 p-4 rounded-md text-gray-600">
              No indexes found. <a href="/create" className="text-blue-600 hover:underline">Create your first index</a>
            </div>
          ) : (
            <div className="relative" ref={dropdownRef}>
              <div 
                className="custom-select-header block w-full pl-3 pr-10 py-2 text-base border border-gray-300 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 rounded-md cursor-pointer"
                onClick={() => setIsDropdownOpen(!isDropdownOpen)}
              >
                <div className="flex justify-between items-center">
                  <span>{selectedIndexId ? indexes.find(idx => idx.id === selectedIndexId)?.name || 'Select an index' : 'Select an index'}</span>
                  <svg className={`h-5 w-5 transition-transform duration-200 ${isDropdownOpen ? 'transform rotate-180' : ''}`} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                    <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                  </svg>
                </div>
              </div>
              
              {isDropdownOpen && (
                <div className="custom-select-dropdown absolute z-10 mt-1 w-full bg-white shadow-lg max-h-60 rounded-md py-1 text-base ring-1 ring-black ring-opacity-5 overflow-auto focus:outline-none sm:text-sm">
                  <div 
                    className="cursor-pointer select-none relative py-2 pl-3 pr-9 hover:bg-indigo-50 text-gray-500"
                    onClick={() => handleIndexSelect('')}
                  >
                    Select an index
                  </div>
                  
                  {indexes.map((index) => (
                    <div
                      key={index.id}
                      className={`cursor-pointer select-none relative py-2 pl-3 pr-9 hover:bg-indigo-50 ${selectedIndexId === index.id ? 'bg-indigo-100 text-indigo-900' : 'text-gray-900'}`}
                      onClick={() => handleIndexSelect(index.id)}
                    >
                      {index.name} ({index.videoCount} videos)
                      
                      {selectedIndexId === index.id && (
                        <span className="absolute inset-y-0 right-0 flex items-center pr-4 text-indigo-600">
                          <svg className="h-5 w-5" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                          </svg>
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
        
        {/* Video Selection Box */}
        <div className="bg-white rounded-lg shadow-md p-6">
          <h2 className="text-lg font-medium mb-4">Select a Video</h2>
          
          {!selectedIndexId ? (
            <div className="bg-gray-100 p-4 rounded-md text-gray-600">
              Please select an index first
            </div>
          ) : isLoadingVideos ? (
            <div className="flex items-center justify-center h-40">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-500"></div>
            </div>
          ) : videos.length === 0 ? (
            <div className="bg-gray-100 p-4 rounded-md text-gray-600">
              No videos found in this index. <a href="/create" className="text-blue-600 hover:underline">Upload videos</a>
            </div>
          ) : (
            <div className="video-thumbnail-grid">
              {videos.map((video) => (
                <div
                  key={video.id}
                  className={`video-thumbnail ${selectedVideo?.id === video.id ? 'selected' : ''}`}
                  onClick={() => handleVideoSelect(video)}
                >
                  <div className="relative aspect-video bg-gray-100">
                    {video.thumbnailUrl ? (
                      <img
                        src={video.thumbnailUrl}
                        alt={video.title}
                        className="video-thumbnail-image"
                        loading="lazy"
                      />
                    ) : (
                      <div className="w-full h-full bg-gray-200 flex items-center justify-center">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                        </svg>
                      </div>
                    )}
                    <div className="video-thumbnail-duration">
                      {video.duration}
                    </div>
                  </div>
                  <div className="video-thumbnail-title">
                    {video.title}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        
        {/* Chatbot UI */}
        <div className="bg-white rounded-lg shadow-md p-6">
          <h2 className="text-lg font-medium mb-4">
            Chat with {selectedVideo ? `"${selectedVideo.title}"` : 'your video'}
          </h2>
          
          {/* Chat container with message history */}
          <div className="chat-container">
            <div 
              ref={chatContainerRef}
              className="chat-messages"
            >
              {chatMessages.length === 0 ? (
                <div className="chat-empty-state">
                  <div className="chat-empty-icon">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-16 w-16 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                    </svg>
                  </div>
                  <p className="text-gray-500 text-center mt-4">
                    Select a video and ask a question to start the conversation
                  </p>
                </div>
              ) : (
                chatMessages.map((message, index) => (
                  <div
                    key={index}
                    className={`chat-message ${message.type === 'user' ? 'chat-message-user' : 'chat-message-assistant'} ${
                      message.type === 'assistant' && index === chatMessages.length - 1 && hasError ? 'chat-message-error' : ''
                    }`}
                  >
                    <div className="chat-message-content">
                      {message.content || (
                        message.type === 'assistant' && !isComplete && (
                          <div className="typing-animation">
                            <span className="dot"></span>
                            <span className="dot"></span>
                            <span className="dot"></span>
                          </div>
                        )
                      )}
                      {message.type === 'assistant' && index === chatMessages.length - 1 && hasError && (
                        <div className="error-indicator">
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-red-500" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                          </svg>
                          <span className="ml-2 text-red-500">Error: {errorMessage || 'Unable to process request'}</span>
                        </div>
                      )}
                    </div>
                    <div className="chat-message-time">
                      {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                ))
              )}
            </div>
            
            {/* Sample suggestions - now outside the conditional rendering */}
            {selectedVideo && (
              <div className="sample-suggestions mt-4 mb-4">
                <p className="text-sm text-gray-500 mb-3 text-center">Try asking:</p>
                <div className="flex flex-wrap justify-center gap-2">
                  {SAMPLE_QUESTIONS.map((sampleQuestion, index) => (
                    <button
                      key={index}
                      className="chat-suggestion-pill"
                      onClick={() => handleSampleQuestionClick(sampleQuestion)}
                      disabled={isProcessing}
                    >
                      {sampleQuestion}
                    </button>
                  ))}
                </div>
              </div>
            )}
            
            {/* Chat input */}
            <form onSubmit={handleSubmit} className="chat-input-container">
              <div className="relative">
                <textarea
                  name="question"
                  id="question"
                  rows={2}
                  className="chat-input"
                  placeholder={!selectedVideo ? "Select a video first..." : "Ask a question about this video..."}
                  value={question}
                  onChange={handleQuestionChange}
                  disabled={isProcessing || !selectedVideo}
                />
                
                {/* Model selector floating button */}
                <div className="absolute bottom-2 left-3 flex gap-2 items-center">
                  <div className="relative" ref={modelDropdownRef}>
                    <button
                      type="button"
                      className="rounded-full p-2 bg-gray-100 hover:bg-gray-200 transition-colors flex items-center justify-center"
                      onClick={() => setIsModelDropdownOpen(!isModelDropdownOpen)}
                      title="Select AI Model"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5 text-gray-600">
                        <circle cx="6" cy="8" r="2" />
                        <circle cx="6" cy="16" r="2" />
                        <circle cx="12" cy="12" r="2" />
                        <circle cx="18" cy="8" r="2" />
                        <circle cx="18" cy="16" r="2" />
                        <line x1="6" y1="8" x2="12" y2="12" />
                        <line x1="6" y1="16" x2="12" y2="12" />
                        <line x1="18" y1="8" x2="12" y2="12" />
                        <line x1="18" y1="16" x2="12" y2="12" />
                      </svg>
                    </button>
                    
                    {isModelDropdownOpen && (
                      <div className="absolute bottom-full mb-2 left-0 z-20 w-48 bg-white shadow-lg rounded-md py-1 text-base ring-1 ring-black ring-opacity-5 overflow-auto focus:outline-none sm:text-sm">
                        <div className="px-3 py-2 text-xs font-medium text-gray-500 border-b">
                          Select AI Model
                        </div>
                        {AVAILABLE_MODELS.map((model) => (
                          <div
                            key={model.id}
                            className={`cursor-pointer select-none relative py-2 pl-3 pr-9 hover:bg-indigo-50 ${selectedModel === model.id ? 'bg-indigo-100 text-indigo-900' : 'text-gray-900'}`}
                            onClick={() => handleModelSelect(model.id)}
                          >
                            {model.name}
                            
                            {selectedModel === model.id && (
                              <span className="absolute inset-y-0 right-0 flex items-center pr-4 text-indigo-600">
                                <svg className="h-5 w-5" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                </svg>
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  
                  <span className="text-xs text-gray-500">
                    {AVAILABLE_MODELS.find(model => model.id === selectedModel)?.name}
                  </span>
                </div>
                
                <button
                  type="submit"
                  className={`chat-send-button ${
                    isProcessing || !selectedVideo || !question.trim()
                      ? 'chat-send-disabled' 
                      : 'chat-send-enabled'
                  }`}
                  disabled={isProcessing || !selectedVideo || !question.trim()}
                >
                  {isProcessing ? (
                    <svg className="h-5 w-5 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                  ) : (
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                    </svg>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}