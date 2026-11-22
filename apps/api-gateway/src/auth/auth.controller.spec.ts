import { HttpException, HttpStatus, INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AUTH_ERROR_CODES, AUTH_PATTERNS } from '@app/shared';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AllExceptionsFilter } from '../common/filters/all-exceptions.filter';
import { OriginCsrfGuard } from '../common/guards/origin-csrf.guard';
import { CoreTcpClientService } from '../core-client/core-tcp-client.service';
import { AuthCookiesService } from './auth-cookies.service';
import { AuthController } from './auth.controller';
import { AuthJwtService } from './auth-jwt.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

describe('AuthController (HTTP boundary)', () => {
  const jwtSecret = 'test-gateway-jwt-secret-minimum-32-chars';
  const userId = '11111111-1111-4111-8111-111111111111';
  const sessionId = '22222222-2222-4222-8222-222222222222';
  const otherSessionId = '33333333-3333-4333-8333-333333333333';

  let app: INestApplication<App>;
  let authJwtService: AuthJwtService;
  let coreTcpClientMock: {
    buildRequestContext: jest.Mock;
    send: jest.Mock;
  };

  beforeEach(async () => {
    coreTcpClientMock = {
      buildRequestContext: jest.fn((_req: unknown, authenticatedUserId: string | null = null) => ({
        requestId: 'req-gateway-1',
        userId: authenticatedUserId,
        audit: {
          ipAddress: '127.0.0.1',
          userAgent: 'supertest',
        },
      })),
      send: jest.fn(),
    };

    const configValues: Record<string, string> = {
      JWT_SECRET: jwtSecret,
      CORS_ORIGIN: 'http://localhost:3001',
      NODE_ENV: 'test',
      COOKIE_SECURE: 'false',
    };

    const moduleRef = await Test.createTestingModule({
      imports: [
        ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),
        JwtModule.register({
          secret: jwtSecret,
          signOptions: { expiresIn: 900 },
        }),
      ],
      controllers: [AuthController],
      providers: [
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => configValues[key]),
          },
        },
        {
          provide: CoreTcpClientService,
          useValue: coreTcpClientMock,
        },
        AuthCookiesService,
        AuthJwtService,
        JwtAuthGuard,
        {
          provide: APP_GUARD,
          useClass: OriginCsrfGuard,
        },
        {
          provide: APP_GUARD,
          useClass: ThrottlerGuard,
        },
      ],
    }).compile();

    authJwtService = moduleRef.get(AuthJwtService);

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('POST /api/v1/auth/register normalizes email and returns 201', async () => {
    const expected = {
      user: {
        id: userId,
        email: 'ana@example.com',
        fullName: 'Ana Pérez',
        preferredCurrency: 'PEN',
        timezone: 'America/Lima',
        emailVerifiedAt: null,
        isActive: true,
        createdAt: '2026-11-22T04:00:00.000Z',
      },
      emailVerificationRequired: true,
      message: 'User registered successfully. Please check your email to verify your account.',
    };
    coreTcpClientMock.send.mockResolvedValue(expected);

    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .set('Origin', 'http://localhost:3001')
      .send({
        email: '  Ana@Example.COM  ',
        fullName: '  Ana Pérez  ',
        password: 'Password123',
      })
      .expect(201);

    expect(response.body).toEqual(expected);
  });

  it('POST /api/v1/auth/login sets HttpOnly cookies with expected Path and omits tokens from JSON body', async () => {
    coreTcpClientMock.send.mockResolvedValue({
      user: {
        id: userId,
        email: 'ana@example.com',
        fullName: 'Ana Pérez',
        preferredCurrency: 'PEN',
        timezone: 'America/Lima',
        emailVerifiedAt: '2026-11-22T04:05:00.000Z',
        isActive: true,
        createdAt: '2026-11-22T04:00:00.000Z',
      },
      sessionId,
      refreshToken: 'a'.repeat(64),
      refreshTokenExpiresAt: '2026-11-29T04:00:00.000Z',
    });

    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('Origin', 'http://localhost:3001')
      .send({
        email: '  Ana@Example.COM ',
        password: 'Password123',
      })
      .expect(200);

    expect(response.body).not.toHaveProperty('accessToken');
    expect(response.body).not.toHaveProperty('refreshToken');
    const cookies = response.headers['set-cookie'] as unknown as string[];
    expect(
      cookies.some(
        (c) => c.startsWith('mf_access_token=') && c.includes('Path=/;') && c.includes('HttpOnly'),
      ),
    ).toBe(true);
    expect(
      cookies.some(
        (c) =>
          c.startsWith('mf_refresh_token=') &&
          c.includes('Path=/api/v1/auth;') &&
          c.includes('HttpOnly'),
      ),
    ).toBe(true);
  });

  it('POST /api/v1/auth/login propagates 403 EMAIL_NOT_VERIFIED and enforces rate limit 429', async () => {
    coreTcpClientMock.send.mockRejectedValue(
      new HttpException(
        {
          statusCode: HttpStatus.FORBIDDEN,
          error: 'Forbidden',
          code: AUTH_ERROR_CODES.EMAIL_NOT_VERIFIED,
          message: 'Email address has not been verified',
        },
        HttpStatus.FORBIDDEN,
      ),
    );

    const first = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'ana@example.com', password: 'Password123' })
      .expect(403);

    expect(first.body).toEqual(
      expect.objectContaining({
        statusCode: 403,
        code: AUTH_ERROR_CODES.EMAIL_NOT_VERIFIED,
      }),
    );

    for (let i = 0; i < 4; i += 1) {
      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'ana@example.com', password: 'Password123' })
        .expect(403);
    }

    const throttled = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'ana@example.com', password: 'Password123' })
      .expect(429);

    expect(throttled.body).toEqual(
      expect.objectContaining({
        statusCode: 429,
        error: 'Too Many Requests',
      }),
    );
  });

  it('blocks mutating requests from unauthorized Origin with 403', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('Origin', 'http://localhost:3001.evil.com')
      .send({ email: 'ana@example.com', password: 'Password123' })
      .expect(403);

    expect(coreTcpClientMock.send).not.toHaveBeenCalled();
  });

  it('POST /api/v1/auth/refresh rotates cookies on 200 and clears both cookies on 401', async () => {
    coreTcpClientMock.send.mockResolvedValueOnce({
      user: {
        id: userId,
        email: 'ana@example.com',
        fullName: 'Ana Pérez',
        preferredCurrency: 'PEN',
        timezone: 'America/Lima',
        emailVerifiedAt: '2026-11-22T04:05:00.000Z',
        isActive: true,
        createdAt: '2026-11-22T04:00:00.000Z',
      },
      sessionId: otherSessionId,
      refreshToken: 'b'.repeat(64),
      refreshTokenExpiresAt: '2026-11-29T04:00:00.000Z',
    });

    const okRes = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Cookie', [`mf_refresh_token=${'a'.repeat(64)}`])
      .expect(200);

    expect((okRes.body as { message: string }).message).toBe('Session refreshed successfully.');

    coreTcpClientMock.send.mockRejectedValueOnce(
      new HttpException(
        { statusCode: 401, error: 'Unauthorized', message: 'Invalid or expired refresh token' },
        401,
      ),
    );

    const failRes = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Cookie', [`mf_refresh_token=${'a'.repeat(64)}`])
      .expect(401);

    const clearedCookies = failRes.headers['set-cookie'] as unknown as string[];
    expect(
      clearedCookies.some(
        (c) => c.startsWith('mf_access_token=;') && c.includes('Path=/;') && c.includes('HttpOnly'),
      ),
    ).toBe(true);
    expect(
      clearedCookies.some(
        (c) =>
          c.startsWith('mf_refresh_token=;') &&
          c.includes('Path=/api/v1/auth;') &&
          c.includes('HttpOnly'),
      ),
    ).toBe(true);
  });

  it('GET /api/v1/auth/sessions requires valid JWT cookie and DELETE /sessions/:id validates UUID and clears cookies on current session', async () => {
    await request(app.getHttpServer()).get('/api/v1/auth/sessions').expect(401);

    const accessToken = await authJwtService.signAccessToken(userId, sessionId);
    coreTcpClientMock.send.mockResolvedValueOnce({ sessions: [] });

    await request(app.getHttpServer())
      .get('/api/v1/auth/sessions')
      .set('Cookie', [`mf_access_token=${accessToken}`])
      .expect(200);

    expect(coreTcpClientMock.send).toHaveBeenCalledWith(
      AUTH_PATTERNS.LIST_SESSIONS,
      { currentSessionId: sessionId },
      { requestId: 'req-gateway-1', userId },
    );

    await request(app.getHttpServer())
      .delete('/api/v1/auth/sessions/not-a-uuid')
      .set('Cookie', [`mf_access_token=${accessToken}`])
      .expect(400);

    coreTcpClientMock.send.mockResolvedValueOnce({
      revokedSessionId: sessionId,
      currentSessionCleared: true,
      message: 'Session revoked successfully.',
    });

    const delRes = await request(app.getHttpServer())
      .delete(`/api/v1/auth/sessions/${sessionId}`)
      .set('Cookie', [`mf_access_token=${accessToken}`])
      .expect(200);

    const clearedCookies = delRes.headers['set-cookie'] as unknown as string[];
    expect(
      clearedCookies.some((c) => c.startsWith('mf_access_token=;') && c.includes('Path=/;')),
    ).toBe(true);
    expect(
      clearedCookies.some(
        (c) => c.startsWith('mf_refresh_token=;') && c.includes('Path=/api/v1/auth;'),
      ),
    ).toBe(true);
  });

  it('POST /api/v1/auth/logout and POST /api/v1/auth/logout-all clear both cookies with exact Paths', async () => {
    coreTcpClientMock.send.mockResolvedValueOnce({ message: 'Logged out successfully.' });

    const logoutRes = await request(app.getHttpServer())
      .post('/api/v1/auth/logout')
      .set('Cookie', ['mf_access_token=invalid.jwt.token'])
      .expect(200);

    expect(coreTcpClientMock.send).toHaveBeenCalledWith(
      AUTH_PATTERNS.LOGOUT,
      {
        sessionId: null,
        refreshToken: null,
        audit: { ipAddress: '127.0.0.1', userAgent: 'supertest' },
      },
      { requestId: 'req-gateway-1', userId: null },
    );
    const logoutCookies = logoutRes.headers['set-cookie'] as unknown as string[];
    expect(
      logoutCookies.some((c) => c.startsWith('mf_access_token=;') && c.includes('Path=/;')),
    ).toBe(true);
    expect(
      logoutCookies.some(
        (c) => c.startsWith('mf_refresh_token=;') && c.includes('Path=/api/v1/auth;'),
      ),
    ).toBe(true);

    const accessToken = await authJwtService.signAccessToken(userId, sessionId);
    coreTcpClientMock.send.mockResolvedValueOnce({
      revokedCount: 2,
      message: 'All active sessions have been revoked.',
    });

    const logoutAllRes = await request(app.getHttpServer())
      .post('/api/v1/auth/logout-all')
      .set('Cookie', [`mf_access_token=${accessToken}`])
      .expect(200);

    const logoutAllCookies = logoutAllRes.headers['set-cookie'] as unknown as string[];
    expect(
      logoutAllCookies.some((c) => c.startsWith('mf_access_token=;') && c.includes('Path=/;')),
    ).toBe(true);
    expect(
      logoutAllCookies.some(
        (c) => c.startsWith('mf_refresh_token=;') && c.includes('Path=/api/v1/auth;'),
      ),
    ).toBe(true);
  });

  it('POST /api/v1/auth/forgot-password and POST /api/v1/auth/reset-password enforce DTO validation, rate limit, and clear cookies only on reset success', async () => {
    coreTcpClientMock.send.mockResolvedValueOnce({
      message: 'If an account with that email exists, a password reset link has been sent.',
    });

    const forgotRes = await request(app.getHttpServer())
      .post('/api/v1/auth/forgot-password')
      .set('Origin', 'http://localhost:3001')
      .send({ email: '  ANA@Example.COM  ' })
      .expect(200);

    expect(forgotRes.body).toEqual({
      message: 'If an account with that email exists, a password reset link has been sent.',
    });
    expect(coreTcpClientMock.send).toHaveBeenCalledWith(
      AUTH_PATTERNS.FORGOT_PASSWORD,
      {
        email: 'ana@example.com',
        audit: { ipAddress: '127.0.0.1', userAgent: 'supertest' },
      },
      { requestId: 'req-gateway-1', userId: null },
    );

    await request(app.getHttpServer())
      .post('/api/v1/auth/reset-password')
      .set('Origin', 'http://localhost:3001')
      .send({ token: 'abc', newPassword: 'weak' })
      .expect(400);

    coreTcpClientMock.send.mockRejectedValueOnce(
      new HttpException(
        { statusCode: 400, error: 'Bad Request', message: 'Invalid token' },
        HttpStatus.BAD_REQUEST,
      ),
    );
    const failedReset = await request(app.getHttpServer())
      .post('/api/v1/auth/reset-password')
      .set('Origin', 'http://localhost:3001')
      .send({ token: 'invalid-token', newPassword: 'NewPassword123' })
      .expect(400);
    expect(failedReset.headers['set-cookie']).toBeUndefined();

    coreTcpClientMock.send.mockResolvedValueOnce({
      message: 'Password has been reset successfully. Please log in with your new password.',
    });
    const okReset = await request(app.getHttpServer())
      .post('/api/v1/auth/reset-password')
      .set('Origin', 'http://localhost:3001')
      .send({ token: 'valid-token', newPassword: 'NewPassword123' })
      .expect(200);

    const resetCookies = okReset.headers['set-cookie'] as unknown as string[];
    expect(
      resetCookies.some((c) => c.startsWith('mf_access_token=;') && c.includes('Path=/;')),
    ).toBe(true);
    expect(
      resetCookies.some(
        (c) => c.startsWith('mf_refresh_token=;') && c.includes('Path=/api/v1/auth;'),
      ),
    ).toBe(true);
  });

  it('SEC-001: enforces strict userId isolation, rejects injected query/body fields (400), and blocks invalid/missing JWT (401)', async () => {
    const userBId = '99999999-9999-4999-8999-999999999999';
    const userAAccessToken = await authJwtService.signAccessToken(userId, sessionId);

    await request(app.getHttpServer()).get('/api/v1/auth/me').expect(401);
    await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Cookie', ['mf_access_token=tampered.jwt.value'])
      .expect(401);

    await request(app.getHttpServer())
      .get(`/api/v1/auth/me?userId=${userBId}`)
      .set('Cookie', [`mf_access_token=${userAAccessToken}`])
      .expect(400);

    coreTcpClientMock.send.mockResolvedValueOnce({
      user: {
        id: userId,
        email: 'ana@example.com',
        fullName: 'Ana Pérez',
        preferredCurrency: 'PEN',
        timezone: 'America/Lima',
        emailVerifiedAt: '2026-11-22T04:05:00.000Z',
        isActive: true,
        createdAt: '2026-11-22T04:00:00.000Z',
      },
    });
    await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Cookie', [`mf_access_token=${userAAccessToken}`])
      .expect(200);
    expect(coreTcpClientMock.send).toHaveBeenCalledWith(
      AUTH_PATTERNS.GET_ME,
      {},
      { requestId: 'req-gateway-1', userId },
    );

    await request(app.getHttpServer())
      .patch('/api/v1/auth/me')
      .set('Origin', 'http://localhost:3001')
      .set('Cookie', [`mf_access_token=${userAAccessToken}`])
      .send({ fullName: 'Ana', email: 'hijack@example.com', userId: userBId, isActive: false })
      .expect(400);

    await request(app.getHttpServer())
      .post('/api/v1/auth/change-password')
      .set('Origin', 'http://localhost:3001')
      .set('Cookie', [`mf_access_token=${userAAccessToken}`])
      .send({
        currentPassword: 'Password123',
        newPassword: 'NewPassword123',
        userId: userBId,
      })
      .expect(400);

    coreTcpClientMock.send.mockResolvedValueOnce({
      revokedOtherSessionsCount: 1,
      message: 'Password changed successfully.',
    });
    await request(app.getHttpServer())
      .post('/api/v1/auth/change-password')
      .set('Origin', 'http://localhost:3001')
      .set('Cookie', [`mf_access_token=${userAAccessToken}`])
      .send({
        currentPassword: 'Password123',
        newPassword: 'NewPassword123',
      })
      .expect(200);
    expect(coreTcpClientMock.send).toHaveBeenCalledWith(
      AUTH_PATTERNS.CHANGE_PASSWORD,
      {
        currentPassword: 'Password123',
        newPassword: 'NewPassword123',
        currentSessionId: sessionId,
        audit: { ipAddress: '127.0.0.1', userAgent: 'supertest' },
      },
      { requestId: 'req-gateway-1', userId },
    );
  });
});
