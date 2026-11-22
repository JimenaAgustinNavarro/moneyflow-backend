import { HttpException, HttpStatus, INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AUTH_PATTERNS } from '@app/shared';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AllExceptionsFilter } from '../common/filters/all-exceptions.filter';
import { CoreTcpClientService } from '../core-client/core-tcp-client.service';
import { AuthController } from './auth.controller';

describe('AuthController (HTTP boundary)', () => {
  let app: INestApplication<App>;
  let coreTcpClientMock: {
    buildRequestContext: jest.Mock;
    send: jest.Mock;
  };

  beforeEach(async () => {
    coreTcpClientMock = {
      buildRequestContext: jest.fn().mockReturnValue({
        requestId: 'req-gateway-1',
        userId: null,
        audit: {
          ipAddress: '127.0.0.1',
          userAgent: 'supertest',
        },
      }),
      send: jest.fn(),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        {
          provide: CoreTcpClientService,
          useValue: coreTcpClientMock,
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
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
        id: 'user-1',
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
      .send({
        email: '  Ana@Example.COM  ',
        fullName: '  Ana Pérez  ',
        password: 'Password123',
      })
      .expect(201);

    expect(response.body).toEqual(expected);
    expect(coreTcpClientMock.send).toHaveBeenCalledWith(
      AUTH_PATTERNS.REGISTER,
      {
        email: 'ana@example.com',
        fullName: 'Ana Pérez',
        password: 'Password123',
        audit: {
          ipAddress: '127.0.0.1',
          userAgent: 'supertest',
        },
      },
      { requestId: 'req-gateway-1', userId: null },
    );
  });

  it('POST /api/v1/auth/register rejects extra fields and >128-char passwords with 400 before calling core', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        email: 'ana@example.com',
        fullName: 'Ana',
        password: 'Password123',
        isAdmin: true,
      })
      .expect(400);

    await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        email: 'ana@example.com',
        fullName: 'Ana',
        password: 'Aa1' + 'x'.repeat(126),
      })
      .expect(400);

    expect(coreTcpClientMock.send).not.toHaveBeenCalled();
  });

  it('POST /api/v1/auth/register formats 409 Conflict via AllExceptionsFilter', async () => {
    coreTcpClientMock.send.mockRejectedValue(
      new HttpException(
        {
          statusCode: HttpStatus.CONFLICT,
          error: 'Conflict',
          message: 'Email is already registered',
        },
        HttpStatus.CONFLICT,
      ),
    );

    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        email: 'ana@example.com',
        fullName: 'Ana',
        password: 'Password123',
      })
      .expect(409);

    expect(response.body).toEqual(
      expect.objectContaining({
        statusCode: 409,
        error: 'Conflict',
        message: 'Email is already registered',
        path: '/api/v1/auth/register',
      }),
    );
  });

  it('POST /api/v1/auth/verify-email returns 200 on valid token and 400 on empty token', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/verify-email')
      .send({ token: '   ' })
      .expect(400);

    coreTcpClientMock.send.mockResolvedValue({
      verified: true,
      email: 'ana@example.com',
      emailVerifiedAt: '2026-11-22T04:05:00.000Z',
      message: 'Email verified successfully.',
    });

    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/verify-email')
      .send({ token: 'a'.repeat(64) })
      .expect(200);

    expect((response.body as { verified: boolean }).verified).toBe(true);
  });

  it('POST /api/v1/auth/resend-verification normalizes email and returns 200', async () => {
    coreTcpClientMock.send.mockResolvedValue({
      message:
        'If an account with that email exists and is pending verification, a new verification link has been sent.',
    });

    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/resend-verification')
      .send({ email: '  ANA@EXAMPLE.COM ' })
      .expect(200);

    expect((response.body as { message: string }).message).toContain(
      'If an account with that email exists',
    );
    expect(coreTcpClientMock.send).toHaveBeenCalledWith(
      AUTH_PATTERNS.RESEND_VERIFICATION,
      expect.objectContaining({ email: 'ana@example.com' }),
      { requestId: 'req-gateway-1', userId: null },
    );
  });
});
