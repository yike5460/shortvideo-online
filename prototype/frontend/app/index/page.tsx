'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function IndexPage() {
  const router = useRouter()

  useEffect(() => {
    router.replace('/create')
  }, [router])

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="text-center">
        <p className="text-gray-600">Redirecting...</p>
      </div>
    </div>
  )
} 