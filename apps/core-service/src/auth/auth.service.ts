import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import {
  AUTH_ERROR_CODES,
  AuthAuditMetadata,
  CoreAuthSessionResult,
  InternalAuthContext,
  ListSessionsResponse,
  ListSessionsTcpPayload,
  LoginTcpPayload,
  LogoutAllResponse,
  LogoutAllTcpPayload,
  LogoutResponse,
  LogoutTcpPayload,
  RefreshSessionTcpPayload,
  RegisteredUserView,
  RegisterUserResponse,
  RegisterUserTcpPayload,
  ResendVerificationResponse,
  ResendVerificationTcpPayload,
  RevokeSessionResponse,
  RevokeSessionTcpPayload,
  VerifyEmailResponse,
  VerifyEmailTcpPayload,
} from '@app/shared';
import { EMAIL_SENDER, EmailSender } from '../email/email-sender.port';
import { AuthAuditEvent, AuthTokenType, Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  assertValidPasswordInput,
  generateRefreshToken,
  generateVerificationToken,
  hashOpaqueTokenSha256,
  hashPasswordArgon2id,
  verifyPasswordArgon2idConstantTime,
} from './auth-crypto.util';

const EMAIL_VERIFICATION_TTL_HOURS = 24;
const EMAIL_VERIFICATION_TTL_MS = EMAIL_VERIFICATION_TTL_HOURS * 60 * 60 * 1000;
const REFRESH_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_IP_LENGTH = 64;
const MAX_USER_AGENT_LENGTH = 512;
const MAX_REQUEST_ID_LENGTH = 128;

const GENERIC_RESEND_MESSAGE =
  'If an account with that email exists and is pending verification, a new verification link has been sent.';

interface UserRecordProjection {
  id: string;
  email: string;
  fullName: string;
  preferredCurrency: string;
  timezone: string;
  emailVerifiedAt: Date | null;
  isActive: boolean;
  createdAt: Date;
}

type RefreshTransactionResult =
  | { status: 'INVALID' }
  | { status: 'REUSE_DETECTED' }
  | { status: 'ROTATED'; result: CoreAuthSessionResult };

function buildBadRequestRpc(message: string): RpcException {
  return new RpcException({
    statusCode: 400,
    error: 'Bad Request',
    message,
  });
}

function buildUnauthorizedRpc(message: string): RpcException {
  return new RpcException({
    statusCode: 401,
    error: 'Unauthorized',
    message,
  });
}

function buildForbiddenRpc(message: string, code?: string): RpcException {
  return new RpcException({
    statusCode: 403,
    error: 'Forbidden',
    ...(code ? { code } : {}),
    message,
  });
}

