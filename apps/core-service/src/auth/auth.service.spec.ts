import { RpcException } from '@nestjs/microservices';
import { InternalAuthContext } from '@app/shared';
import { EmailSender } from '../email/email-sender.port';
import { AuthAuditEvent, AuthTokenType } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { hashOpaqueTokenSha256 } from './auth-crypto.util';
import { AuthService } from './auth.service';

describe('AuthService', () => {
  const baseContext: InternalAuthContext = {
    requestId: 'req-auth-test-1',
    userId: null,
    timestamp: Date.now(),
    signature: '0'.repeat(64),
  };

  let prismaMock: {
    user: {
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
    authToken: {
      findUnique: jest.Mock;
      create: jest.Mock;
      updateMany: jest.Mock;
    };
    authAuditLog: {
      create: jest.Mock;
    };
    $transaction: jest.Mock;
  };
  let emailSenderMock: EmailSender;
  let sendEmailVerificationMock: jest.Mock<
    Promise<void>,
    [Parameters<EmailSender['sendEmailVerification']>[0]]
  >;
  let service: AuthService;

  beforeEach(() => {
    prismaMock = {
      user: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      authToken: {
        findUnique: jest.fn(),
        create: jest.fn(),
        updateMany: jest.fn(),
      },
      authAuditLog: {
        create: jest.fn(),
      },
      $transaction: jest.fn(),
    };

    prismaMock.$transaction.mockImplementation(
      async (callback: (tx: typeof prismaMock) => Promise<unknown>) => callback(prismaMock),
    );

    sendEmailVerificationMock = jest.fn(
      (_input: Parameters<EmailSender['sendEmailVerification']>[0]) => Promise.resolve(),
    );
    emailSenderMock = {
      sendEmailVerification: sendEmailVerificationMock,
    };

    service = new AuthService(prismaMock as unknown as PrismaService, emailSenderMock);
  });

  it('registers user with Argon2id, SHA-256 token hash, REGISTER audit log, and dispatches verification email', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    const createdAt = new Date('2026-11-22T04:00:00.000Z');
    prismaMock.user.create.mockResolvedValue({
      id: 'user-uuid-1',
      email: 'ana@example.com',
      fullName: 'Ana Pérez',
      preferredCurrency: 'PEN',
      timezone: 'America/Lima',
      emailVerifiedAt: null,
      isActive: true,
      createdAt,
    });
    prismaMock.authToken.create.mockResolvedValue({ id: 'token-uuid-1' });
    prismaMock.authAuditLog.create.mockResolvedValue({ id: 'audit-uuid-1' });

    const response = await service.register(baseContext, {
      email: '  Ana@Example.COM ',
      fullName: '  Ana Pérez ',
      password: 'Password123',
      audit: {
        ipAddress: '127.0.0.1',
        userAgent: 'JestTestAgent',
      },
    });

    expect(response.emailVerificationRequired).toBe(true);
    expect(response.user).toEqual({
      id: 'user-uuid-1',
      email: 'ana@example.com',
      fullName: 'Ana Pérez',
      preferredCurrency: 'PEN',
      timezone: 'America/Lima',
      emailVerifiedAt: null,
      isActive: true,
      createdAt: createdAt.toISOString(),
    });
    expect('passwordHash' in response.user).toBe(false);

    const userCreateCall = prismaMock.user.create.mock.calls[0] as [
      { data: { passwordHash: string; email: string } },
    ];
    const userCreateArgs = userCreateCall[0];
    expect(userCreateArgs.data.email).toBe('ana@example.com');
    expect(userCreateArgs.data.passwordHash.startsWith('$argon2id$')).toBe(true);

    const tokenCreateCall = prismaMock.authToken.create.mock.calls[0] as [
      { data: { type: AuthTokenType; tokenHash: string } },
    ];
    const tokenCreateArgs = tokenCreateCall[0];
    const emailInput = sendEmailVerificationMock.mock.calls[0][0];
    expect(tokenCreateArgs.data.type).toBe(AuthTokenType.EMAIL_VERIFICATION);
    expect(tokenCreateArgs.data.tokenHash).toBe(hashOpaqueTokenSha256(emailInput.rawToken));
    expect(tokenCreateArgs.data.tokenHash).not.toBe(emailInput.rawToken);

    const registerAuditCall = prismaMock.authAuditLog.create.mock.calls[0] as [
      {
        data: {
          userId: string;
          event: AuthAuditEvent;
          requestId: string;
          ipAddress: string;
          userAgent: string;
        };
      },
    ];
    expect(registerAuditCall[0].data).toMatchObject({
      userId: 'user-uuid-1',
      event: AuthAuditEvent.REGISTER,
      requestId: 'req-auth-test-1',
      ipAddress: '127.0.0.1',
      userAgent: 'JestTestAgent',
    });
  });

  it('returns 409 Conflict RpcException when email already exists (case-insensitive)', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: 'existing-user-id' });

    await expect(
      service.register(baseContext, {
        email: 'ANA@EXAMPLE.COM',
        fullName: 'Ana',
        password: 'Password123',
        audit: { ipAddress: null, userAgent: null },
      }),
    ).rejects.toThrow(RpcException);

    try {
      await service.register(baseContext, {
        email: 'ANA@EXAMPLE.COM',
        fullName: 'Ana',
        password: 'Password123',
        audit: { ipAddress: null, userAgent: null },
      });
    } catch (error) {
      expect((error as RpcException).getError()).toEqual({
        statusCode: 409,
        error: 'Conflict',
        message: 'Email is already registered',
      });
    }
  });

  it('keeps 201 registration success when SMTP delivery fails', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    prismaMock.user.create.mockResolvedValue({
      id: 'user-uuid-2',
      email: 'mailpit-down@example.com',
      fullName: 'Usuario',
      preferredCurrency: 'PEN',
      timezone: 'America/Lima',
      emailVerifiedAt: null,
      isActive: true,
      createdAt: new Date('2026-11-22T04:00:00.000Z'),
    });
    sendEmailVerificationMock.mockRejectedValueOnce(new Error('SMTP delivery failed'));

    const response = await service.register(baseContext, {
      email: 'mailpit-down@example.com',
      fullName: 'Usuario',
      password: 'Password123',
      audit: { ipAddress: null, userAgent: null },
    });

    expect(response.emailVerificationRequired).toBe(true);
    expect(response.user.id).toBe('user-uuid-2');
  });

  it('verifies email atomically and records EMAIL_VERIFIED audit event', async () => {
    const rawToken = 'f'.repeat(64);
    const tokenHash = hashOpaqueTokenSha256(rawToken);
    prismaMock.authToken.findUnique.mockResolvedValue({
      id: 'token-1',
      userId: 'user-1',
      type: AuthTokenType.EMAIL_VERIFICATION,
      tokenHash,
      expiresAt: new Date(Date.now() + 60_000),
      usedAt: null,
      user: {
        id: 'user-1',
        email: 'ana@example.com',
        isActive: true,
        emailVerifiedAt: null,
      },
    });
    prismaMock.authToken.updateMany.mockResolvedValue({ count: 1 });
    const verifiedAt = new Date('2026-11-22T04:10:00.000Z');
    prismaMock.user.update.mockResolvedValue({
      email: 'ana@example.com',
      emailVerifiedAt: verifiedAt,
    });

    const result = await service.verifyEmail(baseContext, {
      token: rawToken,
      audit: { ipAddress: '10.0.0.1', userAgent: 'Browser' },
    });

    expect(result).toEqual({
      verified: true,
      email: 'ana@example.com',
      emailVerifiedAt: verifiedAt.toISOString(),
      message: 'Email verified successfully.',
    });
    const updateManyCall = prismaMock.authToken.updateMany.mock.calls[0] as [
      {
        where: { id: string; usedAt: null; expiresAt: { gt: Date } };
        data: { usedAt: Date };
      },
    ];
    expect(updateManyCall[0].where.id).toBe('token-1');
    expect(updateManyCall[0].where.usedAt).toBeNull();
    expect(updateManyCall[0].where.expiresAt.gt).toBeInstanceOf(Date);
    expect(updateManyCall[0].data.usedAt).toBeInstanceOf(Date);

    const verifyAuditCall = prismaMock.authAuditLog.create.mock.calls[0] as [
      { data: { userId: string; event: AuthAuditEvent } },
    ];
    expect(verifyAuditCall[0].data).toMatchObject({
      userId: 'user-1',
      event: AuthAuditEvent.EMAIL_VERIFIED,
    });
  });

  it('rejects verifyEmail with 400 when concurrent race condition consumes token first (count=0)', async () => {
    prismaMock.authToken.findUnique.mockResolvedValue({
      id: 'token-race',
      userId: 'user-1',
      type: AuthTokenType.EMAIL_VERIFICATION,
      tokenHash: 'a'.repeat(64),
      expiresAt: new Date(Date.now() + 60_000),
      usedAt: null,
      user: {
        id: 'user-1',
        email: 'ana@example.com',
        isActive: true,
        emailVerifiedAt: null,
      },
    });
    prismaMock.authToken.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      service.verifyEmail(baseContext, {
        token: 'raw-race-token',
        audit: { ipAddress: null, userAgent: null },
      }),
    ).rejects.toThrow(RpcException);

    expect(prismaMock.user.update).not.toHaveBeenCalled();
    expect(prismaMock.authAuditLog.create).not.toHaveBeenCalled();
  });

  it('rejects verifyEmail with 400 if user is inactive or already verified', async () => {
    prismaMock.authToken.findUnique.mockResolvedValue({
      id: 'token-verified',
      userId: 'user-1',
      type: AuthTokenType.EMAIL_VERIFICATION,
      tokenHash: 'b'.repeat(64),
      expiresAt: new Date(Date.now() + 60_000),
      usedAt: null,
      user: {
        id: 'user-1',
        email: 'ana@example.com',
        isActive: true,
        emailVerifiedAt: new Date('2026-11-22T01:00:00.000Z'),
      },
    });

    await expect(
      service.verifyEmail(baseContext, {
        token: 'raw-token',
        audit: { ipAddress: null, userAgent: null },
      }),
    ).rejects.toThrow(RpcException);
    expect(prismaMock.authToken.updateMany).not.toHaveBeenCalled();
  });

  it('returns identical generic 200 response for resendVerification without account enumeration', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce(null);
    const notFoundResult = await service.resendVerification(baseContext, {
      email: 'unknown@example.com',
      audit: { ipAddress: null, userAgent: null },
    });

    prismaMock.user.findUnique.mockResolvedValueOnce({
      id: 'user-verified',
      email: 'verified@example.com',
      fullName: 'Verified',
      isActive: true,
      emailVerifiedAt: new Date(),
    });
    const verifiedResult = await service.resendVerification(baseContext, {
      email: 'verified@example.com',
      audit: { ipAddress: null, userAgent: null },
    });

    prismaMock.user.findUnique.mockResolvedValueOnce({
      id: 'user-pending',
      email: 'pending@example.com',
      fullName: 'Pending',
      isActive: true,
      emailVerifiedAt: null,
    });
    const pendingResult = await service.resendVerification(baseContext, {
      email: 'pending@example.com',
      audit: { ipAddress: null, userAgent: null },
    });

    expect(notFoundResult).toEqual(verifiedResult);
    expect(verifiedResult).toEqual(pendingResult);
    expect(prismaMock.authToken.updateMany).toHaveBeenCalledTimes(1);
    expect(prismaMock.authToken.create).toHaveBeenCalledTimes(1);
    expect(sendEmailVerificationMock).toHaveBeenCalledTimes(1);
  });
});
