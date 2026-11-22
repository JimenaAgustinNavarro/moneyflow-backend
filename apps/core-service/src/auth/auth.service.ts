import { Inject, Injectable, Logger } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import {
  AuthAuditMetadata,
  InternalAuthContext,
  RegisterUserResponse,
  RegisterUserTcpPayload,
  ResendVerificationResponse,
  ResendVerificationTcpPayload,
  VerifyEmailResponse,
  VerifyEmailTcpPayload,
} from '@app/shared';
import { EMAIL_SENDER, EmailSender } from '../email/email-sender.port';
import { AuthAuditEvent, AuthTokenType, Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  assertValidPasswordInput,
  generateVerificationToken,
  hashOpaqueTokenSha256,
  hashPasswordArgon2id,
} from './auth-crypto.util';

const EMAIL_VERIFICATION_TTL_HOURS = 24;
const EMAIL_VERIFICATION_TTL_MS = EMAIL_VERIFICATION_TTL_HOURS * 60 * 60 * 1000;
const MAX_IP_LENGTH = 64;
const MAX_USER_AGENT_LENGTH = 512;
const MAX_REQUEST_ID_LENGTH = 128;

const GENERIC_RESEND_MESSAGE =
  'If an account with that email exists and is pending verification, a new verification link has been sent.';

function buildBadRequestRpc(message: string): RpcException {
  return new RpcException({
    statusCode: 400,
    error: 'Bad Request',
    message,
  });
}

function buildConflictRpc(message: string): RpcException {
  return new RpcException({
    statusCode: 409,
    error: 'Conflict',
    message,
  });
}

function isPrismaUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'P2002'
  );
}

function sanitizeNullableString(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }

  return trimmed.slice(0, maxLength);
}

