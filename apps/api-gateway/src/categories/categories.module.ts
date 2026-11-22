import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CoreTcpModule } from '../core-client/core-tcp.module';
import { CategoriesController } from './categories.controller';

@Module({
  imports: [CoreTcpModule, AuthModule],
  controllers: [CategoriesController],
})
export class CategoriesModule {}
