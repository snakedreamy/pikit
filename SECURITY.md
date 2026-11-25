# Security Policy

## Supported Versions

Only the latest release on `main` receives security fixes:

| Version | Supported |
| ------- | --------- |
| `0.1.x` | Yes       |

## Reporting a Vulnerability

Please **do not** report security vulnerabilities through public GitHub issues.

Instead, open a private report via **[GitHub Security Advisories](https://github.com/snakedreamy/pikbay/security/advisories/new)** and include:

1. Affected version (`pikbay --version`) and deployment topology (loopback, LAN HTTP, or HTTPS reverse proxy).
2. A minimal, self-contained proof of concept or reproduction steps (with all real credentials redacted).
3. Impact assessment (e.g., authentication bypass, CSP bypass, path traversal, or memory exhaustion).

Because `pikbay` is maintained in the author's spare time, reports are triaged on a best-effort basis.

## Operational Security Baseline

By design, `config.example.toml` binds to `127.0.0.1:8080` with authentication disabled for trusted local loopback use. Before exposing `pikbay` to an untrusted network or the public internet:

1. Terminate TLS at a reverse proxy (Caddy, Nginx, Traefik) and never expose the raw `pikbay` port directly.
2. Enable `[auth]` (`enabled = true`) with an Argon2id `password_hash` generated via `pikbay hash-password`.
3. Configure `server.trusted_proxies` to match **only** your reverse proxy IPs/CIDRs and set `server.allowed_hosts` to your domain name.
4. Disable `[speedtest]` (`enabled = false`) if public bandwidth testing is not needed.
