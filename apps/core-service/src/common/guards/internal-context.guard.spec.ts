import { Controller, ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { MessagePattern, RpcException } from '@nestjs/microservices';
import { Test } from '@nestjs/testing';
import { createInternalAuthContext, INTERNAL_CONTEXT_MAX_SKEW_MS } from '@app/shared';
import { PublicInternal } from '../decorators/public-internal.decorator';
import { InternalContextGuard, VERIFIED_INTERNAL_CONTEXT_SYMBOL } from './internal-context.guard';

describe('InternalContextGuard', () => {
  const secret = 'core-service-test-internal-secret-32-chars';

  function createRpcExecutionContext(
    data: unknown,
    handler: (...args: unknown[]) => unknown,
    targetClass: new (...args: unknown[]) => unknown,
  ): ExecutionContext {
    return {
      getHandler: () => handler,
      getClass: () => targetClass,
      switchToRpc: () => ({
        getData: () => data,
        getContext: () => ({}),
      }),
    } as unknown as ExecutionContext;
  }

  class ProtectedController {
    @MessagePattern('domain.protected')
    handleProtected(this: void): string {
      return 'ok';
    }
  }

  @Controller()
  class PublicHealthController {
    @PublicInternal()
    @MessagePattern('health.check')
    check(this: void): string {
      return 'ok';
    }
  }

  let guard: InternalContextGuard;
  const mockConfigService = {
    get: jest.fn<string | undefined, [string]>(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockConfigService.get.mockReturnValue(secret);

    const moduleRef = await Test.createTestingModule({
      providers: [
        Reflector,
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
        {
          provide: APP_GUARD,
          useClass: InternalContextGuard,
        },
        InternalContextGuard,
      ],
    }).compile();

    guard = moduleRef.get(InternalContextGuard);
  });

  it('allows @PublicInternal() handler (health.check) without signed context', () => {
    const ctx = createRpcExecutionContext(
      {},
      PublicHealthController.prototype.check,
      PublicHealthController,
    );

    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('allows protected handler with valid signed authenticated context and attaches symbol', () => {
    const signedContext = createInternalAuthContext(
      {
        requestId: 'req-auth-1',
        userId: '550e8400-e29b-41d4-a716-446655440000',
      },
      secret,
    );
    const payload: Record<string | symbol, unknown> = {
      context: signedContext,
      payload: { amount: '10.00' },
    };

    const ctx = createRpcExecutionContext(
      payload,
      ProtectedController.prototype.handleProtected,
      ProtectedController,
    );

    expect(guard.canActivate(ctx)).toBe(true);
    expect(payload[VERIFIED_INTERNAL_CONTEXT_SYMBOL]).toEqual(signedContext);
  });

  it('allows protected handler with valid signed anonymous context (userId: null)', () => {
    const signedContext = createInternalAuthContext(
      {
        requestId: 'req-anon-1',
        userId: null,
      },
      secret,
    );
    const payload: Record<string | symbol, unknown> = {
      context: signedContext,
      payload: {},
    };

    const ctx = createRpcExecutionContext(
      payload,
      ProtectedController.prototype.handleProtected,
      ProtectedController,
    );

    expect(guard.canActivate(ctx)).toBe(true);
    expect(payload[VERIFIED_INTERNAL_CONTEXT_SYMBOL]).toEqual(signedContext);
  });

  it('blocks protected handler without @PublicInternal() when context is missing', () => {
    const ctx = createRpcExecutionContext(
      {},
      ProtectedController.prototype.handleProtected,
      ProtectedController,
    );

    expect(() => guard.canActivate(ctx)).toThrow(RpcException);
  });

  it('blocks protected handler when signature is tampered', () => {
    const signedContext = createInternalAuthContext(
      {
        requestId: 'req-tamper-1',
        userId: 'user-1',
      },
      secret,
    );
    const ctx = createRpcExecutionContext(
      {
        context: {
          ...signedContext,
          userId: 'user-2',
        },
        payload: {},
      },
      ProtectedController.prototype.handleProtected,
      ProtectedController,
    );

    expect(() => guard.canActivate(ctx)).toThrow(RpcException);
  });

  it('blocks protected handler when timestamp is outside ±30 seconds', () => {
    const expiredTimestamp = Date.now() - (INTERNAL_CONTEXT_MAX_SKEW_MS + 5_000);
    const signedContext = createInternalAuthContext(
      {
        requestId: 'req-expired-1',
        userId: 'user-1',
        timestamp: expiredTimestamp,
      },
      secret,
    );
    const ctx = createRpcExecutionContext(
      {
        context: signedContext,
        payload: {},
      },
      ProtectedController.prototype.handleProtected,
      ProtectedController,
    );

    expect(() => guard.canActivate(ctx)).toThrow(RpcException);
  });

  it('fails closed when INTERNAL_TCP_SECRET is missing', () => {
    mockConfigService.get.mockReturnValue(undefined);
    const signedContext = createInternalAuthContext(
      {
        requestId: 'req-no-secret',
        userId: null,
      },
      secret,
    );
    const ctx = createRpcExecutionContext(
      {
        context: signedContext,
        payload: {},
      },
      ProtectedController.prototype.handleProtected,
      ProtectedController,
    );

    expect(() => guard.canActivate(ctx)).toThrow(RpcException);
  });
});
