export const AUTH_PATTERNS = {
  REGISTER: 'auth.register',
  VERIFY_EMAIL: 'auth.verifyEmail',
  RESEND_VERIFICATION: 'auth.resendVerification',
} as const;

export interface AuthAuditMetadata {
  ipAddress: string | null;
  userAgent: string | null;
}

export interface RegisterUserTcpPayload {
  email: string;
  fullName: string;
  password: string;
  audit: AuthAuditMetadata;
}

export interface VerifyEmailTcpPayload {
  token: string;
  audit: AuthAuditMetadata;
}

export interface ResendVerificationTcpPayload {
  email: string;
  audit: AuthAuditMetadata;
}

export interface RegisteredUserView {
  id: string;
  email: string;
  fullName: string;
  preferredCurrency: string;
  timezone: string;
  emailVerifiedAt: string | null;
  isActive: boolean;
  createdAt: string;
}

export interface RegisterUserResponse {
  user: RegisteredUserView;
  emailVerificationRequired: true;
  message: string;
}

export interface VerifyEmailResponse {
  verified: true;
  email: string;
  emailVerifiedAt: string;
  message: string;
}

export interface ResendVerificationResponse {
  message: string;
}
