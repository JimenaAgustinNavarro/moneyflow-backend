import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { CORE_SERVICE_CLIENT, CoreTcpClientService } from './core-tcp-client.service';

@Module({
  imports: [
    ClientsModule.registerAsync([
      {
        name: CORE_SERVICE_CLIENT,
        inject: [ConfigService],
        useFactory: (configService: ConfigService) => ({
          transport: Transport.TCP,
          options: {
            host: configService.get<string>('CORE_TCP_HOST', '127.0.0.1'),
            port: Number(configService.get<string>('CORE_TCP_PORT', '3002')),
          },
        }),
      },
    ]),
  ],
  providers: [CoreTcpClientService],
  exports: [CoreTcpClientService],
})
export class CoreTcpModule {}
