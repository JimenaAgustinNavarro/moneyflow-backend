import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OriginCsrfGuard } from './origin-csrf.guard';

describe('OriginCsrfGuard', () => {
  function buildGuard(
    corsOrigin = 'http://localhost:3001,https://app.moneyflow.pe',
  ): OriginCsrfGuard {
    const configService = {
      get: jest.fn().mockReturnValue(corsOrigin),
    } as unknown as ConfigService;

    return new OriginCsrfGuard(configService);
  }

  function createHttpContext(
    method: string,
    headers: Record<string, string | undefined>,
  ): ExecutionContext {
    return {
      getType: () => 'http',
      switchToHttp: () => ({
        getRequest: () => ({
          method,
          headers,
        }),
      }),
    } as unknown as ExecutionContext;
  }

  it('allows safe HTTP methods (GET, HEAD, OPTIONS) without Origin check', () => {
    const guard = buildGuard();

    expect(
      guard.canActivate(createHttpContext('GET', { origin: 'https://evil.example.com' })),
    ).toBe(true);
    expect(guard.canActivate(createHttpContext('HEAD', {}))).toBe(true);
    expect(guard.canActivate(createHttpContext('OPTIONS', {}))).toBe(true);
  });

  it('allows mutating requests from exact allowed Origin or Referer', () => {
    const guard = buildGuard();

    expect(guard.canActivate(createHttpContext('POST', { origin: 'http://localhost:3001' }))).toBe(
      true,
    );
    expect(
      guard.canActivate(
        createHttpContext('DELETE', { referer: 'https://app.moneyflow.pe/settings/sessions' }),
      ),
    ).toBe(true);
  });

  it('blocks prefix-spoofed Origin and foreign Referer with 403 Forbidden', () => {
    const guard = buildGuard();

    expect(() =>
      guard.canActivate(createHttpContext('POST', { origin: 'http://localhost:3001.evil.com' })),
    ).toThrow(ForbiddenException);

    expect(() =>
      guard.canActivate(createHttpContext('POST', { referer: 'https://evil.example.com/phish' })),
    ).toThrow(ForbiddenException);

    expect(() =>
      guard.canActivate(createHttpContext('POST', { 'sec-fetch-site': 'cross-site' })),
    ).toThrow(ForbiddenException);
  });

  it('blocks malformed Origin or Referer headers with 403 Forbidden instead of 500', () => {
    const guard = buildGuard();

    expect(() =>
      guard.canActivate(createHttpContext('POST', { origin: 'not a valid url' })),
    ).toThrow(ForbiddenException);

    expect(() => guard.canActivate(createHttpContext('PATCH', { origin: 'null' }))).toThrow(
      ForbiddenException,
    );

    expect(() =>
      guard.canActivate(createHttpContext('DELETE', { referer: 'javascript:alert(1)' })),
    ).toThrow(ForbiddenException);
  });
});
