import { CanActivate, ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { RpcException } from '@nestjs/microservices';
import { InternalAuthContext, verifyInternalAuthContext } from '@app/shared';
import { IS_PUBLIC_INTERNAL_KEY } from '../decorators/public-internal.decorator';

export const VERIFIED_INTERNAL_CONTEXT_SYMBOL = Symbol('VERIFIED_INTERNAL_CONTEXT');

export type RpcDataWithVerifiedContext = Record<string, unknown> & {
  [VERIFIED_INTERNAL_CONTEXT_SYMBOL]?: InternalAuthContext;
};

function buildUnauthorizedRpcException(): RpcException {
  return new RpcException({
    statusCode: 401,
    error: 'Unauthorized',
    message: 'Invalid or expired internal auth context',
  });
}

@Injectable()
export class InternalContextGuard implements CanActivate {
  private readonly logger = new Logger(InternalContextGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly configService: ConfigService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublicInternal = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_INTERNAL_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublicInternal === true) {
      return true;
    }

    const secret = this.configService.get<string>('INTERNAL_TCP_SECRET');
    if (typeof secret !== 'string' || secret.trim().length === 0) {
      this.logger.error('INTERNAL_TCP_SECRET is not configured in core-service');
      throw buildUnauthorizedRpcException();
    }

    const rpcData = context.switchToRpc().getData<unknown>();
    if (typeof rpcData !== 'object' || rpcData === null) {
      throw buildUnauthorizedRpcException();
    }

    const envelope = rpcData as RpcDataWithVerifiedContext;
    const rawContext = envelope.context;

    if (!verifyInternalAuthContext(rawContext, secret)) {
      throw buildUnauthorizedRpcException();
    }

    envelope[VERIFIED_INTERNAL_CONTEXT_SYMBOL] = rawContext;
    return true;
  }
}
