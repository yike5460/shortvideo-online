'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useAuth } from '@/lib/auth/AuthContext'
import { cn } from '@/lib/utils'
import { useState } from 'react'

const navigation = [
  { name: 'Search', href: '/', icon: SearchIcon },
  { name: 'Videos', href: '/videos', icon: VideoIcon },
  { name: 'Create Index', href: '/create', icon: PlusIcon },
  { name: 'Ask Video', href: '/ask', icon: QuestionIcon },
  { name: 'Auto Create', href: '/auto-create', icon: SparklesIcon },
  { name: 'Content Analysis', href: '/ads-tagging', icon: TagIcon },
]

export default function Sidebar() {
  const pathname = usePathname()
  const { logout, state } = useAuth()
  const isAuthenticated = !!state.session && !state.isLoading
  const isLandingPage = pathname === '/landing'
  const [collapsed, setCollapsed] = useState(false)

  if (!isAuthenticated || isLandingPage) {
    return null
  }

  return (
    <>
      {/* Desktop sidebar */}
      <div
        className={cn(
          'hidden md:flex flex-col bg-sidebar border-r border-sidebar-border transition-all duration-200',
          collapsed ? 'w-16' : 'w-60'
        )}
      >
        {/* Logo */}
        <div className="flex h-14 items-center px-4 border-b border-sidebar-border">
          {!collapsed && (
            <span className="text-base font-semibold text-white tracking-tight truncate">
              KnowYourVideo
            </span>
          )}
          <button
            onClick={() => setCollapsed(!collapsed)}
            className={cn(
              'p-1 rounded text-sidebar-text hover:text-white hover:bg-sidebar-hover transition-colors',
              collapsed ? 'mx-auto' : 'ml-auto'
            )}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            <CollapseIcon className="h-4 w-4" collapsed={collapsed} />
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 py-3 px-2 space-y-0.5 overflow-y-auto">
          {navigation.map((item) => {
            const isActive = item.href === '/'
              ? pathname === '/'
              : pathname.startsWith(item.href)

            return (
              <Link
                key={item.name}
                href={item.href}
                title={collapsed ? item.name : undefined}
                className={cn(
                  'flex items-center rounded-md px-2.5 py-2 text-sm font-medium transition-colors duration-150',
                  isActive
                    ? 'bg-primary-600/20 text-primary-300'
                    : 'text-sidebar-text hover:bg-sidebar-hover hover:text-white',
                  collapsed && 'justify-center px-0'
                )}
              >
                <item.icon
                  className={cn(
                    'h-[18px] w-[18px] flex-shrink-0',
                    isActive ? 'text-primary-400' : 'text-sidebar-text',
                    !collapsed && 'mr-2.5'
                  )}
                  aria-hidden="true"
                />
                {!collapsed && item.name}
              </Link>
            )
          })}
        </nav>

        {/* User section */}
        <div className="border-t border-sidebar-border p-3">
          <div className={cn('flex items-center', collapsed && 'justify-center')}>
            <div className="h-8 w-8 rounded-full bg-primary-600 flex items-center justify-center flex-shrink-0">
              <span className="text-xs font-medium text-white">
                {state.user?.email?.[0]?.toUpperCase() || '?'}
              </span>
            </div>
            {!collapsed && (
              <>
                <div className="ml-2.5 min-w-0 flex-1">
                  <p className="text-xs text-sidebar-text-active truncate">
                    {state.user?.email}
                  </p>
                </div>
                <button
                  onClick={() => logout()}
                  className="ml-1 p-1.5 rounded text-sidebar-text hover:text-white hover:bg-sidebar-hover transition-colors"
                  aria-label="Sign out"
                >
                  <LogoutIcon className="h-4 w-4" aria-hidden="true" />
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Mobile bottom nav */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-sidebar border-t border-sidebar-border">
        <nav className="flex justify-around py-1.5 px-1">
          {navigation.slice(0, 5).map((item) => {
            const isActive = item.href === '/'
              ? pathname === '/'
              : pathname.startsWith(item.href)

            return (
              <Link
                key={item.name}
                href={item.href}
                className={cn(
                  'flex flex-col items-center px-2 py-1 rounded-md text-xxs transition-colors',
                  isActive
                    ? 'text-primary-400'
                    : 'text-sidebar-text'
                )}
              >
                <item.icon className="h-5 w-5 mb-0.5" aria-hidden="true" />
                <span className="truncate">{item.name.split(' ')[0]}</span>
              </Link>
            )
          })}
        </nav>
      </div>
    </>
  )
}

function CollapseIcon({ collapsed, ...props }: React.SVGProps<SVGSVGElement> & { collapsed: boolean }) {
  return (
    <svg fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
      {collapsed ? (
        <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
      ) : (
        <path strokeLinecap="round" strokeLinejoin="round" d="M18.75 19.5l-7.5-7.5 7.5-7.5m-6 15L5.25 12l7.5-7.5" />
      )}
    </svg>
  )
}

function SearchIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
    </svg>
  )
}

function VideoIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z" />
    </svg>
  )
}

function PlusIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
    </svg>
  )
}

function LogoutIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15M12 9l-3 3m0 0l3 3m-3-3h12.75" />
    </svg>
  )
}

function SparklesIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.847a4.5 4.5 0 003.09 3.09L15.75 12l-2.847.813a4.5 4.5 0 00-3.09 3.091zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z" />
    </svg>
  )
}

function QuestionIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9 5.25h.008v.008H12v-.008z" />
    </svg>
  )
}

function TagIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.568 3H5.25A2.25 2.25 0 003 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 005.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 009.568 3z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 6h.008v.008H6V6z" />
    </svg>
  )
}
