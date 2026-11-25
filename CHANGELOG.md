# Changelog

All notable changes to `pikbay` are documented in this file. Published release sections are append-only; newer releases are added at the top.

## [0.1.0] - 2026-11-23

Initial public open-source release under `AGPL-3.0-only`.

### Highlights

- **Single-Binary Self-Hosted Console (`Rust + Svelte 5`)**:
  - Embeds the entire SPA into a single `#![forbid(unsafe_code)]` Rust (`axum 0.8`) executable with zero runtime disk writes, zero database dependencies, and full compatibility with `--read-only` scratch containers and bare-metal `systemd` services.
  - Enforces strict `Content-Security-Policy` (`default-src 'none'; script-src 'self'; style-src 'self'`), same-origin Fetch Metadata / `Origin` API protection, zero external network requests, and schema-versioned (`version = 1`) read-only TOML configuration.
- **Startpage & Live Hardware Telemetry (`/`)**:
  - Responsive 4-column (`88rem` / `1408px`) service bookmark grid with same-origin custom icon hosting (`/icons/<file>`, atomic `O_NOFOLLOW` symlink rejection, and sandboxed SVG CSP) plus automatic monogram badge fallbacks.
  - Global 1-second hardware status strip reporting CPU load + per-core spectrum bars (`/proc/stat` & cgroup v2 quota aware), RAM working set, and zero-config multi-disk discovery (`UFS / NVMe / SD / eMMC / SSD / HDD / ZFS / NAS`) isolated on a non-blocking probe channel.
  - Global bilingual command palette (`/` or `⌘K` / `Ctrl+K`), Dark / Light / System themes, and runtime `English` / `简体中文` switching.
- **Optional Single-User Authentication Gate (`[auth]`)**:
  - Argon2id password verification (`pikbay hash-password` CLI, concurrency semaphore cap, constant-time anti-enumeration), per-IP brute-force rate limiting, `HttpOnly` HMAC-SHA256 session cookies, and immediate in-memory logout revocation.
  - Optional `server.allowed_hosts` domain allowlist and CIDR-verified `server.trusted_proxies` client IP extraction.
- **Streaming Network Speedtest (`/speedtest`)**:
  - Uncompressed `/api/speed/{ping,down,up}` streaming endpoints backed by a 1 MiB random buffer, zero-disk upload byte counting, per-IP token buckets, concurrency caps, and local-timezone daily traffic quota reservations with automatic abort refunds.
  - Parallel adaptive-chunk browser engine with real-time 200ms dual-channel (`RX` / `TX`) SVG oscilloscope polylines and a browser-local history ledger (`localStorage`, up to 50 runs).
- **100% In-Browser Local IT Toolbox (`/tools`, 17 Tools)**:
  - Lazy-chunked plugin architecture (`ui -> lib -> features -> shell` statically verified by CI guards) with zero backend tool APIs and plain-HTTP LAN fallbacks:
    `base64` (UTF-8 & binary files), `url-codec`, `json-format` (lossless 64-bit integers), `timestamp` (DST-aware), `base-convert` (`BigInt` radix 2–36), `color` (`HEX / RGB / HSL / OKLCH`), `hash` (`MD5 / SHA-1 / SHA-256 / SHA-384 / SHA-512`), `hmac`, `uuid` (`v4 / v7`), `token` (rejection-sampled entropy), `jwt` (offline inspector), `text-diff` (Patience-anchored Myers diff), `regex` (800ms ReDoS-isolated Web Worker), `text-case`, `subnet` (`IPv4 / IPv6` CIDR), `cron` (5/6-field Vixie parser & local schedule preview), and `qrcode` (`SVG / PNG` export).
