'use client'

import { createContext, useContext, useReducer, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { AuthState, LoginCredentials, RegisterCredentials, User, Session } from '@/types/auth'
import { cognitoClient, CognitoSessionData } from './cognitoClient'
import { setSessionTokenGetter } from '@/lib/api/client'

// Session storage key
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
  login: (credentials: LoginCredentials) => Promise<void>
  logout: () => Promise<void>
  register: (credentials: RegisterCredentials) => Promise<void>
  confirmRegistration: (email: string, code: string) => Promise<void>
  resendVerification: () => Promise<void>
  forgotPassword: (email: string) => Promise<void>
  confirmPassword: (email: string, code: string, newPassword: string) => Promise<void>
}>({
  state: initialState,
  login: async () => {},
  logout: async () => {},
  register: async () => {},
  confirmRegistration: async () => {},
  resendVerification: async () => {},
  forgotPassword: async () => {},
  confirmPassword: async () => {}
})

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(authReducer, initialState)
  const router = useRouter()

  // Wire up the API client's session token getter
  useEffect(() => {
    setSessionTokenGetter(() => state.session?.token ?? null);
  }, [state.session]);

  // Load session from Cognito on mount
  useEffect(() => {
    const loadSession = async () => {
      try {
        dispatch({ type: 'SET_LOADING', payload: true })
        const result = await cognitoClient.getCurrentSession()
        
        if (result) {
          dispatch({ 
            type: 'SET_SESSION', 
            payload: { 
              session: result.session,
              user: {
                id: result.user.sub || '',
                email: result.user.email || '',
                createdAt: result.user['custom:created_at'] || new Date().toISOString(),
                lastLogin: new Date().toISOString(),
                verificationStatus: result.user.email_verified === 'true',
                twoFactorEnabled: false
              }
            } 
          })
        }
      } catch (error) {
        console.error('Error loading session:', error)
      } finally {
        dispatch({ type: 'SET_LOADING', payload: false })
      }
    }

    loadSession()
  }, [])

  const login = async (credentials: LoginCredentials) => {
    try {
      dispatch({ type: 'SET_LOADING', payload: true })
      
      const result = await cognitoClient.signIn(credentials.email, credentials.password)
      
      // Map Cognito user data to our User type
      const user: User = {
        id: result.user.sub || result.user.username || '',
        email: credentials.email,
        createdAt: result.user['custom:created_at'] || new Date().toISOString(),
        lastLogin: new Date().toISOString(),
        verificationStatus: result.user.email_verified === 'true',
        twoFactorEnabled: false
      }
      
      // Save session to storage for persistence across page refreshes
      sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({ 
        session: result.session,
        user
      }))
      
      dispatch({ 
        type: 'SET_SESSION', 
        payload: { session: result.session, user } 
      })
      
      router.push('/')
    } catch (error: any) {
      let errorMessage = 'Invalid email or password'
      
      if (error.code === 'UserNotConfirmedException') {
        dispatch({ 
          type: 'SET_VERIFICATION', 
          payload: { 
            verificationRequired: true, 
            registrationEmail: credentials.email 
          } 
        })
        router.push('/auth/verify-email')
        return
      }
      
      dispatch({ type: 'SET_ERROR', payload: errorMessage })
    } finally {
      dispatch({ type: 'SET_LOADING', payload: false })
    }
  }

  const logout = async () => {
    cognitoClient.signOut()
    sessionStorage.removeItem(SESSION_STORAGE_KEY)
    dispatch({ type: 'CLEAR_SESSION' })
    router.push('/landing')
  }

  const register = async (credentials: RegisterCredentials) => {
    try {
      dispatch({ type: 'SET_LOADING', payload: true })

      await cognitoClient.signUp(credentials.email, credentials.password)
      
      dispatch({ 
        type: 'SET_VERIFICATION', 
        payload: { 
          verificationRequired: true, 
          registrationEmail: credentials.email 
        } 
      })

      router.push('/auth/verify-email')
    } catch (error: any) {
      let errorMessage = 'Registration failed'
      
      if (error.code === 'UsernameExistsException') {
        errorMessage = 'An account with this email already exists'
      } else if (error.message) {
        errorMessage = error.message
      }
      
      dispatch({ type: 'SET_ERROR', payload: errorMessage })
    } finally {
      dispatch({ type: 'SET_LOADING', payload: false })
    }
  }

  const confirmRegistration = async (email: string, code: string) => {
    try {
      dispatch({ type: 'SET_LOADING', payload: true })
      
      await cognitoClient.confirmRegistration(email, code)
      
      // After confirmation, redirect to login
      router.push('/landing?verified=true')
    } catch (error: any) {
      const errorMessage = error.message || 'Failed to verify account'
      dispatch({ type: 'SET_ERROR', payload: errorMessage })
    } finally {
      dispatch({ type: 'SET_LOADING', payload: false })
    }
  }

  const resendVerification = async () => {
    try {
      if (!state.registrationEmail) {
        throw new Error('Email address is missing')
      }
      
      dispatch({ type: 'SET_LOADING', payload: true })
      
      await cognitoClient.resendVerificationCode(state.registrationEmail)
      
      dispatch({ 
        type: 'SET_VERIFICATION', 
        payload: { 
          error: 'Verification email resent. Please check your inbox.' 
        } 
      })
    } catch (error: any) {
      const errorMessage = error.message || 'Failed to resend verification email'
      dispatch({ type: 'SET_ERROR', payload: errorMessage })
    } finally {
      dispatch({ type: 'SET_LOADING', payload: false })
    }
  }

  const forgotPassword = async (email: string) => {
    try {
      dispatch({ type: 'SET_LOADING', payload: true })
      
      await cognitoClient.forgotPassword(email)
      
      // Navigate to reset password page with email in query
      router.push(`/auth/reset-password?email=${encodeURIComponent(email)}`)
    } catch (error: any) {
      const errorMessage = error.message || 'Failed to process password reset'
      dispatch({ type: 'SET_ERROR', payload: errorMessage })
    } finally {
      dispatch({ type: 'SET_LOADING', payload: false })
    }
  }

  const confirmPassword = async (email: string, code: string, newPassword: string) => {
    try {
      dispatch({ type: 'SET_LOADING', payload: true })
      
      await cognitoClient.confirmPassword(email, code, newPassword)
      
      // Navigate to login with reset success message
      router.push('/landing?reset=true')
    } catch (error: any) {
      const errorMessage = error.message || 'Failed to reset password'
      dispatch({ type: 'SET_ERROR', payload: errorMessage })
    } finally {
      dispatch({ type: 'SET_LOADING', payload: false })
    }
  }

  return (
    <AuthContext.Provider value={{ 
      state, 
      login, 
      logout, 
      register, 
      confirmRegistration,
      resendVerification,
      forgotPassword,
      confirmPassword
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
