import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { CoreTcpModule } from '../core-client/core-tcp.module';
import { AuthCookiesService } from './auth-cookies.service';
import { AuthController } from './auth.controller';
import { AuthJwtService } from './auth-jwt.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

@Module({
  imports: [
    CoreTcpModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const secret = configService.get<string>('JWT_SECRET');
        if (typeof secret !== 'string' || secret.trim().length === 0) {
          throw new Error('JWT_SECRET must be configured in api-gateway');
        }
        return {
          secret,
          signOptions: {
            expiresIn: 900,
          },
        };
      },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthCookiesService, AuthJwtService, JwtAuthGuard],
  exports: [AuthCookiesService, AuthJwtService, JwtAuthGuard],
})
export class AuthModule {}
