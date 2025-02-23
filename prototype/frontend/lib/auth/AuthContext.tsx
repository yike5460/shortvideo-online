'use client'

import { createContext, useContext, useReducer, useEffect } from 'react'
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

// Add session storage key
const SESSION_STORAGE_KEY = 'video_search_session'

// Add these types at the top of the file
type AuthAction =
  | { type: 'SET_SESSION'; payload: { session: any; user: any } }
  | { type: 'SET_LOADING'; payload: boolean }
  | { type: 'SET_ERROR'; payload: string }
  | { type: 'CLEAR_SESSION' }
  | { type: 'SET_VERIFICATION'; payload: { verificationRequired?: boolean; registrationEmail?: string; error?: string } }

// Add the reducer before the AuthProvider
function authReducer(state: AuthState, action: AuthAction): AuthState {
  switch (action.type) {
    case 'SET_SESSION':
      return {
        ...state,
        session: action.payload.session,
        user: action.payload.user,
        error: null,
        verificationRequired: false
      }
    case 'SET_LOADING':
      return {
        ...state,
        isLoading: action.payload
      }
    case 'SET_ERROR':
      return {
        ...state,
        error: action.payload,
        isLoading: false
      }
    case 'CLEAR_SESSION':
      return {
        ...initialState,
        isLoading: false,
        verificationRequired: false,
        registrationEmail: null
      }
    case 'SET_VERIFICATION':
      return {
        ...state,
        ...action.payload,
        isLoading: false
      }
    default:
      return state
  }
}

// Update the initial state to include verificationRequired
const initialState: AuthState = {
  isLoading: true,
  session: null,
  user: null,
  error: null,
  registrationEmail: null,
  verificationRequired: false
}

export const AuthContext = createContext<{
  state: AuthState
  login: (credentials: any) => Promise<void>
  logout: () => Promise<void>
  register: (credentials: any) => Promise<void>
  resendVerification: () => Promise<void>
}>({
  state: initialState,
  login: async () => {},
  logout: async () => {},
  register: async () => {},
  resendVerification: async () => {}
})

// Mock API delay
const mockApiDelay = () => new Promise(resolve => setTimeout(resolve, 500))

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(authReducer, initialState)
  const router = useRouter()

  // Load session from storage on mount
  useEffect(() => {
    const loadSession = () => {
      try {
        const savedSession = sessionStorage.getItem(SESSION_STORAGE_KEY)
        if (savedSession) {
          const { session, user } = JSON.parse(savedSession)
          dispatch({ type: 'SET_SESSION', payload: { session, user } })
        }
      } catch (error) {
        console.error('Error loading session:', error)
      } finally {
        dispatch({ type: 'SET_LOADING', payload: false })
      }
    }

    loadSession()
  }, [])

  const login = async (credentials: any) => {
    try {
      dispatch({ type: 'SET_LOADING', payload: true })
      
      // Mock successful login for test@example.com
      if (credentials.email === 'test@example.com' && credentials.password === 'password123') {
        const session = { token: 'mock-token' }
        const user = { email: credentials.email }
        
        // Save to session storage
        sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({ session, user }))
        
        dispatch({ type: 'SET_SESSION', payload: { session, user } })
        router.push('/')
        return
      }

      throw new Error('Invalid credentials')
    } catch (error) {
      dispatch({ type: 'SET_ERROR', payload: 'Invalid email or password' })
    } finally {
      dispatch({ type: 'SET_LOADING', payload: false })
    }
  }

  const logout = async () => {
    sessionStorage.removeItem(SESSION_STORAGE_KEY)
    dispatch({ type: 'CLEAR_SESSION' })
    router.push('/landing')
  }

  const register = async (credentials: RegisterCredentials) => {
    try {
      dispatch({ type: 'SET_LOADING', payload: true })

      await mockApiDelay()

      // Simulate sending verification email
      dispatch({ type: 'SET_VERIFICATION', payload: { verificationRequired: true, registrationEmail: credentials.email } })

      // Show verification required message
      router.push('/auth/verify-email')
    } catch (error) {
      dispatch({ type: 'SET_ERROR', payload: error instanceof Error ? error.message : 'An error occurred' })
    } finally {
      dispatch({ type: 'SET_LOADING', payload: false })
    }
  }

  const resendVerification = async () => {
    try {
      dispatch({ type: 'SET_LOADING', payload: true })
      
      await mockApiDelay()

      dispatch({ type: 'SET_VERIFICATION', payload: { error: 'Verification email resent. Please check your inbox.' } })
    } catch (error) {
      dispatch({ type: 'SET_ERROR', payload: error instanceof Error ? error.message : 'Failed to resend verification email' })
    } finally {
      dispatch({ type: 'SET_LOADING', payload: false })
    }
  }

  return (
    <AuthContext.Provider value={{ state, login, logout, register, resendVerification }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext) 