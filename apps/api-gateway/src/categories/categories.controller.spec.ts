import { HttpException, HttpStatus, INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { CATEGORIES_PATTERNS } from '@app/shared';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AuthCookiesService } from '../auth/auth-cookies.service';
import { AuthJwtService } from '../auth/auth-jwt.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AllExceptionsFilter } from '../common/filters/all-exceptions.filter';
import { OriginCsrfGuard } from '../common/guards/origin-csrf.guard';
import { CoreTcpClientService } from '../core-client/core-tcp-client.service';
import { CategoriesController } from './categories.controller';

describe('CategoriesController (HTTP boundary)', () => {
  const jwtSecret = 'test-gateway-jwt-secret-minimum-32-chars';
  const userId = '11111111-1111-4111-8111-111111111111';
  const sessionId = '22222222-2222-4222-8222-222222222222';
  const validCategoryId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

  let app: INestApplication<App>;
  let authJwtService: AuthJwtService;
  let authCookie: string;
  let coreTcpClientMock: {
    buildRequestContext: jest.Mock;
    send: jest.Mock;
  };

  beforeEach(async () => {
    coreTcpClientMock = {
      buildRequestContext: jest.fn((_req: unknown, authenticatedUserId: string | null = null) => ({
        requestId: 'req-cat-gw-1',
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
      controllers: [CategoriesController],
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

    const token = await authJwtService.signAccessToken(userId, sessionId);
    authCookie = `mf_access_token=${token}`;
  });

  afterEach(async () => {
    await app.close();
  });

  describe('GET /api/v1/categories', () => {
    it('returns 401 when authentication cookie is missing', async () => {
      await request(app.getHttpServer()).get('/api/v1/categories').expect(HttpStatus.UNAUTHORIZED);
    });

    it('returns 200 and lists categories with default query params', async () => {
      const mockResult = {
        categories: [
          {
            id: 'sys-1',
            userId: null,
            name: 'Alimentación',
            kind: 'EXPENSE',
            color: '#EA580C',
            icon: 'utensils',
            isSystem: true,
            isArchived: false,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        ],
      };
      coreTcpClientMock.send.mockResolvedValue(mockResult);

      const response = await request(app.getHttpServer())
        .get('/api/v1/categories')
        .set('Cookie', authCookie)
        .expect(HttpStatus.OK);

      expect(coreTcpClientMock.send).toHaveBeenCalledWith(
        CATEGORIES_PATTERNS.LIST,
        {},
        expect.objectContaining({ userId }),
      );
      expect(response.body).toEqual(mockResult);
    });

    it('correctly transforms and parses includeArchived=false and includeArchived=true', async () => {
      coreTcpClientMock.send.mockResolvedValue({ categories: [] });

      await request(app.getHttpServer())
        .get('/api/v1/categories?includeArchived=false&kind=INCOME')
        .set('Cookie', authCookie)
        .expect(HttpStatus.OK);

      expect(coreTcpClientMock.send).toHaveBeenCalledWith(
        CATEGORIES_PATTERNS.LIST,
        { includeArchived: false, kind: 'INCOME' },
        expect.objectContaining({ userId }),
      );

      await request(app.getHttpServer())
        .get('/api/v1/categories?includeArchived=true')
        .set('Cookie', authCookie)
        .expect(HttpStatus.OK);

      expect(coreTcpClientMock.send).toHaveBeenCalledWith(
        CATEGORIES_PATTERNS.LIST,
        { includeArchived: true },
        expect.objectContaining({ userId }),
      );
    });

    it('returns 400 when includeArchived is not a valid boolean string (includeArchived=invalid)', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/categories?includeArchived=invalid')
        .set('Cookie', authCookie)
        .expect(HttpStatus.BAD_REQUEST);

      expect(response.body).toEqual(
        expect.objectContaining({
          statusCode: 400,
          error: 'Bad Request',
        }),
      );
      const errorBody = response.body as { message: string[] };
      expect(errorBody.message).toContain(
        'includeArchived must be a boolean string (true or false)',
      );
    });

    it('returns 400 when unexpected query params are injected', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/categories?unexpected=1')
        .set('Cookie', authCookie)
        .expect(HttpStatus.BAD_REQUEST);
    });
  });

  describe('POST /api/v1/categories', () => {
    it('creates category with 201 on valid input', async () => {
      const mockCreated = {
        category: {
          id: validCategoryId,
          userId,
          name: 'Gimnasio',
          kind: 'EXPENSE',
          color: '#0284C7',
          icon: 'dumbbell',
          isSystem: false,
          isArchived: false,
          createdAt: '2026-02-01T00:00:00.000Z',
          updatedAt: '2026-02-01T00:00:00.000Z',
        },
      };
      coreTcpClientMock.send.mockResolvedValue(mockCreated);

      const response = await request(app.getHttpServer())
        .post('/api/v1/categories')
        .set('Cookie', authCookie)
        .send({
          name: '  Gimnasio  ',
          kind: 'EXPENSE',
          color: '#0284C7',
          icon: 'dumbbell',
        })
        .expect(HttpStatus.CREATED);

      expect(coreTcpClientMock.send).toHaveBeenCalledWith(
        CATEGORIES_PATTERNS.CREATE,
        {
          name: 'Gimnasio',
          kind: 'EXPENSE',
          color: '#0284C7',
          icon: 'dumbbell',
        },
        expect.objectContaining({ userId }),
      );
      expect(response.body).toEqual(mockCreated);
    });

    it('returns 400 when userId or isSystem are injected in body', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/categories')
        .set('Cookie', authCookie)
        .send({
          name: 'Hacking',
          kind: 'EXPENSE',
          userId: '00000000-0000-0000-0000-000000000000',
          isSystem: true,
        })
        .expect(HttpStatus.BAD_REQUEST);
    });

    it('returns 400 when name or icon are empty after trim ("   ")', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/categories')
        .set('Cookie', authCookie)
        .send({
          name: '   ',
          kind: 'EXPENSE',
        })
        .expect(HttpStatus.BAD_REQUEST);

      await request(app.getHttpServer())
        .post('/api/v1/categories')
        .set('Cookie', authCookie)
        .send({
          name: 'Valid Name',
          kind: 'EXPENSE',
          icon: '   ',
        })
        .expect(HttpStatus.BAD_REQUEST);
    });

    it('returns 400 when color is not a valid hex #RRGGBB', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/categories')
        .set('Cookie', authCookie)
        .send({
          name: 'Inversiones',
          kind: 'INCOME',
          color: 'blue',
        })
        .expect(HttpStatus.BAD_REQUEST);
    });

    it('propagates 409 Conflict when core service throws conflict', async () => {
      coreTcpClientMock.send.mockRejectedValue(
        new HttpException(
          {
            statusCode: 409,
            error: 'Conflict',
            message: 'A category with this name and kind already exists',
          },
          HttpStatus.CONFLICT,
        ),
      );

      const response = await request(app.getHttpServer())
        .post('/api/v1/categories')
        .set('Cookie', authCookie)
        .send({
          name: 'Alimentación',
          kind: 'EXPENSE',
        })
        .expect(HttpStatus.CONFLICT);

      expect(response.body).toEqual(
        expect.objectContaining({
          message: 'A category with this name and kind already exists',
        }),
      );
    });
  });

  describe('PATCH /api/v1/categories/:id', () => {
    it('returns 400 when :id is not a valid UUID', async () => {
      await request(app.getHttpServer())
        .patch('/api/v1/categories/not-a-uuid')
        .set('Cookie', authCookie)
        .send({ name: 'Nuevo Nombre' })
        .expect(HttpStatus.BAD_REQUEST);
    });

    it('returns 400 when body is empty {}', async () => {
      const response = await request(app.getHttpServer())
        .patch(`/api/v1/categories/${validCategoryId}`)
        .set('Cookie', authCookie)
        .send({})
        .expect(HttpStatus.BAD_REQUEST);

      expect(response.body).toEqual(
        expect.objectContaining({
          statusCode: 400,
          error: 'Bad Request',
          message: 'At least one field (name, color, or icon) must be provided for update',
        }),
      );
    });

    it('returns 400 when kind or isSystem are sent in body', async () => {
      await request(app.getHttpServer())
        .patch(`/api/v1/categories/${validCategoryId}`)
        .set('Cookie', authCookie)
        .send({ kind: 'INCOME' })
        .expect(HttpStatus.BAD_REQUEST);
    });

    it('returns 200 and allows updating color and icon to null', async () => {
      const mockUpdated = {
        category: {
          id: validCategoryId,
          userId,
          name: 'Gimnasio Pro',
          kind: 'EXPENSE',
          color: null,
          icon: null,
          isSystem: false,
          isArchived: false,
          createdAt: '2026-02-01T00:00:00.000Z',
          updatedAt: '2026-02-01T01:00:00.000Z',
        },
      };
      coreTcpClientMock.send.mockResolvedValue(mockUpdated);

      const response = await request(app.getHttpServer())
        .patch(`/api/v1/categories/${validCategoryId}`)
        .set('Cookie', authCookie)
        .send({
          name: 'Gimnasio Pro',
          color: null,
          icon: null,
        })
        .expect(HttpStatus.OK);

      expect(coreTcpClientMock.send).toHaveBeenCalledWith(
        CATEGORIES_PATTERNS.UPDATE,
        {
          id: validCategoryId,
          name: 'Gimnasio Pro',
          color: null,
          icon: null,
        },
        expect.objectContaining({ userId }),
      );
      expect(response.body).toEqual(mockUpdated);
    });

    it('propagates 403 when updating a system category', async () => {
      coreTcpClientMock.send.mockRejectedValue(
        new HttpException(
          {
            statusCode: 403,
            error: 'Forbidden',
            message: 'System categories cannot be modified',
          },
          HttpStatus.FORBIDDEN,
        ),
      );

      await request(app.getHttpServer())
        .patch(`/api/v1/categories/${validCategoryId}`)
        .set('Cookie', authCookie)
        .send({ name: 'Alimentación Modificada' })
        .expect(HttpStatus.FORBIDDEN);
    });

    it('propagates 404 when category is not found or belongs to another user', async () => {
      coreTcpClientMock.send.mockRejectedValue(
        new HttpException(
          {
            statusCode: 404,
            error: 'Not Found',
            message: 'Category not found',
          },
          HttpStatus.NOT_FOUND,
        ),
      );

      await request(app.getHttpServer())
        .patch(`/api/v1/categories/${validCategoryId}`)
        .set('Cookie', authCookie)
        .send({ name: 'Nombre' })
        .expect(HttpStatus.NOT_FOUND);
    });
  });

  describe('DELETE /api/v1/categories/:id', () => {
    it('returns 400 when :id is not a valid UUID', async () => {
      await request(app.getHttpServer())
        .delete('/api/v1/categories/not-a-uuid')
        .set('Cookie', authCookie)
        .expect(HttpStatus.BAD_REQUEST);
    });

    it('returns 200 and archives category', async () => {
      coreTcpClientMock.send.mockResolvedValue({
        id: validCategoryId,
        isArchived: true,
        message: 'Category archived successfully.',
      });

      const response = await request(app.getHttpServer())
        .delete(`/api/v1/categories/${validCategoryId}`)
        .set('Cookie', authCookie)
        .expect(HttpStatus.OK);

      expect(coreTcpClientMock.send).toHaveBeenCalledWith(
        CATEGORIES_PATTERNS.ARCHIVE,
        { id: validCategoryId },
        expect.objectContaining({ userId }),
      );
      expect(response.body).toEqual(
        expect.objectContaining({
          isArchived: true,
        }),
      );
    });
  });

  describe('POST /api/v1/categories/:id/unarchive', () => {
    it('returns 400 when :id is not a valid UUID', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/categories/not-a-uuid/unarchive')
        .set('Cookie', authCookie)
        .expect(HttpStatus.BAD_REQUEST);
    });

    it('returns 200 and unarchives category', async () => {
      coreTcpClientMock.send.mockResolvedValue({
        id: validCategoryId,
        isArchived: false,
        message: 'Category unarchived successfully.',
      });

      const response = await request(app.getHttpServer())
        .post(`/api/v1/categories/${validCategoryId}/unarchive`)
        .set('Cookie', authCookie)
        .expect(HttpStatus.OK);

      expect(coreTcpClientMock.send).toHaveBeenCalledWith(
        CATEGORIES_PATTERNS.UNARCHIVE,
        { id: validCategoryId },
        expect.objectContaining({ userId }),
      );
      expect(response.body).toEqual(
        expect.objectContaining({
          isArchived: false,
        }),
      );
    });
  });
});
