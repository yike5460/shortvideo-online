'use client'

import { usePathname } from 'next/navigation'
import Sidebar from '@/components/Sidebar'

export default function ClientLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const isLandingPage = pathname === '/landing'

  return (
    <div className={isLandingPage ? '' : 'flex h-screen'}>
      {!isLandingPage && <Sidebar />}
      <div className={isLandingPage ? '' : 'flex-1 overflow-auto'}>
        {children}
      </div>
    </div>
  )
} 