import { describe, expect, it } from 'vitest';
import { decryptTextWithPassphrase, encryptTextWithPassphrase } from './logic';

describe('Offline PBKDF2-SHA256 + AES-256-GCM text encryption & decryption', () => {
  it('encrypts with random salt/IV and decrypts UTF-8 config secrets accurately', async () => {
    const secretText = 'WG_PRIVATE_KEY=yAnz5TF+lXXJte14tji3zlMNq+hd2rYUIgJBgB3fBmk=\n备注=家庭网关';
    const enc1 = await encryptTextWithPassphrase(secretText, 'master-pass-123', 20_000);
    const enc2 = await encryptTextWithPassphrase(secretText, 'master-pass-123', 20_000);

    expect(enc1.ok && enc2.ok).toBe(true);
    if (!enc1.ok || !enc2.ok) return;

    // Distinct CSPRNG salts/IVs produce distinct ciphertexts for identical plaintexts
    expect(enc1.output).not.toBe(enc2.output);
    expect(enc1.output.startsWith('PKB1.')).toBe(true);

    const dec = await decryptTextWithPassphrase(enc1.output, 'master-pass-123');
    expect(dec).toEqual({ ok: true, output: secretText, iterations: 20_000 });

    // Wrong passphrase or tampered header/ciphertext must fail AEAD authentication
    const wrongPw = await decryptTextWithPassphrase(enc1.output, 'wrong-pass');
    expect(wrongPw).toEqual({ ok: false, error: 'auth_failed' });

    const tampered = `${enc1.output.slice(0, -2)}AA`;
    const badTag = await decryptTextWithPassphrase(tampered, 'master-pass-123');
    expect(badTag.ok).toBe(false);
  });
});
