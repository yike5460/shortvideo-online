'use client'

import Sidebar from '@/components/Sidebar'
import { usePathname } from 'next/navigation'
import { useAuth } from '@/lib/auth/AuthContext'

export default function ClientLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const { state } = useAuth()
  const isAuthenticated = !!state.session && !state.isLoading
  const isLandingPage = pathname === '/landing'

  // If on landing page or not authenticated, render without sidebar
  if (isLandingPage || !isAuthenticated) {
    return <>{children}</>
  }

  // Otherwise render with sidebar
  return (
    <div className="flex h-screen">
      <Sidebar />
      <main className="flex-1 overflow-y-auto bg-gray-50 relative">
        {children}
      </main>
    </div>
  )
}