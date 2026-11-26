// RFC 6238 TOTP & RFC 4226 HOTP generator with RFC 4648 Base32 and `otpauth://totp/...` URI parser (zero dependencies)

import { hmacPure } from '../../../../lib/digest';

export type TotpAlgorithm = 'SHA-1' | 'SHA-256' | 'SHA-512';
export type TotpDigits = 6 | 8;

export interface ParsedOtpInput {
  secretBase32: string;
  issuer?: string;
  account?: string;
  algorithm?: TotpAlgorithm;
  digits?: TotpDigits;
  period?: number;
}

export interface TotpWindowResult {
  ok: true;
  previous: string;
  current: string;
  next: string;
  remainingSeconds: number;
  period: number;
  counter: bigint;
  issuer?: string;
  account?: string;
}

export type TotpComputeResult =
  | TotpWindowResult
  | {
      ok: false;
      error: string;
    };

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function decodeBase32Secret(raw: string): Uint8Array {
  const cleaned = raw
    .toUpperCase()
    .replace(/[\s\-=]+/g, '');
  if (cleaned.length === 0) {
    throw new Error('Base32 secret is empty');
  }

  let acc = 0;
  let bits = 0;
  const bytes: number[] = [];

  for (let i = 0; i < cleaned.length; i += 1) {
    const idx = BASE32_ALPHABET.indexOf(cleaned[i]);
    if (idx < 0) {
      throw new Error(`Invalid Base32 character: ${cleaned[i]}`);
    }
    acc = (acc << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((acc >>> bits) & 0xff);
    }
  }

  if (bytes.length === 0) {
    throw new Error('Base32 secret is too short');
  }
  return new Uint8Array(bytes);
}

export function parseOtpInput(raw: string): ParsedOtpInput {
  const trimmed = raw.trim();
  if (!/^otpauth:\/\//i.test(trimmed)) {
    return { secretBase32: trimmed };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error('Malformed otpauth:// URI');
  }

  const otpType = (parsed.hostname || parsed.pathname.replace(/^\/+/, '').split('/')[0] || '').toLowerCase();
  if (otpType && otpType !== 'totp') {
    throw new Error(`Unsupported otpauth type: ${otpType} (expected totp)`);
  }

  const secret = parsed.searchParams.get('secret') ?? '';
  if (!secret.trim()) {
    throw new Error('otpauth:// URI is missing required secret parameter');
  }

  let rawLabel = parsed.hostname.toLowerCase() === 'totp'
    ? parsed.pathname.replace(/^\/+/, '')
    : parsed.pathname.replace(/^\/+totp\//i, '');
  try {
    rawLabel = decodeURIComponent(rawLabel);
  } catch {
    // Keep raw label if percent-decoding fails
  }

  let issuer = parsed.searchParams.get('issuer')?.trim() || undefined;
  let account: string | undefined;
  if (rawLabel.includes(':')) {
    const [labelIssuer, ...rest] = rawLabel.split(':');
    if (!issuer && labelIssuer.trim()) issuer = labelIssuer.trim();
    account = rest.join(':').trim() || undefined;
  } else if (rawLabel.trim()) {
    account = rawLabel.trim();
  }

  const algRaw = (parsed.searchParams.get('algorithm') ?? '').toUpperCase().replace('-', '');
  let algorithm: TotpAlgorithm | undefined;
  if (algRaw === 'SHA1') algorithm = 'SHA-1';
  else if (algRaw === 'SHA256') algorithm = 'SHA-256';
  else if (algRaw === 'SHA512') algorithm = 'SHA-512';
  else if (algRaw !== '') throw new Error(`Unsupported TOTP algorithm: ${algRaw}`);

  const digitsRaw = parsed.searchParams.get('digits');
  let digits: TotpDigits | undefined;
  if (digitsRaw === '6') digits = 6;
  else if (digitsRaw === '8') digits = 8;
  else if (digitsRaw !== null && digitsRaw !== '') {
    throw new Error('Digits must be 6 or 8');
  }

  const periodRaw = parsed.searchParams.get('period');
  let period: number | undefined;
  if (periodRaw !== null && periodRaw !== '') {
    const num = Number(periodRaw);
    if (!Number.isInteger(num) || num < 5 || num > 3600) {
      throw new Error('Period must be between 5 and 3600 seconds');
    }
    period = num;
  }

  return {
    secretBase32: secret,
    issuer,
    account,
    algorithm,
    digits,
    period,
  };
}

export function computeHotpCode(
  secretBytes: Uint8Array,
  counter: bigint,
  algorithm: TotpAlgorithm = 'SHA-1',
  digits: TotpDigits = 6
): string {
  const msg = new Uint8Array(8);
  const dv = new DataView(msg.buffer);
  dv.setBigUint64(0, counter < 0n ? 0n : counter, false);

  const mac = hmacPure(algorithm, secretBytes, msg);
  const offset = mac[mac.length - 1] & 0x0f;
  const binary =
    ((mac[offset] & 0x7f) << 24) |
    ((mac[offset + 1] & 0xff) << 16) |
    ((mac[offset + 2] & 0xff) << 8) |
    (mac[offset + 3] & 0xff);

  const mod = digits === 8 ? 100_000_000 : 1_000_000;
  return String(binary % mod).padStart(digits, '0');
}

export function computeTotpWindow(params: {
  rawInput: string;
  algorithm: TotpAlgorithm;
  digits: TotpDigits;
  period: number;
  nowMs?: number;
}): TotpComputeResult {
  try {
    const parsed = parseOtpInput(params.rawInput);
    const secretBytes = decodeBase32Secret(parsed.secretBase32);
    const alg = parsed.algorithm ?? params.algorithm;
    const digits = parsed.digits ?? params.digits;
    const period = parsed.period ?? params.period;
    if (!Number.isFinite(period) || period < 5 || period > 3600) {
      return { ok: false, error: 'Period must be between 5 and 3600 seconds' };
    }

    const nowSec = Math.max(0, Math.floor((params.nowMs ?? Date.now()) / 1000));
    const step = BigInt(Math.floor(nowSec / period));
    const remainingSeconds = period - (nowSec % period);

    const previous = step > 0n ? computeHotpCode(secretBytes, step - 1n, alg, digits) : computeHotpCode(secretBytes, 0n, alg, digits);
    const current = computeHotpCode(secretBytes, step, alg, digits);
    const next = computeHotpCode(secretBytes, step + 1n, alg, digits);
    secretBytes.fill(0);

    return {
      ok: true,
      previous,
      current,
      next,
      remainingSeconds,
      period,
      counter: step,
      issuer: parsed.issuer,
      account: parsed.account,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export function formatOtpDisplay(code: string): string {
  if (code.length === 6) return `${code.slice(0, 3)} ${code.slice(3)}`;
  if (code.length === 8) return `${code.slice(0, 4)} ${code.slice(4)}`;
  return code;
}
