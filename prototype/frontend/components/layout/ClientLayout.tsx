'use client'

import Sidebar from '@/components/Sidebar'
import { usePathname } from 'next/navigation'
import { useAuth } from '@/lib/auth/AuthContext'

export default function ClientLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const { state } = useAuth()
  const isAuthenticated = !!state.session && !state.isLoading
  const isLandingPage = pathname === '/landing'

  if (isLandingPage || !isAuthenticated) {
    return <>{children}</>
  }

  return (
    <div className="flex h-screen">
      <Sidebar />
      <main className="flex-1 overflow-y-auto bg-surface-secondary pb-16 md:pb-0">
        {children}
      </main>
    </div>
  )
}
