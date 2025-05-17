'use client'

import { useState } from 'react'
import { useAuth } from '@/lib/auth/AuthContext'
import LoginForm from '@/components/auth/LoginForm'
import RegisterForm from '@/components/auth/RegisterForm'
import { useRouter } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import Image from 'next/image'

function HeartIcon() {
  return (
    <svg
      className="inline-block w-6 h-6 text-red-500 animate-pulse"
      fill="currentColor"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
    </svg>
  )
}

export default function LandingPage() {
  const [showAuthModal, setShowAuthModal] = useState(false)
  const [activeTab, setActiveTab] = useState<'login' | 'register'>('login')
  const { state } = useAuth()
  const router = useRouter()

  // Redirect to home if already authenticated
  if (state.session && !state.isLoading) {
    router.push('/')
    return null
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-gray-100">
      {/* Navigation Bar */}
      <nav className="bg-white bg-opacity-95 backdrop-blur-md fixed w-full z-10 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex items-center">
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.5 }}
                className="text-2xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-indigo-600 to-purple-600"
              >
                Know Your Moments
              </motion.div>
            </div>
            <div className="flex items-center">
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => {
                  setActiveTab('login')
                  setShowAuthModal(true)
                }}
                className="px-4 py-2 rounded-md text-indigo-600 hover:bg-indigo-50 transition-colors duration-300"
              >
                Sign In
              </motion.button>
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => {
                  setActiveTab('register')
                  setShowAuthModal(true)
                }}
                className="ml-4 px-4 py-2 rounded-md bg-gradient-to-r from-indigo-600 to-purple-600 text-white shadow-md hover:shadow-lg transition-all duration-300"
              >
                Get Started
              </motion.button>
            </div>
          </div>
        </div>
      </nav>

      {/* Auth Modal */}
      <AnimatePresence>
        {showAuthModal && (
          <motion.div 
            className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setShowAuthModal(false)}
          >
            <motion.div 
              className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6"
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              onClick={e => e.stopPropagation()}
            >
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-2xl font-bold text-gray-800">
                  {activeTab === 'login' ? 'Welcome Back' : 'Create Account'}
                </h2>
                <button 
                  onClick={() => setShowAuthModal(false)}
                  className="text-gray-500 hover:text-gray-700"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              
              <div className="flex border-b border-gray-200 mb-6">
                <button
                  onClick={() => setActiveTab('login')}
                  className={`py-2 px-4 w-1/2 text-center ${
                    activeTab === 'login'
                      ? 'border-b-2 border-indigo-500 text-indigo-600 font-medium'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  Sign In
                </button>
                <button
                  onClick={() => setActiveTab('register')}
                  className={`py-2 px-4 w-1/2 text-center ${
                    activeTab === 'register'
                      ? 'border-b-2 border-indigo-500 text-indigo-600 font-medium'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  Register
                </button>
              </div>
              
              {activeTab === 'login' ? <LoginForm /> : <RegisterForm />}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Hero Section */}
      <div className="pt-24 pb-16 md:pt-32 md:pb-24">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="lg:grid lg:grid-cols-12 lg:gap-8">
            <div className="lg:col-span-6">
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.8 }}
                className="text-center lg:text-left"
              >
                <motion.h1 
                  className="text-4xl font-extrabold tracking-tight text-gray-900 sm:text-5xl md:text-6xl"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.2 }}
                >
                  <span className="block text-transparent bg-clip-text bg-gradient-to-r from-indigo-600 to-purple-600">
                    Revolutionize Your
                  </span>
                  <span className="block mt-1">Video Search Experience</span>
                </motion.h1>
                <motion.p
                  className="mt-6 text-lg text-gray-600 max-w-3xl"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.4 }}
                >
                  Search and analyze video content with cutting-edge AI. Find exactly what you're looking for using natural language queries and advanced visual recognition.
                </motion.p>
                <motion.div
                  className="mt-8 flex flex-col sm:flex-row sm:justify-center lg:justify-start gap-4"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.6 }}
                >
                  <motion.button
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={() => {
                      setActiveTab('register')
                      setShowAuthModal(true)
                    }}
                    className="px-8 py-4 rounded-lg bg-gradient-to-r from-indigo-600 to-purple-600 text-white font-medium shadow-xl hover:shadow-2xl transition-all duration-300"
                  >
                    Get Started For Free
                  </motion.button>
                  <motion.button
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    className="px-8 py-4 rounded-lg border border-gray-300 text-gray-700 font-medium hover:bg-gray-50 transition-colors duration-300"
                  >
                    Watch Demo
                  </motion.button>
                </motion.div>
              </motion.div>
            </div>
            <div className="mt-12 lg:mt-0 lg:col-span-6">
              <motion.div 
                className="bg-white rounded-2xl shadow-xl overflow-hidden"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.5, duration: 0.8 }}
              >
                <div className="relative">
                  {/* Single video thumbnail background */}
                  <div className="aspect-video relative">
                    <Image 
                      src="/images/thumbnails/video-thumbnail.png" 
                      alt="Video search demo" 
                      width={800} 
                      height={450}
                      className="object-cover w-full h-full"
                    />
                    <div className="absolute inset-0 bg-black bg-opacity-30 flex items-center justify-center">
                      <span className="text-xs text-white bg-black bg-opacity-70 px-2 py-1 rounded absolute bottom-2 right-2">05:24</span>
                    </div>
                  </div>
                  
                  {/* Overlay with search results demo */}
                  <div className="absolute inset-0 bg-gradient-to-b from-transparent to-indigo-900 bg-opacity-80 flex flex-col justify-end p-4">
                    <div className="bg-white bg-opacity-90 rounded-lg p-3 mb-3 shadow-lg transform translate-y-4 opacity-0 animate-fadeInUp">
                      <div className="flex items-start">
                        <div className="h-8 w-8 rounded-full bg-indigo-100 flex items-center justify-center flex-shrink-0">
                          <svg className="h-4 w-4 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                        </div>
                        <div className="ml-3">
                          <p className="text-xs font-medium text-gray-900">Found at 01:24</p>
                          <p className="text-xs text-gray-600">Brand logo appears on screen with product launch announcement</p>
                        </div>
                      </div>
                    </div>
                    
                    <div className="bg-white bg-opacity-90 rounded-lg p-3 shadow-lg transform translate-y-0 animate-fadeInUp animation-delay-100">
                      <div className="flex items-center">
                        <div className="relative h-10 w-16 flex-shrink-0 rounded overflow-hidden">
                          <Image 
                            src="/images/thumbnails/video-thumbnail-01.png" 
                            alt="Result thumbnail" 
                            fill
                            className="object-cover"
                          />
                        </div>
                        <div className="ml-3">
                          <p className="text-xs font-medium text-gray-900">Product Demo</p>
                          <p className="text-xs text-gray-600">2 matching segments found</p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </motion.div>
            </div>
          </div>
        </div>
      </div>

      {/* Features Highlight */}
      <div className="py-16 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div 
            className="text-center"
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
          >
            <motion.h2 
              className="text-base font-semibold text-indigo-600 tracking-wide uppercase"
              initial={{ opacity: 0, y: 10 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5 }}
            >
              Powerful Features
            </motion.h2>
            <motion.p 
              className="mt-2 text-3xl font-extrabold text-gray-900 sm:text-4xl"
              initial={{ opacity: 0, y: 10 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: 0.1 }}
            >
              Everything you need for intelligent video search
            </motion.p>
          </motion.div>

          <div className="mt-16">
            <div className="grid grid-cols-1 gap-8 md:grid-cols-2 lg:grid-cols-3">
              {/* Feature 1 */}
              <motion.div 
                className="relative p-6 bg-white rounded-xl shadow-md hover:shadow-xl transition-shadow duration-300"
                whileHover={{ y: -5 }}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5 }}
              >
                <div className="h-12 w-12 rounded-full bg-indigo-100 flex items-center justify-center mb-4">
                  <svg className="h-6 w-6 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                </div>
                <h3 className="text-xl font-medium text-gray-900">Multimodal Embedding Engine</h3>
                <p className="mt-2 text-base text-gray-600">
                  Our advanced system processes both visual elements (objects, actions, text, logos) and audio components (speech, music, ambient sounds) for granular, precise video analysis.
                </p>
              </motion.div>

              {/* Feature 2 */}
              <motion.div 
                className="relative p-6 bg-white rounded-xl shadow-md hover:shadow-xl transition-shadow duration-300"
                whileHover={{ y: -5 }}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: 0.1 }}
              >
                <div className="h-12 w-12 rounded-full bg-indigo-100 flex items-center justify-center mb-4">
                  <svg className="h-6 w-6 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                </div>
                <h3 className="text-xl font-medium text-gray-900">Any-to-Any Search Precision</h3>
                <p className="mt-2 text-base text-gray-600">
                  Search for brands, logos, or specific moments across modalities. Use images to find video segments, text to locate audio moments, or audio to discover relevant visual scenes.
                </p>
              </motion.div>

              {/* Feature 3 */}
              <motion.div 
                className="relative p-6 bg-white rounded-xl shadow-md hover:shadow-xl transition-shadow duration-300"
                whileHover={{ y: -5 }}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: 0.2 }}
              >
                <div className="h-12 w-12 rounded-full bg-indigo-100 flex items-center justify-center mb-4">
                  <svg className="h-6 w-6 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                  </svg>
                </div>
                <h3 className="text-xl font-medium text-gray-900">Long-Form Video Understanding</h3>
                <p className="mt-2 text-base text-gray-600">
                  Get accurate temporal grounding with precise timestamps. Generate coherent summaries, perform Q&A, and pinpoint specific moments in lengthy videos with contextual awareness.
                </p>
              </motion.div>
            </div>
          </div>
        </div>
      </div>

      {/* How It Works Section */}
      <div className="py-16 bg-gradient-to-b from-gray-50 to-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div 
            className="text-center mb-16"
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
          >
            <h2 className="text-base font-semibold text-indigo-600 tracking-wide uppercase">How It Works</h2>
            <p className="mt-2 text-3xl font-extrabold text-gray-900 sm:text-4xl">
              Simple Process, Powerful Results
            </p>
          </motion.div>

          <div className="relative">
            {/* Timeline line */}
            <div className="hidden md:block absolute left-1/2 transform -translate-x-1/2 h-full w-0.5 bg-gradient-to-b from-indigo-400 to-purple-500"></div>

            <div className="space-y-12 md:space-y-0 md:grid md:grid-cols-2 md:gap-16">
              {/* Step 1 */}
              <motion.div 
                className="md:col-start-1"
                initial={{ opacity: 0, x: -50 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5 }}
              >
                <div className="flex flex-col items-center md:items-end">
                  <div className="flex items-center justify-center h-12 w-12 rounded-full bg-indigo-500 text-white mb-4 md:hidden">
                    <span className="text-lg font-bold">1</span>
                  </div>
                  <div className="bg-white p-6 rounded-xl shadow-lg w-full max-w-md">
                    <h3 className="text-xl font-bold text-gray-900">Upload Videos</h3>
                    <p className="mt-2 text-gray-600">
                      Upload your videos to our secure platform or connect with your existing storage solutions.
                    </p>
                  </div>
                </div>
              </motion.div>

              {/* Step 1 Number (desktop) */}
              <div className="hidden md:flex md:col-start-2 md:items-center">
                <div className="h-12 w-12 rounded-full bg-indigo-500 text-white flex items-center justify-center z-10">
                  <span className="text-lg font-bold">1</span>
                </div>
              </div>

              {/* Step 2 Number (desktop) */}
              <div className="hidden md:flex md:col-start-1 md:items-center md:justify-end">
                <div className="h-12 w-12 rounded-full bg-indigo-500 text-white flex items-center justify-center z-10">
                  <span className="text-lg font-bold">2</span>
                </div>
              </div>

              {/* Step 2 */}
              <motion.div 
                className="md:col-start-2"
                initial={{ opacity: 0, x: 50 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5 }}
              >
                <div className="flex flex-col items-center md:items-start">
                  <div className="flex items-center justify-center h-12 w-12 rounded-full bg-indigo-500 text-white mb-4 md:hidden">
                    <span className="text-lg font-bold">2</span>
                  </div>
                  <div className="bg-white p-6 rounded-xl shadow-lg w-full max-w-md">
                    <h3 className="text-xl font-bold text-gray-900">AI Processing</h3>
                    <p className="mt-2 text-gray-600">
                      Our AI automatically analyzes your videos, indexes content, and makes everything searchable.
                    </p>
                  </div>
                </div>
              </motion.div>

              {/* Step 3 */}
              <motion.div 
                className="md:col-start-1"
                initial={{ opacity: 0, x: -50 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5 }}
              >
                <div className="flex flex-col items-center md:items-end">
                  <div className="flex items-center justify-center h-12 w-12 rounded-full bg-indigo-500 text-white mb-4 md:hidden">
                    <span className="text-lg font-bold">3</span>
                  </div>
                  <div className="bg-white p-6 rounded-xl shadow-lg w-full max-w-md">
                    <h3 className="text-xl font-bold text-gray-900">Search & Discover</h3>
                    <p className="mt-2 text-gray-600">
                      Search with natural language queries and find exactly what you're looking for instantly.
                    </p>
                  </div>
                </div>
              </motion.div>

              {/* Step 3 Number (desktop) */}
              <div className="hidden md:flex md:col-start-2 md:items-center">
                <div className="h-12 w-12 rounded-full bg-indigo-500 text-white flex items-center justify-center z-10">
                  <span className="text-lg font-bold">3</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Testimonials */}
      <div className="py-16 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div 
            className="text-center mb-16"
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
          >
            <h2 className="text-base font-semibold text-indigo-600 tracking-wide uppercase">Testimonials</h2>
            <p className="mt-2 text-3xl font-extrabold text-gray-900 sm:text-4xl">
              What our users are saying
            </p>
          </motion.div>

          <div className="grid gap-8 lg:grid-cols-3">
            {/* Testimonial 1 */}
            <motion.div 
              className="bg-gray-50 p-6 rounded-xl shadow-md"
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5 }}
            >
              <div className="flex items-center mb-4">
                <div className="h-12 w-12 rounded-full bg-indigo-200 flex items-center justify-center">
                  <span className="text-indigo-600 font-bold">JD</span>
                </div>
                <div className="ml-4">
                  <h4 className="text-lg font-medium text-gray-900">John Doe (Mocked User)</h4>
                  <p className="text-sm text-gray-600">Video Editor</p>
                </div>
              </div>
              <p className="text-gray-600 italic">
                "This platform has revolutionized how I search through my video archives. What used to take hours now takes seconds."
              </p>
            </motion.div>

            {/* Testimonial 2 */}
            <motion.div 
              className="bg-gray-50 p-6 rounded-xl shadow-md"
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: 0.1 }}
            >
              <div className="flex items-center mb-4">
                <div className="h-12 w-12 rounded-full bg-indigo-200 flex items-center justify-center">
                  <span className="text-indigo-600 font-bold">AS</span>
                </div>
                <div className="ml-4">
                  <h4 className="text-lg font-medium text-gray-900">Alice Smith (Mocked User)</h4>
                  <p className="text-sm text-gray-600">Content Creator</p>
                </div>
              </div>
              <p className="text-gray-600 italic">
                "The natural language search is incredible. I can find exact moments in my videos just by describing what I'm looking for."
              </p>
            </motion.div>

            {/* Testimonial 3 */}
            <motion.div 
              className="bg-gray-50 p-6 rounded-xl shadow-md"
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: 0.2 }}
            >
              <div className="flex items-center mb-4">
                <div className="h-12 w-12 rounded-full bg-indigo-200 flex items-center justify-center">
                  <span className="text-indigo-600 font-bold">RJ</span>
                </div>
                <div className="ml-4">
                  <h4 className="text-lg font-medium text-gray-900">Robert Johnson (Mocked User)</h4>
                  <p className="text-sm text-gray-600">Marketing Director</p>
                </div>
              </div>
              <p className="text-gray-600 italic">
                "The analytics and insights have helped us understand our video content better and make more informed decisions."
              </p>
            </motion.div>
          </div>
        </div>
      </div>

      {/* CTA Section */}
      <div className="py-16 bg-gradient-to-r from-indigo-600 to-purple-600">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <motion.h2 
            className="text-3xl font-extrabold text-white sm:text-4xl"
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
          >
            Ready to transform your video search experience?
          </motion.h2>
          <motion.p 
            className="mt-4 text-lg text-indigo-100 max-w-2xl mx-auto"
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.1 }}
          >
            Join thousands of users who are already saving time and discovering more with our advanced video search platform.
          </motion.p>
          <motion.div 
            className="mt-8 flex justify-center"
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.2 }}
          >
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => {
                setActiveTab('register')
                setShowAuthModal(true)
              }}
              className="px-8 py-4 rounded-full bg-white text-indigo-600 font-medium shadow-xl hover:shadow-2xl transition-all duration-300"
            >
              Get Started For Free
            </motion.button>
          </motion.div>
        </div>
      </div>

      {/* Footer */}
      <footer className="bg-gray-900 text-white py-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div>
              <h3 className="text-xl font-bold mb-4">Know Your Moments</h3>
              <p className="text-gray-400">
                The most advanced video search platform powered by AI. Made with <HeartIcon />
              </p>
            </div>
            <div>
              <h4 className="text-lg font-medium mb-4">Quick Links</h4>
              <ul className="space-y-2">
                <li><a href="#" className="text-gray-400 hover:text-white transition-colors">Features</a></li>
                <li><a href="#" className="text-gray-400 hover:text-white transition-colors">Pricing</a></li>
                <li><a href="#" className="text-gray-400 hover:text-white transition-colors">Documentation</a></li>
                <li><a href="#" className="text-gray-400 hover:text-white transition-colors">Blog</a></li>
              </ul>
            </div>
            <div>
              <h4 className="text-lg font-medium mb-4">Contact</h4>
              <ul className="space-y-2">
                <li className="flex items-center text-gray-400">
                  <svg className="h-5 w-5 mr-2" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M2.003 5.884L10 9.882l7.997-3.998A2 2 0 0016 4H4a2 2 0 00-1.997 1.884z" />
                    <path d="M18 8.118l-8 4-8-4V14a2 2 0 002 2h12a2 2 0 002-2V8.118z" />
                  </svg>
                  support@knowyourmoments.com
                </li>
                <li className="flex items-center text-gray-400">
                  <svg className="h-5 w-5 mr-2" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z" clipRule="evenodd" />
                  </svg>
                  Beijing, China
                </li>
              </ul>
            </div>
          </div>
          <div className="mt-8 pt-8 border-t border-gray-800 text-center text-gray-400 text-sm">
            <p>© 2025 Know Your Moments. All rights reserved.</p>
          </div>
        </div>
      </footer>
    </div>
  )
}