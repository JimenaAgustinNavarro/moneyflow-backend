import { createHmac, timingSafeEqual } from 'node:crypto';

export const INTERNAL_CONTEXT_MAX_SKEW_MS = 30_000;

export interface InternalAuthContext {
  requestId: string;
  userId: string | null;
  timestamp: number;
  signature: string;
}

export interface SignedTcpEnvelope<TPayload = unknown> {
  context: InternalAuthContext;
  payload: TPayload;
}

const SHA256_HEX_REGEX = /^[0-9a-f]{64}$/;
const SHA256_BYTE_LENGTH = 32;

function assertValidSecret(secret: string): void {
  if (typeof secret !== 'string' || secret.trim().length === 0) {
    throw new Error('INTERNAL_TCP_SECRET must be a non-empty string');
  }
}

function assertValidContextFields(
  requestId: string,
  userId: string | null,
  timestamp: number,
): void {
  if (typeof requestId !== 'string' || requestId.trim().length === 0) {
    throw new Error('requestId must be a non-empty string');
  }
  if (userId !== null && (typeof userId !== 'string' || userId.trim().length === 0)) {
    throw new Error('userId must be null or a non-empty string');
  }
  if (typeof timestamp !== 'number' || !Number.isInteger(timestamp) || timestamp <= 0) {
    throw new Error('timestamp must be a positive integer');
  }
}

function buildCanonicalMessage(
  requestId: string,
  userId: string | null,
  timestamp: number,
): string {
  return JSON.stringify(['v1', requestId, userId, timestamp]);
}

export function signInternalAuthContext(
  input: { requestId: string; userId: string | null; timestamp: number },
  secret: string,
): string {
  assertValidSecret(secret);
  assertValidContextFields(input.requestId, input.userId, input.timestamp);

  const canonical = buildCanonicalMessage(input.requestId, input.userId, input.timestamp);
  return createHmac('sha256', secret).update(canonical, 'utf8').digest('hex');
}

export function createInternalAuthContext(
  input: { requestId: string; userId: string | null; timestamp?: number },
  secret: string,
): InternalAuthContext {
  const timestamp = input.timestamp ?? Date.now();
  const signature = signInternalAuthContext(
    {
      requestId: input.requestId,
      userId: input.userId,
      timestamp,
    },
    secret,
  );

  return {
    requestId: input.requestId,
    userId: input.userId,
    timestamp,
    signature,
  };
}

export function wrapSignedTcpPayload<TPayload>(
  payload: TPayload,
  input: { requestId: string; userId: string | null; timestamp?: number },
  secret: string,
): SignedTcpEnvelope<TPayload> {
  return {
    context: createInternalAuthContext(input, secret),
    payload,
  };
}

export function verifyInternalAuthContext(
  context: unknown,
  secret: string,
  nowMs: number = Date.now(),
  maxSkewMs: number = INTERNAL_CONTEXT_MAX_SKEW_MS,
): context is InternalAuthContext {
  if (typeof secret !== 'string' || secret.trim().length === 0) {
    return false;
  }
  if (typeof context !== 'object' || context === null) {
    return false;
  }

  const candidate = context as Record<string, unknown>;
  const requestId = candidate.requestId;
  const userId = candidate.userId;
  const timestamp = candidate.timestamp;
  const signature = candidate.signature;

  if (typeof requestId !== 'string' || requestId.trim().length === 0) {
    return false;
  }
  if (userId !== null && (typeof userId !== 'string' || userId.trim().length === 0)) {
    return false;
  }
  if (typeof timestamp !== 'number' || !Number.isInteger(timestamp) || timestamp <= 0) {
    return false;
  }
  if (typeof signature !== 'string' || !SHA256_HEX_REGEX.test(signature)) {
    return false;
  }
  if (typeof nowMs !== 'number' || !Number.isFinite(nowMs)) {
    return false;
  }
  if (typeof maxSkewMs !== 'number' || !Number.isFinite(maxSkewMs) || maxSkewMs < 0) {
    return false;
  }
  if (Math.abs(nowMs - timestamp) > maxSkewMs) {
    return false;
  }

  const expectedHex = signInternalAuthContext({ requestId, userId, timestamp }, secret);
  const expectedBuf = Buffer.from(expectedHex, 'hex');
  const providedBuf = Buffer.from(signature, 'hex');

  if (
    expectedBuf.byteLength !== SHA256_BYTE_LENGTH ||
    providedBuf.byteLength !== SHA256_BYTE_LENGTH
  ) {
    return false;
  }

  return timingSafeEqual(expectedBuf, providedBuf);
}
