# Changelog

All notable changes to `pikbay` are documented in this file. Published release sections are append-only; newer releases are added at the top.

## [0.3.1] - 2026-11-28

### Fixes

- **Cross-Platform Windows Release Test & Atomic Container Publishing (`src/system/disk.rs`, `.github/workflows/release.yml`)**:
  - Switches `/proc/self/mountinfo` VFS symlink traversal in `src/system/disk.rs` to pure POSIX `/` segment operations so unit tests execute identically on `x86_64-pc-windows-msvc` without Windows `PathBuf` separator or drive-prefix divergence.
  - Requires all cross-platform binary builds and test suites (`build-binaries`) to succeed before publishing multi-architecture `ghcr.io` container tags in `release.yml`.

## [0.3.0] - 2026-11-28

### Highlights

- **Tactile Industrial Chassis UI & Typography Overhaul (`web/src/styles`, `web/src/features`, `web/src/ui`)**:
  - Self-hosts variable `Instrument Sans` and `Martian Mono` WOFF2 fonts inside the single binary (preserving strict `default-src 'none'` CSP and zero external requests) alongside refined 1px specular surface bevels, neutral graphite dark plates, and warm sand-aluminum light plates.
  - Introduces a cool-sage reflective LCD instrument readout surface in Light mode and ivory recessed input/code wells, paired with a unified single-row hardware status strip across all four workspaces (`Start | Tools | Speed | Drop`), free-standing per-core load bars, and enlarged `30px` sandboxed bookmark icons.
  - Streamlines `/speedtest` (4 sequential stage indicator lamps, `100ms` oscilloscope ticks with a `~300ms` sliding instantaneous window) and `/drop` (`3 + 3` tactile PIN digit slots and consolidated pairing-code actions).
- **Authentication, Encrypted Drop & Speedtest Hardening**:
  - **Immediate WebSocket Session Revocation (`src/auth.rs`, `src/drop.rs`)**: Signing out or reaching `session_ttl_hours` now broadcasts revocation immediately to active `/api/drop/ws` waiting and paired sockets instead of waiting for connection teardown; failed `POST /api/auth/logout` requests surface an explicit error toast without silently re-unlocking cached UI state.
  - **Long-Lived WebRTC P2P Stability & Backpressure (`web/src/features/drop/session.ts`, `src/drop.rs`)**: Sends periodic signaling keepalives while direct `RTCDataChannel` transfers are active, keeps open direct channels alive across signaling idle timeouts, enforces multi-tick `bufferedamountlow` backpressure (`512 KiB` high-water mark with stall protection), and guards waiting-room cleanup with monotonic room instance IDs.
  - **Speedtest Request Budgeting, Probe Timeouts & Exact Daily Quotas (`web/src/features/speedtest/engine.ts`, `src/speedtest.rs`)**: Caps per-phase HTTP chunk requests within tight `per_ip_requests_per_minute` budgets (down to `60 RPM`), enforces `5s` per-request deadlines on latency probes and `/api/system` telemetry polls, and rejects final upload chunks that cross `daily_quota_gb` consistently with download reservations.
- **Toolbox & Storage Isolation Refinements**:
  - **VFS-Order Zero-Blocking Disk Classification (`src/system/disk.rs`)**: Walks configured disk paths component-by-component from `/` and expands local symlinks before subsequent `..` segments, routing paths that touch remote NFS/SMB/CIFS/SSHFS mounts to the isolated network probe worker without invoking syscalls inside hung remote mounts.
  - **Lossless `data-convert`, `docker-convert`, `cron` & `timestamp` Upgrades**: Rejects colliding YAML scalar keys (`1` vs `"1"`), unresolved custom YAML tags (`!Ref`), and lossy high-precision non-integer decimals while preserving integer-valued decimals (`9223372036854775807.0`) as exact 64-bit integers; preserves `--entrypoint=""`, warns on `--publish-all` in Compose, maps `--restart on-failure:N` to systemd `StartLimitBurst=N` without injecting `Restart=` when omitted; expands `cron` leap-day lookahead to 40 years; and adds an `Auto / s / ms` unit selector to `timestamp`.
  - **Startup Log Redaction (`src/config.rs`)**: Redacts literal values in TOML parse errors and omits raw bookmark URLs from startup validation errors so credentials or tokens in mistyped URLs never enter system logs.

## [0.2.0] - 2026-11-27

### Highlights

