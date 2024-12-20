'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth/AuthContext'

export default function VerifyEmailPage() {
  const { state, resendVerification } = useAuth()
  const router = useRouter()

  useEffect(() => {
    // If no registration email is set, redirect to landing
    if (!state.registrationEmail && !state.isLoading) {
      router.push('/landing')
    }
  }, [state.registrationEmail, state.isLoading, router])

  if (state.isLoading || !state.registrationEmail) {
    return <div className="flex items-center justify-center h-screen">
      <div className="text-gray-600">Loading...</div>
    </div>
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900">
          Verify your email
        </h2>
        <p className="mt-2 text-center text-sm text-gray-600">
          We sent a verification link to {state.registrationEmail}
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white py-8 px-4 shadow sm:rounded-lg sm:px-10">
          <div className="space-y-6">
            <div>
              <p className="text-sm text-gray-500">
                Please check your email and click the verification link to complete your registration.
                If you don't see the email, check your spam folder.
              </p>
            </div>

            {state.error && (
              <div className="rounded-md bg-red-50 p-4">
                <div className="text-sm text-red-700">{state.error}</div>
              </div>
            )}

            <div className="flex items-center justify-between">
              <button
                onClick={() => resendVerification()}
                disabled={state.isLoading}
                className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50"
              >
                {state.isLoading ? 'Sending...' : 'Resend verification email'}
              </button>
            </div>

            <div className="text-sm text-center">
              <button
                onClick={() => router.push('/landing')}
                className="font-medium text-indigo-600 hover:text-indigo-500"
              >
                Return to sign in
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
} 