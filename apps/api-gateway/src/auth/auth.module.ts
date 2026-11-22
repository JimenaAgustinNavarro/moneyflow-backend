import { Module } from '@nestjs/common';
import { CoreTcpModule } from '../core-client/core-tcp.module';
import { AuthController } from './auth.controller';

@Module({
  imports: [CoreTcpModule],
  controllers: [AuthController],
})
export class AuthModule {}
