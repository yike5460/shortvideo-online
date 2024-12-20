'use client'

import { usePathname } from 'next/navigation'
import { useAuth } from '@/lib/auth/AuthContext'
import Sidebar from '@/components/Sidebar'

export default function ClientLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const { state } = useAuth()
  const isLandingPage = pathname === '/landing'
  const isAuthenticated = !!state.session && !state.isLoading
  const showSidebar = isAuthenticated && !isLandingPage

  // Always render the layout, but conditionally show the sidebar
  return (
    <div className={showSidebar ? 'flex h-screen' : 'min-h-screen'}>
      {showSidebar && <Sidebar />}
      <div className={showSidebar ? 'flex-1 overflow-auto' : 'w-full'}>
        {children}
      </div>
    </div>
  )
} 