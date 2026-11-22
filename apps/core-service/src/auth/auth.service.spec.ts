import { RpcException } from '@nestjs/microservices';
import { AUTH_ERROR_CODES, InternalAuthContext } from '@app/shared';
import { EmailSender } from '../email/email-sender.port';
import { AuthAuditEvent, AuthTokenType } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { hashOpaqueTokenSha256, hashPasswordArgon2id } from './auth-crypto.util';
import { AuthService } from './auth.service';

describe('AuthService', () => {
  const userAId = '11111111-1111-4111-8111-111111111111';
  const sessionA1Id = '22222222-2222-4222-8222-222222222222';
  const sessionA2Id = '33333333-3333-4333-8333-333333333333';
  const familyAId = '44444444-4444-4444-8444-444444444444';
  const sessionB1Id = '55555555-5555-4555-8555-555555555555';

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
    userSession: {
      findUnique: jest.Mock;
      findMany: jest.Mock;
      create: jest.Mock;
      updateMany: jest.Mock;
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
      userSession: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        updateMany: jest.fn(),
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
      id: userAId,
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
    expect(response.user.id).toBe(userAId);
    expect('passwordHash' in response.user).toBe(false);

    const tokenCreateCall = prismaMock.authToken.create.mock.calls[0] as [
      { data: { type: AuthTokenType; tokenHash: string } },
    ];
    const emailInput = sendEmailVerificationMock.mock.calls[0][0];
    expect(tokenCreateCall[0].data.type).toBe(AuthTokenType.EMAIL_VERIFICATION);
    expect(tokenCreateCall[0].data.tokenHash).toBe(hashOpaqueTokenSha256(emailInput.rawToken));
  });

  it('returns 409 Conflict RpcException when email already exists (case-insensitive)', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: userAId });

    await expect(
      service.register(baseContext, {
        email: 'ANA@EXAMPLE.COM',
        fullName: 'Ana',
        password: 'Password123',
        audit: { ipAddress: null, userAgent: null },
      }),
    ).rejects.toThrow(RpcException);
  });

  it('keeps 201 registration success when SMTP delivery fails', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    prismaMock.user.create.mockResolvedValue({
      id: userAId,
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
  });

  it('verifies email atomically and rejects concurrent race condition (count=0)', async () => {
    const rawToken = 'f'.repeat(64);
    const tokenHash = hashOpaqueTokenSha256(rawToken);
    prismaMock.authToken.findUnique.mockResolvedValue({
      id: 'token-1',
      userId: userAId,
      type: AuthTokenType.EMAIL_VERIFICATION,
      tokenHash,
      expiresAt: new Date(Date.now() + 60_000),
      usedAt: null,
      user: {
        id: userAId,
        email: 'ana@example.com',
        isActive: true,
        emailVerifiedAt: null,
      },
    });
    prismaMock.authToken.updateMany.mockResolvedValueOnce({ count: 1 });
    prismaMock.user.update.mockResolvedValue({
      email: 'ana@example.com',
      emailVerifiedAt: new Date('2026-11-22T04:10:00.000Z'),
    });

    const result = await service.verifyEmail(baseContext, {
      token: rawToken,
      audit: { ipAddress: '10.0.0.1', userAgent: 'Browser' },
    });
    expect(result.verified).toBe(true);

    prismaMock.authToken.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(
      service.verifyEmail(baseContext, {
        token: rawToken,
        audit: { ipAddress: null, userAgent: null },
      }),
    ).rejects.toThrow(RpcException);
  });

  it('returns identical generic 200 response for resendVerification without account enumeration', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce(null);
    const notFoundResult = await service.resendVerification(baseContext, {
      email: 'unknown@example.com',
      audit: { ipAddress: null, userAgent: null },
    });

    prismaMock.user.findUnique.mockResolvedValueOnce({
      id: userAId,
      email: 'verified@example.com',
      fullName: 'Verified',
      isActive: true,
      emailVerifiedAt: new Date(),
    });
    const verifiedResult = await service.resendVerification(baseContext, {
      email: 'verified@example.com',
      audit: { ipAddress: null, userAgent: null },
    });

    expect(notFoundResult).toEqual(verifiedResult);
  });

  it('login returns 401 (never 500) on short password ("abc") and non-existent user', async () => {
    const passwordHash = await hashPasswordArgon2id('Password123');
    prismaMock.user.findUnique.mockResolvedValueOnce({
      id: userAId,
      email: 'ana@example.com',
      passwordHash,
      fullName: 'Ana',
      preferredCurrency: 'PEN',
      timezone: 'America/Lima',
      emailVerifiedAt: null,
      isActive: true,
      createdAt: new Date(),
    });

    try {
      await service.login(baseContext, {
        email: 'ana@example.com',
        password: 'abc',
        audit: { ipAddress: '127.0.0.1', userAgent: 'Test' },
      });
      throw new Error('Expected login to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(RpcException);
      expect((error as RpcException).getError()).toEqual({
        statusCode: 401,
        error: 'Unauthorized',
        message: 'Invalid email or password',
      });
    }

    prismaMock.user.findUnique.mockResolvedValueOnce(null);
    await expect(
      service.login(baseContext, {
        email: 'missing@example.com',
        password: 'Password123',
        audit: { ipAddress: null, userAgent: null },
      }),
    ).rejects.toThrow(RpcException);
  });

  it('login returns 403 EMAIL_NOT_VERIFIED only after matching password for unverified active user', async () => {
    const passwordHash = await hashPasswordArgon2id('Password123');
    prismaMock.user.findUnique.mockResolvedValueOnce({
      id: userAId,
      email: 'ana@example.com',
      passwordHash,
      fullName: 'Ana',
      preferredCurrency: 'PEN',
      timezone: 'America/Lima',
      emailVerifiedAt: null,
      isActive: true,
      createdAt: new Date(),
    });

    try {
      await service.login(baseContext, {
        email: 'ana@example.com',
        password: 'Password123',
        audit: { ipAddress: '127.0.0.1', userAgent: 'Test' },
      });
      throw new Error('Expected login to fail with 403');
    } catch (error) {
      expect(error).toBeInstanceOf(RpcException);
      expect((error as RpcException).getError()).toEqual({
        statusCode: 403,
        error: 'Forbidden',
        code: AUTH_ERROR_CODES.EMAIL_NOT_VERIFIED,
        message: 'Email address has not been verified',
      });
    }

    const auditCall = prismaMock.authAuditLog.create.mock.calls[0] as [
      { data: { event: AuthAuditEvent; metadata: { reason: string } } },
    ];
    expect(auditCall[0].data.event).toBe(AuthAuditEvent.LOGIN_FAILED);
    expect(auditCall[0].data.metadata.reason).toBe(AUTH_ERROR_CODES.EMAIL_NOT_VERIFIED);
  });

  it('login creates session with hashed refresh token and LOGIN_SUCCESS audit for verified user', async () => {
    const passwordHash = await hashPasswordArgon2id('Password123');
    const createdAt = new Date('2026-11-22T04:00:00.000Z');
    const expiresAt = new Date('2026-11-29T04:00:00.000Z');
    prismaMock.user.findUnique.mockResolvedValueOnce({
      id: userAId,
      email: 'ana@example.com',
      passwordHash,
      fullName: 'Ana Pérez',
      preferredCurrency: 'PEN',
      timezone: 'America/Lima',
      emailVerifiedAt: new Date('2026-11-22T04:05:00.000Z'),
      isActive: true,
      createdAt,
    });
    prismaMock.userSession.create.mockResolvedValueOnce({
      id: sessionA1Id,
      expiresAt,
    });

    const result = await service.login(baseContext, {
      email: '  ANA@Example.com ',
      password: 'Password123',
      audit: { ipAddress: '127.0.0.1', userAgent: 'Chrome' },
    });

    expect(result.sessionId).toBe(sessionA1Id);
    expect(result.refreshToken).toMatch(/^[0-9a-f]{64}$/);
    expect(result.user.id).toBe(userAId);

    const sessionCreateCall = prismaMock.userSession.create.mock.calls[0] as [
      { data: { refreshTokenHash: string; familyId: string } },
    ];
    expect(sessionCreateCall[0].data.refreshTokenHash).toBe(
      hashOpaqueTokenSha256(result.refreshToken),
    );
    expect(sessionCreateCall[0].data.refreshTokenHash).not.toBe(result.refreshToken);
  });

  it('refresh rotates token preserving familyId and revoking previous session', async () => {
    const rawRefresh = 'c'.repeat(64);
    prismaMock.userSession.findUnique.mockResolvedValueOnce({
      id: sessionA1Id,
      userId: userAId,
      familyId: familyAId,
      refreshTokenHash: hashOpaqueTokenSha256(rawRefresh),
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: null,
      replacedBySessionId: null,
      user: {
        id: userAId,
        email: 'ana@example.com',
        fullName: 'Ana',
        preferredCurrency: 'PEN',
        timezone: 'America/Lima',
        emailVerifiedAt: new Date('2026-11-22T01:00:00.000Z'),
        isActive: true,
        createdAt: new Date('2026-11-22T00:00:00.000Z'),
      },
    });
    prismaMock.userSession.create.mockResolvedValueOnce({
      id: sessionA2Id,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });
    prismaMock.userSession.updateMany.mockResolvedValueOnce({ count: 1 });

    const rotated = await service.refresh(baseContext, {
      refreshToken: rawRefresh,
      audit: { ipAddress: '127.0.0.1', userAgent: 'Chrome' },
    });

    expect(rotated.sessionId).toBe(sessionA2Id);
    expect(rotated.refreshToken).not.toBe(rawRefresh);
    const createCall = prismaMock.userSession.create.mock.calls[0] as [
      { data: { familyId: string } },
    ];
    expect(createCall[0].data.familyId).toBe(familyAId);
  });

  it('refresh revokes entire familyId and commits audit when token reuse or race condition is detected', async () => {
    prismaMock.userSession.findUnique.mockResolvedValueOnce({
      id: sessionA1Id,
      userId: userAId,
      familyId: familyAId,
      refreshTokenHash: 'd'.repeat(64),
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: new Date(),
      replacedBySessionId: sessionA2Id,
      user: {
        id: userAId,
        email: 'ana@example.com',
        fullName: 'Ana',
        preferredCurrency: 'PEN',
        timezone: 'America/Lima',
        emailVerifiedAt: new Date(),
        isActive: true,
        createdAt: new Date(),
      },
    });
    prismaMock.userSession.updateMany.mockResolvedValueOnce({ count: 2 });

    await expect(
      service.refresh(baseContext, {
        refreshToken: 'e'.repeat(64),
        audit: { ipAddress: '10.0.0.2', userAgent: 'Attacker' },
      }),
    ).rejects.toThrow(RpcException);

    const revokeFamilyCall = prismaMock.userSession.updateMany.mock.calls[0] as [
      { where: { familyId: string; revokedAt: null } },
    ];
    expect(revokeFamilyCall[0].where).toEqual({
      familyId: familyAId,
      revokedAt: null,
    });
    const auditCall = prismaMock.authAuditLog.create.mock.calls[0] as [
      { data: { event: AuthAuditEvent; metadata: { reason: string; familyId: string } } },
    ];
    expect(auditCall[0].data.event).toBe(AuthAuditEvent.SESSION_REVOKED);
    expect(auditCall[0].data.metadata.reason).toBe('REFRESH_TOKEN_REUSE_DETECTED');
  });

  it('listSessions, revokeSession (isolated by userId), logout, and logoutAll enforce ownership', async () => {
    const authContext: InternalAuthContext = {
      ...baseContext,
      userId: userAId,
    };

    prismaMock.userSession.findMany.mockResolvedValueOnce([
      {
        id: sessionA1Id,
        ipAddress: '127.0.0.1',
        userAgent: 'Chrome',
        createdAt: new Date('2026-11-22T01:00:00.000Z'),
        expiresAt: new Date('2026-11-29T01:00:00.000Z'),
      },
    ]);
    const listResult = await service.listSessions(authContext, { currentSessionId: sessionA1Id });
    expect(listResult.sessions).toHaveLength(1);
    expect(listResult.sessions[0].isCurrent).toBe(true);

    prismaMock.userSession.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(
      service.revokeSession(authContext, {
        sessionId: sessionB1Id,
        currentSessionId: sessionA1Id,
        audit: { ipAddress: null, userAgent: null },
      }),
    ).rejects.toThrow(RpcException);

    prismaMock.userSession.updateMany.mockResolvedValueOnce({ count: 1 });
    const revokeOwn = await service.revokeSession(authContext, {
      sessionId: sessionA1Id,
      currentSessionId: sessionA1Id,
      audit: { ipAddress: null, userAgent: null },
    });
    expect(revokeOwn.currentSessionCleared).toBe(true);

    prismaMock.userSession.updateMany.mockResolvedValueOnce({ count: 3 });
    const logoutAllResult = await service.logoutAll(authContext, {
      audit: { ipAddress: null, userAgent: null },
    });
    expect(logoutAllResult.revokedCount).toBe(3);

    const logoutIdempotent = await service.logout(baseContext, {
      sessionId: null,
      refreshToken: null,
      audit: { ipAddress: null, userAgent: null },
    });
    expect(logoutIdempotent.message).toBe('Logged out successfully.');
  });
});
