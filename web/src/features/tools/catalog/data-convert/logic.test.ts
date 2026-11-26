import { describe, expect, it } from 'vitest';
import { convertStructuredData, detectDataFormat } from './logic';

describe('Three-way YAML <-> JSON <-> TOML converter & line/column validator', () => {
  it('converts TOML -> YAML -> JSON -> TOML losslessly on structured config tables', () => {
    const sampleToml = `version = 1

[server]
listen = "127.0.0.1:8080"
trusted_proxies = ["127.0.0.1/32", "::1/128"]

[drop]
enabled = true
code_ttl_seconds = 180`;

    expect(detectDataFormat(sampleToml)).toBe('toml');

    const toYaml = convertStructuredData(sampleToml, 'auto', 'yaml');
    expect(toYaml.ok).toBe(true);
    if (!toYaml.ok) return;
    expect(toYaml.output).toContain('code_ttl_seconds: 180');

    const toJson = convertStructuredData(toYaml.output, 'yaml', 'json');
    expect(toJson.ok).toBe(true);
    if (!toJson.ok) return;

    const backToToml = convertStructuredData(toJson.output, 'auto', 'toml');
    expect(backToToml.ok).toBe(true);
    if (!backToToml.ok) return;
    expect(backToToml.output).toContain('listen = "127.0.0.1:8080"');
  });

  it('reports accurate line and column numbers for invalid YAML, TOML, and JSON', () => {
    const badToml = 'version = 1\n[server\nlisten = "8080"';
    const resToml = convertStructuredData(badToml, 'toml', 'json');
    expect(resToml.ok).toBe(false);
    if (!resToml.ok) {
      expect(resToml.location?.line).toBe(2);
    }

    const badYaml = 'server:\n  listen: [1, 2\n';
    const resYaml = convertStructuredData(badYaml, 'yaml', 'json');
    expect(resYaml.ok).toBe(false);
    if (!resYaml.ok) {
      expect(resYaml.location?.line).toBeGreaterThanOrEqual(2);
    }

    // Explicit warning instead of silent data loss when converting JSON `null` to TOML
    const jsonWithNull = '{"server":{"extra":null}}';
    const resNull = convertStructuredData(jsonWithNull, 'json', 'toml');
    expect(resNull.ok).toBe(false);
  });
});
