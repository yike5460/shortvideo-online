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
  user: User;
  expiresAt: string;
}

export interface AuthState {
  user: User | null;
  session: Session | null;
  isLoading: boolean;
  error: string | null;
  verificationRequired: boolean;
  registrationEmail: string | null;
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