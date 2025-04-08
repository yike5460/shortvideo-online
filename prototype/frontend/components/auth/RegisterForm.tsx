'use client'

import { useState } from 'react'
import { useAuth } from '@/lib/auth/AuthContext'
import { RegisterCredentials } from '@/types/auth'

export default function RegisterForm() {
  const { register, state } = useAuth()
  const [credentials, setCredentials] = useState<RegisterCredentials>({
    email: '',
    password: '',
    confirmPassword: '',
    acceptTerms: false,
  })
  const [errors, setErrors] = useState<{
    email?: string;
    password?: string;
    confirmPassword?: string;
  }>({})

  const validateForm = () => {
    const newErrors: typeof errors = {}
    
    if (!credentials.email.endsWith('@amazon.com')) {
      newErrors.email = 'Only invitation email addresses are allowed for pre-release'
    }

    if (credentials.password.length < 8) {
      newErrors.password = 'Password must be at least 8 characters'
    }

    if (credentials.password !== credentials.confirmPassword) {
      newErrors.confirmPassword = 'Passwords do not match'
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!validateForm()) return
    await register(credentials)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div>
        <label htmlFor="email" className="block text-sm font-medium text-gray-700">
          Email
        </label>
        <input
          id="email"
          type="email"
          required
          className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-indigo-500"
          value={credentials.email}
          onChange={(e) => setCredentials(prev => ({ ...prev, email: e.target.value }))}
        />
        {errors.email && (
          <p className="mt-1 text-sm text-red-600">{errors.email}</p>
        )}
      </div>

      <div>
        <label htmlFor="password" className="block text-sm font-medium text-gray-700">
          Password
        </label>
        <input
          id="password"
          type="password"
          required
          className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-indigo-500"
          value={credentials.password}
          onChange={(e) => setCredentials(prev => ({ ...prev, password: e.target.value }))}
        />
        {errors.password && (
          <p className="mt-1 text-sm text-red-600">{errors.password}</p>
        )}
      </div>

      <div>
        <label htmlFor="confirm-password" className="block text-sm font-medium text-gray-700">
          Confirm Password
        </label>
        <input
          id="confirm-password"
          type="password"
          required
          className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-indigo-500"
          value={credentials.confirmPassword}
          onChange={(e) => setCredentials(prev => ({ ...prev, confirmPassword: e.target.value }))}
        />
        {errors.confirmPassword && (
          <p className="mt-1 text-sm text-red-600">{errors.confirmPassword}</p>
        )}
      </div>

      <div className="flex items-center">
        <input
          id="accept-terms"
          type="checkbox"
          required
          className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
          checked={credentials.acceptTerms}
          onChange={(e) => setCredentials(prev => ({ ...prev, acceptTerms: e.target.checked }))}
        />
        <label htmlFor="accept-terms" className="ml-2 block text-sm text-gray-900">
          I accept the <a href="#" className="text-indigo-600 hover:text-indigo-500">terms and conditions</a>
        </label>
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
        {state.isLoading ? 'Creating account...' : 'Create account'}
      </button>
    </form>
  )
}
