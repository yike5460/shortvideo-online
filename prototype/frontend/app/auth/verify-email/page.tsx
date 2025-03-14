'use client'

import { useState, useEffect } from 'react'
import { useAuth } from '@/lib/auth/AuthContext'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'

export default function VerifyEmailPage() {
  const { state, confirmRegistration, resendVerification } = useAuth()
  const searchParams = useSearchParams()
  const [verificationCode, setVerificationCode] = useState('')
  
  // Get email from query params or context
  const email = searchParams.get('email') || state.registrationEmail || ''
  
  // Redirect if no email is found
  useEffect(() => {
    if (!email && !state.registrationEmail) {
      // No email to verify, redirect to login
      window.location.href = '/landing'
    }
  }, [email, state.registrationEmail])
  
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    await confirmRegistration(email, verificationCode)
  }
  
  const handleResend = async () => {
    await resendVerification()
  }
  
  return (
    <div className="max-w-md mx-auto mt-10 p-6 bg-white rounded-lg shadow-md">
      <h1 className="text-2xl font-bold mb-6 text-gray-900">Verify Your Email</h1>
      
      <p className="mb-4 text-gray-700">
        We've sent a verification code to <strong className="text-indigo-600">{email}</strong>. 
        Please check your inbox and enter the code below to verify your account.
      </p>
      
      <form onSubmit={handleSubmit} className="space-y-6">
        <div>
          <label htmlFor="code" className="block text-sm font-medium text-gray-700">
            Verification Code
          </label>
          <input
            id="code"
            type="text"
            required
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-indigo-500"
            value={verificationCode}
            onChange={(e) => setVerificationCode(e.target.value)}
            placeholder="Enter verification code"
          />
        </div>
        
        {state.error && (
          <div className="rounded-md bg-red-50 p-4">
            <div className="text-sm text-red-700">{state.error}</div>
          </div>
        )}

        <button
          type="submit"
          disabled={state.isLoading}
          className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50"
        >
          {state.isLoading ? 'Verifying...' : 'Verify Email'}
        </button>
        
        <div className="text-center">
          <button 
            type="button" 
            onClick={handleResend}
            disabled={state.isLoading}
            className="text-sm font-medium text-indigo-600 hover:text-indigo-500"
          >
            Didn't receive a code? Send again
          </button>
        </div>

        <div className="text-center mt-4">
          <Link href="/landing" className="text-sm text-gray-600 hover:text-indigo-500">
            Return to login
          </Link>
        </div>
      </form>
    </div>
  )
}
