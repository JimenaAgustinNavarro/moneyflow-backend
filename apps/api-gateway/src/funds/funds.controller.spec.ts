import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { FUNDS_PATTERNS } from '@app/shared';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AuthCookiesService } from '../auth/auth-cookies.service';
import { AuthJwtService } from '../auth/auth-jwt.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AllExceptionsFilter } from '../common/filters/all-exceptions.filter';
import { OriginCsrfGuard } from '../common/guards/origin-csrf.guard';
import { CoreTcpClientService } from '../core-client/core-tcp-client.service';
import { FundsController } from './funds.controller';

describe('FundsController (HTTP boundary)', () => {
  const jwtSecret = 'test-gateway-jwt-secret-minimum-32-chars';
  const userId = '11111111-1111-4111-8111-111111111111';
  const sessionId = '22222222-2222-4222-8222-222222222222';
  const fundId = 'aaaaaaaa-aaaa-1aaa-8aaa-aaaaaaaaaaaa';

  let app: INestApplication<App>;
  let authJwtService: AuthJwtService;
  let coreTcpClientMock: {
    buildRequestContext: jest.Mock;
    send: jest.Mock;
  };

  beforeEach(async () => {
    coreTcpClientMock = {
      buildRequestContext: jest.fn((_req: unknown, authenticatedUserId: string | null = null) => ({
        requestId: 'req-funds-1',
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
      controllers: [FundsController],
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

  it('rejects unauthenticated requests with 401', async () => {
    await request(app.getHttpServer()).get('/api/v1/funds').expect(401);
    expect(coreTcpClientMock.send).not.toHaveBeenCalled();
  });

  it('validates query params on GET /api/v1/funds and transforms includeArchived=false cleanly', async () => {
    const accessToken = await authJwtService.signAccessToken(userId, sessionId);
    coreTcpClientMock.send.mockResolvedValue({ funds: [], totalsByCurrency: [] });

    await request(app.getHttpServer())
      .get('/api/v1/funds?includeArchived=invalido')
      .set('Cookie', [`mf_access_token=${accessToken}`])
      .expect(400);

    await request(app.getHttpServer())
      .get('/api/v1/funds?includeArchived=false&currency=PEN&type=CASH')
      .set('Cookie', [`mf_access_token=${accessToken}`])
      .expect(200);

    expect(coreTcpClientMock.send).toHaveBeenCalledWith(
      FUNDS_PATTERNS.LIST,
      { includeArchived: false, currency: 'PEN', type: 'CASH' },
      { requestId: 'req-funds-1', userId },
    );
  });

  it('validates :id with standard RFC 4122 ParseUUIDPipe and rejects non-UUIDs with 400', async () => {
    const accessToken = await authJwtService.signAccessToken(userId, sessionId);
    coreTcpClientMock.send.mockResolvedValue({ fund: { id: fundId } });

    await request(app.getHttpServer())
      .get('/api/v1/funds/not-a-uuid')
      .set('Cookie', [`mf_access_token=${accessToken}`])
      .expect(400);

    await request(app.getHttpServer())
      .get(`/api/v1/funds/${fundId}`)
      .set('Cookie', [`mf_access_token=${accessToken}`])
      .expect(200);

    expect(coreTcpClientMock.send).toHaveBeenCalledWith(
      FUNDS_PATTERNS.GET_BY_ID,
      { id: fundId },
      { requestId: 'req-funds-1', userId },
    );
  });

  it('rejects userId in POST body and invalid initialBalance with 400, and returns 201 for valid creation', async () => {
    const accessToken = await authJwtService.signAccessToken(userId, sessionId);
    coreTcpClientMock.send.mockResolvedValue({
      fund: { id: fundId, name: 'Efectivo', balance: '250.00' },
    });

    await request(app.getHttpServer())
      .post('/api/v1/funds')
      .set('Origin', 'http://localhost:3001')
      .set('Cookie', [`mf_access_token=${accessToken}`])
      .send({ name: 'Efectivo', type: 'CASH', userId: '99999999-9999-4999-8999-999999999999' })
      .expect(400);

    await request(app.getHttpServer())
      .post('/api/v1/funds')
      .set('Origin', 'http://localhost:3001')
      .set('Cookie', [`mf_access_token=${accessToken}`])
      .send({ name: 'Efectivo', type: 'CASH', initialBalance: '-10.00' })
      .expect(400);

    await request(app.getHttpServer())
      .post('/api/v1/funds')
      .set('Origin', 'http://localhost:3001')
      .set('Cookie', [`mf_access_token=${accessToken}`])
      .send({ name: 'Efectivo', type: 'CASH', initialBalance: '250.00' })
      .expect(201);

    expect(coreTcpClientMock.send).toHaveBeenCalledWith(
      FUNDS_PATTERNS.CREATE,
      { name: 'Efectivo', type: 'CASH', initialBalance: '250.00' },
      { requestId: 'req-funds-1', userId },
    );
  });

  it('rejects empty body {} and currency in PATCH, allows null color/icon, and rejects invalid color', async () => {
    const accessToken = await authJwtService.signAccessToken(userId, sessionId);
    coreTcpClientMock.send.mockResolvedValue({
      fund: { id: fundId, name: 'Efectivo', color: null, icon: null, balance: '350.25' },
    });

    await request(app.getHttpServer())
      .patch(`/api/v1/funds/${fundId}`)
      .set('Origin', 'http://localhost:3001')
      .set('Cookie', [`mf_access_token=${accessToken}`])
      .send({})
      .expect(400);

    await request(app.getHttpServer())
      .patch(`/api/v1/funds/${fundId}`)
      .set('Origin', 'http://localhost:3001')
      .set('Cookie', [`mf_access_token=${accessToken}`])
      .send({ currency: 'USD' })
      .expect(400);

    await request(app.getHttpServer())
      .patch(`/api/v1/funds/${fundId}`)
      .set('Origin', 'http://localhost:3001')
      .set('Cookie', [`mf_access_token=${accessToken}`])
      .send({ color: '' })
      .expect(400);

    await request(app.getHttpServer())
      .patch(`/api/v1/funds/${fundId}`)
      .set('Origin', 'http://localhost:3001')
      .set('Cookie', [`mf_access_token=${accessToken}`])
      .send({ color: null, icon: null })
      .expect(200);

    expect(coreTcpClientMock.send).toHaveBeenCalledWith(
      FUNDS_PATTERNS.UPDATE,
      { id: fundId, color: null, icon: null },
      { requestId: 'req-funds-1', userId },
    );
  });

  it('archives a fund via DELETE /api/v1/funds/:id with 200', async () => {
    const accessToken = await authJwtService.signAccessToken(userId, sessionId);
    coreTcpClientMock.send.mockResolvedValue({
      fund: { id: fundId, isArchived: true, balance: '0.00' },
      message: 'Fund archived successfully.',
    });

    await request(app.getHttpServer())
      .delete(`/api/v1/funds/${fundId}`)
      .set('Origin', 'http://localhost:3001')
      .set('Cookie', [`mf_access_token=${accessToken}`])
      .expect(200);

    expect(coreTcpClientMock.send).toHaveBeenCalledWith(
      FUNDS_PATTERNS.ARCHIVE,
      { id: fundId },
      { requestId: 'req-funds-1', userId },
    );
  });
});
