import { Controller, Get, Inject, Query, ServiceUnavailableException } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { SkipThrottle } from '@nestjs/throttler';
import { CORE_PATTERNS, CoreHealthResponse, GatewayHealthResponse } from '@app/shared';
import { catchError, firstValueFrom, timeout } from 'rxjs';
import { HealthQueryDto } from './dto/health-query.dto';

export const CORE_SERVICE_CLIENT = 'CORE_SERVICE_CLIENT';
const HEALTH_TCP_TIMEOUT_MS = 3000;

@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(
    @Inject(CORE_SERVICE_CLIENT)
    private readonly coreClient: ClientProxy,
  ) {}

  @Get()
  async check(@Query() _query: HealthQueryDto): Promise<GatewayHealthResponse> {
    const coreHealth = await firstValueFrom(
      this.coreClient.send<CoreHealthResponse>(CORE_PATTERNS.HEALTH_CHECK, {}).pipe(
        timeout(HEALTH_TCP_TIMEOUT_MS),
        catchError(() => {
          throw new ServiceUnavailableException('Core service or database is unavailable');
        }),
      ),
    );

    if (coreHealth.status !== 'ok' || coreHealth.database !== 'up') {
      throw new ServiceUnavailableException('Core service or database is unavailable');
    }

    return {
      status: 'ok',
      gateway: 'up',
      coreService: 'up',
      database: coreHealth.database,
      timestamp: new Date().toISOString(),
    };
  }
}