- **Peer-to-Peer End-to-End Encrypted LAN Drop (`/drop` + `src/drop.rs`)**:
  - Adds a 4th symmetric top-bar workspace (`Start | Tools | Speed | Drop`, configurable via optional `[drop]` in `config.toml` while preserving seamless `version = 1` config compatibility).
  - Pairs two live browser sessions via a CSPRNG one-time **6-digit numeric code** (`code_ttl_seconds = 180` default) with strict **single-attempt room destruction**: the pairing slot is atomically removed on the first join lookup, and any MAC mismatch or disconnect destroys the session immediately to prevent online PIN guessing.
  - Negotiates ephemeral **X25519** keys bound with both 128-bit salts and the 6-digit PIN via **HKDF-SHA256**, verifies mutual **Key Confirmation MACs** before transmitting any transfer metadata, and encrypts text, `Ctrl+V` clipboard captures, and files in **64 KiB ChaCha20-Poly1305 (256-bit AEAD)** chunks with monotonic sequence numbers and an authenticated EOF frame (works identically on HTTPS and plain-HTTP private LAN IPs).
  - Prefers direct LAN **WebRTC `RTCDataChannel`** (`iceServers: []`, zero external STUN/TURN requests) and automatically falls back after 3 seconds to streaming the same AEAD ciphertext chunks over `/api/drop/ws` with bounded `mpsc` / `bufferedAmount` backpressure (`max_relay_mb = 256`), mandatory same-origin `Origin` CSWSH checks, per-IP `governor` rate limiting, and zero server storage.
- **Expanded 100% In-Browser IT Toolbox (`/tools`, 25 Tools)**:
  - **Upgraded `text-diff`**: Adds left/right file pickers and drag-and-drop import (detecting NUL-containing binary files for byte-length & SHA-256 comparison instead of rendering garbled bytes), **Unified / Split** side-by-side view toggle, **collapse unchanged context**, and **ignore trailing whitespace**.
  - **Upgraded `text-case`**: Expands in place with visual grapheme counting (`Intl.Segmenter` ZWJ emoji aware), Unicode code points, UTF-16 code units, UTF-8 bytes, split CJK & Latin word counts, digits/punctuation/whitespace breakdown, paragraph & sentence counts, `LF / CRLF / CR / mixed` line-ending detection, max/average line length, estimated reading time, Top 8 token frequency, and NUL-guarded local text file import alongside all 9 identifier naming conversions.
  - **8 New Lazy-Loaded Local Tools**:
    - `totp`: RFC 6238 TOTP generator supporting Base32 secrets & `otpauth://totp/...` URIs, `SHA-1 / SHA-256 / SHA-512`, `6 / 8` digits, custom step period, and live Previous / Current / Next window display (never persisted to `localStorage`).
    - `data-convert`: Three-way `YAML ↔ JSON ↔ TOML` converter, formatter, and exact line/column syntax validator (`yaml` + `smol-toml` isolated in a lazy chunk).
    - `chmod`: Two-way POSIX 12-bit permission matrix (`rwx` + `SUID / SGID / Sticky`) synced with octal (`0640`), symbolic (`rwxr-x---`), and `chmod` CLI commands.
    - `url-parser`: RFC 3986 / WHATWG URL breakdown with interactive row-by-row Query parameter editing and live URL reconstruction.
    - `docker-convert`: Self-contained shell tokenizer converting `docker run` / `podman run` commands into `compose.yaml` and **Podman `.container` Quadlet** systemd unit files.
    - `bcrypt`: Web Worker–isolated Eksblowfish `$2b$` hash generator, password verifier, and `.htpasswd` / Caddy `basic_auth` snippet builder.
    - `text-encrypt`: Offline passphrase-based `PBKDF2-HMAC-SHA256` + `AES-256-GCM` authenticated text encryption & decryption (WebCrypto with bit-exact pure-TS fallback for plain-HTTP LANs).
    - `device-info`: Zero-network client device & browser diagnostics workbench probing physical render pixels, `requestAnimationFrame` measured screen refresh rate (`Hz`), color gamut (`Rec.2020 / P3 / sRGB`) & HDR, Chromium high-entropy Client Hints, unmasked WebGL2 GPU renderer (immediately releasing context) & WebGPU adapter status, 1080p60 hardware media decode matrix (`H.264 / HEVC / AV1 / VP9 / Opus / FLAC / AAC / Vorbis`), security context, and storage quota with one-click Markdown / JSON report export.
- **Speedtest & Security Refinements**:
  - Tapers tail upload chunks near the 10-second deadline and drains in-flight `POST /api/speed/up` streams gracefully before aborting, eliminating `H3_REQUEST_CANCELLED` (`502`) reverse-proxy log noise in Caddy over HTTP/3 while keeping manual Stop instantaneous.
  - Extends `check-no-network.mjs` to ban `RTCPeerConnection` inside `src/features/tools/**`, preserving strict offline guarantees across all 25 tools.

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