function buildNotFoundRpc(message: string): RpcException {
  return new RpcException({
    statusCode: 404,
    error: 'Not Found',
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

function toRegisteredUserView(user: UserRecordProjection): RegisteredUserView {
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    preferredCurrency: user.preferredCurrency,
    timezone: user.timezone,
    emailVerifiedAt: user.emailVerifiedAt ? user.emailVerifiedAt.toISOString() : null,
    isActive: user.isActive,
    createdAt: user.createdAt.toISOString(),
  };
}

function requireAuthenticatedUserId(context: InternalAuthContext): string {
  if (typeof context.userId !== 'string' || context.userId.trim().length === 0) {
    throw buildUnauthorizedRpc('Authenticated user context is required');
  }

  return context.userId;
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

    let createdUser: UserRecordProjection;

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
      user: toRegisteredUserView(createdUser),
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

  async login(
    context: InternalAuthContext,
    payload: LoginTcpPayload,
  ): Promise<CoreAuthSessionResult> {
    const email = payload.email.trim().toLowerCase();
    const audit = sanitizeAuditMetadata(payload.audit);
    const requestId = sanitizeNullableString(context.requestId, MAX_REQUEST_ID_LENGTH);

    const user =
      email.length > 0 && email.length <= 255
        ? await this.prisma.user.findUnique({
            where: { email },
            select: {
              id: true,
              email: true,
              passwordHash: true,
              fullName: true,
              preferredCurrency: true,
              timezone: true,
              emailVerifiedAt: true,
              isActive: true,
              createdAt: true,
            },
          })
        : null;

    const passwordMatched = await verifyPasswordArgon2idConstantTime(
      user?.passwordHash,
      payload.password,
    );

    if (!user || !user.isActive || !passwordMatched) {
      await this.prisma.authAuditLog.create({
        data: {
          userId: user?.id ?? null,
          event: AuthAuditEvent.LOGIN_FAILED,
          ipAddress: audit.ipAddress,
          userAgent: audit.userAgent,
          requestId,
          metadata: {
            reason: !user
              ? 'USER_NOT_FOUND'
              : !user.isActive
                ? 'USER_INACTIVE'
                : 'INVALID_PASSWORD',
          },
        },
      });
      throw buildUnauthorizedRpc('Invalid email or password');
    }

    if (user.emailVerifiedAt === null) {
      await this.prisma.authAuditLog.create({
        data: {
          userId: user.id,
          event: AuthAuditEvent.LOGIN_FAILED,
          ipAddress: audit.ipAddress,
          userAgent: audit.userAgent,
          requestId,
          metadata: {
            reason: AUTH_ERROR_CODES.EMAIL_NOT_VERIFIED,
          },
        },
      });
      throw buildForbiddenRpc(
        'Email address has not been verified',
        AUTH_ERROR_CODES.EMAIL_NOT_VERIFIED,
      );
    }

    const { rawToken, tokenHash } = generateRefreshToken();
    const familyId = randomUUID();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + REFRESH_SESSION_TTL_MS);

    const session = await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const createdSession = await tx.userSession.create({
        data: {
          userId: user.id,
          familyId,
          refreshTokenHash: tokenHash,
          expiresAt,
          ipAddress: audit.ipAddress,
          userAgent: audit.userAgent,
        },
        select: {
          id: true,
          expiresAt: true,
        },
      });

      await tx.authAuditLog.create({
        data: {
          userId: user.id,
          event: AuthAuditEvent.LOGIN_SUCCESS,
          ipAddress: audit.ipAddress,
          userAgent: audit.userAgent,
          requestId,
          metadata: {
            sessionId: createdSession.id,
            familyId,
          },
        },
      });

      return createdSession;
    });

    return {
      user: toRegisteredUserView(user),
      sessionId: session.id,
      refreshToken: rawToken,
      refreshTokenExpiresAt: session.expiresAt.toISOString(),
    };
  }

  async refresh(
    context: InternalAuthContext,
    payload: RefreshSessionTcpPayload,
  ): Promise<CoreAuthSessionResult> {
    const rawRefreshToken =
      typeof payload.refreshToken === 'string' ? payload.refreshToken.trim() : '';
    if (rawRefreshToken.length === 0) {
      throw buildUnauthorizedRpc('Invalid or expired refresh token');
    }

    const tokenHash = hashOpaqueTokenSha256(rawRefreshToken);
    const audit = sanitizeAuditMetadata(payload.audit);
    const requestId = sanitizeNullableString(context.requestId, MAX_REQUEST_ID_LENGTH);
    const now = new Date();
    const nextRefresh = generateRefreshToken();
    const nextExpiresAt = new Date(now.getTime() + REFRESH_SESSION_TTL_MS);

    const txResult = await this.prisma.$transaction<RefreshTransactionResult>(
      async (tx: Prisma.TransactionClient) => {
        const session = await tx.userSession.findUnique({
          where: { refreshTokenHash: tokenHash },
          include: {
            user: {
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
            },
          },
        });

        if (!session) {
          return { status: 'INVALID' };
        }

        if (session.revokedAt !== null || session.replacedBySessionId !== null) {
          await tx.userSession.updateMany({
            where: {
              familyId: session.familyId,
              revokedAt: null,
            },
            data: {
              revokedAt: now,
            },
          });

          await tx.authAuditLog.create({
            data: {
              userId: session.userId,
              event: AuthAuditEvent.SESSION_REVOKED,
              ipAddress: audit.ipAddress,
              userAgent: audit.userAgent,
              requestId,
              metadata: {
                reason: 'REFRESH_TOKEN_REUSE_DETECTED',
                familyId: session.familyId,
                triggerSessionId: session.id,
              },
            },
          });

          return { status: 'REUSE_DETECTED' };
        }

        if (
          session.expiresAt.getTime() <= now.getTime() ||
          session.user.isActive !== true ||
          session.user.emailVerifiedAt === null
        ) {
          return { status: 'INVALID' };
        }

        const newSession = await tx.userSession.create({
          data: {
            userId: session.userId,
            familyId: session.familyId,
            refreshTokenHash: nextRefresh.tokenHash,
            expiresAt: nextExpiresAt,
            ipAddress: audit.ipAddress,
            userAgent: audit.userAgent,
          },
          select: {
            id: true,
            expiresAt: true,
          },
        });

        const rotated = await tx.userSession.updateMany({
          where: {
            id: session.id,
            revokedAt: null,
            replacedBySessionId: null,
          },
          data: {
            revokedAt: now,
            replacedBySessionId: newSession.id,
          },
        });

        if (rotated.count !== 1) {
          await tx.userSession.updateMany({
            where: {
              familyId: session.familyId,
              revokedAt: null,
            },
            data: {
              revokedAt: now,
            },
          });

          await tx.authAuditLog.create({
            data: {
              userId: session.userId,
              event: AuthAuditEvent.SESSION_REVOKED,
              ipAddress: audit.ipAddress,
              userAgent: audit.userAgent,
              requestId,
              metadata: {
                reason: 'REFRESH_TOKEN_REUSE_DETECTED',
                familyId: session.familyId,
                triggerSessionId: session.id,
              },
            },
          });

          return { status: 'REUSE_DETECTED' };
        }

        return {
          status: 'ROTATED',
          result: {
            user: toRegisteredUserView(session.user),
            sessionId: newSession.id,
            refreshToken: nextRefresh.rawToken,
            refreshTokenExpiresAt: newSession.expiresAt.toISOString(),
          },
        };
      },
    );

    if (txResult.status !== 'ROTATED') {
      throw buildUnauthorizedRpc('Invalid or expired refresh token');
    }

    return txResult.result;
  }

  async logout(context: InternalAuthContext, payload: LogoutTcpPayload): Promise<LogoutResponse> {
    const audit = sanitizeAuditMetadata(payload.audit);
    const requestId = sanitizeNullableString(context.requestId, MAX_REQUEST_ID_LENGTH);
    const now = new Date();
    const rawRefreshToken =
      typeof payload.refreshToken === 'string' ? payload.refreshToken.trim() : '';
    const sessionId = typeof payload.sessionId === 'string' ? payload.sessionId.trim() : '';

    if (rawRefreshToken.length > 0) {
      const refreshTokenHash = hashOpaqueTokenSha256(rawRefreshToken);
      await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const session = await tx.userSession.findUnique({
          where: { refreshTokenHash },
          select: { id: true, userId: true, revokedAt: true },
        });

        if (!session || session.revokedAt !== null) {
          return;
        }

        const updated = await tx.userSession.updateMany({
          where: {
            id: session.id,
            revokedAt: null,
          },
          data: {
            revokedAt: now,
          },
        });

        if (updated.count === 1) {
          await tx.authAuditLog.create({
            data: {
              userId: session.userId,
              event: AuthAuditEvent.LOGOUT,
              ipAddress: audit.ipAddress,
              userAgent: audit.userAgent,
              requestId,
              metadata: {
                sessionId: session.id,
              },
            },
          });
        }
      });

      return { message: 'Logged out successfully.' };
    }

    if (sessionId.length > 0 && context.userId !== null) {
      const authenticatedUserId = requireAuthenticatedUserId(context);
      await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const updated = await tx.userSession.updateMany({
          where: {
            id: sessionId,
            userId: authenticatedUserId,
            revokedAt: null,
          },
          data: {
            revokedAt: now,
          },
        });

        if (updated.count === 1) {
          await tx.authAuditLog.create({
            data: {
              userId: authenticatedUserId,
              event: AuthAuditEvent.LOGOUT,
              ipAddress: audit.ipAddress,
              userAgent: audit.userAgent,
              requestId,
              metadata: {
                sessionId,
              },
            },
          });
        }
      });
    }

    return { message: 'Logged out successfully.' };
  }

  async listSessions(
    context: InternalAuthContext,
    payload: ListSessionsTcpPayload,
  ): Promise<ListSessionsResponse> {
    const userId = requireAuthenticatedUserId(context);
    const now = new Date();

    const sessions = await this.prisma.userSession.findMany({
      where: {
        userId,
        revokedAt: null,
        expiresAt: { gt: now },
      },
      orderBy: {
        createdAt: 'desc',
      },
      select: {
        id: true,
        ipAddress: true,
        userAgent: true,
        createdAt: true,
        expiresAt: true,
      },
    });

    return {
      sessions: sessions.map((session) => ({
        id: session.id,
        ipAddress: session.ipAddress,
        userAgent: session.userAgent,
        createdAt: session.createdAt.toISOString(),
        expiresAt: session.expiresAt.toISOString(),
        isCurrent: session.id === payload.currentSessionId,
      })),
    };
  }

  async revokeSession(
    context: InternalAuthContext,
    payload: RevokeSessionTcpPayload,
  ): Promise<RevokeSessionResponse> {
    const userId = requireAuthenticatedUserId(context);
    const audit = sanitizeAuditMetadata(payload.audit);
    const requestId = sanitizeNullableString(context.requestId, MAX_REQUEST_ID_LENGTH);
    const now = new Date();

    const revoked = await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const updated = await tx.userSession.updateMany({
        where: {
          id: payload.sessionId,
          userId,
          revokedAt: null,
        },
        data: {
          revokedAt: now,
        },
      });

      if (updated.count !== 1) {
        return false;
      }

      await tx.authAuditLog.create({
        data: {
          userId,
          event: AuthAuditEvent.SESSION_REVOKED,
          ipAddress: audit.ipAddress,
          userAgent: audit.userAgent,
          requestId,
          metadata: {
            sessionId: payload.sessionId,
            scope: 'SINGLE_SESSION',
          },
        },
      });

      return true;
    });

    if (!revoked) {
      throw buildNotFoundRpc('Session not found');
    }

    return {
      revokedSessionId: payload.sessionId,
      currentSessionCleared: payload.sessionId === payload.currentSessionId,
      message: 'Session revoked successfully.',
    };
  }

  async logoutAll(
    context: InternalAuthContext,
    payload: LogoutAllTcpPayload,
  ): Promise<LogoutAllResponse> {
    const userId = requireAuthenticatedUserId(context);
    const audit = sanitizeAuditMetadata(payload.audit);
    const requestId = sanitizeNullableString(context.requestId, MAX_REQUEST_ID_LENGTH);
    const now = new Date();

    const revokedCount = await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const updated = await tx.userSession.updateMany({
        where: {
          userId,
          revokedAt: null,
        },
        data: {
          revokedAt: now,
        },
      });

      await tx.authAuditLog.create({
        data: {
          userId,
          event: AuthAuditEvent.SESSION_REVOKED,
          ipAddress: audit.ipAddress,
          userAgent: audit.userAgent,
          requestId,
          metadata: {
            scope: 'ALL_SESSIONS',
            revokedCount: updated.count,
          },
        },
      });

      return updated.count;
    });

    return {
      revokedCount,
      message: 'All active sessions have been revoked.',
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
