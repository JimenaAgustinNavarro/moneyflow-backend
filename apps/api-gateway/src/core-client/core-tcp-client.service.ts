import { randomUUID } from 'node:crypto';
import {
  HttpException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClientProxy } from '@nestjs/microservices';
import { AuthAuditMetadata, wrapSignedTcpPayload } from '@app/shared';
import { Request } from 'express';
import { catchError, firstValueFrom, timeout } from 'rxjs';

export const CORE_SERVICE_CLIENT = 'CORE_SERVICE_CLIENT';
const DEFAULT_TCP_TIMEOUT_MS = 5_000;
const PRINTABLE_ASCII_REQUEST_ID_REGEX = /^[\x21-\x7E]{1,128}$/;
const MAX_IP_LENGTH = 64;
const MAX_USER_AGENT_LENGTH = 512;

export interface CoreTcpRequestContext {
  requestId: string;
  userId: string | null;
  audit: AuthAuditMetadata;
}

interface StructuredRpcError {
  statusCode: number;
  error?: string;
  code?: string;
  message: string | string[];
}

function isStructuredRpcError(candidate: unknown): candidate is StructuredRpcError {
  if (typeof candidate !== 'object' || candidate === null) {
    return false;
  }

  const record = candidate as Record<string, unknown>;
  const hasValidStatus =
    typeof record.statusCode === 'number' &&
    Number.isInteger(record.statusCode) &&
    record.statusCode >= 400 &&
    record.statusCode <= 599;
  const hasValidMessage = typeof record.message === 'string' || Array.isArray(record.message);
  const hasValidCode = record.code === undefined || typeof record.code === 'string';

  return hasValidStatus && hasValidMessage && hasValidCode;
}

function extractRpcErrorPayload(error: unknown): StructuredRpcError | null {
  if (isStructuredRpcError(error)) {
    return error;
  }

  if (typeof error === 'object' && error !== null && 'error' in error) {
    const nested = (error as { error?: unknown }).error;
    if (isStructuredRpcError(nested)) {
      return nested;
    }
  }

  return null;
}

function extractClientIp(request: Request): string | null {
  const forwardedFor = request.headers['x-forwarded-for'];
  const rawForwarded = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor;
  const candidate =
    typeof rawForwarded === 'string' && rawForwarded.trim().length > 0
      ? rawForwarded.split(',')[0].trim()
      : (request.ip ?? request.socket?.remoteAddress ?? '');

  const normalized = candidate.trim();
  if (normalized.length === 0) {
    return null;
  }

  return normalized.slice(0, MAX_IP_LENGTH);
}

function extractUserAgent(request: Request): string | null {
  const candidate = request.headers['user-agent'];
  if (typeof candidate !== 'string') {
    return null;
  }

  const trimmed = candidate.trim();
  if (trimmed.length === 0) {
    return null;
  }

  return trimmed.slice(0, MAX_USER_AGENT_LENGTH);
}

function extractRequestId(request: Request): string {
  const rawHeader = request.headers['x-request-id'];
  const candidate = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
  if (typeof candidate === 'string') {
    const trimmed = candidate.trim();
    if (PRINTABLE_ASCII_REQUEST_ID_REGEX.test(trimmed)) {
      return trimmed;
    }
  }

  return randomUUID();
}

@Injectable()
export class CoreTcpClientService {
  private readonly logger = new Logger(CoreTcpClientService.name);

  constructor(
    @Inject(CORE_SERVICE_CLIENT)
    private readonly coreClient: ClientProxy,
    private readonly configService: ConfigService,
  ) {}

  buildRequestContext(request: Request, userId: string | null = null): CoreTcpRequestContext {
    return {
      requestId: extractRequestId(request),
      userId,
      audit: {
        ipAddress: extractClientIp(request),
        userAgent: extractUserAgent(request),
      },
    };
  }

  async send<TResponse, TPayload>(
    pattern: string,
    payload: TPayload,
    options: { requestId: string; userId: string | null },
  ): Promise<TResponse> {
    const secret = this.configService.get<string>('INTERNAL_TCP_SECRET');
    if (typeof secret !== 'string' || secret.trim().length === 0) {
      this.logger.error('INTERNAL_TCP_SECRET is missing in api-gateway');
      throw new InternalServerErrorException('Internal server error');
    }

    const envelope = wrapSignedTcpPayload(
      payload,
      {
        requestId: options.requestId,
        userId: options.userId,
      },
      secret,
    );

    return firstValueFrom(
      this.coreClient.send<TResponse>(pattern, envelope).pipe(
        timeout(DEFAULT_TCP_TIMEOUT_MS),
        catchError((error: unknown) => {
          const rpcError = extractRpcErrorPayload(error);
          if (rpcError) {
            if (rpcError.statusCode >= 500) {
              throw new InternalServerErrorException('Internal server error');
            }

            throw new HttpException(
              {
                statusCode: rpcError.statusCode,
                error: rpcError.error ?? 'Error',
                ...(rpcError.code ? { code: rpcError.code } : {}),
                message: rpcError.message,
              },
              rpcError.statusCode,
            );
          }

          this.logger.error(`Core TCP request failed for pattern=${pattern}`);
          throw new ServiceUnavailableException('Core service is unavailable');
        }),
      ),
    );
  }
}
