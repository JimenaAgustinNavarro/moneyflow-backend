import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { CORE_PATTERNS } from '@app/shared';
import { of, throwError } from 'rxjs';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AllExceptionsFilter } from '../common/filters/all-exceptions.filter';
import { CORE_SERVICE_CLIENT, HealthController } from './health.controller';

describe('HealthController (HTTP boundary)', () => {
  let app: INestApplication<App>;
  const mockCoreClient = {
    send: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        {
          provide: CORE_SERVICE_CLIENT,
          useValue: mockCoreClient,
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

  it('GET /api/v1/health returns 200 OK when core-service and database are up', async () => {
    mockCoreClient.send.mockReturnValueOnce(
      of({
        status: 'ok',
        service: 'core-service',
        database: 'up',
        timestamp: '2026-11-21T23:00:00.000Z',
      }),
    );

    const response = await request(app.getHttpServer()).get('/api/v1/health').expect(200);

    expect(mockCoreClient.send).toHaveBeenCalledWith(CORE_PATTERNS.HEALTH_CHECK, {});
    expect(response.body).toMatchObject({
      status: 'ok',
      gateway: 'up',
      coreService: 'up',
      database: 'up',
    });
  });

  it('GET /api/v1/health returns 503 without stack trace when core-service TCP fails', async () => {
    mockCoreClient.send.mockReturnValueOnce(
      throwError(() => new Error('ECONNREFUSED 127.0.0.1:3002')),
    );

    const response = await request(app.getHttpServer()).get('/api/v1/health').expect(503);

    expect(response.body).toMatchObject({
      statusCode: 503,
      message: 'Core service or database is unavailable',
      path: '/api/v1/health',
    });
    expect(response.body).not.toHaveProperty('stack');
  });

  it('GET /api/v1/health returns 503 when database is down', async () => {
    mockCoreClient.send.mockReturnValueOnce(
      of({
        status: 'error',
        service: 'core-service',
        database: 'down',
        timestamp: '2026-11-21T23:00:00.000Z',
      }),
    );

    const response = await request(app.getHttpServer()).get('/api/v1/health').expect(503);

    expect(response.body).toMatchObject({
      statusCode: 503,
      message: 'Core service or database is unavailable',
    });
  });

  it('GET /api/v1/health?unexpected=1 returns 400 Bad Request due to ValidationPipe forbidNonWhitelisted', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/health?unexpected=1')
      .expect(400);

    expect(response.body).toMatchObject({
      statusCode: 400,
      path: '/api/v1/health?unexpected=1',
    });
    expect(mockCoreClient.send).not.toHaveBeenCalled();
  });
});
