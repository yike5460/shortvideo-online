'use client'

import { useState, useEffect } from 'react'
import { useAuth } from '@/lib/auth/AuthContext'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'

export default function ResetPasswordPage() {
  const { state, confirmPassword } = useAuth()
  const searchParams = useSearchParams()
  const [verificationCode, setVerificationCode] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmNewPassword, setConfirmNewPassword] = useState('')
  const [error, setError] = useState('')
  
  // Get email from query params
  const email = searchParams.get('email') || ''
  
  // Redirect if no email is found
  useEffect(() => {
    if (!email) {
      // No email to reset password for, redirect to login
      window.location.href = '/landing'
    }
  }, [email])
  
  const validatePassword = () => {
    if (newPassword.length < 8) {
      setError('Password must be at least 8 characters')
      return false
    }
    
    if (newPassword !== confirmNewPassword) {
      setError('Passwords do not match')
      return false
    }
    
    setError('')
    return true
  }
  
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!validatePassword()) {
      return
    }
    
    await confirmPassword(email, verificationCode, newPassword)
  }
  
  return (
    <div className="max-w-md mx-auto mt-10 p-6 bg-white rounded-lg shadow-md">
      <h1 className="text-2xl font-bold mb-6 text-gray-900">Reset Your Password</h1>
      
      <p className="mb-4 text-gray-700">
        Enter the verification code sent to <strong className="text-indigo-600">{email}</strong> and your new password.
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
        
        <div>
          <label htmlFor="new-password" className="block text-sm font-medium text-gray-700">
            New Password
          </label>
          <input
            id="new-password"
            type="password"
            required
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-indigo-500"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="Enter new password"
          />
        </div>
        
        <div>
          <label htmlFor="confirm-password" className="block text-sm font-medium text-gray-700">
            Confirm New Password
          </label>
          <input
            id="confirm-password"
            type="password"
            required
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-indigo-500"
            value={confirmNewPassword}
            onChange={(e) => setConfirmNewPassword(e.target.value)}
            placeholder="Confirm new password"
          />
        </div>
        
        {(error || state.error) && (
          <div className="rounded-md bg-red-50 p-4">
            <div className="text-sm text-red-700">{error || state.error}</div>
          </div>
        )}

        <button
          type="submit"
          disabled={state.isLoading}
          className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50"
        >
          {state.isLoading ? 'Resetting Password...' : 'Reset Password'}
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
