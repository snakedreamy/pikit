// RFC 3986 / WHATWG URL deep inspector & interactive Query parameter builder (zero dependencies)

export interface QueryParamRow {
  id: string;
  key: string;
  value: string;
  enabled: boolean;
}

export interface UrlComponents {
  protocol: string;
  username: string;
  password: string;
  hostname: string;
  port: string;
  pathname: string;
  hash: string;
  origin: string;
  params: QueryParamRow[];
}

export type ParseUrlResult =
  | { ok: true; data: UrlComponents }
  | { ok: false; error: string };

function safeDecode(str: string): string {
  try {
    return decodeURIComponent(str);
  } catch {
    return str;
  }
}

export function parseUrlDeep(raw: string): ParseUrlResult {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { ok: false, error: 'URL is empty' };
  }

  let u: URL;
  try {
    u = new URL(trimmed);
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Invalid URL syntax',
    };
  }

  const params: QueryParamRow[] = [];
  let idx = 0;
  u.searchParams.forEach((value, key) => {
    params.push({
      id: `q-${idx++}`,
      key,
      value,
      enabled: true,
    });
  });

  return {
    ok: true,
    data: {
      protocol: u.protocol.replace(/:$/, ''),
      username: safeDecode(u.username),
      password: safeDecode(u.password),
      hostname: u.hostname,
      port: u.port,
      pathname: u.pathname,
      hash: u.hash.replace(/^#/, ''),
      origin: u.origin,
      params,
    },
  };
}

export function rebuildUrlFromComponents(comp: Omit<UrlComponents, 'origin'>): ParseUrlResult {
  const proto = comp.protocol.trim().replace(/:$/, '');
  const host = comp.hostname.trim();
  if (!proto || !host) {
    return { ok: false, error: 'Protocol and hostname are required' };
  }

  try {
    const u = new URL(`${proto}://${host}`);
    if (comp.username) u.username = comp.username;
    if (comp.password) u.password = comp.password;
    if (comp.port.trim()) u.port = comp.port.trim();
    u.pathname = comp.pathname.trim() || '/';

    const sp = new URLSearchParams();
    for (const row of comp.params) {
      if (row.enabled && row.key !== '') {
        sp.append(row.key, row.value);
      }
    }
    const qs = sp.toString();
    u.search = qs ? `?${qs}` : '';
    const cleanHash = comp.hash.replace(/^#/, '');
    u.hash = cleanHash ? `#${cleanHash}` : '';

    return {
      ok: true,
      data: {
        ...comp,
        origin: u.origin,
      },
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Invalid URL component',
    };
  }
}

export function serializeUrlComponents(comp: Omit<UrlComponents, 'origin'>): string | null {
  const proto = comp.protocol.trim().replace(/:$/, '');
  const host = comp.hostname.trim();
  if (!proto || !host) return null;

  try {
    const u = new URL(`${proto}://${host}`);
    if (comp.username) u.username = comp.username;
    if (comp.password) u.password = comp.password;
    if (comp.port.trim()) u.port = comp.port.trim();
    u.pathname = comp.pathname.trim() || '/';

    const sp = new URLSearchParams();
    for (const row of comp.params) {
      if (row.enabled && row.key !== '') {
        sp.append(row.key, row.value);
      }
    }
    const qs = sp.toString();
    u.search = qs ? `?${qs}` : '';
    const cleanHash = comp.hash.replace(/^#/, '');
    u.hash = cleanHash ? `#${cleanHash}` : '';
    return u.toString();
  } catch {
    return null;
  }
}
