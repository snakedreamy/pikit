// Offline JWT inspector (decodes Header & Payload and formats local timestamps in-browser; never verifies signatures or transmits tokens)

export interface DecodedJwt {
  ok: boolean;
  headerJson: string;
  payloadJson: string;
  signaturePart: string;
  claims: {
    alg?: string;
    iss?: string;
    sub?: string;
    iatMs?: number;
    nbfMs?: number;
    expMs?: number;
    expired?: boolean;
  };
  error?: string;
}

const MAX_SAFE_DATE_MS = 8.64e15;

function toSafeEpochMs(sec: unknown): number | undefined {
  if (typeof sec !== 'number' || !Number.isFinite(sec)) return undefined;
  const ms = sec * 1000;
  return Math.abs(ms) <= MAX_SAFE_DATE_MS ? ms : undefined;
}

function isPlainJsonObject(val: unknown): val is Record<string, unknown> {
  return Boolean(val) && typeof val === 'object' && !Array.isArray(val);
}
function decodeBase64UrlUtf8(seg: string): string | null {
  const normalized = seg.replace(/-/g, '+').replace(/_/g, '/');
  if (normalized.length % 4 === 1) return null;
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  try {
    const bin = atob(padded);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

export function inspectJwtToken(raw: string, nowMs = Date.now()): DecodedJwt {
  const trimmed = raw.trim().replace(/^Bearer\s+/i, '').trim();
  if (!trimmed) {
    return {
      ok: true,
      headerJson: '',
      payloadJson: '',
      signaturePart: '',
      claims: {},
    };
  }

  const parts = trimmed.split('.');
  if (parts.length !== 3) {
    return {
      ok: false,
      headerJson: '',
      payloadJson: '',
      signaturePart: '',
      claims: {},
      error: 'parts',
    };
  }

  const headerStr = decodeBase64UrlUtf8(parts[0]);
  const payloadStr = decodeBase64UrlUtf8(parts[1]);
  if (!headerStr || !payloadStr) {
    return {
      ok: false,
      headerJson: '',
      payloadJson: '',
      signaturePart: '',
      claims: {},
      error: 'base64',
    };
  }

  try {
    const headerRaw: unknown = JSON.parse(headerStr);
    const payloadRaw: unknown = JSON.parse(payloadStr);
    if (!isPlainJsonObject(headerRaw) || !isPlainJsonObject(payloadRaw)) {
      return {
        ok: false,
        headerJson: '',
        payloadJson: '',
        signaturePart: '',
        claims: {},
        error: 'json',
      };
    }

    const iatMs = toSafeEpochMs(payloadRaw.iat);
    const nbfMs = toSafeEpochMs(payloadRaw.nbf);
    const expMs = toSafeEpochMs(payloadRaw.exp);

    return {
      ok: true,
      headerJson: JSON.stringify(headerRaw, null, 2),
      payloadJson: JSON.stringify(payloadRaw, null, 2),
      signaturePart: parts[2],
      claims: {
        alg: typeof headerRaw.alg === 'string' ? headerRaw.alg : undefined,
        iss: typeof payloadRaw.iss === 'string' ? payloadRaw.iss : undefined,
        sub: typeof payloadRaw.sub === 'string' ? payloadRaw.sub : undefined,
        iatMs,
        nbfMs,
        expMs,
        expired: expMs !== undefined ? nowMs >= expMs : undefined,
      },
    };
  } catch {
    return {
      ok: false,
      headerJson: '',
      payloadJson: '',
      signaturePart: '',
      claims: {},
      error: 'json',
    };
  }
}
