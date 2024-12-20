'use client'

import { usePathname, useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { useAuth } from '@/lib/auth/AuthContext'
import Sidebar from '@/components/Sidebar'

// Define protected and public paths
const PUBLIC_PATHS = ['/landing', '/auth/verify-email']
const PROTECTED_PATHS = ['/', '/videos', '/create']

export default function ClientLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const { state } = useAuth()
  const router = useRouter()
  const isAuthenticated = !!state.session && !state.isLoading
  const isPublicPath = PUBLIC_PATHS.includes(pathname)
  const isProtectedPath = PROTECTED_PATHS.includes(pathname)
  const showSidebar = isAuthenticated && !isPublicPath

  // Handle route protection
  useEffect(() => {
    if (state.isLoading) return // Don't redirect while checking authentication

    // Redirect to landing if trying to access protected path while not authenticated
    if (!isAuthenticated && isProtectedPath) {
      router.push('/landing')
      return
    }

    // Redirect to home if trying to access public path while authenticated
    if (isAuthenticated && isPublicPath && pathname !== '/auth/verify-email') {
      router.push('/')
      return
    }
  }, [isAuthenticated, isPublicPath, isProtectedPath, pathname, router, state.isLoading])

  // Show loading state while checking authentication
  if (state.isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-gray-600">Loading...</div>
      </div>
    )
  }

  return (
    <div className={showSidebar ? 'flex h-screen' : 'min-h-screen'}>
      {showSidebar && <Sidebar />}
      <div className={showSidebar ? 'flex-1 overflow-auto' : 'w-full'}>
        {children}
      </div>
    </div>
  )
} 