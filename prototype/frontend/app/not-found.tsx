import Link from 'next/link'
import { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Page Not Found - 404',
  description: 'The page you are looking for could not be found. Return to Know Your Moments and discover our AI-powered video search platform.',
  robots: {
    index: false,
    follow: true,
  },
}

export default function NotFound() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-gray-100 flex items-center justify-center px-4">
      <div className="max-w-md w-full text-center">
        <h1 className="text-9xl font-bold text-indigo-600">404</h1>
        <h2 className="mt-4 text-3xl font-bold text-gray-900">Page Not Found</h2>
        <p className="mt-4 text-lg text-gray-600">
          We couldn't find the page you're looking for. The video you're searching for might have been moved or doesn't exist.
        </p>
        <div className="mt-8 space-y-4">
          <Link
            href="/"
            className="inline-block px-6 py-3 bg-indigo-600 text-white font-medium rounded-lg hover:bg-indigo-700 transition-colors"
          >
            Go to Homepage
          </Link>
          <p className="text-sm text-gray-500">
            Or try our <Link href="/landing" className="text-indigo-600 hover:underline">AI video search</Link> to find what you need
          </p>
        </div>
      </div>
    </div>
  )
}