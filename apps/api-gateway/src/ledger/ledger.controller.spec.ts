import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LEDGER_PATTERNS } from '@app/shared';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AuthCookiesService } from '../auth/auth-cookies.service';
import { AuthJwtService } from '../auth/auth-jwt.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AllExceptionsFilter } from '../common/filters/all-exceptions.filter';
import { OriginCsrfGuard } from '../common/guards/origin-csrf.guard';
import { CoreTcpClientService } from '../core-client/core-tcp-client.service';
import { LedgerController } from './ledger.controller';

describe('LedgerController (HTTP boundary)', () => {
  jest.setTimeout(15_000);

  const jwtSecret = 'test-gateway-jwt-secret-minimum-32-chars';
  const userId = '11111111-1111-4111-8111-111111111111';
  const sessionId = '22222222-2222-4222-8222-222222222222';
  const fundId = 'aaaaaaaa-aaaa-1aaa-8aaa-aaaaaaaaaaaa';
  const catId1 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const catId2 = 'cccccccc-cccc-1ccc-8ccc-cccccccccccc';
  const txId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

  let app: INestApplication<App>;
  let authJwtService: AuthJwtService;
  let coreTcpClientMock: {
    buildRequestContext: jest.Mock;
    send: jest.Mock;
  };

  beforeEach(async () => {
    coreTcpClientMock = {
      buildRequestContext: jest.fn((_req: unknown, authenticatedUserId: string | null = null) => ({
        requestId: 'req-ledger-1',
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
      controllers: [LedgerController],
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

  it('rejects unauthenticated requests with 401 and cross-origin POST with 403 CSRF', async () => {
    await request(app.getHttpServer()).get(`/api/v1/transactions/${txId}`).expect(401);

    const accessToken = await authJwtService.signAccessToken(userId, sessionId);
    await request(app.getHttpServer())
      .post('/api/v1/transactions')
      .set('Origin', 'http://evil.example.com')
      .set('Cookie', [`mf_access_token=${accessToken}`])
      .send({
        type: 'INCOME',
        fundId,
        amount: '100.00',
        description: 'Sueldo',
        categoryId: catId1,
      })
      .expect(403);

    expect(coreTcpClientMock.send).not.toHaveBeenCalled();
  });

  it('rejects injected userId, invalid amounts, non-string notes, and invalid Gregorian date 2026-02-31 with 400', async () => {
    const accessToken = await authJwtService.signAccessToken(userId, sessionId);

    const invalidPayloads: Array<Record<string, unknown>> = [
      {
        type: 'INCOME',
        fundId,
        amount: '100.00',
        description: 'Sueldo',
        categoryId: catId1,
        userId: '99999999-9999-4999-8999-999999999999',
      },
      {
        type: 'EXPENSE',
        fundId,
        amount: '0.00',
        description: 'Cero',
        categoryId: catId1,
      },
      {
        type: 'EXPENSE',
        fundId,
        amount: '-15.00',
        description: 'Negativo',
        categoryId: catId1,
      },
      {
        type: 'EXPENSE',
        fundId,
        amount: '10.123',
        description: 'Tres decimales',
        categoryId: catId1,
      },
      {
        type: 'EXPENSE',
        fundId,
        amount: '50.00',
        occurredOn: '2026-02-31',
        description: 'Fecha imposible',
        categoryId: catId1,
      },
      {
        type: 'EXPENSE',
        fundId,
        amount: '50.00',
        description: 'Nota numérica',
        notes: 12345,
        categoryId: catId1,
      },
    ];

    for (const body of invalidPayloads) {
      await request(app.getHttpServer())
        .post('/api/v1/transactions')
        .set('Origin', 'http://localhost:3001')
        .set('Cookie', [`mf_access_token=${accessToken}`])
        .send(body)
        .expect(400);
    }

    expect(coreTcpClientMock.send).not.toHaveBeenCalled();
  });

  it('enforces categoryId XOR splits, splits count bounds (2..50), non-string split note, and exact Decimal sum', async () => {
    const accessToken = await authJwtService.signAccessToken(userId, sessionId);

    const tooManySplits = Array.from({ length: 51 }, () => ({
      categoryId: catId1,
      amount: '1.00',
    }));

    const invalidBodies: Array<Record<string, unknown>> = [
      // Neither categoryId nor splits
      {
        type: 'EXPENSE',
        fundId,
        amount: '100.00',
        description: 'Sin categoría',
      },
      // Both categoryId and splits
      {
        type: 'EXPENSE',
        fundId,
        amount: '100.00',
        description: 'Ambos',
        categoryId: catId1,
        splits: [
          { categoryId: catId1, amount: '60.00' },
          { categoryId: catId2, amount: '40.00' },
        ],
      },
      // Fewer than 2 splits
      {
        type: 'EXPENSE',
        fundId,
        amount: '100.00',
        description: 'Un solo split',
        splits: [{ categoryId: catId1, amount: '100.00' }],
      },
      // More than 50 splits
      {
        type: 'EXPENSE',
        fundId,
        amount: '51.00',
        description: 'Demasiados splits',
        splits: tooManySplits,
      },
      // Off by 0.01
      {
        type: 'EXPENSE',
        fundId,
        amount: '100.00',
        description: 'Descuadre 0.01',
        splits: [
          { categoryId: catId1, amount: '33.33' },
          { categoryId: catId2, amount: '33.33' },
          { categoryId: catId1, amount: '33.33' },
        ],
      },
      // Non-string split note
      {
        type: 'EXPENSE',
        fundId,
        amount: '100.00',
        description: 'Nota objeto',
        splits: [
          { categoryId: catId1, amount: '60.00', note: { bad: true } },
          { categoryId: catId2, amount: '40.00' },
        ],
      },
    ];

    for (const body of invalidBodies) {
      await request(app.getHttpServer())
        .post('/api/v1/transactions')
        .set('Origin', 'http://localhost:3001')
        .set('Cookie', [`mf_access_token=${accessToken}`])
        .send(body)
        .expect(400);
    }

    expect(coreTcpClientMock.send).not.toHaveBeenCalled();
  });

  it('validates Idempotency-Key header bounds and forwards valid INCOME and split EXPENSE transactions', async () => {
    const accessToken = await authJwtService.signAccessToken(userId, sessionId);
    coreTcpClientMock.send.mockResolvedValue({
      transaction: { id: txId },
      fundBalanceAfter: '380.00',
    });

    await request(app.getHttpServer())
      .post('/api/v1/transactions')
      .set('Origin', 'http://localhost:3001')
      .set('Cookie', [`mf_access_token=${accessToken}`])
      .set('Idempotency-Key', '   ')
      .send({
        type: 'INCOME',
        fundId,
        amount: '100.00',
        description: 'Bono',
        categoryId: catId1,
      })
      .expect(400);

    await request(app.getHttpServer())
      .post('/api/v1/transactions')
      .set('Origin', 'http://localhost:3001')
      .set('Cookie', [`mf_access_token=${accessToken}`])
      .set('Idempotency-Key', 'k'.repeat(129))
      .send({
        type: 'INCOME',
        fundId,
        amount: '100.00',
        description: 'Bono',
        categoryId: catId1,
      })
      .expect(400);

    await request(app.getHttpServer())
      .post('/api/v1/transactions')
      .set('Origin', 'http://localhost:3001')
      .set('Cookie', [`mf_access_token=${accessToken}`])
      .set('Idempotency-Key', '  key-123  ')
      .send({
        type: 'EXPENSE',
        fundId,
        amount: '120.00',
        occurredOn: '2026-11-22',
        description: '  Supermercado  ',
        notes: '   ',
        splits: [
          { categoryId: catId1, amount: '80.00', note: ' Alimentos ' },
          { categoryId: catId2, amount: '40.00', note: '   ' },
        ],
      })
      .expect(201);

    expect(coreTcpClientMock.send).toHaveBeenCalledWith(
      LEDGER_PATTERNS.RECORD_TRANSACTION,
      {
        type: 'EXPENSE',
        fundId,
        amount: '120.00',
        occurredOn: '2026-11-22',
        description: 'Supermercado',
        notes: null,
        splits: [
          { categoryId: catId1, amount: '80.00', note: 'Alimentos' },
          { categoryId: catId2, amount: '40.00', note: null },
        ],
        idempotencyKey: 'key-123',
      },
      { requestId: 'req-ledger-1', userId },
    );
  });

  it('validates :id with ParseUUIDPipe on GET /api/v1/transactions/:id', async () => {
    const accessToken = await authJwtService.signAccessToken(userId, sessionId);
    coreTcpClientMock.send.mockResolvedValue({ transaction: { id: txId } });

    await request(app.getHttpServer())
      .get('/api/v1/transactions/not-a-uuid')
      .set('Cookie', [`mf_access_token=${accessToken}`])
      .expect(400);

    await request(app.getHttpServer())
      .get(`/api/v1/transactions/${txId}`)
      .set('Cookie', [`mf_access_token=${accessToken}`])
      .expect(200);

    expect(coreTcpClientMock.send).toHaveBeenCalledWith(
      LEDGER_PATTERNS.GET_BY_ID,
      { id: txId },
      { requestId: 'req-ledger-1', userId },
    );
  });

  it('validates POST /api/v1/transactions/transfers (same fund, invalid date/amount/notes/key) and forwards valid transfer', async () => {
    const accessToken = await authJwtService.signAccessToken(userId, sessionId);
    const destFundId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
    coreTcpClientMock.send.mockResolvedValue({
      transaction: { id: txId, type: 'TRANSFER' },
      sourceFundBalanceAfter: '350.00',
      destinationFundBalanceAfter: '350.00',
    });

    const invalidBodies: Array<Record<string, unknown>> = [
      {
        sourceFundId: fundId,
        destinationFundId: fundId.toUpperCase(),
        amount: '100.00',
        description: 'Mismo fondo',
      },
      {
        sourceFundId: fundId,
        destinationFundId: destFundId,
        amount: '0.00',
        description: 'Monto cero',
      },
      {
        sourceFundId: fundId,
        destinationFundId: destFundId,
        amount: '100.00',
        occurredOn: '2026-02-31',
        description: 'Fecha inválida',
      },
      {
        sourceFundId: fundId,
        destinationFundId: destFundId,
        amount: '100.00',
        description: 'User inyectado',
        userId: '99999999-9999-4999-8999-999999999999',
      },
      {
        sourceFundId: fundId,
        destinationFundId: destFundId,
        amount: '100.00',
        description: 'Notas no string',
        notes: 99,
      },
    ];

    for (const body of invalidBodies) {
      await request(app.getHttpServer())
        .post('/api/v1/transactions/transfers')
        .set('Origin', 'http://localhost:3001')
        .set('Cookie', [`mf_access_token=${accessToken}`])
        .send(body)
        .expect(400);
    }

    await request(app.getHttpServer())
      .post('/api/v1/transactions/transfers')
      .set('Origin', 'http://localhost:3001')
      .set('Cookie', [`mf_access_token=${accessToken}`])
      .set('Idempotency-Key', '   ')
      .send({
        sourceFundId: fundId,
        destinationFundId: destFundId,
        amount: '150.00',
        description: 'Traspaso',
      })
      .expect(400);

    await request(app.getHttpServer())
      .post('/api/v1/transactions/transfers')
      .set('Origin', 'http://localhost:3001')
      .set('Cookie', [`mf_access_token=${accessToken}`])
      .set('Idempotency-Key', '  transfer-key-1  ')
      .send({
        sourceFundId: fundId,
        destinationFundId: destFundId,
        amount: '150.00',
        occurredOn: '2026-11-22',
        description: '  Traspaso a ahorros  ',
        notes: '   ',
      })
      .expect(201);

    expect(coreTcpClientMock.send).toHaveBeenCalledWith(
      LEDGER_PATTERNS.RECORD_TRANSFER,
      {
        sourceFundId: fundId,
        destinationFundId: destFundId,
        amount: '150.00',
        occurredOn: '2026-11-22',
        description: 'Traspaso a ahorros',
        notes: null,
        idempotencyKey: 'transfer-key-1',
      },
      { requestId: 'req-ledger-1', userId },
    );
  });

  it('validates POST /api/v1/transactions/adjustments and forwards valid INCREASE/DECREASE adjustment', async () => {
    const accessToken = await authJwtService.signAccessToken(userId, sessionId);
    coreTcpClientMock.send.mockResolvedValue({
      transaction: { id: txId, type: 'ADJUSTMENT' },
      fundBalanceAfter: '145.25',
    });

    const invalidBodies: Array<Record<string, unknown>> = [
      {
        fundId,
        direction: 'INVALID',
        amount: '45.25',
        description: 'Dirección inválida',
      },
      {
        fundId,
        direction: 'DECREASE',
        amount: '-10.00',
        description: 'Monto negativo',
      },
      {
        fundId,
        direction: 'INCREASE',
        amount: '45.25',
        occurredOn: '2026-02-31',
        description: 'Fecha inválida',
      },
      {
        fundId,
        direction: 'INCREASE',
        amount: '45.25',
        description: 'Campo extra',
        userId: '99999999-9999-4999-8999-999999999999',
      },
    ];

    for (const body of invalidBodies) {
      await request(app.getHttpServer())
        .post('/api/v1/transactions/adjustments')
        .set('Origin', 'http://localhost:3001')
        .set('Cookie', [`mf_access_token=${accessToken}`])
        .send(body)
        .expect(400);
    }

    await request(app.getHttpServer())
      .post('/api/v1/transactions/adjustments')
      .set('Origin', 'http://localhost:3001')
      .set('Cookie', [`mf_access_token=${accessToken}`])
      .set('Idempotency-Key', 'adj-key-1')
      .send({
        fundId,
        direction: 'INCREASE',
        amount: '45.25',
        description: '  Arqueo de caja  ',
        notes: '  Sobrante  ',
      })
      .expect(201);

    expect(coreTcpClientMock.send).toHaveBeenCalledWith(
      LEDGER_PATTERNS.RECORD_ADJUSTMENT,
      {
        fundId,
        direction: 'INCREASE',
        amount: '45.25',
        description: 'Arqueo de caja',
        notes: 'Sobrante',
        idempotencyKey: 'adj-key-1',
      },
      { requestId: 'req-ledger-1', userId },
    );
  });
});
