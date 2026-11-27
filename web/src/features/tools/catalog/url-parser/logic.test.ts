import { describe, expect, it } from 'vitest';
import { buildUrlFromComponents, parseUrlDeep, serializeUrlComponents } from './logic';

describe('URL deep parser & Query parameter rebuilder', () => {
  it('breaks down protocol, credentials, host, port, path, query rows, and hash', () => {
    const parsed = parseUrlDeep(
      'https://ops:s3cr3t@gw.example.ts.net:8443/api/v1/items?tag=arm64&filter=a%20b&tag=linux#metrics'
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    expect(parsed.data.protocol).toBe('https');
    expect(parsed.data.username).toBe('ops');
    expect(parsed.data.password).toBe('s3cr3t');
    expect(parsed.data.hostname).toBe('gw.example.ts.net');
    expect(parsed.data.port).toBe('8443');
    expect(parsed.data.pathname).toBe('/api/v1/items');
    expect(parsed.data.hash).toBe('metrics');
    expect(parsed.data.params).toHaveLength(3);
    expect(parsed.data.params[1]).toMatchObject({ key: 'filter', value: 'a b', enabled: true });

    // Disable second row and add a UTF-8 parameter -> rebuilds valid encoded URL
    parsed.data.params[1].enabled = false;
    parsed.data.params.push({ id: 'q-new', key: 'q', value: '中文 测试', enabled: true });
    const rebuilt = serializeUrlComponents(parsed.data);
    expect(rebuilt).toBe(
      'https://ops:s3cr3t@gw.example.ts.net:8443/api/v1/items?tag=arm64&tag=linux&q=%E4%B8%AD%E6%96%87+%E6%B5%8B%E8%AF%95#metrics'
    );
  });

  it('rejects malformed URLs and out-of-range ports while preserving empty-key query params', () => {
    const bad = parseUrlDeep('not a valid url');
    expect(bad.ok).toBe(false);

    const emptyKeyParsed = parseUrlDeep('https://example.com/search?=fallback&k=1');
    expect(emptyKeyParsed.ok).toBe(true);
    if (!emptyKeyParsed.ok) return;
    expect(serializeUrlComponents(emptyKeyParsed.data)).toBe(
      'https://example.com/search?=fallback&k=1'
    );

    const badPort = buildUrlFromComponents({ ...emptyKeyParsed.data, port: '70000' });
    expect(badPort).toEqual({ ok: false, error: 'invalid_port' });
  });
});
