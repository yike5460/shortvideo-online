'use client'

import { useState } from 'react'
import { useAuth } from '@/lib/auth/AuthContext'
import Link from 'next/link'

export default function ForgotPasswordPage() {
  const { state, forgotPassword } = useAuth()
  const [email, setEmail] = useState('')
  
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    await forgotPassword(email)
  }
  
  return (
    <div className="max-w-md mx-auto mt-10 p-6 bg-white rounded-lg shadow-md">
      <h1 className="text-2xl font-bold mb-6 text-gray-900">Reset Password</h1>
      
      <p className="mb-4 text-gray-700">
        Enter your email address and we'll send you a verification code to reset your password.
      </p>
      
      <form onSubmit={handleSubmit} className="space-y-6">
        <div>
          <label htmlFor="email" className="block text-sm font-medium text-gray-700">
            Email Address
          </label>
          <input
            id="email"
            type="email"
            required
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-indigo-500"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Enter your email address"
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
          {state.isLoading ? 'Sending...' : 'Send Reset Code'}
        </button>

        <div className="text-center mt-4">
          <Link href="/landing" className="text-sm text-gray-600 hover:text-indigo-500">
            Return to login
          </Link>
        </div>
      </form>
    </div>
  )
}
