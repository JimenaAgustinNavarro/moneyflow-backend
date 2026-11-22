import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { HealthController } from './health.controller';

describe('HealthController (core-service TCP)', () => {
  let controller: HealthController;
  const mockPrismaService = {
    ping: jest.fn<Promise<boolean>, []>(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
      ],
    }).compile();

    controller = moduleRef.get(HealthController);
  });

  it('returns status ok and database up when PostgreSQL responds', async () => {
    mockPrismaService.ping.mockResolvedValueOnce(true);

    const result = await controller.check();

    expect(result).toMatchObject({
      status: 'ok',
      service: 'core-service',
      database: 'up',
    });
    expect(typeof result.timestamp).toBe('string');
  });

  it('returns status error and database down when PostgreSQL fails', async () => {
    mockPrismaService.ping.mockResolvedValueOnce(false);

    const result = await controller.check();

    expect(result).toMatchObject({
      status: 'error',
      service: 'core-service',
      database: 'down',
    });
  });
});
