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
  verificationRequired: false,
  registrationEmail: null,
}

const AuthContext = createContext<{
  state: AuthState;
  login: (credentials: LoginCredentials) => Promise<void>;
  register: (credentials: RegisterCredentials) => Promise<void>;
  logout: () => Promise<void>;
  clearError: () => void;
  resendVerification: () => Promise<void>;
}>({
  state: initialState,
  login: async () => {},
  register: async () => {},
  logout: async () => {},
  clearError: () => {},
  resendVerification: async () => {},
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
      
      // For test account, bypass verification
      if (credentials.email === TEST_ACCOUNT.email && credentials.password === TEST_ACCOUNT.password) {
        const session: Session = {
          token: 'mock-jwt-token-' + Date.now(),
          user: MOCK_USER,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        }
        
        if (credentials.rememberMe) {
          localStorage.setItem('session', JSON.stringify(session))
        }

        setState(prev => ({
          ...prev,
          user: session.user,
          session,
          isLoading: false,
          verificationRequired: false,
          registrationEmail: null,
        }))

        router.push('/')
        return
      }

      // For other accounts, check verification status
      if (!credentials.email.endsWith('@example.com')) {
        setState(prev => ({
          ...prev,
          error: 'Please verify your email before logging in.',
          verificationRequired: true,
          registrationEmail: credentials.email,
          isLoading: false,
        }))
        return
      }

      throw new Error('Invalid credentials. Use test@example.com / password123')
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

      await mockApiDelay()

      // Simulate sending verification email
      setState(prev => ({
        ...prev,
        verificationRequired: true,
        registrationEmail: credentials.email,
        error: null,
        isLoading: false,
      }))

      // Show verification required message
      router.push('/auth/verify-email')
    } catch (error) {
      setState(prev => ({
        ...prev,
        error: error instanceof Error ? error.message : 'An error occurred',
        isLoading: false,
      }))
    }
  }

  const resendVerification = async () => {
    try {
      setState(prev => ({ ...prev, isLoading: true, error: null }))
      
      await mockApiDelay()

      setState(prev => ({
        ...prev,
        error: 'Verification email resent. Please check your inbox.',
        isLoading: false,
      }))
    } catch (error) {
      setState(prev => ({
        ...prev,
        error: error instanceof Error ? error.message : 'Failed to resend verification email',
        isLoading: false,
      }))
    }
  }

  const logout = async () => {
    try {
      setState(prev => ({ ...prev, isLoading: true }))
      
      await mockApiDelay()

      localStorage.removeItem('session')
      setState({ 
        ...initialState, 
        isLoading: false,
        verificationRequired: false,
        registrationEmail: null,
      })
      router.push('/landing')
    } catch (error) {
      console.error('Logout error:', error)
      localStorage.removeItem('session')
      setState({ 
        ...initialState, 
        isLoading: false,
        verificationRequired: false,
        registrationEmail: null,
      })
      router.push('/landing')
    }
  }

  const clearError = () => {
    setState(prev => ({ ...prev, error: null }))
  }

  return (
    <AuthContext.Provider value={{ 
      state, 
      login, 
      register, 
      logout, 
      clearError,
      resendVerification,
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext) 