export const EMAIL_SENDER = Symbol('EMAIL_SENDER');

export interface SendEmailVerificationInput {
  to: string;
  fullName: string;
  rawToken: string;
  expiresInHours: number;
}

export interface SendPasswordResetInput {
  to: string;
  fullName: string;
  rawToken: string;
  expiresInMinutes: number;
}

export interface EmailSender {
  sendEmailVerification(input: SendEmailVerificationInput): Promise<void>;
  sendPasswordReset(input: SendPasswordResetInput): Promise<void>;
}
