'use client'

import { useState } from 'react'
import { useAuth } from '@/lib/auth/AuthContext'
import LoginForm from '@/components/auth/LoginForm'
import RegisterForm from '@/components/auth/RegisterForm'
import { useRouter } from 'next/navigation'

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
  const [activeTab, setActiveTab] = useState<'login' | 'register'>('login')
  const { state } = useAuth()
  const router = useRouter()

  // Redirect to home if already authenticated
  if (state.session && !state.isLoading) {
    router.push('/')
    return null
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Hero Section */}
      <div className="relative overflow-hidden">
        <div className="absolute inset-y-0 h-full w-full" aria-hidden="true">
          <div className="relative h-full">
            <svg
              className="absolute right-full transform translate-y-1/3 translate-x-1/4 md:translate-y-1/2 sm:translate-x-1/2 lg:translate-x-full"
              width="404"
              height="784"
              fill="none"
              viewBox="0 0 404 784"
            >
              <defs>
                <pattern
                  id="e229dbec-10e9-49ee-8ec3-0286ca089edf"
                  x="0"
                  y="0"
                  width="20"
                  height="20"
                  patternUnits="userSpaceOnUse"
                >
                  <rect x="0" y="0" width="4" height="4" className="text-gray-200" fill="currentColor" />
                </pattern>
              </defs>
              <rect width="404" height="784" fill="url(#e229dbec-10e9-49ee-8ec3-0286ca089edf)" />
            </svg>
            <svg
              className="absolute left-full transform -translate-y-3/4 -translate-x-1/4 sm:-translate-x-1/2 md:-translate-y-1/2 lg:-translate-x-3/4"
              width="404"
              height="784"
              fill="none"
              viewBox="0 0 404 784"
            >
              <defs>
                <pattern
                  id="d2a68204-c383-44b1-b99f-42ccff4e5365"
                  x="0"
                  y="0"
                  width="20"
                  height="20"
                  patternUnits="userSpaceOnUse"
                >
                  <rect x="0" y="0" width="4" height="4" className="text-gray-200" fill="currentColor" />
                </pattern>
              </defs>
              <rect width="404" height="784" fill="url(#d2a68204-c383-44b1-b99f-42ccff4e5365)" />
            </svg>
          </div>
        </div>

        <div className="relative pt-6 pb-16 sm:pb-24">
          <div className="mx-auto max-w-7xl px-4 sm:px-6">
            <div className="text-center">
              <h1 className="text-4xl font-bold tracking-tight text-gray-900 sm:text-5xl md:text-6xl">
                <span className="block">Video Search Platform</span>
                <span className="block text-indigo-600 mt-2 text-2xl sm:text-3xl md:text-4xl">
                  Built with <HeartIcon />
                </span>
              </h1>
              <p className="mx-auto mt-3 max-w-md text-base text-gray-500 sm:text-lg md:mt-5 md:max-w-3xl md:text-xl">
                Search and analyze video content across multiple sources with advanced AI capabilities.
                Upload your videos and search through them with natural language.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Auth Section */}
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-md">
          <div className="rounded-lg bg-white shadow-lg">
            <div className="p-4">
              <div className="sm:hidden">
                <select
                  className="block w-full rounded-md border-gray-300 py-2"
                  value={activeTab}
                  onChange={(e) => setActiveTab(e.target.value as 'login' | 'register')}
                >
                  <option value="login">Sign in</option>
                  <option value="register">Create account</option>
                </select>
              </div>
              <div className="hidden sm:block">
                <div className="border-b border-gray-200">
                  <nav className="-mb-px flex" aria-label="Tabs">
                    <button
                      onClick={() => setActiveTab('login')}
                      className={`w-1/2 border-b-2 py-4 px-1 text-center text-sm font-medium ${
                        activeTab === 'login'
                          ? 'border-indigo-500 text-indigo-600'
                          : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
                      }`}
                    >
                      Sign in
                    </button>
                    <button
                      onClick={() => setActiveTab('register')}
                      className={`w-1/2 border-b-2 py-4 px-1 text-center text-sm font-medium ${
                        activeTab === 'register'
                          ? 'border-indigo-500 text-indigo-600'
                          : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
                      }`}
                    >
                      Create account
                    </button>
                  </nav>
                </div>
              </div>

              <div className="mt-8">
                {activeTab === 'login' ? <LoginForm /> : <RegisterForm />}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Features Section */}
      <div className="mt-32 bg-white">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="lg:text-center">
            <h2 className="text-base font-semibold uppercase tracking-wide text-indigo-600">Features</h2>
            <p className="mt-2 text-3xl font-extrabold leading-8 tracking-tight text-gray-900 sm:text-4xl">
              Everything you need for video search
            </p>
          </div>

          <div className="mt-10">
            <dl className="space-y-10 md:grid md:grid-cols-2 md:gap-x-8 md:gap-y-10 md:space-y-0">
              <div className="relative">
                <dt>
                  <div className="absolute flex h-12 w-12 items-center justify-center rounded-md bg-indigo-500 text-white">
                    <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                  </div>
                  <p className="ml-16 text-lg font-medium leading-6 text-gray-900">Advanced Search</p>
                </dt>
                <dd className="mt-2 ml-16 text-base text-gray-500">
                  Search through video content using natural language queries and get precise results.
                </dd>
              </div>

              <div className="relative">
                <dt>
                  <div className="absolute flex h-12 w-12 items-center justify-center rounded-md bg-indigo-500 text-white">
                    <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                  </div>
                  <p className="ml-16 text-lg font-medium leading-6 text-gray-900">Visual Search</p>
                </dt>
                <dd className="mt-2 ml-16 text-base text-gray-500">
                  Find specific moments in videos by uploading images or describing visual content.
                </dd>
              </div>

              <div className="relative">
                <dt>
                  <div className="absolute flex h-12 w-12 items-center justify-center rounded-md bg-indigo-500 text-white">
                    <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                    </svg>
                  </div>
                  <p className="ml-16 text-lg font-medium leading-6 text-gray-900">Analytics</p>
                </dt>
                <dd className="mt-2 ml-16 text-base text-gray-500">
                  Get detailed insights about your video content with advanced analytics.
                </dd>
              </div>

              <div className="relative">
                <dt>
                  <div className="absolute flex h-12 w-12 items-center justify-center rounded-md bg-indigo-500 text-white">
                    <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                  </div>
                  <p className="ml-16 text-lg font-medium leading-6 text-gray-900">Fast Processing</p>
                </dt>
                <dd className="mt-2 ml-16 text-base text-gray-500">
                  Quick indexing and real-time search results powered by advanced AI models.
                </dd>
              </div>
            </dl>
          </div>
        </div>
      </div>
    </div>
  )
}