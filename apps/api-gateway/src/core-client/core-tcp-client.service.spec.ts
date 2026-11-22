import { ConflictException, HttpException, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClientProxy } from '@nestjs/microservices';
import { SignedTcpEnvelope, verifyInternalAuthContext } from '@app/shared';
import { Request } from 'express';
import { of, throwError } from 'rxjs';
import { CoreTcpClientService } from './core-tcp-client.service';

describe('CoreTcpClientService', () => {
  const secret = 'gateway-test-internal-secret-32-chars';
  let clientProxyMock: { send: jest.Mock };
  let configServiceMock: { get: jest.Mock };
  let service: CoreTcpClientService;

  beforeEach(() => {
    clientProxyMock = {
      send: jest.fn(),
    };
    configServiceMock = {
      get: jest.fn().mockReturnValue(secret),
    };

    service = new CoreTcpClientService(
      clientProxyMock as unknown as ClientProxy,
      configServiceMock as unknown as ConfigService,
    );
  });

  it('builds sanitized audit context respecting PostgreSQL column bounds', () => {
    const req = {
      headers: {
        'x-request-id': 'req-valid-123',
        'x-forwarded-for': `${'192.168.1.1'.repeat(10)}, 10.0.0.1`,
        'user-agent': 'U'.repeat(600),
      },
      ip: '127.0.0.1',
      socket: { remoteAddress: '127.0.0.1' },
    } as unknown as Request;

    const ctx = service.buildRequestContext(req, null);

    expect(ctx.requestId).toBe('req-valid-123');
    expect(ctx.userId).toBeNull();
    expect(ctx.audit.ipAddress?.length).toBe(64);
    expect(ctx.audit.userAgent?.length).toBe(512);
  });

  it('generates UUID requestId when x-request-id contains non-printable or oversized input', () => {
    const req = {
      headers: {
        'x-request-id': 'invalid request id with spaces',
      },
      ip: '127.0.0.1',
      socket: { remoteAddress: '127.0.0.1' },
    } as unknown as Request;

    const ctx = service.buildRequestContext(req, null);
    expect(ctx.requestId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('wraps payload in SignedTcpEnvelope verifiable by verifyInternalAuthContext', async () => {
    clientProxyMock.send.mockReturnValue(of({ ok: true }));

    const result = await service.send<{ ok: boolean }, { email: string }>(
      'auth.register',
      { email: 'ana@example.com' },
      { requestId: 'req-1', userId: null },
    );

    expect(result).toEqual({ ok: true });
    const callArgs = clientProxyMock.send.mock.calls[0] as [
      string,
      SignedTcpEnvelope<{ email: string }>,
    ];
    const sentEnvelope = callArgs[1];
    expect(verifyInternalAuthContext(sentEnvelope.context, secret)).toBe(true);
    expect(sentEnvelope.context.userId).toBeNull();
    expect(sentEnvelope.payload).toEqual({ email: 'ana@example.com' });
  });

  it('fails closed with InternalServerErrorException when INTERNAL_TCP_SECRET is missing', async () => {
    configServiceMock.get.mockReturnValue(undefined);

    await expect(
      service.send('auth.register', {}, { requestId: 'req-1', userId: null }),
    ).rejects.toThrow(InternalServerErrorException);
  });

  it('maps structured 409 RPC error to HttpException(409)', async () => {
    clientProxyMock.send.mockReturnValue(
      throwError(() => ({
        statusCode: 409,
        error: 'Conflict',
        message: 'Email is already registered',
      })),
    );

    await expect(
      service.send('auth.register', {}, { requestId: 'req-1', userId: null }),
    ).rejects.toThrow(HttpException);

    try {
      await service.send('auth.register', {}, { requestId: 'req-1', userId: null });
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(409);
      expect(error).not.toBeInstanceOf(ConflictException);
    }
  });
});
