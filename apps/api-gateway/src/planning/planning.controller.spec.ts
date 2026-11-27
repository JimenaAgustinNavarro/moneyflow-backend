import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { PLANNING_PATTERNS } from '@app/shared';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AuthCookiesService } from '../auth/auth-cookies.service';
import { AuthJwtService } from '../auth/auth-jwt.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AllExceptionsFilter } from '../common/filters/all-exceptions.filter';
import { OriginCsrfGuard } from '../common/guards/origin-csrf.guard';
import { CoreTcpClientService } from '../core-client/core-tcp-client.service';
import { PlanningController } from './planning.controller';

describe('PlanningController (HTTP boundary)', () => {
  jest.setTimeout(15_000);

  const jwtSecret = 'test-gateway-jwt-secret-minimum-32-chars';
  const userId = '11111111-1111-4111-8111-111111111111';
  const sessionId = '22222222-2222-4222-8222-222222222222';
  const ruleId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const occId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const fundId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const catId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

  let app: INestApplication<App>;
  let authJwtService: AuthJwtService;
  let coreTcpClientMock: {
    buildRequestContext: jest.Mock;
    send: jest.Mock;
  };

  beforeEach(async () => {
    coreTcpClientMock = {
      buildRequestContext: jest.fn((_req: unknown, authenticatedUserId: string | null = null) => ({
        requestId: 'req-planning-1',
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
      controllers: [PlanningController],
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

  async function createAccessCookie(): Promise<string> {
    const token = await authJwtService.signAccessToken(userId, sessionId);
    return `mf_access_token=${token}`;
  }

  it('validates DTOs with strict ValidationPipe: rejects kind/currency in PATCH, userId injection, extra fields, impossible dates, and invalid booleans', async () => {
    const cookie = await createAccessCookie();

    // 1) PATCH rejects kind and currency
    await request(app.getHttpServer())
      .patch(`/api/v1/recurring/rules/${ruleId}`)
      .set('Cookie', cookie)
      .set('Origin', 'http://localhost:3001')
      .send({ kind: 'INCOME' })
      .expect(400);

    await request(app.getHttpServer())
      .patch(`/api/v1/recurring/rules/${ruleId}`)
      .set('Cookie', cookie)
      .set('Origin', 'http://localhost:3001')
      .send({ currency: 'USD' })
      .expect(400);

    // 2) POST rejects userId injection and extra fields
    await request(app.getHttpServer())
      .post('/api/v1/recurring/rules')
      .set('Cookie', cookie)
      .set('Origin', 'http://localhost:3001')
      .send({
        userId: '99999999-9999-4999-8999-999999999999',
        kind: 'EXPENSE',
        description: 'Alquiler',
        amount: '1500.00',
        currency: 'PEN',
        frequency: 'MONTHLY',
        startDate: '2026-11-01',
        categoryId: catId,
      })
      .expect(400);

    await request(app.getHttpServer())
      .post('/api/v1/recurring/rules')
      .set('Cookie', cookie)
      .set('Origin', 'http://localhost:3001')
      .send({
        kind: 'EXPENSE',
        description: 'Alquiler',
        amount: '1500.00',
        currency: 'PEN',
        frequency: 'MONTHLY',
        startDate: '2026-11-01',
        categoryId: catId,
        extraField: 'nope',
      })
      .expect(400);

    // 3) Impossible Gregorian date (2026-02-31) -> 400
    await request(app.getHttpServer())
      .post('/api/v1/recurring/rules')
      .set('Cookie', cookie)
      .set('Origin', 'http://localhost:3001')
      .send({
        kind: 'EXPENSE',
        description: 'Alquiler',
        amount: '1500.00',
        currency: 'PEN',
        frequency: 'MONTHLY',
        startDate: '2026-02-31',
        categoryId: catId,
      })
      .expect(400);

    // 4) GET occurrences with fromDate > toDate -> 400
    await request(app.getHttpServer())
      .get('/api/v1/recurring/occurrences?fromDate=2026-12-10&toDate=2026-12-01')
      .set('Cookie', cookie)
      .expect(400);

    // 5) GET rules with invalid boolean "yes" -> 400, valid "false" -> false
    await request(app.getHttpServer())
      .get('/api/v1/recurring/rules?includeArchived=yes')
      .set('Cookie', cookie)
      .expect(400);

    coreTcpClientMock.send.mockResolvedValueOnce({ items: [] });
    await request(app.getHttpServer())
      .get('/api/v1/recurring/rules?includeArchived=false')
      .set('Cookie', cookie)
      .expect(200);

    expect(coreTcpClientMock.send).toHaveBeenCalledWith(
      PLANNING_PATTERNS.LIST_RULES,
      expect.objectContaining({ includeArchived: false }),
      expect.objectContaining({ userId }),
    );
  });

  it('requires valid Idempotency-Key on /occurrences/:id/pay, validates ParseUUIDPipe, and propagates userId exclusively from JWT', async () => {
    const cookie = await createAccessCookie();

    // 1) ParseUUIDPipe rejects invalid UUID
    await request(app.getHttpServer())
      .post('/api/v1/recurring/occurrences/not-a-uuid/pay')
      .set('Cookie', cookie)
      .set('Origin', 'http://localhost:3001')
      .set('Idempotency-Key', 'valid-key-1')
      .send({ fundId })
      .expect(400);

    // 2) Missing Idempotency-Key -> 400
    await request(app.getHttpServer())
      .post(`/api/v1/recurring/occurrences/${occId}/pay`)
      .set('Cookie', cookie)
      .set('Origin', 'http://localhost:3001')
      .send({ fundId })
      .expect(400);

    // 3) Whitespace-only Idempotency-Key -> 400
    await request(app.getHttpServer())
      .post(`/api/v1/recurring/occurrences/${occId}/pay`)
      .set('Cookie', cookie)
      .set('Origin', 'http://localhost:3001')
      .set('Idempotency-Key', '   ')
      .send({ fundId })
      .expect(400);

    // 4) Too long Idempotency-Key (>128 chars) -> 400
    await request(app.getHttpServer())
      .post(`/api/v1/recurring/occurrences/${occId}/pay`)
      .set('Cookie', cookie)
      .set('Origin', 'http://localhost:3001')
      .set('Idempotency-Key', 'a'.repeat(129))
      .send({ fundId })
      .expect(400);

    // 5) Valid pay request -> 201 and userId from JWT
    coreTcpClientMock.send.mockResolvedValueOnce({
      occurrence: { id: occId, status: 'PAID' },
      transaction: { id: 'tx-1' },
      fundBalanceAfter: '500.00',
    });

    await request(app.getHttpServer())
      .post(`/api/v1/recurring/occurrences/${occId}/pay`)
      .set('Cookie', cookie)
      .set('Origin', 'http://localhost:3001')
      .set('Idempotency-Key', 'pay-key-123')
      .send({ fundId })
      .expect(201);

    expect(coreTcpClientMock.send).toHaveBeenCalledWith(
      PLANNING_PATTERNS.PAY_OCCURRENCE,
      expect.objectContaining({
        id: occId,
        idempotencyKey: 'pay-key-123',
        fundId,
      }),
      expect.objectContaining({ userId }),
    );
  });
});
