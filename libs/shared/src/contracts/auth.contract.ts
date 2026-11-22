export const AUTH_PATTERNS = {
  REGISTER: 'auth.register',
  VERIFY_EMAIL: 'auth.verifyEmail',
  RESEND_VERIFICATION: 'auth.resendVerification',
  LOGIN: 'auth.login',
  REFRESH: 'auth.refresh',
  LOGOUT: 'auth.logout',
  LIST_SESSIONS: 'auth.listSessions',
  REVOKE_SESSION: 'auth.revokeSession',
  LOGOUT_ALL: 'auth.logoutAll',
  FORGOT_PASSWORD: 'auth.forgotPassword',
  RESET_PASSWORD: 'auth.resetPassword',
  GET_ME: 'auth.getMe',
  UPDATE_ME: 'auth.updateMe',
  CHANGE_PASSWORD: 'auth.changePassword',
} as const;

export const AUTH_ERROR_CODES = {
  EMAIL_NOT_VERIFIED: 'EMAIL_NOT_VERIFIED',
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

export interface LoginTcpPayload {
  email: string;
  password: string;
  audit: AuthAuditMetadata;
}

export interface RefreshSessionTcpPayload {
  refreshToken: string;
  audit: AuthAuditMetadata;
}

export interface LogoutTcpPayload {
  sessionId: string | null;
  refreshToken: string | null;
  audit: AuthAuditMetadata;
}

export interface ListSessionsTcpPayload {
  currentSessionId: string;
}

export interface RevokeSessionTcpPayload {
  sessionId: string;
  currentSessionId: string;
  audit: AuthAuditMetadata;
}

export interface LogoutAllTcpPayload {
  audit: AuthAuditMetadata;
}

export interface ForgotPasswordTcpPayload {
  email: string;
  audit: AuthAuditMetadata;
}

export interface ResetPasswordTcpPayload {
  token: string;
  newPassword: string;
  audit: AuthAuditMetadata;
}

export type GetProfileTcpPayload = Record<string, never>;

export interface UpdateProfileTcpPayload {
  fullName: string;
}

export interface ChangePasswordTcpPayload {
  currentPassword: string;
  newPassword: string;
  currentSessionId: string;
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

export interface CoreAuthSessionResult {
  user: RegisteredUserView;
  sessionId: string;
  refreshToken: string;
  refreshTokenExpiresAt: string;
}

export interface PublicAuthResponse {
  user: RegisteredUserView;
  message: string;
}

export interface LogoutResponse {
  message: string;
}

export interface UserSessionView {
  id: string;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
  expiresAt: string;
  isCurrent: boolean;
}

export interface ListSessionsResponse {
  sessions: UserSessionView[];
}

export interface RevokeSessionResponse {
  revokedSessionId: string;
  currentSessionCleared: boolean;
  message: string;
}

export interface LogoutAllResponse {
  revokedCount: number;
  message: string;
}

export interface ForgotPasswordResponse {
  message: string;
}

export interface ResetPasswordResponse {
  message: string;
}

export interface GetProfileResponse {
  user: RegisteredUserView;
}

export interface UpdateProfileResponse {
  user: RegisteredUserView;
  message: string;
}

export interface ChangePasswordResponse {
  revokedOtherSessionsCount: number;
  message: string;
}
