import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);
  const logger = new Logger('ApiGatewayBootstrap');

  app.use(cookieParser());
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());

  const corsOrigin = configService.get<string>('CORS_ORIGIN', 'http://localhost:3001');
  app.enableCors({
    origin: corsOrigin,
    credentials: true,
  });

  const port = Number(configService.get<string>('GATEWAY_PORT', '3000'));
  await app.listen(port);
  logger.log(`API Gateway listening on port ${port}`);
}

void bootstrap();