function sanitizeAuditMetadata(audit: AuthAuditMetadata | undefined): AuthAuditMetadata {
  return {
    ipAddress: sanitizeNullableString(audit?.ipAddress, MAX_IP_LENGTH),
    userAgent: sanitizeNullableString(audit?.userAgent, MAX_USER_AGENT_LENGTH),
  };
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(EMAIL_SENDER)
    private readonly emailSender: EmailSender,
  ) {}

  async register(
    context: InternalAuthContext,
    payload: RegisterUserTcpPayload,
  ): Promise<RegisterUserResponse> {
    const email = payload.email.trim().toLowerCase();
    const fullName = payload.fullName.trim();
    const audit = sanitizeAuditMetadata(payload.audit);
    const requestId = sanitizeNullableString(context.requestId, MAX_REQUEST_ID_LENGTH);

    if (email.length === 0 || email.length > 255) {
      throw buildBadRequestRpc('Invalid email');
    }

    if (fullName.length === 0 || fullName.length > 150) {
      throw buildBadRequestRpc('Invalid fullName');
    }

    try {
      assertValidPasswordInput(payload.password);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Invalid password';
      throw buildBadRequestRpc(message);
    }

    const existingUser = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });

    if (existingUser) {
      throw buildConflictRpc('Email is already registered');
    }

    const passwordHash = await hashPasswordArgon2id(payload.password);
    const { rawToken, tokenHash } = generateVerificationToken();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + EMAIL_VERIFICATION_TTL_MS);

    let createdUser: {
      id: string;
      email: string;
      fullName: string;
      preferredCurrency: string;
      timezone: string;
      emailVerifiedAt: Date | null;
      isActive: boolean;
      createdAt: Date;
    };

    try {
      createdUser = await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const user = await tx.user.create({
          data: {
            email,
            passwordHash,
            fullName,
            preferredCurrency: 'PEN',
            timezone: 'America/Lima',
            emailVerifiedAt: null,
            isActive: true,
          },
          select: {
            id: true,
            email: true,
            fullName: true,
            preferredCurrency: true,
            timezone: true,
            emailVerifiedAt: true,
            isActive: true,
            createdAt: true,
          },
        });

        await tx.authToken.create({
          data: {
            userId: user.id,
            type: AuthTokenType.EMAIL_VERIFICATION,
            tokenHash,
            expiresAt,
          },
        });

        await tx.authAuditLog.create({
          data: {
            userId: user.id,
            event: AuthAuditEvent.REGISTER,
            ipAddress: audit.ipAddress,
            userAgent: audit.userAgent,
            requestId,
            metadata: {
              emailVerified: false,
            },
          },
        });

        return user;
      });
    } catch (error) {
      if (isPrismaUniqueViolation(error)) {
        throw buildConflictRpc('Email is already registered');
      }
      throw error;
    }

    await this.dispatchVerificationEmailSafely({
      userId: createdUser.id,
      requestId,
      to: createdUser.email,
      fullName: createdUser.fullName,
      rawToken,
    });

    return {
      user: {
        id: createdUser.id,
        email: createdUser.email,
        fullName: createdUser.fullName,
        preferredCurrency: createdUser.preferredCurrency,
        timezone: createdUser.timezone,
        emailVerifiedAt: createdUser.emailVerifiedAt
          ? createdUser.emailVerifiedAt.toISOString()
          : null,
        isActive: createdUser.isActive,
        createdAt: createdUser.createdAt.toISOString(),
      },
      emailVerificationRequired: true,
      message: 'User registered successfully. Please check your email to verify your account.',
    };
  }

  async verifyEmail(
    context: InternalAuthContext,
    payload: VerifyEmailTcpPayload,
  ): Promise<VerifyEmailResponse> {
    const rawToken = typeof payload.token === 'string' ? payload.token.trim() : '';
    if (rawToken.length === 0) {
      throw buildBadRequestRpc('Invalid, expired, or already used verification token');
    }

    const tokenHash = hashOpaqueTokenSha256(rawToken);
    const now = new Date();
    const audit = sanitizeAuditMetadata(payload.audit);
    const requestId = sanitizeNullableString(context.requestId, MAX_REQUEST_ID_LENGTH);

    const verifiedResult = await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const tokenRecord = await tx.authToken.findUnique({
        where: { tokenHash },
        include: {
          user: {
            select: {
              id: true,
              email: true,
              isActive: true,
              emailVerifiedAt: true,
            },
          },
        },
      });

      if (
        !tokenRecord ||
        tokenRecord.type !== AuthTokenType.EMAIL_VERIFICATION ||
        tokenRecord.usedAt !== null ||
        tokenRecord.expiresAt.getTime() <= now.getTime() ||
        tokenRecord.user.isActive !== true ||
        tokenRecord.user.emailVerifiedAt !== null
      ) {
        throw buildBadRequestRpc('Invalid, expired, or already used verification token');
      }

      const consumed = await tx.authToken.updateMany({
        where: {
          id: tokenRecord.id,
          usedAt: null,
          expiresAt: { gt: now },
        },
        data: {
          usedAt: now,
        },
      });

      if (consumed.count !== 1) {
        throw buildBadRequestRpc('Invalid, expired, or already used verification token');
      }

      const updatedUser = await tx.user.update({
        where: { id: tokenRecord.userId },
        data: {
          emailVerifiedAt: now,
        },
        select: {
          email: true,
          emailVerifiedAt: true,
        },
      });

      await tx.authAuditLog.create({
        data: {
          userId: tokenRecord.userId,
          event: AuthAuditEvent.EMAIL_VERIFIED,
          ipAddress: audit.ipAddress,
          userAgent: audit.userAgent,
          requestId,
          metadata: {
            tokenId: tokenRecord.id,
          },
        },
      });

      return updatedUser;
    });

    return {
      verified: true,
      email: verifiedResult.email,
      emailVerifiedAt: (verifiedResult.emailVerifiedAt ?? now).toISOString(),
      message: 'Email verified successfully.',
    };
  }

  async resendVerification(
    context: InternalAuthContext,
    payload: ResendVerificationTcpPayload,
  ): Promise<ResendVerificationResponse> {
    const email = payload.email.trim().toLowerCase();
    if (email.length === 0 || email.length > 255) {
      return { message: GENERIC_RESEND_MESSAGE };
    }

    const user = await this.prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        fullName: true,
        isActive: true,
        emailVerifiedAt: true,
      },
    });

    if (!user || !user.isActive || user.emailVerifiedAt !== null) {
      return { message: GENERIC_RESEND_MESSAGE };
    }

    const { rawToken, tokenHash } = generateVerificationToken();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + EMAIL_VERIFICATION_TTL_MS);
    const requestId = sanitizeNullableString(context.requestId, MAX_REQUEST_ID_LENGTH);

    await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.authToken.updateMany({
        where: {
          userId: user.id,
          type: AuthTokenType.EMAIL_VERIFICATION,
          usedAt: null,
        },
        data: {
          usedAt: now,
        },
      });

      await tx.authToken.create({
        data: {
          userId: user.id,
          type: AuthTokenType.EMAIL_VERIFICATION,
          tokenHash,
          expiresAt,
        },
      });
    });

    await this.dispatchVerificationEmailSafely({
      userId: user.id,
      requestId,
      to: user.email,
      fullName: user.fullName,
      rawToken,
    });

    return {
      message: GENERIC_RESEND_MESSAGE,
    };
  }

  private async dispatchVerificationEmailSafely(input: {
    userId: string;
    requestId: string | null;
    to: string;
    fullName: string;
    rawToken: string;
  }): Promise<void> {
    try {
      await this.emailSender.sendEmailVerification({
        to: input.to,
        fullName: input.fullName,
        rawToken: input.rawToken,
        expiresInHours: EMAIL_VERIFICATION_TTL_HOURS,
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'SMTP delivery failed';
      this.logger.warn(
        `Verification email dispatch deferred for userId=${input.userId} requestId=${input.requestId ?? 'none'}: ${reason}`,
      );
    }
  }
}
