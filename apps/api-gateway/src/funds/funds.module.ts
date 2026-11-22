import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CoreTcpModule } from '../core-client/core-tcp.module';
import { FundsController } from './funds.controller';

@Module({
  imports: [CoreTcpModule, AuthModule],
  controllers: [FundsController],
})
export class FundsModule {}
