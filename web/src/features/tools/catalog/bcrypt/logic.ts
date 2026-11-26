// Bcrypt password hash generator, verifier, and HTTP Basic Auth / Caddy `basic_auth` formatter

import bcrypt from 'bcryptjs';

export interface BcryptGenerateOutput {
  hash: string;
  htpasswdLine: string;
  caddySnippet: string;
  elapsedMs: number;
  truncated72Bytes: boolean;
}

export interface BcryptVerifyOutput {
  validFormat: boolean;
  matched: boolean;
  rounds: number | null;
  elapsedMs: number;
}

function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

export function utf8ByteLength(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

export function formatBasicAuthSnippets(
  username: string,
  hash: string
): { htpasswdLine: string; caddySnippet: string } {
  const safeUser = username.trim().replace(/[:\s]+/g, '') || 'admin';
  return {
    htpasswdLine: `${safeUser}:${hash}`,
    caddySnippet: `basic_auth {\n    ${safeUser} ${hash}\n}`,
  };
}

export function generateBcryptHashSync(
  password: string,
  rounds: number,
  username = 'admin'
): BcryptGenerateOutput {
  const safeRounds = Math.max(4, Math.min(15, Math.floor(rounds)));
  const t0 = nowMs();
  const salt = bcrypt.genSaltSync(safeRounds);
  // Normalize `$2a$` -> `$2b$` standard modern prefix (compatible with Caddy, Nginx, OpenBSD, Python/Rust)
  const rawHash = bcrypt.hashSync(password, salt);
  const hash = rawHash.startsWith('$2a$') ? `$2b$${rawHash.slice(4)}` : rawHash;
  const elapsedMs = Math.max(0, Number((nowMs() - t0).toFixed(1)));
  const { htpasswdLine, caddySnippet } = formatBasicAuthSnippets(username, hash);

  return {
    hash,
    htpasswdLine,
    caddySnippet,
    elapsedMs,
    truncated72Bytes: utf8ByteLength(password) > 72,
  };
}

export function verifyBcryptHashSync(
  candidatePassword: string,
  targetHash: string
): BcryptVerifyOutput {
  const trimmed = targetHash.trim();
  if (!/^\$2[abxy]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(trimmed)) {
    return {
      validFormat: false,
      matched: false,
      rounds: null,
      elapsedMs: 0,
    };
  }

  const t0 = nowMs();
  // `bcryptjs` handles `$2a$`, `$2b$`, `$2y$`; map `$2y$`/`$2b$` cleanly
  const normalized = trimmed.startsWith('$2y$') ? `$2b$${trimmed.slice(4)}` : trimmed;
  const matched = bcrypt.compareSync(candidatePassword, normalized);
  const rounds = bcrypt.getRounds(normalized);
  const elapsedMs = Math.max(0, Number((nowMs() - t0).toFixed(1)));

  return {
    validFormat: true,
    matched,
    rounds,
    elapsedMs,
  };
}
