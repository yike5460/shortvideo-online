'use client'

import { createContext, useContext, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AuthState, LoginCredentials, RegisterCredentials, User, Session } from '@/types/auth'

// Test account credentials
const TEST_ACCOUNT = {
  email: 'test@example.com',
  password: 'password123',
}

// Mock user data
const MOCK_USER: User = {
  id: 'test-user-id',
  email: TEST_ACCOUNT.email,
  createdAt: new Date().toISOString(),
  lastLogin: new Date().toISOString(),
  verificationStatus: true,
  twoFactorEnabled: false,
}

const initialState: AuthState = {
  user: null,
  session: null,
  isLoading: true,
  error: null,
}

const AuthContext = createContext<{
  state: AuthState;
  login: (credentials: LoginCredentials) => Promise<void>;
  register: (credentials: RegisterCredentials) => Promise<void>;
  logout: () => Promise<void>;
  clearError: () => void;
}>({
  state: initialState,
  login: async () => {},
  register: async () => {},
  logout: async () => {},
  clearError: () => {},
})

// Mock API delay
const mockApiDelay = () => new Promise(resolve => setTimeout(resolve, 500))

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>(initialState)
  const router = useRouter()

  useEffect(() => {
    // Check for existing session in localStorage
    const storedSession = localStorage.getItem('session')
    if (storedSession) {
      try {
        const session = JSON.parse(storedSession)
        setState(prev => ({
          ...prev,
          user: session.user,
          session,
          isLoading: false,
        }))
      } catch (error) {
        localStorage.removeItem('session')
        setState(prev => ({ ...prev, isLoading: false }))
      }
    } else {
      setState(prev => ({ ...prev, isLoading: false }))
    }
  }, [])

  const login = async (credentials: LoginCredentials) => {
    try {
      setState(prev => ({ ...prev, isLoading: true, error: null }))
      
      // Simulate API delay
      await mockApiDelay()

      // Check test account credentials
      if (credentials.email !== TEST_ACCOUNT.email || credentials.password !== TEST_ACCOUNT.password) {
        throw new Error('Invalid credentials. Use test@example.com / password123')
      }

      // Create mock session
      const session: Session = {
        token: 'mock-jwt-token-' + Date.now(),
        user: MOCK_USER,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // 24 hours from now
      }
      
      if (credentials.rememberMe) {
        localStorage.setItem('session', JSON.stringify(session))
      }

      setState(prev => ({
        ...prev,
        user: session.user,
        session,
        isLoading: false,
      }))

      router.push('/')
    } catch (error) {
      setState(prev => ({
        ...prev,
        error: error instanceof Error ? error.message : 'An error occurred',
        isLoading: false,
      }))
    }
  }

  const register = async (credentials: RegisterCredentials) => {
    try {
      setState(prev => ({ ...prev, isLoading: true, error: null }))

      // Simulate API delay
      await mockApiDelay()

      // Create mock user and session
      const user: User = {
        id: 'user-' + Date.now(),
        email: credentials.email,
        createdAt: new Date().toISOString(),
        lastLogin: new Date().toISOString(),
        verificationStatus: true,
        twoFactorEnabled: false,
      }

      const session: Session = {
        token: 'mock-jwt-token-' + Date.now(),
        user,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // 24 hours from now
      }

      localStorage.setItem('session', JSON.stringify(session))

      setState(prev => ({
        ...prev,
        user: session.user,
        session,
        isLoading: false,
      }))

      router.push('/')
    } catch (error) {
      setState(prev => ({
        ...prev,
        error: error instanceof Error ? error.message : 'An error occurred',
        isLoading: false,
      }))
    }
  }

  const logout = async () => {
    try {
      setState(prev => ({ ...prev, isLoading: true }))
      
      // Simulate API delay
      await mockApiDelay()

      localStorage.removeItem('session')
      setState({ ...initialState, isLoading: false })
      router.push('/landing')
    } catch (error) {
      console.error('Logout error:', error)
      // Still clear the session even if the API call fails
      localStorage.removeItem('session')
      setState({ ...initialState, isLoading: false })
      router.push('/landing')
    }
  }

  const clearError = () => {
    setState(prev => ({ ...prev, error: null }))
  }

  return (
    <AuthContext.Provider value={{ state, login, register, logout, clearError }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext) 