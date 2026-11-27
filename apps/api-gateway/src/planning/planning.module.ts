import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CoreTcpModule } from '../core-client/core-tcp.module';
import { PlanningController } from './planning.controller';

@Module({
  imports: [CoreTcpModule, AuthModule],
  controllers: [PlanningController],
})
export class PlanningModule {}
