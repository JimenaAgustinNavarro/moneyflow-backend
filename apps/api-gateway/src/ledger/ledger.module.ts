import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CoreTcpModule } from '../core-client/core-tcp.module';
import { LedgerController } from './ledger.controller';

@Module({
  imports: [CoreTcpModule, AuthModule],
  controllers: [LedgerController],
})
export class LedgerModule {}
