import { createHash, randomBytes } from 'node:crypto';
import * as argon2 from 'argon2';

export const MIN_PASSWORD_CHARS = 8;
export const MAX_PASSWORD_CHARS = 128;
export const MAX_PASSWORD_BYTES = 512;

const ARGON2ID_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

const DUMMY_ARGON2ID_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

export function assertValidPasswordInput(plainPassword: string): void {
  if (typeof plainPassword !== 'string') {
    throw new Error('Password must be a string');
  }

  if (plainPassword.length < MIN_PASSWORD_CHARS || plainPassword.length > MAX_PASSWORD_CHARS) {
    throw new Error(
      `Password length must be between ${MIN_PASSWORD_CHARS} and ${MAX_PASSWORD_CHARS} characters`,
    );
  }

  if (Buffer.byteLength(plainPassword, 'utf8') > MAX_PASSWORD_BYTES) {
    throw new Error(`Password must not exceed ${MAX_PASSWORD_BYTES} UTF-8 bytes`);
  }
}

export async function hashPasswordArgon2id(plainPassword: string): Promise<string> {
  assertValidPasswordInput(plainPassword);
  return argon2.hash(plainPassword, ARGON2ID_OPTIONS);
}

export async function verifyPasswordArgon2id(
  passwordHash: string,
  plainPassword: string,
): Promise<boolean> {
  if (typeof passwordHash !== 'string' || passwordHash.length === 0) {
    return false;
  }

  assertValidPasswordInput(plainPassword);
  return argon2.verify(passwordHash, plainPassword);
}

export async function verifyPasswordArgon2idConstantTime(
  passwordHash: string | null | undefined,
  plainPassword: string,
): Promise<boolean> {
  if (
    typeof plainPassword !== 'string' ||
    plainPassword.length === 0 ||
    plainPassword.length > MAX_PASSWORD_CHARS ||
    Buffer.byteLength(plainPassword, 'utf8') > MAX_PASSWORD_BYTES
  ) {
    return false;
  }

  const hasValidHash = typeof passwordHash === 'string' && passwordHash.length > 0;
  const targetHash = hasValidHash ? passwordHash : DUMMY_ARGON2ID_HASH;

  try {
    const matched = await argon2.verify(targetHash, plainPassword);
    return hasValidHash && matched;
  } catch {
    return false;
  }
}

export function hashOpaqueTokenSha256(rawToken: string): string {
  if (typeof rawToken !== 'string' || rawToken.trim().length === 0) {
    throw new Error('Token must be a non-empty string');
  }

  return createHash('sha256').update(rawToken, 'utf8').digest('hex');
}

export function generateVerificationToken(): { rawToken: string; tokenHash: string } {
  const rawToken = randomBytes(32).toString('hex');
  const tokenHash = hashOpaqueTokenSha256(rawToken);
  return { rawToken, tokenHash };
}

export function generateRefreshToken(): { rawToken: string; tokenHash: string } {
  const rawToken = randomBytes(32).toString('hex');
  const tokenHash = hashOpaqueTokenSha256(rawToken);
  return { rawToken, tokenHash };
}
