import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { InternalAuthContext } from '@app/shared';
import {
  RpcDataWithVerifiedContext,
  VERIFIED_INTERNAL_CONTEXT_SYMBOL,
} from '../guards/internal-context.guard';

export const CurrentInternalContext = createParamDecorator(
  (_data: unknown, context: ExecutionContext): InternalAuthContext => {
    const rpcData = context.switchToRpc().getData<unknown>();

    if (typeof rpcData !== 'object' || rpcData === null) {
      throw new RpcException({
        statusCode: 401,
        error: 'Unauthorized',
        message: 'Verified internal auth context is missing',
      });
    }

    const verifiedContext = (rpcData as RpcDataWithVerifiedContext)[
      VERIFIED_INTERNAL_CONTEXT_SYMBOL
    ];

    if (!verifiedContext) {
      throw new RpcException({
        statusCode: 401,
        error: 'Unauthorized',
        message: 'Verified internal auth context is missing',
      });
    }

    return verifiedContext;
  },
);
