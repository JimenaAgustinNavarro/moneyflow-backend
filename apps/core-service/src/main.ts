import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const logger = new Logger('CoreServiceBootstrap');
  const host = process.env.CORE_TCP_HOST ?? '127.0.0.1';
  const port = Number(process.env.CORE_TCP_PORT ?? '3002');

  const app = await NestFactory.createMicroservice<MicroserviceOptions>(AppModule, {
    transport: Transport.TCP,
    options: {
      host,
      port,
    },
  });

  app.enableShutdownHooks();
  await app.listen();
  logger.log(`Core Service TCP listening on ${host}:${port}`);
}

void bootstrap();
