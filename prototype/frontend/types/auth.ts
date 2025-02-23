export interface User {
  id: string;
  email: string;
  createdAt: string;
  lastLogin: string;
  verificationStatus: boolean;
  twoFactorEnabled: boolean;
}

export interface Session {
  token: string;
  expiresAt?: string;
}

export interface AuthState {
  isLoading: boolean;
  session: Session | null;
  user: User | null;
  error: string | null;
  registrationEmail: string | null;
  verificationRequired: boolean;
}

export interface LoginCredentials {
  email: string;
  password: string;
  rememberMe?: boolean;
}

export interface RegisterCredentials {
  email: string;
  password: string;
  confirmPassword: string;
  acceptTerms: boolean;
}

export interface ResetPasswordCredentials {
  token: string;
  newPassword: string;
  confirmPassword: string;
} 