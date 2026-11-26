# Changelog

All notable changes to `pikbay` are documented in this file. Published release sections are append-only; newer releases are added at the top.

## [0.2.0] - 2026-11-26

### Highlights

- **Peer-to-Peer End-to-End Encrypted LAN Drop (`/drop` + `src/drop.rs`)**:
  - Adds a 4th symmetric top-bar workspace (`Start | Tools | Speed | Drop`, configurable via optional `[drop]` in `config.toml` while preserving seamless `version = 1` config compatibility).
  - Pairs two live browser sessions via a CSPRNG one-time **6-digit numeric code** (`code_ttl_seconds = 180` default) with strict **single-attempt room destruction**: the pairing slot is atomically removed on the first join lookup, and any MAC mismatch or disconnect destroys the session immediately to prevent online PIN guessing.
  - Negotiates ephemeral **X25519** keys bound with both 128-bit salts and the 6-digit PIN via **HKDF-SHA256**, verifies mutual **Key Confirmation MACs** before transmitting any transfer metadata, and encrypts text, `Ctrl+V` clipboard captures, and files in **64 KiB ChaCha20-Poly1305 (256-bit AEAD)** chunks with monotonic sequence numbers and an authenticated EOF frame (works identically on HTTPS and plain-HTTP private LAN IPs).
  - Prefers direct LAN **WebRTC `RTCDataChannel`** (`iceServers: []`, zero external STUN/TURN requests) and automatically falls back after 3 seconds to streaming the same AEAD ciphertext chunks over `/api/drop/ws` with bounded `mpsc` / `bufferedAmount` backpressure (`max_relay_mb = 256`), mandatory same-origin `Origin` CSWSH checks, per-IP `governor` rate limiting, and zero server storage.
- **Expanded 100% In-Browser IT Toolbox (`/tools`, 24 Tools — Full 4×6 Grid)**:
  - **Upgraded `text-diff`**: Adds left/right file pickers and drag-and-drop import (detecting NUL-containing binary files for byte-length & SHA-256 comparison instead of rendering garbled bytes), **Unified / Split** side-by-side view toggle, **collapse unchanged context**, and **ignore trailing whitespace**.
  - **7 New Lazy-Loaded Local Tools**:
    - `totp`: RFC 6238 TOTP generator supporting Base32 secrets & `otpauth://totp/...` URIs, `SHA-1 / SHA-256 / SHA-512`, `6 / 8` digits, custom step period, and live Previous / Current / Next window display (never persisted to `localStorage`).
    - `data-convert`: Three-way `YAML ↔ JSON ↔ TOML` converter, formatter, and exact line/column syntax validator (`yaml` + `smol-toml` isolated in a lazy chunk).
    - `chmod`: Two-way POSIX 12-bit permission matrix (`rwx` + `SUID / SGID / Sticky`) synced with octal (`0640`), symbolic (`rwxr-x---`), and `chmod` CLI commands.
    - `url-parser`: RFC 3986 / WHATWG URL breakdown with interactive row-by-row Query parameter editing and live URL reconstruction.
    - `docker-convert`: Self-contained shell tokenizer converting `docker run` / `podman run` commands into `compose.yaml` and **Podman `.container` Quadlet** systemd unit files.
    - `bcrypt`: Web Worker–isolated Eksblowfish `$2b$` hash generator, password verifier, and `.htpasswd` / Caddy `basic_auth` snippet builder.
    - `text-encrypt`: Offline passphrase-based `PBKDF2-HMAC-SHA256` + `AES-256-GCM` authenticated text encryption & decryption (WebCrypto with bit-exact pure-TS fallback for plain-HTTP LANs).
- **Security & Architecture Guards**:
  - Extends `check-no-network.mjs` to ban `RTCPeerConnection` inside `src/features/tools/**`, preserving strict offline guarantees across all 24 tools.

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
