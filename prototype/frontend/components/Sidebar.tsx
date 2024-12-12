'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import {
  MagnifyingGlassIcon,
  FolderPlusIcon,
  VideoCameraIcon
} from '@heroicons/react/24/outline'

const navigation = [
  {
    name: 'Search Videos',
    href: '/',
    icon: MagnifyingGlassIcon
  },
  {
    name: 'Create Index',
    href: '/create',
    icon: FolderPlusIcon
  },
  {
    name: 'My Videos',
    href: '/videos',
    icon: VideoCameraIcon
  }
]

export default function Sidebar() {
  const pathname = usePathname()

  return (
    <div className="flex flex-col w-64 bg-white border-r">
      {/* Logo */}
      <div className="flex h-16 items-center px-6 border-b">
        <h1 className="text-xl font-semibold text-gray-900">Video Search</h1>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-4 py-6 space-y-1">
        {navigation.map((item) => {
          const isActive = pathname === item.href
          return (
            <Link
              key={item.name}
              href={item.href}
              className={cn(
                "flex items-center px-4 py-2 text-sm font-medium rounded-lg",
                isActive
                  ? "bg-primary-50 text-primary-600"
                  : "text-gray-600 hover:bg-gray-50"
              )}
            >
              <item.icon className="mr-3 h-5 w-5 flex-shrink-0" />
              {item.name}
            </Link>
          )
        })}
      </nav>

      {/* User tutorial */}
      <div className="p-4 border-t">
        <div className="bg-blue-50 p-4 rounded-lg">
          <h3 className="text-sm font-medium text-blue-800">Quick Tutorial</h3>
          <ol className="mt-2 text-sm text-blue-700 space-y-2">
            <li>1. Create a new index</li>
            <li>2. Select models for analysis</li>
            <li>3. Upload your videos</li>
            <li>4. View processing status</li>
          </ol>
        </div>
      </div>
    </div>
  )
} 