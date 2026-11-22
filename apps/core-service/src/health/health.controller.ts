import { Controller } from '@nestjs/common';
import { MessagePattern } from '@nestjs/microservices';
import { CORE_PATTERNS, CoreHealthResponse } from '@app/shared';
import { PrismaService } from '../prisma/prisma.service';

@Controller()
export class HealthController {
  constructor(private readonly prismaService: PrismaService) {}

  @MessagePattern(CORE_PATTERNS.HEALTH_CHECK)
  async check(): Promise<CoreHealthResponse> {
    const dbUp = await this.prismaService.ping();

    return {
      status: dbUp ? 'ok' : 'error',
      service: 'core-service',
      database: dbUp ? 'up' : 'down',
      timestamp: new Date().toISOString(),
    };
  }
}
