import {
  assertValidPasswordInput,
  generateRefreshToken,
  generateVerificationToken,
  hashOpaqueTokenSha256,
  hashPasswordArgon2id,
  verifyPasswordArgon2id,
  verifyPasswordArgon2idConstantTime,
} from './auth-crypto.util';

describe('auth-crypto.util', () => {
  it('hashes passwords using Argon2id and verifies matching/non-matching passwords', async () => {
    const hash = await hashPasswordArgon2id('SecurePass123');

    expect(hash.startsWith('$argon2id$')).toBe(true);
    await expect(verifyPasswordArgon2id(hash, 'SecurePass123')).resolves.toBe(true);
    await expect(verifyPasswordArgon2id(hash, 'WrongPass123')).resolves.toBe(false);
  });

  it('allows valid passwords with UTF-8 accents up to 128 chars', async () => {
    const accented = 'ContraseñaSegura123';
    const hash = await hashPasswordArgon2id(accented);

    await expect(verifyPasswordArgon2id(hash, accented)).resolves.toBe(true);
  });

  it('rejects passwords shorter than 8 chars, longer than 128 chars, or > 512 UTF-8 bytes before hashing', async () => {
    expect(() => assertValidPasswordInput('Short1')).toThrow(
      'Password length must be between 8 and 128 characters',
    );
    await expect(hashPasswordArgon2id('A1'.repeat(65))).rejects.toThrow(
      'Password length must be between 8 and 128 characters',
    );

    const highByteChar = '\u{1F600}';
    const over512BytesPassword = 'A1a' + highByteChar.repeat(128);
    expect(over512BytesPassword.length).toBeGreaterThan(128);
    expect(() => assertValidPasswordInput(over512BytesPassword)).toThrow();
  });

  it('verifies login passwords in constant time without throwing on short passwords or missing hash', async () => {
    const realHash = await hashPasswordArgon2id('SecurePass123');

    await expect(verifyPasswordArgon2idConstantTime(realHash, 'abc')).resolves.toBe(false);
    await expect(verifyPasswordArgon2idConstantTime(null, 'abc')).resolves.toBe(false);
    await expect(verifyPasswordArgon2idConstantTime(null, 'SecurePass123')).resolves.toBe(false);
    await expect(verifyPasswordArgon2idConstantTime(realHash, 'A'.repeat(129))).resolves.toBe(
      false,
    );
    await expect(verifyPasswordArgon2idConstantTime(realHash, 'SecurePass123')).resolves.toBe(true);
  });

  it('generates 64-char hex verification and refresh tokens with deterministic SHA-256 hashes', () => {
    const verification = generateVerificationToken();
    const refresh = generateRefreshToken();

    expect(verification.rawToken).toMatch(/^[0-9a-f]{64}$/);
    expect(verification.tokenHash).toBe(hashOpaqueTokenSha256(verification.rawToken));
    expect(refresh.rawToken).toMatch(/^[0-9a-f]{64}$/);
    expect(refresh.tokenHash).toBe(hashOpaqueTokenSha256(refresh.rawToken));
    expect(refresh.rawToken).not.toBe(verification.rawToken);
  });
});
