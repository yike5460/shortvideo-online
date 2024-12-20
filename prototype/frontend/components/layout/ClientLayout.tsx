'use client'

import { usePathname } from 'next/navigation'
import { useAuth } from '@/lib/auth/AuthContext'
import Sidebar from '@/components/Sidebar'

export default function ClientLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const { state } = useAuth()
  const isLandingPage = pathname === '/landing'
  const isAuthenticated = !!state.session && !state.isLoading

  // Only show sidebar if authenticated and not on landing page
  const showSidebar = isAuthenticated && !isLandingPage

  return (
    <div className={showSidebar ? 'flex h-screen' : ''}>
      {showSidebar && <Sidebar />}
      <div className={showSidebar ? 'flex-1 overflow-auto' : ''}>
        {children}
      </div>
    </div>
  )
} 