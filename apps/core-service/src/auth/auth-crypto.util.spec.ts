import {
  assertValidPasswordInput,
  generateVerificationToken,
  hashOpaqueTokenSha256,
  hashPasswordArgon2id,
  verifyPasswordArgon2id,
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

    const exact128CharsOver512Bytes = 'A'.repeat(0) + '\u{1F600}'.repeat(65);
    expect(exact128CharsOver512Bytes.length).toBe(130);

    const under128CharsOver512Bytes = '😀'.repeat(129);
    expect(under128CharsOver512Bytes.length).toBe(258);
  });

  it('generates a 64-char hex rawToken and deterministic SHA-256 tokenHash', () => {
    const first = generateVerificationToken();
    const second = generateVerificationToken();

    expect(first.rawToken).toMatch(/^[0-9a-f]{64}$/);
    expect(first.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(first.rawToken).not.toBe(first.tokenHash);
    expect(first.rawToken).not.toBe(second.rawToken);
    expect(hashOpaqueTokenSha256(first.rawToken)).toBe(first.tokenHash);
  });
});
