import { describe, expect, it } from 'vitest';
import {
  decodeBase64ToBytes,
  decodeUtf8Base64,
  encodeBytesBase64,
  encodeUtf8Base64,
} from './logic';

describe('base64 codec logic', () => {
  it('round-trips UTF-8 CJK and emoji in both standard and urlsafe modes', () => {
    const src = 'pikbay 控制台 · 100% 本地计算 🚀';
    const std = encodeUtf8Base64(src, 'standard');
    expect(std.ok).toBe(true);
    expect(decodeUtf8Base64(std.output)).toEqual({
      ok: true,
      output: src,
      byteLength: std.byteLength,
    });

    const url = encodeUtf8Base64(src, 'urlsafe');
    expect(url.output.includes('+')).toBe(false);
    expect(url.output.includes('/')).toBe(false);
    expect(url.output.includes('=')).toBe(false);
    expect(decodeUtf8Base64(url.output).output).toBe(src);
  });

  it('encodes and decodes arbitrary binary byte buffers (including data URL prefix)', () => {
    const raw = new Uint8Array([0, 255, 128, 64, 32, 16, 1]);
    const b64 = encodeBytesBase64(raw, 'standard');
    expect(Array.from(decodeBase64ToBytes(`data:application/octet-stream;base64,${b64}`)!)).toEqual(
      Array.from(raw)
    );
  });

  it('rejects malformed base64 strings cleanly', () => {
    expect(decodeUtf8Base64('abcde').ok).toBe(false);
    expect(decodeUtf8Base64('%%%invalid%%%').ok).toBe(false);
  });
});
