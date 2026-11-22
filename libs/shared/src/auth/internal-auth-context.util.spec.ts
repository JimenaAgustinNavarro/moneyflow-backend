import {
  INTERNAL_CONTEXT_MAX_SKEW_MS,
  createInternalAuthContext,
  signInternalAuthContext,
  verifyInternalAuthContext,
  wrapSignedTcpPayload,
} from './internal-auth-context.util';

describe('internal-auth-context.util', () => {
  const secret = 'test-internal-tcp-secret-32-chars-min';
  const baseNowMs = 1_795_400_000_000;

  it('creates and verifies a valid authenticated context within anti-replay window', () => {
    const context = createInternalAuthContext(
      {
        requestId: 'req-123',
        userId: '550e8400-e29b-41d4-a716-446655440000',
        timestamp: baseNowMs,
      },
      secret,
    );

    expect(verifyInternalAuthContext(context, secret, baseNowMs)).toBe(true);
    expect(
      verifyInternalAuthContext(context, secret, baseNowMs + INTERNAL_CONTEXT_MAX_SKEW_MS),
    ).toBe(true);
    expect(
      verifyInternalAuthContext(context, secret, baseNowMs - INTERNAL_CONTEXT_MAX_SKEW_MS),
    ).toBe(true);
  });

  it('creates and verifies a valid anonymous context (userId: null)', () => {
    const envelope = wrapSignedTcpPayload(
      { email: 'user@example.com' },
      { requestId: 'req-anon-1', userId: null, timestamp: baseNowMs },
      secret,
    );

    expect(envelope.payload).toEqual({ email: 'user@example.com' });
    expect(verifyInternalAuthContext(envelope.context, secret, baseNowMs)).toBe(true);
  });

  it('produces distinct non-interchangeable signatures for userId: null vs userId: "anonymous"', () => {
    const nullSig = signInternalAuthContext(
      { requestId: 'req-collision', userId: null, timestamp: baseNowMs },
      secret,
    );
    const literalAnonSig = signInternalAuthContext(
      { requestId: 'req-collision', userId: 'anonymous', timestamp: baseNowMs },
      secret,
    );

    expect(nullSig).not.toBe(literalAnonSig);

    expect(
      verifyInternalAuthContext(
        {
          requestId: 'req-collision',
          userId: 'anonymous',
          timestamp: baseNowMs,
          signature: nullSig,
        },
        secret,
        baseNowMs,
      ),
    ).toBe(false);

    expect(
      verifyInternalAuthContext(
        {
          requestId: 'req-collision',
          userId: null,
          timestamp: baseNowMs,
          signature: literalAnonSig,
        },
        secret,
        baseNowMs,
      ),
    ).toBe(false);
  });

  it('rejects tampered fields, wrong secret, or malformed/non-hex signatures safely', () => {
    const context = createInternalAuthContext(
      { requestId: 'req-456', userId: 'user-1', timestamp: baseNowMs },
      secret,
    );

    expect(verifyInternalAuthContext({ ...context, userId: 'user-2' }, secret, baseNowMs)).toBe(
      false,
    );
    expect(verifyInternalAuthContext({ ...context, requestId: 'req-999' }, secret, baseNowMs)).toBe(
      false,
    );
    expect(
      verifyInternalAuthContext({ ...context, timestamp: baseNowMs + 1 }, secret, baseNowMs),
    ).toBe(false);
    expect(verifyInternalAuthContext(context, 'wrong-secret', baseNowMs)).toBe(false);
    expect(verifyInternalAuthContext({ ...context, signature: 'short' }, secret, baseNowMs)).toBe(
      false,
    );
    expect(
      verifyInternalAuthContext(
        { ...context, signature: context.signature.toUpperCase() },
        secret,
        baseNowMs,
      ),
    ).toBe(false);
    expect(verifyInternalAuthContext(context, '', baseNowMs)).toBe(false);
    expect(verifyInternalAuthContext(null, secret, baseNowMs)).toBe(false);
  });

  it('rejects expired or future-skewed timestamps outside ±30 seconds', () => {
    const context = createInternalAuthContext(
      { requestId: 'req-789', userId: null, timestamp: baseNowMs },
      secret,
    );

    expect(
      verifyInternalAuthContext(context, secret, baseNowMs + INTERNAL_CONTEXT_MAX_SKEW_MS + 1),
    ).toBe(false);
    expect(
      verifyInternalAuthContext(context, secret, baseNowMs - INTERNAL_CONTEXT_MAX_SKEW_MS - 1),
    ).toBe(false);
  });

  it('throws when signing with invalid secret or invalid context fields', () => {
    expect(() =>
      signInternalAuthContext({ requestId: 'req-1', userId: null, timestamp: baseNowMs }, '   '),
    ).toThrow();
    expect(() =>
      signInternalAuthContext({ requestId: '', userId: null, timestamp: baseNowMs }, secret),
    ).toThrow();
    expect(() =>
      signInternalAuthContext({ requestId: 'req-1', userId: '  ', timestamp: baseNowMs }, secret),
    ).toThrow();
    expect(() =>
      signInternalAuthContext({ requestId: 'req-1', userId: null, timestamp: 0 }, secret),
    ).toThrow();
  });
});
