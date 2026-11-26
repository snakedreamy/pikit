export interface AuthMeta {
  enabled: boolean;
  authenticated: boolean;
  username?: string;
}

export interface SpeedtestLimitsMeta {
  maxDownloadMb: number;
  maxUploadMb: number;
  maxStreams: number;
}

export interface DropLimitsMeta {
  codeTtlSeconds: number;
  maxRelayMb: number;
}

export interface AppMeta {
  version: string;
  commit: string;
  title: string;
  auth: AuthMeta;
  features: {
    system: boolean;
    perCore: boolean;
    speedtest: boolean;
    drop: boolean;
  };
  speedtestLimits?: SpeedtestLimitsMeta;
  dropLimits?: DropLimitsMeta;
}

export class ApiHttpError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export async function fetchAppMeta(signal?: AbortSignal): Promise<AppMeta> {
  const res = await fetch('/api/meta', {
    method: 'GET',
    headers: { Accept: 'application/json' },
    signal,
  });
  if (!res.ok) {
    throw new ApiHttpError(res.status, 'http_error', `HTTP ${res.status}`);
  }
  return (await res.json()) as AppMeta;
}

export async function loginWithPassword(
  username: string,
  password: string
): Promise<void> {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ username, password }),
  });

  if (!res.ok) {
    let code = 'auth_failed';
    let message = `HTTP ${res.status}`;
    try {
      const errJson = (await res.json()) as { error?: string; message?: string };
      if (errJson.error) code = errJson.error;
      if (errJson.message) message = errJson.message;
    } catch {
      // Retain status-code fallback message
    }
    throw new ApiHttpError(res.status, code, message);
  }
}

export async function logoutSession(): Promise<void> {
  await fetch('/api/auth/logout', {
    method: 'POST',
    headers: { Accept: 'application/json' },
  });
}
